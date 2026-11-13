import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded';
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { MONO } from '../theme';
import { PhaseChip } from './ui';

type Status = 'connecting' | 'open' | 'closed' | 'error';

/**
 * A real PTY inside the browser: keystrokes go over a WebSocket to the bridge,
 * which holds `openshell sandbox exec --tty` open. Resizing the panel sends new
 * dimensions on reconnect, matching how the CLI sizes the remote PTY.
 */
export function TerminalPanel({ name, phase }: { name: string; phase: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState('');
  const [nonce, setNonce] = useState(0);

  const ready = phase === 'Ready' || phase === 'Running';

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;

    const term = new XTerm({
      fontFamily: MONO,
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: false,
      scrollback: 6000,
      theme: {
        background: '#080a10',
        foreground: '#e6ebf5',
        cursor: '#7c5cff',
        cursorAccent: '#080a10',
        selectionBackground: 'rgba(124,92,255,0.35)',
        black: '#1a1e2a',
        red: '#ff5f6d',
        green: '#35d29a',
        yellow: '#f2a53c',
        blue: '#5aa9ff',
        magenta: '#a78bfa',
        cyan: '#22d3ee',
        white: '#c8d0e0',
        brightBlack: '#4a5568',
        brightRed: '#ff8a94',
        brightGreen: '#6ee7b7',
        brightYellow: '#ffd08a',
        brightBlue: '#8dc4ff',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* container not measurable yet */
    }
    termRef.current = term;

    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${scheme}//${window.location.host}/api/terminal?name=${encodeURIComponent(
      name,
    )}&cols=${term.cols}&rows=${term.rows}`;
    setStatus('connecting');
    const ws = new WebSocket(url);
    socketRef.current = ws;

    let disposed = false;
    ws.onopen = () => {
      if (disposed) return;
      setStatus('open');
      setMessage('');
    };
    ws.onmessage = (ev) => {
      if (disposed) return;
      let payload: { type?: string; data?: string; message?: string; code?: number | null };
      try {
        payload = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (payload.type === 'data') term.write(payload.data ?? '');
      if (payload.type === 'error') {
        setStatus('error');
        setMessage(payload.message ?? 'terminal error');
      }
      if (payload.type === 'exit') {
        setStatus('closed');
        setMessage(
          payload.message || `shell exited (code ${payload.code ?? 'unknown'}) — restart the sandbox if it completed`,
        );
      }
    };
    ws.onerror = () => {
      if (disposed) return;
      setStatus('error');
      setMessage('the terminal socket failed — is the API bridge running?');
    };
    ws.onclose = () => {
      if (disposed) return;
      setStatus((s) => (s === 'open' ? 'closed' : s));
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });

    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(host);
    term.focus();

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      term.dispose();
      termRef.current = null;
      socketRef.current = null;
    };
  }, [name, ready, nonce]);

  const statusLabel = useMemo(
    () =>
      ({
        connecting: 'opening pty…',
        open: 'streaming',
        closed: 'shell closed',
        error: 'disconnected',
      })[status],
    [status],
  );

  if (!ready) {
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <PhaseChip phase={phase} />
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            `sandbox exec` needs a Ready sandbox — start this one, then reopen the terminal.
          </Typography>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.4,
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <FiberManualRecordRoundedIcon
            sx={{
              fontSize: 9,
              color: status === 'open' ? 'success.main' : status === 'closed' ? 'text.secondary' : 'warning.main',
            }}
          />
          <Typography sx={{ fontFamily: MONO, fontSize: 11.5 }}>{statusLabel}</Typography>
        </Box>
        <Chip
          label={`openshell sandbox exec ${name} --tty`}
          size="small"
          variant="outlined"
          sx={{ fontFamily: MONO, fontSize: 10.5 }}
        />
        <Box sx={{ flex: 1 }} />
        {status === 'closed' || status === 'error' ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<PowerSettingsNewRoundedIcon />}
            onClick={() => setNonce((n) => n + 1)}
          >
            reconnect
          </Button>
        ) : null}
      </Stack>

      {message ? (
        <Typography sx={{ fontFamily: MONO, fontSize: 12, color: 'warning.main' }}>{message}</Typography>
      ) : null}

      <Box
        ref={hostRef}
        sx={{
          height: 'min(62vh, 560px)',
          minHeight: 300,
          bgcolor: '#080a10',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          p: 1,
          overflow: 'hidden',
        }}
      />
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
        ctrl-c interrupts · the shell is the sandbox’s login shell, so PATH and env are the real ones
      </Typography>
    </Stack>
  );
}
