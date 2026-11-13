/**
 * The network-rule approval commands print human-readable blocks rather than
 * JSON (`openshell rule get` predates the `-o json` convention). These parsers
 * turn that output into a stable shape for the console.
 */

export interface RuleEndpoint {
  raw: string;
  host: string;
  port: number | null;
  protocol: string;
}

export interface NetworkRule {
  chunk_id: string;
  status: string;
  name: string;
  binary: string;
  confidence: number | null;
  rationale: string;
  endpoints: RuleEndpoint[];
  binaries: string[];
  security: string;
  prover: string;
  application: string;
  candidate: string;
  hits: string;
  fields: Record<string, string>;
  sandbox?: string;
}

export interface RuleCollection {
  rules: NetworkRule[];
  summary: string;
  version: string | null;
  total: number;
}

export interface RuleHistoryEntry {
  id: string;
  revision: string;
  time: string;
  status: string;
  chunk_id: string;
  message: string;
  sandbox?: string;
}

export interface RuleHistoryCollection {
  entries: RuleHistoryEntry[];
  sandbox?: string;
}

const FIELD_RE = /^\s{2,}([A-Za-z][A-Za-z ]*?):\s*(.*)$/;

function parseEndpoint(raw: string): RuleEndpoint {
  const clean = raw.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(clean);
  const host = (match?.[1] ?? clean).trim();
  const port = match?.[2] ? Number(match[2]) : null;
  const proto = /\[([^\]]+)\]\s*$/.exec(raw)?.[1] ?? '';
  return { raw: raw.trim(), host, port, protocol: proto };
}

export function parseRules(text: string, sandbox?: string): RuleCollection {
  const clean = text.replace(/\r\n/g, '\n').trim();
  const header = /Network Rules:\s*(.*)$/m.exec(clean);
  const summary = (header?.[1] ?? '').trim();
  const version = /version\s+([\w.-]+)/i.exec(summary)?.[1] ?? null;
  if (!clean || /^No network rules/i.test(clean)) {
    return { rules: [], summary, version, total: 0 };
  }

  const rules: NetworkRule[] = [];
  const blocks = clean.split(/^\s*Chunk:\s*/m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const first = (lines.shift() ?? '').trim();
    const chunkId = first.split(/\s+/)[0] ?? '';
    if (!chunkId) continue;
    const fields: Record<string, string> = {};
    let lastKey = '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const m = FIELD_RE.exec(line);
      if (m) {
        lastKey = m[1].trim();
        fields[lastKey] = m[2].trim();
      } else if (lastKey) {
        // Wrapped values continue on indented lines without a label.
        fields[lastKey] = `${fields[lastKey]} ${line.trim()}`.trim();
      }
    }
    const field = (...names: string[]) => {
      for (const name of names) {
        const hit = Object.keys(fields).find((k) => k.toLowerCase() === name.toLowerCase());
        if (hit !== undefined) return fields[hit];
      }
      return '';
    };
    const endpointText = field('Endpoints');
    const binaryText = field('Binaries');
    rules.push({
      chunk_id: chunkId,
      status: field('Status').toLowerCase() || 'unknown',
      name: field('Rule', 'Name'),
      binary: field('Binary'),
      confidence: parseConfidence(field('Confidence')),
      rationale: field('Rationale'),
      endpoints: splitList(endpointText).map(parseEndpoint),
      binaries: splitList(binaryText),
      security: field('Security'),
      prover: field('Prover'),
      application: field('Application'),
      candidate: field('Candidate'),
      hits: field('Hits'),
      fields,
      ...(sandbox ? { sandbox } : {}),
    });
  }
  return { rules, summary, version, total: rules.length };
}

function parseConfidence(value: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(value);
  if (m) return Number(m[1]);
  const n = Number(value);
  return Number.isFinite(n) && value.trim() !== '' ? n : null;
}

function splitList(value: string): string[] {
  if (!value || /^none$/i.test(value.trim()) || value.trim() === '—') return [];
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse the compact `rule history` listing. */
export function parseRuleHistory(text: string, sandbox?: string): RuleHistoryCollection {
  const clean = text.replace(/\r\n/g, '\n');
  if (!clean.trim() || /^No rule history/i.test(clean)) return { entries: [], ...(sandbox ? { sandbox } : {}) };
  const entries: RuleHistoryEntry[] = [];
  const re = /^\s*(\S+)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(\S+)\s+\[([^\]]+)\]\s*(.*)$/;
  for (const line of clean.split('\n')) {
    const m = re.exec(line);
    if (!m) continue;
    entries.push({
      id: `${m[1]}-${m[2]}-${m[4]}-${entries.length}`,
      revision: m[1],
      time: m[2],
      status: m[3].toLowerCase(),
      chunk_id: m[4],
      message: m[5].trim(),
      ...(sandbox ? { sandbox } : {}),
    });
  }
  return { entries, ...(sandbox ? { sandbox } : {}) };
}

export function parseChunkId(value: string | undefined): string {
  const id = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error(`invalid rule chunk id: ${JSON.stringify(id)}`);
  return id;
}
