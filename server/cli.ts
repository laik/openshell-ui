/**
 * Thin, typed wrapper around the local `openshell` CLI.
 *
 * The gateway speaks gRPC over mTLS, which a browser cannot do directly, so the
 * console talks to the gateway through the CLI that is already authenticated on
 * this machine. Every read uses `-o json` where the CLI supports it.
 */
import { execFile } from 'node:child_process';

export const BIN = process.env.OPENSHELL_BIN ?? 'openshell';

export class CliError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly args: string[];

  constructor(message: string, args: string[], exitCode: number | null, stderr: string, stdout = '') {
    super(message);
    this.name = 'CliError';
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

const ANSI = /\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI, '');
}

/** Collapse the CLI's boxed `Error:   × ...` diagnostic into one line. */
export function cleanError(stderr: string): string {
  const raw = stripAnsi(stderr).trim();
  if (!raw) return 'command failed';
  const oneLine = raw
    .replace(/\\\s*\n\s*/g, ' ')
    .replace(/[├╰│└]/g, ' ')
    .replace(/─▶/g, ' → ')
    .replace(/\s*\n\s*/g, '  ')
    .replace(/\s+/g, ' ');
  const message = /message:\s*"([^"]+)"/.exec(oneLine);
  if (message) return message[1];
  const boxed = /×\s*([\s\S]*)/.exec(oneLine);
  return (boxed ? boxed[1] : oneLine).trim();
}

export interface RunOptions {
  gateway?: string;
  workspace?: string;
  timeoutMs?: number;
  stdin?: string;
  signal?: AbortSignal;
  /** Extra environment variables for this invocation only. */
  env?: Record<string, string | undefined>;
}

/** Run an openshell subcommand and resolve with its stdout. */
export function runCli(args: string[], opts: RunOptions = {}): Promise<string> {
  const argv = [...args];
  if (opts.gateway) argv.unshift('--gateway', opts.gateway);
  if (opts.workspace) argv.unshift('--workspace', opts.workspace);

  return new Promise((resolve, reject) => {
    const child = execFile(
      BIN,
      argv,
      {
        maxBuffer: 32 * 1024 * 1024,
        timeout: opts.timeoutMs ?? 45_000,
        env: {
          ...process.env,
          OPENSHELL_COLOR: 'never',
          CI: '1',
          TERM: 'dumb',
          ...(opts.env ?? {}),
        },
        signal: opts.signal,
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
          if (code === 'ENOENT') {
            reject(new CliError(`openshell binary not found (looked for "${BIN}")`, argv, 127, ''));
            return;
          }
          const timedOut = /SIGTERM|ETIMEDOUT/.test(String(err.message));
          const text = cleanError(stderr) || (timedOut ? 'command timed out' : String(err.message));
          reject(new CliError(text, argv, typeof code === 'number' ? code : 1, stripAnsi(stderr), stripAnsi(stdout)));
          return;
        }
        resolve(stdout);
      },
    );
    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.end(opts.stdin);
    }
  });
}

/** Split a user-typed command into argv, honouring single and double quotes. */
export function tokenize(command: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let started = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        out.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}

/** Run an openshell subcommand whose output is JSON. */
export async function runJson<T>(args: string[], opts: RunOptions = {}): Promise<T> {
  const out = await runCli(args, opts);
  const trimmed = out.trim();
  if (!trimmed) return undefined as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new CliError(`could not parse output as JSON: ${trimmed.slice(0, 200)}`, args, 1, out);
  }
}
