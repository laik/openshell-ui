/**
 * OpenShell Console — local API bridge.
 *
 * The gateway is gRPC + mTLS and only the CLI holds those credentials, so every
 * console request is translated into an `openshell` invocation. Reads use the
 * CLI's JSON output mode; the terminal page streams a real PTY over a WebSocket.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
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
import {
  AUTH_MODE,
  ENTRA,
  ENTRA_ENABLED,
  entraPoll,
  entraStart,
  OIDC_CLIENT_ID,
  OIDC_ISSUERS,
  PORTAL_URLS,
  TLS,
  TLS_ENABLED,
  LOCAL_TOKEN,
  anonymousAllowed,
  authPaths,
  audit,
  ensureFresh,
  entraIssuer,
  isAdminOnly,
  listEntraTenants,
  localLogin,
  logout as oidcLogout,
  oidcCallback,
  oidcCallbackDiscover,
  oidcStart,
  peekOidcFlowOrigin,
  peekOidcFlowPurpose,
  selectEntraTenant,
  ENTRA_DISCOVER_SCOPES,
  ENTRA_ORGANIZATIONS_ISSUER,
  parseCookies,
  passwordGrant,
  sessionCookie,
  sessionFromCert,
  sessionFromRequest,
  sessionUser,
  SESSION_COOKIE,
  type Session,
} from './auth.ts';

const PORT = Number(process.env.OPENSHELL_UI_PORT ?? 8787);
const HOST = process.env.OPENSHELL_UI_HOST ?? '127.0.0.1';
/** Public origin for OIDC redirect URIs behind proxies/ingress. */
const PUBLIC_URL = (process.env.OPENSHELL_UI_PUBLIC_URL ?? '').trim().replace(/\/$/, '');
function publicBase(req: http.IncomingMessage): string {
  if (PUBLIC_URL) return PUBLIC_URL;
  // The browser's Origin survives dev proxies that rewrite Host; fall back to
  // the forwarded/host headers for direct or proxied production traffic.
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const proto = (req.headers['x-forwarded-proto'] as string) ?? (TLS_ENABLED ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}
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
  // The CLI forbids --template together with --cpu/--memory/--gpu; resource
  // overrides on a template create are resolved via a derived template below.
  if (!body.template) {
    if (body.cpu) args.push('--cpu', String(body.cpu));
    if (body.memory) args.push('--memory', String(body.memory));
    if (body.gpu === true) args.push('--gpu');
    else if (typeof body.gpu === 'string' && body.gpu) args.push('--gpu', body.gpu);
  }
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

interface TemplateDoc {
  image?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  resources?: { cpu?: string; memory?: string; gpu?: number };
  startup?: { ready_within_ms?: number; max_burst?: number };
  driver_config?: unknown;
}

/**
 * Template creates with resource overrides: the CLI rejects --template plus
 * --cpu/--memory/--gpu, so the console copies the template into a one-off
 * derived template (all fields preserved), applies the overrides there,
 * creates from it, and removes the derived template afterwards. Unchanged
 * resources keep the plain --template path and its lineage.
 */
async function createSandboxResolved(b: CreateBody, opts: Query): Promise<Json> {
  if (!b.template) return runJson<Json>(createArgs(b), { ...opts, timeoutMs: 5 * 60_000 });
  const tpl = await runJson<TemplateDoc>(
    ['sandbox', 'template', 'get', safeName(b.template, 'template name'), '-o', 'json'],
    opts,
  );
  const res = tpl.resources ?? {};
  const cpuOverride = b.cpu?.trim() && b.cpu.trim() !== res.cpu ? b.cpu.trim() : null;
  const memOverride = b.memory?.trim() && b.memory.trim() !== res.memory ? b.memory.trim() : null;
  const gpuOverride = b.gpu ? b.gpu : null;
  if (!cpuOverride && !memOverride && !gpuOverride) {
    return runJson<Json>(createArgs(b), { ...opts, timeoutMs: 5 * 60_000 });
  }

  const derived = `os-ovr-${crypto.randomUUID().slice(0, 8)}`;
  const targs = ['sandbox', 'template', 'create', derived];
  if (tpl.image) targs.push('--image', tpl.image);
  if (cpuOverride ?? res.cpu) targs.push('--cpu', String(cpuOverride ?? res.cpu));
  if (memOverride ?? res.memory) targs.push('--memory', String(memOverride ?? res.memory));
  if (gpuOverride === true) targs.push('--gpu');
  else if (typeof gpuOverride === 'string') targs.push('--gpu', gpuOverride);
  else if (res.gpu != null) targs.push('--gpu', String(res.gpu));
  for (const [k, v] of Object.entries(tpl.labels ?? {})) targs.push('--label', `${k}=${v}`);
  for (const [k, v] of Object.entries(tpl.annotations ?? {})) targs.push('--annotation', `${k}=${v}`);
  if (tpl.startup?.ready_within_ms) targs.push('--ready-within', `${Math.round(tpl.startup.ready_within_ms / 1000)}s`);
  if (tpl.startup?.max_burst != null) targs.push('--max-burst', String(tpl.startup.max_burst));
  if (tpl.driver_config != null) targs.push('--driver-config-json', JSON.stringify(tpl.driver_config));
  await runCli(targs, { ...opts, timeoutMs: 2 * 60_000 });

  const body: CreateBody = { ...b, template: derived, cpu: undefined, memory: undefined, gpu: undefined };
  body.labels = { ...(b.labels ?? {}), 'openshell.io/template-source': b.template };
  try {
    const result = await runJson<Json>(createArgs(body), { ...opts, timeoutMs: 5 * 60_000 });
    // best-effort cleanup: the sandbox is already materialized
    runCli(['sandbox', 'template', 'delete', derived], opts).catch(() => {});
    return result;
  } catch (err) {
    await runCli(['sandbox', 'template', 'delete', derived], opts).catch(() => {});
    throw err;
  }
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

const SHELL_META = new Set(['|', '&', ';', '<', '>', '(', ')', '$', '`', '\\', '*', '?', '[', ']', '{', '}', '~', '\n']);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** True when the requested line needs a shell (pipes, redirects, expansion…). */
function needsShell(command: string): boolean {
  if (ASSIGNMENT_RE.test(command)) return true;
  for (const ch of command) if (SHELL_META.has(ch)) return true;
  return false;
}

const shellCache = new Map<string, { value: string; at: number }>();

/**
 * The shell the sandbox user is configured with. `exec` still sources the
 * sandbox's login/profile startup files before every command; this is only the
 * interpreter used when the user's line actually needs shell syntax.
 */
async function resolveSandboxShell(name: string, opts: Query): Promise<string> {
  const key = `${opts.gateway ?? ''}|${opts.workspace ?? ''}|${name}`;
  const hit = shellCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  let value = '/bin/sh';
  try {
    const out = await runCli(['sandbox', 'exec', name, '--no-tty', '--', 'printenv', 'SHELL'], {
      ...opts,
      timeoutMs: 15_000,
    });
    const candidate = stripAnsi(out).trim().split('\n')[0].trim();
    if (/^\/(?:[\w.+-]+\/)*[\w.+-]+$/.test(candidate)) value = candidate;
  } catch {
    /* keep the POSIX fallback */
  }
  shellCache.set(key, { value, at: Date.now() });
  return value;
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
  // The CLI sources the sandbox user's login/profile startup files before
  // every exec, so plain commands run directly — no hardcoded bash. Only lines
  // that actually need shell syntax use the sandbox's own `$SHELL`.
  if (needsShell(argv)) {
    const shell = await resolveSandboxShell(safeName(name), opts);
    args.push('--', shell, '-c', argv);
  } else {
    const tokens = tokenize(argv);
    if (tokens.length === 0) throw new Error('command is required');
    args.push('--', ...tokens);
  }
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

/**
 * Observe the canonical main process from inside the sandbox: the gateway does
 * not expose the startup command, so match PID-1 children against the reported
 * main-process start time using `ps` elapsed time (busybox formats included).
 */
const STARTUP_PROBE = `# OS_STARTUP_PROBE
want=$(( (OS_NOW_MS - OS_MAIN_MS) / 1000 ))
ps -eo pid,ppid,etime,args | awk -v want="$want" '
NR == 1 { next }
$2 != 1 { next }
index($0, "OS_STARTUP_PROBE") > 0 { next }
{
  args = $0
  sub(/^[ \\t]*[^ \\t]+[ \\t]+[^ \\t]+[ \\t]+[^ \\t]+[ \\t]+/, "", args)
  if (args == "ps -eo pid,ppid,etime,args") next
  if (substr(args, 1, 1) == "[") next
  e = $3; s = 0; coarse = 0
  if (index(e, "d") > 0) { split(e, a, "d"); s += a[1] * 86400; e = a[2]; coarse = 1 }
  if (index(e, "h") > 0) { split(e, a, "h"); s += a[1] * 3600 + a[2] * 60; coarse = 1 }
  else if (index(e, ":") > 0) { split(e, a, ":"); s += a[1] * 60 + a[2] }
  tol = coarse ? 61 : 6
  diff = s - want; if (diff < 0) diff = -diff
  if (diff <= tol && (best == 0 || diff < bestd)) { best = 1; bestd = diff; bestargs = args; bestpid = $1; bests = s }
}
END { if (best) printf "%s\\t%s\\t%s\\n", bestpid, bests, bestargs }
'
`;

/** Last successfully observed startup command per sandbox, so stopped sandboxes still show their own. */
const lastStartup = new Map<string, { command: string; pid: number | null; elapsed_s: number | null }>();

async function readStartupCommand(name: string, opts: Query) {
  const cached = lastStartup.get(name);
  const fallback = (reason: string) => ({
    sandbox: name,
    command: cached?.command ?? null,
    pid: cached?.pid ?? null,
    elapsed_s: cached?.elapsed_s ?? null,
    stale: Boolean(cached),
    reason: cached ? `${reason}; showing the last observed command` : reason,
  });
  const sandbox = await runJson<{ phase?: string; main_process_started_at_ms?: number }>(
    ['sandbox', 'get', name, '-o', 'json'],
    opts,
  );
  const started = Number(sandbox?.main_process_started_at_ms ?? 0);
  const phase = String(sandbox?.phase ?? 'Unknown');
  if (!started) {
    return fallback('the gateway reports no main-process start time');
  }
  if (phase !== 'Ready' && phase !== 'Running') {
    return fallback(`sandbox is ${phase}; the main process is not running`);
  }
  const out = await runCli(
    [
      'sandbox',
      'exec',
      name,
      '--no-tty',
      '--env',
      `OS_NOW_MS=${Date.now()}`,
      '--env',
      `OS_MAIN_MS=${started}`,
      '--',
      'sh',
      '-c',
      STARTUP_PROBE,
    ],
    { ...opts, timeoutMs: 20_000 },
  );
  const line = stripAnsi(out).trim().split('\n').filter(Boolean).pop() ?? '';
  const [pid, elapsed, ...rest] = line.split('\t');
  const command = rest.join('\t').trim();
  if (!command) {
    return fallback('the main process could not be observed inside the sandbox');
  }
  const observed = { command, pid: Number(pid) || null, elapsed_s: Number(elapsed) || null };
  lastStartup.set(name, observed);
  return { sandbox: name, ...observed, stale: false, reason: null };
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
// Dynamic policy updates
// ---------------------------------------------------------------------------

/** CLI argument values must not look like flags or carry shell/whitespace surprises. */
function policyToken(value: unknown, what: string): string {
  const s = String(value ?? '').trim();
  if (!s) throw new Error(`${what} is required`);
  if (s.startsWith('-')) throw new Error(`${what} may not start with "-": ${s}`);
  if (/[\s"'`$;|&<>\\\n]/.test(s)) throw new Error(`${what} contains unsupported characters: ${s}`);
  return s;
}

function endpointSpec(value: unknown): string {
  const s = policyToken(value, 'endpoint');
  if (!/^[\w.*[\]-]+:\d{1,5}(:[^:]*){0,4}$/.test(s)) {
    throw new Error(`endpoint must be host:port[:access[:protocol[:enforcement[:options]]]]: ${s}`);
  }
  return s;
}

function ruleSpec(value: unknown, what: string): string {
  const s = policyToken(value, what);
  if (!/^[\w.*-]+:\d{1,5}(,\d{1,5})*:[A-Z*]+:\S+$/.test(s)) {
    throw new Error(`${what} must be host:port[,port...]:METHOD:path_glob: ${s}`);
  }
  return s;
}

function binaryPath(value: unknown): string {
  const s = policyToken(value, 'binary');
  if (!s.startsWith('/')) throw new Error(`binary must be an absolute path: ${s}`);
  return s;
}

interface PolicyUpdateBody {
  addEndpoints?: string[];
  removeEndpoints?: string[];
  addAllow?: string[];
  addDeny?: string[];
  removeRules?: string[];
  binaries?: string[];
  ruleName?: string;
  anyBinary?: boolean;
  endpointPath?: string;
  dryRun?: boolean;
  wait?: boolean;
}

function policyUpdateArgs(name: string, b: PolicyUpdateBody): string[] {
  const args = ['policy', 'update', name];
  for (const e of b.addEndpoints ?? []) args.push('--add-endpoint', endpointSpec(e));
  for (const e of b.removeEndpoints ?? []) args.push('--remove-endpoint', endpointSpec(e));
  for (const bin of b.binaries ?? []) args.push('--binary', binaryPath(bin));
  if (b.ruleName) args.push('--rule-name', policyToken(b.ruleName, 'rule name'));
  if (b.anyBinary) args.push('--any-binary');
  if (b.endpointPath !== undefined && b.endpointPath !== '') {
    const p = policyToken(b.endpointPath, 'endpoint path');
    if (!p.startsWith('/')) throw new Error(`endpoint path must start with "/": ${p}`);
    args.push('--endpoint-path', p);
  }
  for (const r of b.addAllow ?? []) args.push('--add-allow', ruleSpec(r, 'allow rule'));
  for (const r of b.addDeny ?? []) args.push('--add-deny', ruleSpec(r, 'deny rule'));
  for (const r of b.removeRules ?? []) args.push('--remove-rule', policyToken(r, 'rule name'));
  if ((b.addAllow?.length || b.addDeny?.length) && !b.ruleName) {
    throw new Error('L7 allow/deny rules require a rule name');
  }
  if ((b.addAllow?.length || b.addDeny?.length) && !b.anyBinary && !(b.binaries ?? []).length) {
    throw new Error('L7 allow/deny rules require the complete binary list or --any-binary');
  }
  if (args.length === 3) throw new Error('nothing to update');
  if (b.dryRun) args.push('--dry-run');
  // The CLI rejects --wait together with --dry-run.
  else if (b.wait) args.push('--wait');
  return args;
}

/** Write pasted YAML to a private temp file for `policy set`. */
function withTempFile<T>(content: string, ext: string, fn: (file: string) => Promise<T>): Promise<T> {
  if (!content.trim()) throw new Error('policy YAML is required');
  if (content.length > 512 * 1024) throw new Error('policy YAML is too large (limit 512 KiB)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openshell-ui-policy-'));
  const file = path.join(dir, `policy.${ext}`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return fn(file).finally(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
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
  route('GET', '/api/auth/config', async () => ({
    mode: AUTH_MODE,
    issuers: OIDC_ISSUERS,
    clientId: OIDC_CLIENT_ID,
    entra: {
      enabled: ENTRA_ENABLED,
      tenant: ENTRA.tenant,
      clientId: ENTRA.clientId,
      issuer: ENTRA_ENABLED ? entraIssuer() : '',
    },
    local: {
      token: Boolean(LOCAL_TOKEN),
      mtls: TLS_ENABLED && Boolean(TLS.clientCa),
      anonymous: ANONYMOUS,
    },
    tls: TLS_ENABLED,
    ...PORTAL_URLS,
  })),
  route('POST', '/api/auth/entra/start', async (_m, body) =>
    entraStart((body ?? {}) as { scopes?: string; purpose?: 'session' | 'gateway-token' }),
  ),
  // handled by the wrapper (origin / query / session cookie)
  route('POST', '/api/auth/entra/discover', async () => ({ ok: true })),
  route('GET', '/api/auth/entra/tenants', async () => ({ ok: true })),
  route('POST', '/api/auth/entra/select', async () => ({ ok: true })),
  route('POST', '/api/auth/entra/poll', async (_m, body) => {
    const flow = String(((body ?? {}) as { flow?: string }).flow ?? '');
    if (!flow) throw new Error('flow is required');
    const result = await entraPoll(flow);
    if (result.status === 'ok' && result.session) {
      const { session, ...rest } = result;
      return { ...rest, cookie: sessionCookie(session.id, undefined, TLS_ENABLED) };
    }
    return result;
  }),
  // authorization code + PKCE; handled by the wrapper (needs the request origin
  // for the redirect URI and the query string for the callback)
  route('POST', '/api/auth/oidc/start', async () => ({ ok: true })),
  route('GET', '/api/auth/oidc/callback', async () => ({ ok: true })),
  route('POST', '/api/auth/logout', async (_m, _b, _opts) => {
    // session id is resolved by the handler wrapper below via cookie
    return { ok: true };
  }),
  // handled by the wrapper (needs the source address for rate limiting)
  route('POST', '/api/auth/local', async () => ({ ok: true })),
  route('GET', '/api/auth/me', async () => ({ user: null })),
  // handled by the wrapper (needs the live session)
  route('POST', '/api/auth/role', async () => ({ ok: true })),
  route('POST', '/api/oidc/token', async (_m, body) => {
    const b = (body ?? {}) as { issuer?: string; clientId?: string; username?: string; password?: string };
    const issuer = String(b.issuer ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/.test(issuer)) throw new Error(`invalid issuer: ${issuer}`);
    const bundle = await passwordGrant(
      issuer,
      String(b.clientId ?? OIDC_CLIENT_ID),
      String(b.username ?? ''),
      String(b.password ?? ''),
    );
    return { access_token: bundle.access_token, expires_in: bundle.expires_at - Math.floor(Date.now() / 1000) };
  }),
  route('GET', '/api/context', (_m, _b, opts) => readContext(opts)),
  route('GET', '/api/sandboxes', (_m, _b, opts) => listSandboxes(opts)),
  route('POST', '/api/sandboxes', (_m, body, opts) =>
    createSandboxResolved((body ?? {}) as CreateBody, opts),
  ),
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
  // Must precede the generic :action route so "settings" is not treated as an action.
  route('POST', '/api/sandboxes/:name/settings', (m, body, opts) => {
    const b = (body ?? {}) as { key?: string; value?: string };
    const key = String(b.key ?? '').trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw new Error(`invalid setting key: ${key}`);
    const value = String(b.value ?? '').trim();
    if (!value || /[\n\r]/.test(value)) throw new Error('setting value must be a single non-empty line');
    return runCli(['settings', 'set', safeName(m.name), '--key', key, '--value', value], {
      ...opts,
      timeoutMs: 60_000,
    });
  }),
  route('DELETE', '/api/sandboxes/:name/settings/:key', (m, _b, opts) => {
    const key = String(m.key ?? '').trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw new Error(`invalid setting key: ${key}`);
    return runCli(['settings', 'delete', safeName(m.name), '--key', key], { ...opts, timeoutMs: 60_000 });
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
  route('POST', '/api/sandboxes/:name/policy/update', async (m, body, opts) => {
    const name = safeName(m.name);
    const b = (body ?? {}) as PolicyUpdateBody;
    const run = (args: string[]) => runCli(args, { ...opts, timeoutMs: 3 * 60_000 });
    const hasEndpoint = Boolean(b.addEndpoints?.length || b.removeEndpoints?.length);
    const hasL7 = Boolean(b.addAllow?.length || b.addDeny?.length);
    if (hasEndpoint && hasL7) {
      // The CLI rejects --add-endpoint combined with --add-allow/--add-deny:
      // merge the endpoint first, then append the L7 rules onto it.
      const step1 = policyUpdateArgs(name, {
        ...b,
        addAllow: [],
        addDeny: [],
        anyBinary: false,
        endpointPath: '',
      });
      const step2 = policyUpdateArgs(name, { ...b, addEndpoints: [], removeEndpoints: [] });
      const out1 = await run(step1);
      let out2 = '';
      try {
        out2 = await run(step2);
      } catch (err) {
        // A dry-run of step 2 previews against the not-yet-merged policy.
        if (!b.dryRun) throw err;
        out2 = `step 2 preview: ${(err as Error).message}`;
      }
      return { output: [out1, out2].filter((s) => s.trim()).join('\n'), args: step1, steps: [step1, step2] };
    }
    const args = policyUpdateArgs(name, b);
    const output = await run(args);
    return { output, args, steps: [args] };
  }),
  route('POST', '/api/sandboxes/:name/policy/set', async (m, body, opts) => {
    const b = (body ?? {}) as { yaml?: string; wait?: boolean };
    return withTempFile(String(b.yaml ?? ''), 'yaml', async (file) => {
      const args = ['policy', 'set', safeName(m.name), '--policy', file];
      if (b.wait !== false) args.push('--wait');
      const output = await runCli(args, { ...opts, timeoutMs: 3 * 60_000 });
      return { output, args: ['policy', 'set', safeName(m.name), '--policy', '<temp.yaml>', ...(b.wait !== false ? ['--wait'] : [])] };
    });
  }),
  route('GET', '/api/sandboxes/:name/startup', (m, _b, opts) => readStartupCommand(safeName(m.name), opts)),
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
  route('POST', '/api/templates', async (_m, body, opts) => {
    const b = (body ?? {}) as { name?: string; image?: string; cpu?: string; memory?: string };
    const args = ['sandbox', 'template', 'create', safeName(b.name, 'template name')];
    if (b.image) args.push('--image', String(b.image));
    if (b.cpu) args.push('--cpu', String(b.cpu));
    if (b.memory) args.push('--memory', String(b.memory));
    // `template create` prints a confirmation line even with -o json.
    const output = await runCli(args, { ...opts, timeoutMs: 2 * 60_000 });
    return { output };
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
  route('POST', '/api/profiles/lint', async (_m, body, opts) => {
    const b = (body ?? {}) as ProfileFileBody;
    const run = (file?: string) => runCli(profileSourceArgs(b, file, 'lint'), opts);
    try {
      return b.url ? await run() : await withProfileFile(b, (file) => run(file));
    } catch (err) {
      const cli = err as CliError;
      const detail = cli.stdout?.trim() || cli.stderr?.trim() || cli.message;
      throw new Error(detail || 'profile lint failed');
    }
  }),
  route('POST', '/api/profiles/import', async (_m, body, opts) => {
    const b = (body ?? {}) as ProfileFileBody;
    const run = (file?: string) =>
      runCli(profileSourceArgs(b, file, 'import'), { ...opts, timeoutMs: 2 * 60_000 });
    try {
      return b.url ? await run() : await withProfileFile(b, (file) => run(file));
    } catch (err) {
      const cli = err as CliError;
      // diagnostics (e.g. "profile 'x' already exists") print above the error box
      const detail = cli.stdout?.trim() || cli.stderr?.trim() || cli.message;
      throw new Error(detail || 'profile import failed');
    }
  }),
  route('POST', '/api/profiles/:id/update', async (m, body, opts) => {
    const b = (body ?? {}) as ProfileFileBody;
    const id = safeProfileId(m.id);
    const run = (file: string) => {
      const args = ['profile', 'update', '-f', file, id];
      if (b.global) args.push('--global');
      return runCli(args, { ...opts, timeoutMs: 2 * 60_000 });
    };
    try {
      return await withProfileFile(b, run);
    } catch (err) {
      const cli = err as CliError;
      const detail = cli.stdout?.trim() || cli.stderr?.trim() || cli.message;
      throw new Error(detail || 'profile update failed');
    }
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

/** Cookie session, or the identity proven by a verified mTLS client cert. */
function requestSession(req: http.IncomingMessage): Session | null {
  const cookieSession = sessionFromRequest(req);
  if (cookieSession) return cookieSession;
  if (TLS_ENABLED && TLS.clientCa) {
    const socket = req.socket as TLSSocket;
    if (socket.authorized && typeof socket.getPeerCertificate === 'function') {
      return sessionFromCert(socket.getPeerCertificate());
    }
  }
  return null;
}

const ANONYMOUS = anonymousAllowed(HOST);

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // auth state must never be heuristic-cached by the browser
  if (url.pathname.startsWith('/api/auth/')) res.setHeader('Cache-Control', 'no-store');
  if (TLS_ENABLED) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (url.pathname.startsWith('/api/')) {
    const session = requestSession(req);
    const publicPath =
      url.pathname === '/api/auth/config' ||
      url.pathname === '/api/auth/oidc/start' ||
      url.pathname === '/api/auth/oidc/callback' ||
      url.pathname === '/api/auth/local' ||
      url.pathname === '/api/auth/entra/start' ||
      url.pathname === '/api/auth/entra/poll' ||
      url.pathname === '/api/auth/entra/discover' ||
      url.pathname === '/api/auth/entra/tenants' ||
      url.pathname === '/api/auth/entra/select' ||
      url.pathname === '/api/auth/me' ||
      url.pathname === '/api/auth/logout';
    if (!ANONYMOUS && !publicPath) {
      if (!session) {
        send(res, 401, { error: 'authentication required — sign in on the welcome page' });
        return;
      }
      try {
        await ensureFresh(session);
      } catch (err) {
        oidcLogout(session.id);
        send(res, 401, { error: (err as Error).message });
        return;
      }
      if (!sessionUser(session).admin && isAdminOnly(method, url.pathname)) {
        send(res, 403, { error: 'this operation requires the admin role' });
        return;
      }
    }
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        const body = method === 'GET' ? null : await readBody(req);
        // session-aware auth endpoints
        if (url.pathname === '/api/auth/me') {
          send(res, 200, { user: session ? sessionUser(session) : null, mode: AUTH_MODE });
          return;
        }
        if (url.pathname === '/api/auth/logout') {
          oidcLogout(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
          res.setHeader('set-cookie', sessionCookie('', 0, TLS_ENABLED));
          send(res, 200, { ok: true });
          return;
        }
        if (url.pathname === '/api/auth/role') {
          if (!session) throw new Error('authentication required — sign in first');
          const role = String(((body ?? {}) as { role?: string }).role ?? '');
          const granted = sessionUser(session).roles;
          const match = granted.find((r) => r.toLowerCase() === role.toLowerCase());
          if (!match) throw new Error(`role not granted by your IdP: ${role || '(empty)'}`);
          session.activeRole = match;
          audit('role-switch', { user: sessionUser(session).name, role: match });
          send(res, 200, { user: sessionUser(session) });
          return;
        }
        if (url.pathname === '/api/auth/oidc/start') {
          const b = (body ?? {}) as { issuer?: string; scopes?: string };
          const issuer = String(b.issuer ?? '').trim();
          const allowed =
            OIDC_ISSUERS.some((i) => i.issuer === issuer) || (ENTRA_ENABLED && issuer === entraIssuer());
          if (!allowed) throw new Error(`unknown issuer: ${issuer || '(empty)'}`);
          send(res, 200, await oidcStart(issuer, `${publicBase(req)}/api/auth/oidc/callback`, b.scopes));
          return;
        }
        if (url.pathname === '/api/auth/oidc/callback') {
          // land the browser back on the origin that started the flow (the
          // dev proxy rewrites Host, so the request host is not the UI origin)
          const flowOrigin = peekOidcFlowOrigin(url.searchParams.get('state') ?? '');
          const base = flowOrigin ?? publicBase(req);
          const fail = (msg: string) => {
            res.writeHead(302, { location: `${base}/#/welcome?oidc_error=${encodeURIComponent(msg)}` });
            res.end();
          };
          const idpError = url.searchParams.get('error');
          if (idpError) {
            audit('oidc-code denied', { error: idpError });
            fail(url.searchParams.get('error_description') || idpError);
            return;
          }
          try {
            const state = url.searchParams.get('state') ?? '';
            if (peekOidcFlowPurpose(state) === 'discover') {
              const selectionId = await oidcCallbackDiscover(url.searchParams.get('code') ?? '', state);
              res.writeHead(302, { location: `${base}/#/welcome?entra_flow=${selectionId}` });
              res.end();
              return;
            }
            const session = await oidcCallback(url.searchParams.get('code') ?? '', state);
            res.setHeader('set-cookie', sessionCookie(session.id, undefined, TLS_ENABLED));
            res.writeHead(302, { location: `${base}/` });
            res.end();
          } catch (err) {
            audit('oidc-code failed', { error: (err as Error).message });
            fail((err as Error).message);
          }
          return;
        }
        if (url.pathname === '/api/auth/entra/discover') {
          if (!ENTRA_ENABLED) throw new Error('Entra sign-in is not configured on this bridge');
          send(
            res,
            200,
            await oidcStart(
              ENTRA_ORGANIZATIONS_ISSUER,
              `${publicBase(req)}/api/auth/oidc/callback`,
              ENTRA_DISCOVER_SCOPES,
              'discover',
            ),
          );
          return;
        }
        if (url.pathname === '/api/auth/entra/tenants') {
          send(res, 200, { tenants: listEntraTenants(url.searchParams.get('flow') ?? '') });
          return;
        }
        if (url.pathname === '/api/auth/entra/select') {
          const b = (body ?? {}) as { flow?: string; tenantId?: string };
          const session = await selectEntraTenant(String(b.flow ?? ''), String(b.tenantId ?? ''));
          res.setHeader('set-cookie', sessionCookie(session.id, undefined, TLS_ENABLED));
          send(res, 200, { user: sessionUser(session) });
          return;
        }
        if (url.pathname === '/api/auth/local') {
          const b = (body ?? {}) as { token?: string };
          const token = String(b.token ?? '');
          if (!token) throw new Error('token is required');
          const local = localLogin(token, req.socket.remoteAddress ?? 'unknown');
          res.setHeader('set-cookie', sessionCookie(local.id, undefined, TLS_ENABLED));
          send(res, 200, { user: sessionUser(local) });
          return;
        }
        const result = await r.handler(params, body, q(url));
        if (
          url.pathname === '/api/auth/entra/poll' &&
          result &&
          typeof result === 'object' &&
          'cookie' in result
        ) {
          const { cookie, ...rest } = result as { cookie: string };
          res.setHeader('set-cookie', cookie);
          send(res, 200, rest);
          return;
        }
        send(res, 200, result);
      } catch (err) {
        const cli = err as CliError;
        send(res, 400, {
          error: cli instanceof CliError ? cli.message : String((err as Error).message ?? err),
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
}

// TLS terminates on the bridge itself so client certificates can be verified;
// rejectUnauthorized stays false because token/OIDC callers present no cert —
// `socket.authorized` is what gates the mTLS path.
const server = TLS_ENABLED
  ? https.createServer(
      {
        cert: fs.readFileSync(TLS.cert),
        key: fs.readFileSync(TLS.key),
        ca: TLS.clientCa ? fs.readFileSync(TLS.clientCa) : undefined,
        requestCert: Boolean(TLS.clientCa),
        rejectUnauthorized: false,
      },
      (req, res) => void handleRequest(req, res),
    )
  : http.createServer((req, res) => void handleRequest(req, res));

// ---------------------------------------------------------------------------
// Terminal bridge: a real PTY over WebSocket
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/api/terminal' });

wss.on('connection', async (ws: WebSocket, req) => {
  if (!ANONYMOUS) {
    const session = requestSession(req);
    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: 'authentication required — sign in on the welcome page' }));
      ws.close();
      return;
    }
    try {
      await ensureFresh(session);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      ws.close();
      return;
    }
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const name = url.searchParams.get('name') ?? '';
  const cols = Math.min(Math.max(Number(url.searchParams.get('cols')) || 100, 20), 400);
  const rows = Math.min(Math.max(Number(url.searchParams.get('rows')) || 30, 8), 200);
  const mode = url.searchParams.get('mode') === 'shell' ? 'shell' : 'workload';
  const gateway = url.searchParams.get('gateway') ?? '';
  const workspace = url.searchParams.get('workspace') ?? '';
  if (!NAME_RE.test(name)) {
    ws.send(JSON.stringify({ type: 'error', message: `invalid sandbox name: ${name}` }));
    ws.close();
    return;
  }
  if ((gateway && !NAME_RE.test(gateway)) || (workspace && !NAME_RE.test(workspace))) {
    ws.send(JSON.stringify({ type: 'error', message: 'invalid gateway or workspace scope' }));
    ws.close();
    return;
  }

  const scope: Query = {
    gateway: gateway || undefined,
    workspace: workspace || undefined,
  };
  const write = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  let argv: string[];
  try {
    if (mode === 'workload') {
      // Attach to the sandbox's canonical main process — the command the
      // sandbox was started with. This is the CLI's own interactive path.
      argv = ['sandbox', 'connect', name];
    } else {
      const requested = (url.searchParams.get('shell') ?? '').trim();
      const shell =
        /^\/(?:[\w.+-]+\/)*[\w.+-]+$/.test(requested) ? requested : await resolveSandboxShell(name, scope);
      // The sandbox's own shell, never a hardcoded bash.
      argv = ['sandbox', 'exec', name, '--tty', '--', shell, '-l'];
    }
  } catch (err) {
    write({ type: 'error', message: String((err as Error).message) });
    ws.close();
    return;
  }
  if (gateway) argv.unshift('--gateway', gateway);
  if (workspace) argv.unshift('--workspace', workspace);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(BIN, argv, {
      env: {
        ...process.env,
        OPENSHELL_COLOR: 'always',
        TERM: 'xterm-256color',
        COLUMNS: String(cols),
        LINES: String(rows),
      },
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: String((err as Error).message) }));
    ws.close();
    return;
  }

  child.stdout.on('data', (d: Buffer) => write({ type: 'data', data: d.toString('utf8') }));
  child.stderr.on('data', (d: Buffer) => write({ type: 'data', data: d.toString('utf8') }));
  child.on('error', (err) => write({ type: 'error', message: String(err.message) }));
  child.on('close', (code, signal) => {
    write({
      type: 'exit',
      code,
      signal,
      message:
        mode === 'workload'
          ? 'the canonical main process ended or detached from this terminal — press reconnect to attach again'
          : cleanError(signal ? `shell terminated (${signal})` : ''),
    });
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
    // Nudge the remote PTY to redraw at the new size (TUIs repaint on SIGWINCH).
    if (msg.type === 'resize') child.kill('SIGWINCH');
  });
  ws.on('close', () => {
    child.stdin.end();
    child.kill('SIGTERM');
  });
});

// Fail closed: with no credential path and no anonymous allowance (non-loopback
// bind, or OPENSHELL_UI_REQUIRE_AUTH) the bridge would be either an open proxy
// to the gateway or unusable. Refuse to start instead of serving it.
const PATHS = authPaths(HOST);
if (PATHS.length === 0) {
  console.error(
    `openshell-ui bridge refuses to start: no credential path configured and anonymous access not allowed (host=${HOST}).\n` +
      '  Anonymous loopback is a dev convenience, disabled by a non-loopback bind or OPENSHELL_UI_REQUIRE_AUTH.\n' +
      '  Set OPENSHELL_UI_AUTH=oidc, or OPENSHELL_UI_ENTRA_TENANT/CLIENT_ID, or\n' +
      '  OPENSHELL_UI_LOCAL_TOKEN[_FILE], or OPENSHELL_UI_TLS_CERT/KEY + OPENSHELL_UI_TLS_CLIENT_CA.',
  );
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`openshell-ui bridge → ${TLS_ENABLED ? 'https' : 'http'}://${HOST}:${PORT}`);
  console.log(`  cli: ${BIN}`);
  console.log(`  home: ${os.homedir()}`);
  console.log(`  auth: mode=${AUTH_MODE} tls=${TLS_ENABLED ? 'on' : 'off'} paths=${PATHS.join(',')}`);
  if (ANONYMOUS) console.log('  WARNING: anonymous loopback access (development only)');
});
