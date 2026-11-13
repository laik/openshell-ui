/** Formatting helpers for gateway values. */

/** Gateway timestamps look like "2026-11-09 08:11:02" (UTC, no zone marker). */
export function parseGatewayTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

export function shortTime(value: string | null | undefined): string {
  const d = parseGatewayTime(value);
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fullTime(value: string | null | undefined): string {
  const d = parseGatewayTime(value);
  if (!d) return '—';
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
}

export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  const d = parseGatewayTime(value);
  if (!d) return '—';
  const diff = now - d.getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  const units: Array<[number, string]> = [
    [1000, 's'],
    [60_000, 'm'],
    [3_600_000, 'h'],
    [86_400_000, 'd'],
    [604_800_000, 'w'],
  ];
  if (abs < 45_000) return diff >= 0 ? 'just now' : 'in a moment';
  let chosen = units[1];
  for (const [step, label] of units) if (abs >= step) chosen = [step, label];
  const [step, label] = chosen;
  return `${Math.round(abs / step)}${label} ${suffix}`;
}

export function durationBetween(a: string | null | undefined, b: string | null | undefined): string {
  const start = parseGatewayTime(a);
  if (!start) return '—';
  const end = parseGatewayTime(b) ?? new Date();
  const secs = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60 ? `${secs % 60}s` : ''}`;
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function truncate(value: string, max = 96): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** Split `key=value` pairs the CLI reports back as a single string. */
export function parsePairs(text: string): Array<{ key: string; value: string }> {
  return text
    .split('\n')
    .map((l) => /^\s*([A-Za-z0-9_./-]+)\s*=\s*(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ key: m[1], value: m[2] }));
}
