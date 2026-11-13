/**
 * OpenShell Console — local API bridge.
 *
 * The gateway is gRPC + mTLS and only the CLI holds those credentials, so every
 * console request is translated into an `openshell` invocation. Reads use the
 * CLI's JSON output mode; the terminal page streams a real PTY over a WebSocket.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import { BIN, CliError, cleanError, runCli, runJson, stripAnsi, tokenize } from './cli.ts';
import { parseLogs } from './logparse.ts';
import {
  addGateway,
  clearTokens,
  listGateways,
  loginGateway,
  logoutGateway,
  probeGateway,
  readMetadata,
  removeGateway,
  selectGateway,
  setGatewayToken,
  tokenKind,
  type AddGatewayBody,
} from './gateways.ts';
import { parseChunkId, parseRuleHistory, parseRules } from './ruleparse.ts';

const PORT = Number(process.env.OPENSHELL_UI_PORT ?? 8787);
const HOST = process.env.OPENSHELL_UI_HOST ?? '127.0.0.1';
const DIST = path.resolve(process.cwd(), 'dist');
const NAME_RE = /^[A-Za-z0-9]([-A-Za-z0-9_.]{0,62}[A-Za-z0-9])?$/;

type Json = Record<string, unknown> | unknown[] | null;

interface Query {
  gateway?: string;
  workspace?: string;
  all?: boolean;
  lines?: number;
  level?: string;
  source?: string;
  since?: string;
  rev?: number;
  status?: string;
  probe?: boolean;
  format?: string;
  global?: boolean;
}

function q(url: URL): Query {
  const p = url.searchParams;
  return {
    gateway: p.get('gateway') ?? undefined,
    workspace: p.get('workspace') ?? undefined,
    all: p.get('all') === '1',
    lines: p.get('lines') ? Number(p.get('lines')) : undefined,
    level: p.get('level') ?? undefined,
    source: p.get('source') ?? undefined,
    since: p.get('since') ?? undefined,
    rev: p.get('rev') ? Number(p.get('rev')) : undefined,
    status: p.get('status') ?? undefined,
    probe: p.get('probe') === '1',
    format: p.get('format') ?? undefined,
    global: p.get('global') === '1',
  };
}

function safeName(value: string | undefined, what = 'name'): string {
  if (!value || !NAME_RE.test(value)) throw new Error(`invalid ${what}: ${JSON.stringify(value)}`);
  return value;
}

function safePort(value: unknown, what = 'port'): string {
  const s = String(value ?? '');
  if (!/^(\d{1,5}(:\d{1,5})?)$/.test(s)) throw new Error(`invalid ${what}: ${s}`);
  return s;
}

// ---------------------------------------------------------------------------
// Resource reads
// ---------------------------------------------------------------------------

async function readContext(opts: Query) {
  const [status, whoami, gateways, workspaces, version] = await Promise.all([
    // The gateway list comes from local CLI metadata, so it still has to reach
    // the browser when the selected gateway is unreachable — otherwise the
    // console could not offer a way to switch back.
    runJson<Record<string, unknown>>(['status', '-o', 'json'], opts).catch((err) => ({
      gateway: opts.gateway ?? '',
      server: '',
      status: 'unreachable',
      version: '',
      authentication: { provider: '', status: '' },
      error: err instanceof CliError ? err.message : cleanError(String((err as Error)?.message ?? err)),
    })),
    runJson<Json>(['whoami', '-o', 'json'], opts).catch(() => null),
    runJson<Json>(['gateway', 'list', '-o', 'json'], {}).catch(() => []),
    runJson<Json>(['workspace', 'list', '-o', 'json'], opts).catch(() => null),
    runCli(['--version'], opts)
      .then((s) => s.trim().replace(/^openshell\s+/, ''))
      .catch(() => 'unknown'),
  ]);
  return { status, whoami, gateways, workspaces, cli_version: version, binary: BIN };
}

async function listSandboxes(opts: Query) {
  const args = ['sandbox', 'list', '-o', 'json', '--page-size', '200'];
  if (opts.all) args.push('--all-workspaces');
  const body = await runJson<{ sandboxes?: Json[]; next_page_token?: string }>(args, opts);
  return { sandboxes: body?.sandboxes ?? [], next_page_token: body?.next_page_token ?? '' };
}

async function sandboxDetail(name: string, opts: Query) {
  const sandbox = await runJson<Record<string, unknown>>(['sandbox', 'get', name, '-o', 'json'], opts);
  const [policy, providers, services] = await Promise.all([
    runJson<Json>(['policy', 'get', name, '--full', '-o', 'json'], opts).catch(() => null),
    runJson<Json>(['sandbox', 'provider', 'list', name, '-o', 'json'], opts).catch(() => null),
    runJson<Json>(['service', 'list', name, '-o', 'json'], opts).catch(() => null),
  ]);
  return { sandbox, policy, providers, services };
}

async function readLogs(name: string, opts: Query) {
  const args = ['logs', name, '-n', String(Math.min(Math.max(opts.lines ?? 400, 1), 5000))];
  if (opts.level) args.push('--level', opts.level);
  if (opts.source) args.push('--source', opts.source);
  if (opts.since) args.push('--since', opts.since);
  const out = await runCli(args, opts);
  return { lines: parseLogs(stripAnsi(out)) };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface CreateBody {
  name?: string;
  from?: string;
  template?: string;
  command?: string;
  cpu?: string;
  memory?: string;
  gpu?: string | boolean;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  providers?: string[];
  forward?: string[];
  expose?: string[];
  restartPolicy?: string;
  detach?: boolean;
  keep?: boolean;
}

function createArgs(body: CreateBody): string[] {
  const args = ['sandbox', 'create', '-o', 'json'];
  if (body.name) args.push('--name', safeName(body.name, 'sandbox name'));
  if (body.template) args.push('--template', safeName(body.template, 'template name'));
  if (body.from) {
    const from = String(body.from).trim();
    if (!/^[\w.\-/:@~]+$/.test(from)) throw new Error(`invalid image reference: ${from}`);
    args.push('--from', from);
  }
  if (body.cpu) args.push('--cpu', String(body.cpu));
  if (body.memory) args.push('--memory', String(body.memory));
  if (body.gpu === true) args.push('--gpu');
  else if (typeof body.gpu === 'string' && body.gpu) args.push('--gpu', body.gpu);
  for (const [k, v] of Object.entries(body.env ?? {})) {
    if (v.includes('\n')) throw new Error(`env value for ${k} may not contain a newline`);
    args.push('--env', `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(body.labels ?? {})) args.push('--label', `${k}=${v}`);
  for (const p of body.providers ?? []) args.push('--provider', safeName(p, 'provider'));
  for (const f of body.forward ?? []) args.push('--forward', safePort(f, 'forward'));
  for (const e of body.expose ?? []) args.push('--expose', safePort(e, 'expose'));
  if (body.restartPolicy && body.restartPolicy !== 'never') {
    args.push('--restart-policy', body.restartPolicy);
  }
  const command = body.command?.trim() || '';
  // The CLI rejects a repeated --detach, and options cannot follow `--`.
  if (body.detach ?? !command) args.push('--detach');
  if (body.keep === false) args.push('--no-keep');
  if (command) args.push('--', ...tokenize(command));
  return args;
}

// ---------------------------------------------------------------------------
// Sandbox exec / run
// ---------------------------------------------------------------------------

interface ExecBody {
  command?: string;
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
}

async function execInSandbox(name: string, body: ExecBody, opts: Query) {
  const argv = String(body.command ?? '').trim();
  if (!argv) throw new Error('command is required');
  if (argv.length > 32 * 1024) throw new Error('command is too long (limit 32 KiB)');
  const args = ['sandbox', 'exec', safeName(name), '--no-tty'];
  if (body.workdir) args.push('--workdir', body.workdir);
  if (body.timeout) args.push('--timeout', String(body.timeout));
  for (const [k, v] of Object.entries(body.env ?? {})) {
    if (v.includes('\n')) throw new Error(`env value for ${k} may not contain a newline`);
    args.push('--env', `${k}=${v}`);
  }
  // Run the line through the sandbox's shell so `&&`, pipes and quotes behave
  // the way the person typing them expects.
  args.push('--', 'bash', '-lc', argv);
  const started = Date.now();
  try {
    const stdout = await runCli(args, { ...opts, timeoutMs: 3 * 60_000 });
    return { ok: true, stdout, stderr: '', exit_code: 0, duration_ms: Date.now() - started };
  } catch (err) {
    const cli = err as CliError;
    return {
      ok: false,
      stdout: cli.stderr ? stripAnsi(cli.stderr) : '',
      stderr: cli.message ?? String(err),
      exit_code: typeof cli.exitCode === 'number' ? cli.exitCode : 1,
      duration_ms: Date.now() - started,
    };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureSandboxReady(name: string, opts: Query) {
  const read = async () =>
    runJson<{ phase?: string; name?: string }>(['sandbox', 'get', name, '-o', 'json'], opts);
  let sandbox = await read();
  const initial = String(sandbox?.phase ?? 'Unknown');
  if (initial === 'Ready' || initial === 'Running') return { phase: initial, started: false };
  if (initial === 'Stopped') {
    await runCli(['sandbox', 'start', name], { ...opts, timeoutMs: 3 * 60_000 });
  } else if (initial === 'Suspended') {
    await runCli(['sandbox', 'resume', name], { ...opts, timeoutMs: 3 * 60_000 });
  } else {
    throw new Error(`sandbox "${name}" is ${initial}; only stopped, suspended or running sandboxes can run commands`);
  }
  for (let i = 0; i < 45; i += 1) {
    await sleep(2000);
    sandbox = await read();
    const phase = String(sandbox?.phase ?? 'Unknown');
    if (phase === 'Ready' || phase === 'Running') return { phase, started: true };
    if (phase === 'Failed' || phase === 'Completed') {
      throw new Error(`sandbox "${name}" entered ${phase} while starting`);
    }
  }
  throw new Error(`sandbox "${name}" did not reach Ready in time`);
}

// ---------------------------------------------------------------------------
// Network rule approvals
// ---------------------------------------------------------------------------

function ruleStatus(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^(pending|approved|rejected)$/.test(value)) throw new Error(`invalid rule status: ${value}`);
  return value;
}

async function readRules(name: string, opts: Query, status?: string, timeoutMs?: number) {
  const args = ['rule', 'get', safeName(name)];
  const s = ruleStatus(status);
  if (s) args.push('--status', s);
  const out = await runCli(args, { ...opts, ...(timeoutMs ? { timeoutMs } : {}) });
  return parseRules(stripAnsi(out), name);
}

async function readRuleHistory(name: string, opts: Query) {
  const out = await runCli(['rule', 'history', safeName(name)], opts);
  return parseRuleHistory(stripAnsi(out), name);
}

async function readAllRules(opts: Query, status?: string) {
  const body = await runJson<{ sandboxes?: Array<{ name: string; phase: string }> }>(
    ['sandbox', 'list', '-o', 'json', '--page-size', '200'],
    opts,
  );
  const live = (body?.sandboxes ?? []).filter(
    (s) => !['Completed', 'Failed', 'Deleting', 'Terminating', 'Pending'].includes(String(s.phase)),
  );
  if (live.length > 24) live.length = 24;
  const rules: unknown[] = [];
  const errors: Array<{ sandbox: string; error: string }> = [];
  for (let i = 0; i < live.length; i += 4) {
    const batch = live.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (s) => {
        try {
          const collection = await readRules(s.name, opts, status, 15_000);
          return { ok: true as const, rules: collection.rules };
        } catch (err) {
          return { ok: false as const, error: cleanError(String((err as Error)?.message ?? err)) };
        }
      }),
    );
    results.forEach((result, index) => {
      if (result.ok) rules.push(...result.rules);
      else errors.push({ sandbox: batch[index].name, error: result.error });
    });
  }
  return { rules, scanned: live.length, errors };
}

// ---------------------------------------------------------------------------
// Profiles and providers
// ---------------------------------------------------------------------------

const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;

function safeProfileId(value: string | undefined): string {
  if (!value || !PROFILE_ID_RE.test(value)) throw new Error(`invalid profile id: ${JSON.stringify(value)}`);
  return value;
}

function safeProviderName(value: string | undefined): string {
  return safeName(value, 'provider name');
}

interface ProfileFileBody {
  content?: string;
  fileName?: string;
  url?: string;
  global?: boolean;
}

/** Write pasted profile YAML to a private temp file for `profile import/lint`. */
function withProfileFile<T>(body: ProfileFileBody, fn: (file: string) => Promise<T>): Promise<T> {
  const content = String(body.content ?? '');
  if (!content.trim()) throw new Error('profile content is required');
  if (content.length > 512 * 1024) throw new Error('profile content is too large (limit 512 KiB)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openshell-ui-profile-'));
  const ext = /\.json$/i.test(String(body.fileName ?? '')) ? 'json' : 'yaml';
  const file = path.join(dir, `profile.${ext}`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return fn(file).finally(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
}

function profileSourceArgs(body: ProfileFileBody, file?: string, action?: string): string[] {
  const args = ['profile', action ?? 'import'];
  if (body.url) {
    const url = String(body.url).trim();
    if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error(`invalid profile URL: ${url}`);
    args.push('--url', url);
  } else if (file) {
    args.push('-f', file);
  }
  if (body.global) args.push('--global');
  return args;
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function send(res: http.ServerResponse, code: number, payload: unknown) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw) as Json;
}

type Handler = (m: Record<string, string>, body: Json, opts: Query) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, spec: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      spec
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            keys.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '/?$',
  );
  return { method, pattern, keys, handler };
}

const routes: Route[] = [
  route('GET', '/api/context', (_m, _b, opts) => readContext(opts)),
  route('GET', '/api/sandboxes', (_m, _b, opts) => listSandboxes(opts)),
  route('POST', '/api/sandboxes', (_m, body, opts) => {
    const b = (body ?? {}) as CreateBody;
    return runJson<Json>(createArgs(b), { ...opts, timeoutMs: 5 * 60_000 });
  }),
  route('GET', '/api/sandboxes/:name', (m, _b, opts) => sandboxDetail(safeName(m.name), opts)),
  route('DELETE', '/api/sandboxes/:name', (m, _b, opts) =>
    runCli(['sandbox', 'delete', safeName(m.name)], { ...opts, timeoutMs: 2 * 60_000 }),
  ),
  route('POST', '/api/sandboxes/:name/exec', (m, body, opts) =>
    execInSandbox(safeName(m.name), (body ?? {}) as ExecBody, opts),
  ),
  route('POST', '/api/sandboxes/:name/run', async (m, body, opts) => {
    const b = (body ?? {}) as ExecBody & { start?: boolean };
    if (!String(b.command ?? '').trim()) throw new Error('command is required');
    const readiness = b.start === false ? null : await ensureSandboxReady(safeName(m.name), opts);
    const result = await execInSandbox(safeName(m.name), b, opts);
    return { ...result, started: readiness?.started ?? false, phase: readiness?.phase ?? null };
  }),
  route('POST', '/api/sandboxes/:name/:action', async (m, body, opts) => {
    const allowed = new Set(['start', 'stop', 'suspend', 'resume']);
    if (!allowed.has(m.action)) throw new Error(`unknown action: ${m.action}`);
    const extra = (body as { all?: boolean } | null)?.all ? ['--all'] : [];
    return {
      output: await runCli(['sandbox', m.action, safeName(m.name), ...extra], {
        ...opts,
        timeoutMs: 3 * 60_000,
      }),
    };
  }),
  route('GET', '/api/sandboxes/:name/logs', (m, _b, opts) => readLogs(safeName(m.name), opts)),
  route('GET', '/api/sandboxes/:name/ssh', (m, _b, opts) =>
    runCli(['sandbox', 'ssh-config', safeName(m.name)], opts),
  ),
  route('GET', '/api/sandboxes/:name/policy', (m, _b, opts) =>
    runJson<Json>(
      ['policy', 'list', safeName(m.name), '-o', 'json', '--page-size', '50'],
      opts,
    ),
  ),
  // --- network rule approvals (the human-readable `openshell rule` surface) ---
  route('GET', '/api/rules', (_m, _b, opts) => readAllRules(opts, opts.status)),
  route('GET', '/api/sandboxes/:name/rules', (m, _b, opts) => readRules(safeName(m.name), opts, opts.status)),
  route('GET', '/api/sandboxes/:name/rules/history', (m, _b, opts) => readRuleHistory(safeName(m.name), opts)),
  route('POST', '/api/sandboxes/:name/rules/approve-all', (m, body, opts) => {
    const b = (body ?? {}) as { includeSecurityFlagged?: boolean };
    const args = ['rule', 'approve-all', safeName(m.name)];
    if (b.includeSecurityFlagged) args.push('--include-security-flagged');
    return runCli(args, { ...opts, timeoutMs: 2 * 60_000 });
  }),
  route('POST', '/api/sandboxes/:name/rules/:chunk/approve', (m, _b, opts) =>
    runCli(['rule', 'approve', '--chunk-id', parseChunkId(m.chunk), safeName(m.name)], {
      ...opts,
      timeoutMs: 2 * 60_000,
    }),
  ),
  route('POST', '/api/sandboxes/:name/rules/:chunk/reject', (m, body, opts) => {
    const reason = String((body as { reason?: string } | null)?.reason ?? '').trim();
    if (reason.includes('\n') || reason.length > 500) {
      throw new Error('rejection reason must be a single line under 500 characters');
    }
    const args = ['rule', 'reject', '--chunk-id', parseChunkId(m.chunk), safeName(m.name)];
    if (reason) args.push('--reason', reason);
    return runCli(args, { ...opts, timeoutMs: 2 * 60_000 });
  }),
  route('DELETE', '/api/sandboxes/:name/rules', (m, _b, opts) =>
    runCli(['rule', 'clear', safeName(m.name)], { ...opts, timeoutMs: 2 * 60_000 }),
  ),
  route('GET', '/api/services', (_m, _b, opts) =>
    runJson<Json>(['service', 'list', '-o', 'json'], opts),
  ),
  route('POST', '/api/services', (_m, body, opts) => {
    const b = (body ?? {}) as { sandbox?: string; port?: string; service?: string; authorizationMode?: string };
    const args = ['service', 'expose', safeName(b.sandbox, 'sandbox'), safePort(b.port, 'port')];
    if (b.service) args.push(safeName(b.service, 'service name'));
    if (b.authorizationMode) args.push('--authorization-mode', b.authorizationMode);
    return runCli(args, opts);
  }),
  route('DELETE', '/api/services/:sandbox/:service', (m, _b, opts) => {
    const args = ['service', 'delete', safeName(m.sandbox, 'sandbox')];
    if (m.service && m.service !== '_') args.push(safeName(m.service, 'service'));
    return runCli(args, opts);
  }),
  route('GET', '/api/forwards', (_m, _b, opts) => runJson<Json>(['forward', 'list', '-o', 'json'], opts)),
  route('POST', '/api/forwards', (_m, body, opts) => {
    const b = (body ?? {}) as { port?: string; sandbox?: string };
    return runCli(['forward', 'start', '--background', safePort(b.port, 'port'), safeName(b.sandbox, 'sandbox')], opts);
  }),
  route('DELETE', '/api/forwards/:port/:sandbox', (m, _b, opts) =>
    runCli(['forward', 'stop', safePort(m.port, 'port'), safeName(m.sandbox, 'sandbox')], opts),
  ),
  route('GET', '/api/templates', (_m, _b, opts) =>
    runJson<Json>(['sandbox', 'template', 'list', '-o', 'json'], opts),
  ),
  route('POST', '/api/templates', (_m, body, opts) => {
    const b = (body ?? {}) as { name?: string; image?: string; cpu?: string; memory?: string };
    const args = ['sandbox', 'template', 'create', safeName(b.name, 'template name')];
    if (b.image) args.push('--image', String(b.image));
    if (b.cpu) args.push('--cpu', String(b.cpu));
    if (b.memory) args.push('--memory', String(b.memory));
    return runJson<Json>(args, opts);
  }),
  route('DELETE', '/api/templates/:name', (m, _b, opts) =>
    runCli(['sandbox', 'template', 'delete', safeName(m.name, 'template')], opts),
  ),
  route('GET', '/api/profiles', (_m, _b, opts) => runJson<Json>(['profile', 'list', '-o', 'json'], opts)),
  route('GET', '/api/profiles/:id/export', (m, _b, opts) => {
    const format = opts.format === 'json' ? 'json' : 'yaml';
    const args = ['profile', 'export', safeProfileId(m.id), '-o', format];
    if (opts.global) args.push('--global');
    return runCli(args, opts);
  }),
  route('GET', '/api/profiles/:id', (m, _b, opts) => {
    const args = ['profile', 'describe', safeProfileId(m.id), '-o', 'json'];
    if (opts.global) args.push('--global');
    return runJson<Json>(args, opts);
  }),
  route('POST', '/api/profiles/lint', (_m, body, opts) => {
    const b = (body ?? {}) as ProfileFileBody;
    if (b.url) return runCli(profileSourceArgs(b, undefined, 'lint'), opts);
    return withProfileFile(b, (file) => runCli(profileSourceArgs(b, file, 'lint'), opts));
  }),
  route('POST', '/api/profiles/import', (_m, body, opts) => {
    const b = (body ?? {}) as ProfileFileBody;
    if (b.url) {
      return runCli(profileSourceArgs(b, undefined, 'import'), { ...opts, timeoutMs: 2 * 60_000 });
    }
    return withProfileFile(b, (file) =>
      runCli(profileSourceArgs(b, file, 'import'), { ...opts, timeoutMs: 2 * 60_000 }),
    );
  }),
  route('DELETE', '/api/profiles/:id', (m, _b, opts) => {
    const args = ['profile', 'delete', safeProfileId(m.id)];
    if (opts.global) args.push('--global');
    return runCli(args, { ...opts, timeoutMs: 2 * 60_000 });
  }),
  route('GET', '/api/providers', (_m, _b, opts) =>
    runJson<Json>(['provider', 'list', '-o', 'json'], opts),
  ),
  route('POST', '/api/providers', (_m, body, opts) => {
    const b = (body ?? {}) as {
      name?: string;
      type?: string;
      credentials?: string[];
      config?: string[];
      labels?: string[];
      fromExisting?: boolean;
      fromOidcToken?: boolean;
      fromGcloudAdc?: boolean;
      runtimeCredentials?: boolean;
      globalProfile?: boolean;
    };
    const args = ['provider', 'create', '--name', safeProviderName(b.name), '--type', safeProviderName(b.type)];
    for (const c of b.credentials ?? []) args.push('--credential', String(c));
    for (const c of b.config ?? []) args.push('--config', String(c));
    for (const l of b.labels ?? []) args.push('--label', String(l));
    if (b.fromExisting) args.push('--from-existing');
    if (b.fromOidcToken) args.push('--from-oidc-token');
    if (b.fromGcloudAdc) args.push('--from-gcloud-adc');
    if (b.runtimeCredentials) args.push('--runtime-credentials');
    if (b.globalProfile) args.push('--global-profile');
    return runCli(args, { ...opts, timeoutMs: 2 * 60_000 });
  }),
  route('PATCH', '/api/providers/:name', (m, body, opts) => {
    const b = (body ?? {}) as {
      credentials?: string[];
      config?: string[];
      fromExisting?: boolean;
      fromOidcToken?: boolean;
    };
    const args = ['provider', 'update', safeProviderName(m.name)];
    for (const c of b.credentials ?? []) args.push('--credential', String(c));
    for (const c of b.config ?? []) args.push('--config', String(c));
    if (b.fromExisting) args.push('--from-existing');
    if (b.fromOidcToken) args.push('--from-oidc-token');
    return runCli(args, { ...opts, timeoutMs: 2 * 60_000 });
  }),
  route('DELETE', '/api/providers/:name', (m, _b, opts) =>
    runCli(['provider', 'delete', safeProviderName(m.name)], { ...opts, timeoutMs: 2 * 60_000 }),
  ),
  route('GET', '/api/workspaces', (_m, _b, opts) =>
    runJson<Json>(['workspace', 'list', '-o', 'json'], opts),
  ),
  // Gateway registration lives in the local CLI config, so these take no scope.
  route('GET', '/api/gateways', (_m, _b, opts) => listGateways({ probe: opts.probe })),
  route('GET', '/api/gateways/:name/health', (m) => probeGateway(m.name)),
  route('GET', '/api/gateways/:name', async (m) => {
    const metadata = readMetadata(m.name);
    if (!metadata) throw new Error(`no local metadata for gateway "${m.name}"`);
    return { metadata, token_kind: tokenKind(metadata) };
  }),
  route('POST', '/api/gateways', (_m, body) => addGateway((body ?? {}) as AddGatewayBody)),
  route('POST', '/api/gateways/:name/select', (m) => selectGateway(m.name)),
  route('POST', '/api/gateways/:name/login', (m) => loginGateway(m.name)),
  route('POST', '/api/gateways/:name/logout', (m) => logoutGateway(m.name)),
  route('POST', '/api/gateways/:name/token', (m, body) => {
    const b = (body ?? {}) as { token?: string; insecure?: boolean; verify?: boolean };
    return setGatewayToken(m.name, String(b.token ?? ''), { insecure: b.insecure, verify: b.verify });
  }),
  route('POST', '/api/gateways/:name/forget-tokens', async (m) => {
    const removed = clearTokens(m.name);
    return { removed };
  }),
  route('DELETE', '/api/gateways/:name', (m) => removeGateway(m.name)),
  route('GET', '/api/settings/:name', (m, _b, opts) =>
    runCli(['settings', 'get', safeName(m.name, 'sandbox')], opts),
  ),
];

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      'openshell-ui api bridge is running.\n\n' +
        'The web app is served by Vite in dev mode (http://localhost:5273).\n' +
        `For a single-process build run \`npm run build && npm start\`.\n`,
    );
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': STATIC_TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  if (url.pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        const body = method === 'GET' ? null : await readBody(req);
        send(res, 200, await r.handler(params, body, q(url)));
      } catch (err) {
        const cli = err as CliError;
        send(res, 400, {
          error: cli instanceof CliError ? cli.message : cleanError(String((err as Error).message ?? err)),
          args: cli.args ?? null,
          exit_code: cli.exitCode ?? null,
        });
      }
      return;
    }
    send(res, 404, { error: `no route: ${method} ${url.pathname}` });
    return;
  }

  if (method === 'GET') serveStatic(req, res);
  else send(res, 405, { error: 'method not allowed' });
});

// ---------------------------------------------------------------------------
// Terminal bridge: a real PTY over WebSocket
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/api/terminal' });

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const name = url.searchParams.get('name') ?? '';
  const cols = Math.min(Math.max(Number(url.searchParams.get('cols')) || 100, 20), 400);
  const rows = Math.min(Math.max(Number(url.searchParams.get('rows')) || 30, 8), 200);
  const shell = url.searchParams.get('shell') || 'bash -li';
  if (!NAME_RE.test(name)) {
    ws.send(JSON.stringify({ type: 'error', message: `invalid sandbox name: ${name}` }));
    ws.close();
    return;
  }

  const argv = ['sandbox', 'exec', name, '--tty', '--', ...shell.split(/\s+/)];
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(BIN, argv, {
      env: { ...process.env, OPENSHELL_COLOR: 'never', TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) },
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: String((err as Error).message) }));
    ws.close();
    return;
  }

  const write = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  child.stdout.on('data', (d: Buffer) => write({ type: 'data', data: d.toString('utf8') }));
  child.stderr.on('data', (d: Buffer) => write({ type: 'data', data: stripAnsi(d.toString('utf8')) }));
  child.on('error', (err) => write({ type: 'error', message: String(err.message) }));
  child.on('close', (code, signal) => {
    write({ type: 'exit', code, signal, message: cleanError(signal ? `shell terminated (${signal})` : '') });
    ws.close();
  });

  ws.on('message', (raw) => {
    let msg: { type?: string; data?: string };
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return;
    }
    if (msg.type === 'input' && msg.data) child.stdin.write(msg.data);
    if (msg.type === 'signal' && msg.data === 'interrupt') child.kill('SIGINT');
  });
  ws.on('close', () => {
    child.stdin.end();
    child.kill('SIGTERM');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`openshell-ui bridge → http://${HOST}:${PORT}`);
  console.log(`  cli: ${BIN}`);
  console.log(`  home: ${os.homedir()}`);
});
