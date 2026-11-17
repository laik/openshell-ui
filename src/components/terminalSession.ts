import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { MONO } from '../theme';

export type TerminalStatus = 'connecting' | 'open' | 'closed' | 'error';
export type TerminalMode = 'workload' | 'shell';

export interface SessionState {
  status: TerminalStatus;
  message: string;
}

export interface SessionParams {
  name: string;
  mode: TerminalMode;
  gateway?: string;
  workspace?: string;
}

type Listener = (state: SessionState) => void;

const THEME = {
  background: '#000000',
  foreground: '#e8e8e8',
  cursor: '#76b900',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(118,185,0,0.35)',
  black: '#1a1a1a',
  red: '#ff5449',
  green: '#76b900',
  yellow: '#ffb800',
  blue: '#6eb4ff',
  magenta: '#b8b8b8',
  cyan: '#6eb4ff',
  white: '#d9d9d9',
  brightBlack: '#545454',
  brightRed: '#ff8a80',
  brightGreen: '#9ed435',
  brightYellow: '#ffd08a',
  brightBlue: '#8dc4ff',
  brightMagenta: '#d9d9d9',
  brightCyan: '#8dc4ff',
  brightWhite: '#ffffff',
};

/**
 * A terminal session outlives the React component that displays it: switching
 * tabs or navigating away detaches the xterm element but keeps the WebSocket
 * (and therefore the remote shell / attached workload) alive. Re-opening the
 * terminal re-attaches the same session, scrollback included.
 */
export class TerminalSession {
  readonly key: string;
  readonly params: SessionParams;
  readonly element: HTMLDivElement;
  term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private state: SessionState = { status: 'connecting', message: '' };
  lastAttached = Date.now();

  constructor(key: string, params: SessionParams) {
    this.key = key;
    this.params = params;
    this.element = document.createElement('div');
    this.element.style.width = '100%';
    this.element.style.height = '100%';
  }

  /** Called once, while the element is attached to a visible container. */
  init(): void {
    if (this.term) return;
    const term = new Terminal({
      fontFamily: MONO,
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: false,
      scrollback: 6000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(this.element);
    term.onData((data) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });
    this.term = term;
    this.fitAddon = fit;
    this.fit();
    this.connect();
  }

  private url(): string {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      name: this.params.name,
      cols: String(this.term?.cols ?? 100),
      rows: String(this.term?.rows ?? 30),
      mode: this.params.mode,
    });
    if (this.params.gateway) params.set('gateway', this.params.gateway);
    if (this.params.workspace) params.set('workspace', this.params.workspace);
    return `${scheme}//${window.location.host}/api/terminal?${params.toString()}`;
  }

  connect(): void {
    this.setState({ status: 'connecting', message: '' });
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.setState({ status: 'open', message: '' });
      this.fit();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let payload: { type?: string; data?: string; message?: string; code?: number | null };
      try {
        payload = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (payload.type === 'data') this.term?.write(payload.data ?? '');
      if (payload.type === 'error') this.setState({ status: 'error', message: payload.message ?? 'terminal error' });
      if (payload.type === 'exit') {
        this.setState({
          status: 'closed',
          message:
            payload.message ||
            `session ended (code ${payload.code ?? 'unknown'}) — reconnect to attach again`,
        });
      }
    };
    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.setState({ status: 'error', message: 'the terminal socket failed — is the API bridge running?' });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setState((prev) =>
        prev.status === 'open' ? { status: 'closed', message: prev.message } : prev,
      );
    };
  }

  reconnect(): void {
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    this.connect();
  }

  fit(): void {
    if (!this.fitAddon || this.element.offsetWidth === 0) return;
    try {
      this.fitAddon.fit();
    } catch {
      /* not measurable yet */
    }
    if (this.ws?.readyState === WebSocket.OPEN && this.term) {
      this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
    }
  }

  focus(): void {
    this.term?.focus();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(next: SessionState | ((prev: SessionState) => SessionState)): void {
    this.state = typeof next === 'function' ? next(this.state) : next;
    for (const listener of this.listeners) listener(this.state);
  }

  dispose(): void {
    this.listeners.clear();
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    this.term?.dispose();
    this.term = null;
    this.element.remove();
  }
}

const MAX_SESSIONS = 6;
const sessions = new Map<string, TerminalSession>();

export function sessionKey(params: SessionParams): string {
  return [params.gateway ?? '', params.workspace ?? '', params.name, params.mode].join('|');
}

/** Get (or create) the persistent session for a sandbox + mode. */
export function acquireSession(params: SessionParams): TerminalSession {
  const key = sessionKey(params);
  let session = sessions.get(key);
  if (!session) {
    session = new TerminalSession(key, params);
    sessions.set(key, session);
    if (sessions.size > MAX_SESSIONS) {
      let oldest: TerminalSession | null = null;
      for (const candidate of sessions.values()) {
        if (candidate === session) continue;
        if (!oldest || candidate.lastAttached < oldest.lastAttached) oldest = candidate;
      }
      if (oldest) {
        sessions.delete(oldest.key);
        oldest.dispose();
      }
    }
  }
  session.lastAttached = Date.now();
  return session;
}

export function dropSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  session.dispose();
}

export function listSessions(): TerminalSession[] {
  return Array.from(sessions.values());
}
