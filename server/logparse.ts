/**
 * Parser for `openshell logs`, which has no JSON output mode.
 *
 * Observed shape:
 *   [1794211874.486] [gateway] [INFO ] [openshell_server::supervisor_session] supervisor session: relay opened
 *   [1794211874.486] [sandbox]  [OCSF ] [ocsf] SSH:OPEN [INFO] ALLOWED
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'other';

export interface LogLine {
  id: string;
  ts: number | null;
  source: 'gateway' | 'sandbox' | 'unknown';
  level: LogLevel;
  target: string;
  message: string;
  raw: string;
}

const LINE =
  /^\[(\d{6,12})(?:\.(\d+))?\]\s+\[(gateway|sandbox)\]\s+\[([A-Za-z]+)\s*\]\s*(.*)$/;
const LEVEL_WORDS = /\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b/;

function normaliseLevel(token: string): LogLevel {
  const t = token.toUpperCase();
  if (t === 'ERROR') return 'error';
  if (t === 'WARN' || t === 'WARNING') return 'warn';
  if (t === 'INFO') return 'info';
  if (t === 'DEBUG') return 'debug';
  if (t === 'TRACE') return 'trace';
  return 'other';
}

export function parseLogLine(raw: string, index: number): LogLine {
  const fallback: LogLine = {
    id: `${index}`,
    ts: null,
    source: 'unknown',
    level: 'other',
    target: '',
    message: raw,
    raw,
  };
  const m = LINE.exec(raw);
  if (!m) return fallback;

  const [, seconds, frac, sourceRaw, tag, rest] = m;
  const source = sourceRaw as LogLine['source'];
  const ts = Number(seconds) * 1000 + (frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0);

  // The bracket tag is often the literal level; OCSF records carry a second one inline.
  let level = normaliseLevel(tag);
  let message = rest;
  if (level === 'other') {
    const inner = LEVEL_WORDS.exec(rest);
    if (inner) level = normaliseLevel(inner[1]);
  }
  const targetMatch = /^\[([^\]]+)\]\s*/.exec(rest);
  const target = targetMatch ? targetMatch[1] : '';
  if (targetMatch) message = rest.slice(targetMatch[0].length);

  return {
    id: `${index}-${seconds}`,
    ts: Number.isFinite(ts) ? ts : null,
    source,
    level,
    target,
    message: message.trim(),
    raw,
  };
}

export function parseLogs(stdout: string): LogLine[] {
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0)
    .map((line, i) => parseLogLine(line, i));
}
