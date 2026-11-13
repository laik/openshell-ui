/**
 * Gateway registration helpers.
 *
 * `openshell gateway add` writes a metadata.json into the CLI config directory;
 * edge-authenticated gateways then keep a bearer token next to it. The console
 * lets a person paste that token up front, stores it with the same layout the
 * CLI uses, and verifies the pair before keeping the registration.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError, cleanError, runCli, runJson } from './cli.ts';

export const NAME_RE = /^[A-Za-z0-9]([-A-Za-z0-9_.]{0,62}[A-Za-z0-9])?$/;

export interface GatewayMetadata {
  name?: string;
  gateway_endpoint?: string;
  is_remote?: boolean;
  gateway_port?: number;
  remote_host?: string | null;
  resolved_host?: string | null;
  auth_mode?: string;
  edge_team_domain?: string;
  edge_auth_url?: string;
  oidc_issuer?: string;
  oidc_client_id?: string;
  oidc_audience?: string;
  oidc_scopes?: string;
  vm_driver_state_dir?: string;
  [key: string]: unknown;
}

export interface GatewayRecord {
  name: string;
  endpoint: string;
  type: string;
  source: string;
  auth: string;
  active: boolean;
  is_remote: boolean;
  remote_host?: string | null;
  resolved_host?: string | null;
  health?: GatewayHealth;
  metadata?: GatewayMetadata | null;
}

export interface GatewayHealth {
  ok: boolean;
  status?: Record<string, unknown> | null;
  error?: string;
  latency_ms: number;
  checked_at: number;
}

export interface AddGatewayBody {
  endpoint?: string;
  name?: string;
  /** auto | edge | oidc | local | remote | plaintext */
  mode?: string;
  /** Bearer token for edge gateways, access token for OIDC gateways. */
  token?: string;
  remoteHost?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcAudience?: string;
  oidcScopes?: string;
  insecure?: boolean;
  /** Verify with `openshell status` before keeping the registration. */
  verify?: boolean;
  /** Remove the registration again when verification fails. */
  rollback?: boolean;
  /** Make the new gateway the active one (CLI default). */
  activate?: boolean;
}

export interface AddGatewayResult {
  name: string;
  gateway: GatewayRecord;
  verification: GatewayHealth | null;
  token_saved: boolean;
  token_kind: 'edge' | 'oidc' | null;
  warnings: string[];
  output: string;
}

export function safeGatewayName(value: string | undefined, what = 'gateway name'): string {
  if (!value || !NAME_RE.test(value)) {
    throw new Error(`invalid ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Where the CLI keeps user-scoped gateway registrations. */
export function configDir(): string {
  const explicit = process.env.OPENSHELL_UI_CONFIG_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, 'openshell');
  return path.join(os.homedir(), '.config', 'openshell');
}

export function gatewayDir(name: string): string {
  return path.join(configDir(), 'gateways', safeGatewayName(name));
}

export function readMetadata(name: string): GatewayMetadata | null {
  try {
    const raw = fs.readFileSync(path.join(gatewayDir(name), 'metadata.json'), 'utf8');
    const parsed = JSON.parse(raw) as GatewayMetadata;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writePrivate(dir: string, file: string, contents: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${file}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, file));
}

/** Bearer token used by Cloudflare/edge authenticated gateways. */
export function writeEdgeToken(name: string, token: string): void {
  writePrivate(gatewayDir(name), 'edge_token', token.trim());
}

export interface OidcBundle {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  issuer: string;
  client_id: string;
}

/** Token bundle the CLI reads for OIDC gateways (`oidc_token.json`). */
export function writeOidcToken(
  name: string,
  token: string,
  metadata: GatewayMetadata,
  overrides: { issuer?: string; clientId?: string } = {},
): void {
  const exp = jwtExpiry(token);
  const bundle: OidcBundle = {
    access_token: token.trim(),
    refresh_token: '',
    expires_at: exp ?? Math.floor(Date.now() / 1000) + 3600,
    issuer: (overrides.issuer ?? metadata.oidc_issuer ?? '').trim(),
    client_id: (overrides.clientId ?? metadata.oidc_client_id ?? 'openshell-cli').trim(),
  };
  writePrivate(gatewayDir(name), 'oidc_token.json', JSON.stringify(bundle));
}

export function clearTokens(name: string): string[] {
  const dir = gatewayDir(name);
  const removed: string[] = [];
  for (const file of ['edge_token', 'cf_token', 'oidc_token.json']) {
    try {
      fs.unlinkSync(path.join(dir, file));
      removed.push(file);
    } catch {
      /* not present */
    }
  }
  return removed;
}

/** Best-effort JWT payload read, used only to choose an expiry for OIDC bundles. */
function jwtExpiry(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

export function tokenKind(metadata: GatewayMetadata | null): 'edge' | 'oidc' | null {
  const mode = String(metadata?.auth_mode ?? '').toLowerCase();
  if (mode === 'oidc') return 'oidc';
  if (mode === 'cloudflare_jwt' || mode === 'edge' || mode === 'cf_jwt') return 'edge';
  return null;
}

/** Run `openshell status` against one registered gateway. */
export async function probeGateway(
  name: string,
  opts: { insecure?: boolean; timeoutMs?: number } = {},
): Promise<GatewayHealth> {
  const started = Date.now();
  try {
    const status = await runJson<Record<string, unknown>>(['status', '-o', 'json'], {
      gateway: safeGatewayName(name),
      timeoutMs: opts.timeoutMs ?? 25_000,
      env: opts.insecure ? { OPENSHELL_GATEWAY_INSECURE: '1' } : undefined,
    });
    const state = String(status?.status ?? '');
    return {
      ok: state === 'connected',
      status,
      ...(state && state !== 'connected' ? { error: `gateway reported status "${state}"` } : {}),
      latency_ms: Date.now() - started,
      checked_at: Date.now(),
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof CliError ? err.message : cleanError(String((err as Error)?.message ?? err)),
      latency_ms: Date.now() - started,
      checked_at: Date.now(),
    };
  }
}

export async function listGateways(opts: { probe?: boolean; insecure?: boolean } = {}): Promise<GatewayRecord[]> {
  const records = (await runJson<GatewayRecord[]>(['gateway', 'list', '-o', 'json'], {})) ?? [];
  if (!Array.isArray(records)) return [];
  const withMeta = records.map((g) => ({ ...g, metadata: readMetadata(g.name) }));
  if (!opts.probe) return withMeta;
  // Probe in small batches so a long gateway list does not spawn a burst of CLI
  // processes at once.
  const out: GatewayRecord[] = [];
  for (let i = 0; i < withMeta.length; i += 4) {
    const batch = withMeta.slice(i, i + 4);
    out.push(
      ...(await Promise.all(
        batch.map(async (g) => ({
          ...g,
          health: await probeGateway(g.name, { insecure: opts.insecure, timeoutMs: 12_000 }),
        })),
      )),
    );
  }
  return out;
}

function previousActive(): string {
  try {
    return fs.readFileSync(path.join(configDir(), 'active_gateway'), 'utf8').trim();
  } catch {
    return '';
  }
}

function nameFromAddOutput(output: string): string {
  const quoted = /Gateway '([^']+)' added/.exec(output);
  if (quoted) return quoted[1];
  const unquoted = /Gateway "([^"]+)" added/.exec(output);
  return unquoted ? unquoted[1] : '';
}

function validEndpoint(endpoint: string): boolean {
  return /^(https?|ssh):\/\/[^\s]+$/.test(endpoint);
}

function safeRemote(value: string | undefined): string {
  const remote = String(value ?? '').trim();
  if (!remote) throw new Error('a remote host is required for remote gateways (user@host)');
  if (!/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+$/.test(remote) && !/^[A-Za-z0-9_.:-]+$/.test(remote)) {
    throw new Error(`invalid remote host: ${JSON.stringify(remote)}`);
  }
  return remote;
}

/**
 * Register a gateway, optionally store a pasted token, and verify the result.
 * Verification is on by default; a failed verification rolls the registration
 * back unless the caller explicitly asked to keep it.
 */
export async function addGateway(body: AddGatewayBody): Promise<AddGatewayResult> {
  const endpoint = String(body.endpoint ?? '').trim();
  if (!validEndpoint(endpoint)) {
    throw new Error(`invalid gateway endpoint: ${endpoint || '(empty)'}`);
  }
  const mode = String(body.mode ?? 'auto').toLowerCase();
  const scheme = endpoint.slice(0, endpoint.indexOf('://')).toLowerCase();
  if ((mode === 'edge' || mode === 'oidc') && scheme !== 'https') {
    throw new Error(`${mode} gateways need an https:// endpoint`);
  }
  if (mode === 'plaintext' && scheme !== 'http') {
    throw new Error('plaintext gateways need an http:// endpoint');
  }
  if (mode === 'remote' && scheme === 'http') {
    throw new Error('a remote mTLS gateway needs an https:// or ssh:// endpoint');
  }
  const args = ['gateway', 'add'];
  const warnings: string[] = [];

  switch (mode) {
    case 'auto':
    case 'edge':
      break;
    case 'oidc': {
      const issuer = String(body.oidcIssuer ?? '').trim();
      if (!/^https?:\/\/[^\s]+$/.test(issuer)) {
        throw new Error('an OIDC gateway needs an issuer URL (https://…)');
      }
      args.push('--oidc-issuer', issuer);
      if (body.oidcClientId) args.push('--oidc-client-id', String(body.oidcClientId).trim());
      if (body.oidcAudience) args.push('--oidc-audience', String(body.oidcAudience).trim());
      if (body.oidcScopes) args.push('--oidc-scopes', String(body.oidcScopes).trim());
      break;
    }
    case 'local':
    case 'plaintext':
      args.push('--local');
      break;
    case 'remote':
      // `ssh://user@host:port` already carries the SSH destination.
      if (!endpoint.startsWith('ssh://')) args.push('--remote', safeRemote(body.remoteHost));
      break;
    default:
      throw new Error(`unknown gateway mode: ${mode}`);
  }

  args.push(endpoint);
  if (body.name) args.push('--name', safeGatewayName(body.name));
  if (body.insecure) args.push('--gateway-insecure');

  const before = previousActive();
  const output = await runCli(args, {
    timeoutMs: 2 * 60_000,
    env: { OPENSHELL_NO_BROWSER: '1', OPENSHELL_COLOR: 'never' },
  });

  const name =
    (body.name && safeGatewayName(body.name)) ||
    nameFromAddOutput(output) ||
    deriveName(endpoint);
  if (!name) {
    throw new Error(`the gateway was added but its name could not be resolved: ${output.trim()}`);
  }

  if (body.activate === false && before && before !== name) {
    try {
      await runCli(['gateway', 'select', safeGatewayName(before)]);
    } catch (err) {
      warnings.push(`could not restore previous active gateway: ${(err as Error).message}`);
    }
  }

  const metadata = readMetadata(name);
  let tokenSaved = false;
  let kind: 'edge' | 'oidc' | null = null;
  const token = String(body.token ?? '').trim();
  if (token) {
    kind = tokenKind(metadata);
    if (kind === 'edge') {
      writeEdgeToken(name, token);
      tokenSaved = true;
    } else if (kind === 'oidc') {
      writeOidcToken(name, token, metadata ?? {}, {
        issuer: body.oidcIssuer,
        clientId: body.oidcClientId,
      });
      tokenSaved = true;
    } else {
      warnings.push(
        `gateway uses ${String(metadata?.auth_mode ?? 'mTLS')} authentication; the token was not stored`,
      );
    }
  }

  const verify = body.verify !== false;
  let verification: GatewayHealth | null = null;
  if (verify) {
    verification = await probeGateway(name, { insecure: body.insecure });
    if (!verification.ok && body.rollback !== false) {
      let rolledBack = false;
      try {
        await runCli(['gateway', 'remove', safeGatewayName(name)]);
        rolledBack = true;
      } catch {
        /* keeping the registration is preferable to hiding the original error */
      }
      if (before && before !== name) {
        try {
          await runCli(['gateway', 'select', safeGatewayName(before)]);
        } catch {
          /* best effort */
        }
      }
      throw new Error(
        `gateway verification failed${rolledBack ? ' (registration rolled back)' : ''}: ${verification.error ?? 'connection refused'}`,
      );
    }
    if (!verification.ok) {
      warnings.push(`verification failed: ${verification.error ?? 'connection refused'}`);
    }
  }

  const records = (await runJson<GatewayRecord[]>(['gateway', 'list', '-o', 'json'], {})) ?? [];
  const gateway =
    records.find((g) => g.name === name) ??
    ({
      name,
      endpoint,
      type: 'unknown',
      source: 'user',
      auth: String(metadata?.auth_mode ?? 'unknown'),
      active: true,
      is_remote: Boolean(metadata?.is_remote),
    } satisfies GatewayRecord);
  return {
    name,
    gateway: { ...gateway, metadata, ...(verification ? { health: verification } : {}) },
    verification,
    token_saved: tokenSaved,
    token_kind: kind,
    warnings,
    output: output.trim(),
  };
}

function deriveName(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = url.port ? `-${url.port}` : '';
    const base = host === 'localhost' || host === '127.0.0.1' ? 'local' : host;
    return base.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) + port;
  } catch {
    return '';
  }
}

/** Store a fresh token for an existing gateway and verify it. */
export async function setGatewayToken(
  name: string,
  token: string,
  opts: { insecure?: boolean; verify?: boolean } = {},
): Promise<{ name: string; token_kind: 'edge' | 'oidc'; token_saved: boolean; verification: GatewayHealth | null }> {
  const gwName = safeGatewayName(name);
  const metadata = readMetadata(gwName);
  if (!metadata) throw new Error(`no local metadata for gateway "${gwName}"`);
  const kind = tokenKind(metadata);
  if (!kind) {
    throw new Error(
      `gateway "${gwName}" uses ${String(metadata.auth_mode ?? 'mTLS')} authentication; it does not accept a pasted token`,
    );
  }
  const clean = String(token ?? '').trim();
  if (!clean) throw new Error('a token is required');
  if (kind === 'edge') writeEdgeToken(gwName, clean);
  else writeOidcToken(gwName, clean, metadata);
  const verification = opts.verify === false ? null : await probeGateway(gwName, { insecure: opts.insecure });
  return { name: gwName, token_kind: kind, token_saved: true, verification };
}

export async function removeGateway(name: string): Promise<string> {
  return runCli(['gateway', 'remove', safeGatewayName(name)], { timeoutMs: 60_000 });
}

export async function selectGateway(name: string): Promise<string> {
  return runCli(['gateway', 'select', safeGatewayName(name)], { timeoutMs: 60_000 });
}

/**
 * Browser login runs on the machine hosting the bridge. It is intentionally a
 * separate action from `add`, because it blocks until the browser flow returns.
 */
export async function loginGateway(name: string): Promise<string> {
  return runCli(['gateway', 'login', safeGatewayName(name)], {
    timeoutMs: 5 * 60_000,
    env: { OPENSHELL_COLOR: 'never' },
  });
}

export async function logoutGateway(name: string): Promise<string> {
  return runCli(['gateway', 'logout', safeGatewayName(name)], { timeoutMs: 60_000 });
}
