/**
 * Authentication for the console bridge — three credential paths, one session
 * model, fail-closed by default.
 *
 *  - OIDC password grant (iam-lab Keycloak realms, `lab-cli` public client),
 *    offered when `OPENSHELL_UI_AUTH=oidc`;
 *  - Microsoft Entra ID device-code flow (public client, MFA-friendly, no
 *    client secret), offered when tenant + client id are configured;
 *  - local operator credentials for the "local console" path: a client
 *    certificate verified against a trusted CA (mTLS) or a provisioned bearer
 *    token (k8s Secret). Both yield an admin session.
 *
 * Anonymous access is a development convenience only: it exists when the mode
 * is `local`, the bind address is loopback, no local credential is configured
 * and OPENSHELL_UI_REQUIRE_AUTH is unset. Anything else requires a session.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';

export interface OidcIssuer {
  name: string;
  issuer: string;
}

export const AUTH_MODE = (process.env.OPENSHELL_UI_AUTH ?? 'local').toLowerCase() === 'oidc' ? 'oidc' : 'local';

/**
 * Issuer allowlist, fixed at deploy time (env / ConfigMap) — never supplied by
 * the browser: the password grant runs server-side against these token
 * endpoints, so an open-ended issuer field would be credential phishing + SSRF.
 * Entries are `url` or `Display Name=url`; the name defaults to the last path
 * segment (the realm name for Keycloak).
 */
/** No built-in demo defaults: an unset allowlist means no OIDC path at all.
 * The demo scripts supply the iam-lab realms explicitly. */
export const OIDC_ISSUERS: OidcIssuer[] = (process.env.OPENSHELL_UI_OIDC_ISSUERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const eq = entry.indexOf('=');
    const named = eq > 0 && !entry.slice(0, eq).includes('://');
    const issuer = (named ? entry.slice(eq + 1) : entry).trim();
    const name = named ? entry.slice(0, eq).trim() : (issuer.split('/').filter(Boolean).pop() ?? issuer);
    return { name, issuer };
  });

export const OIDC_CLIENT_ID = process.env.OPENSHELL_UI_OIDC_CLIENT_ID ?? 'lab-cli';

/** Microsoft Entra ID (device-code flow). Disabled unless tenant + client id are set. */
const entraClientId = (process.env.OPENSHELL_UI_ENTRA_CLIENT_ID ?? '').trim();
export const ENTRA = {
  tenant: (process.env.OPENSHELL_UI_ENTRA_TENANT ?? '').trim(),
  clientId: entraClientId,
  // `<clientId>/.default` makes the access token's audience this app itself —
  // only then does Entra emit the app's `roles` claim (a Graph-audience token
  // would carry Graph's roles, not ours). OIDC scopes ride along for the
  // id token and the refresh token.
  scopes: (
    process.env.OPENSHELL_UI_ENTRA_SCOPES ??
    (entraClientId ? `openid profile email offline_access ${entraClientId}/.default` : 'openid profile email offline_access')
  ).trim(),
  issuerOverride: (process.env.OPENSHELL_UI_ENTRA_ISSUER ?? '').trim(),
};
export const ENTRA_ENABLED = Boolean(ENTRA.tenant && ENTRA.clientId);
/** Tenants this console accepts sessions from (multi-tenant app hardening). */
export const ENTRA_ALLOWED_TENANTS = (process.env.OPENSHELL_UI_ENTRA_ALLOWED_TENANTS ?? ENTRA.tenant)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Session role that unlocks admin-only operations (realm role for Keycloak, app role for Entra). */
export const ADMIN_ROLE = (process.env.OPENSHELL_UI_ADMIN_ROLE ?? 'admin').trim();

export function entraIssuer(): string {
  if (ENTRA.issuerOverride) return ENTRA.issuerOverride.replace(/\/$/, '');
  return `https://login.microsoftonline.com/${ENTRA.tenant}/v2.0`;
}

// ---------------------------------------------------------------------------
// Transport security + local operator credentials (mTLS / token)
// ---------------------------------------------------------------------------

/** TLS termination on the bridge itself — required for client-certificate auth. */
export const TLS = {
  cert: (process.env.OPENSHELL_UI_TLS_CERT ?? '').trim(),
  key: (process.env.OPENSHELL_UI_TLS_KEY ?? '').trim(),
  clientCa: (process.env.OPENSHELL_UI_TLS_CLIENT_CA ?? '').trim(),
};
export const TLS_ENABLED = Boolean(TLS.cert && TLS.key);

function readLocalToken(): string {
  const inline = (process.env.OPENSHELL_UI_LOCAL_TOKEN ?? '').trim();
  if (inline) return inline;
  const file = (process.env.OPENSHELL_UI_LOCAL_TOKEN_FILE ?? '').trim();
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (err) {
    console.error(`[auth] cannot read OPENSHELL_UI_LOCAL_TOKEN_FILE ${file}: ${(err as Error).message}`);
    return '';
  }
}
/** Provisioned operator token (env or Secret-mounted file). Never logged. */
export const LOCAL_TOKEN = readLocalToken();
export const LOCAL_AUTH_CONFIGURED = Boolean(LOCAL_TOKEN || (TLS_ENABLED && TLS.clientCa));
export const REQUIRE_AUTH = /^(1|true|yes)$/i.test((process.env.OPENSHELL_UI_REQUIRE_AUTH ?? '').trim());

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

/** The only situation where an unauthenticated caller is served: dev loopback. */
export function anonymousAllowed(host: string): boolean {
  return AUTH_MODE === 'local' && isLoopbackHost(host) && !LOCAL_AUTH_CONFIGURED && !REQUIRE_AUTH;
}

/** Credential paths this bridge offers; used for the startup fail-closed check. */
export function authPaths(host: string): string[] {
  const paths: string[] = [];
  if (AUTH_MODE === 'oidc' && OIDC_ISSUERS.length > 0) paths.push('oidc');
  if (ENTRA_ENABLED) paths.push('entra');
  if (LOCAL_TOKEN) paths.push('local-token');
  if (TLS_ENABLED && TLS.clientCa) paths.push('local-mtls');
  if (anonymousAllowed(host)) paths.push('anonymous-loopback(dev)');
  return paths;
}

export function audit(event: string, detail: Record<string, unknown>): void {
  console.log(`[auth] ${event} ${JSON.stringify(detail)}`);
}

/** Sibling console URLs offered on the welcome/chooser page. */
export const PORTAL_URLS = {
  localUrl: process.env.OPENSHELL_UI_LOCAL_URL ?? 'http://localhost:5279',
  oidcUrl: process.env.OPENSHELL_UI_OIDC_URL ?? 'http://localhost:5273',
};

export interface TokenBundle {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type?: string;
}

export interface SessionClaims {
  sub?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  /** Keycloak realm roles. */
  realm_access?: { roles?: string[] };
  /** Entra ID app roles (and/or groups, depending on the app manifest). */
  roles?: string[];
  [k: string]: unknown;
}

export interface Session {
  id: string;
  issuer: string;
  clientId: string;
  bundle: TokenBundle;
  claims: SessionClaims;
  /** Role this session operates with, chosen post-login from granted roles. */
  activeRole?: string;
}

export interface AuthUser {
  name: string;
  email: string;
  /** All roles granted by the IdP (realm roles / Entra app roles). */
  roles: string[];
  /** IdP group memberships, when the provider emits them. */
  groups: string[];
  /** Role currently in effect for this session (defaults to highest granted). */
  activeRole: string | null;
  issuer: string;
  admin: boolean;
}

const sessions = new Map<string, Session>();

interface DiscoveryDoc {
  token_endpoint: string;
  device_authorization_endpoint?: string;
  authorization_endpoint?: string;
  jwks_uri?: string;
}
const discovery = new Map<string, DiscoveryDoc>();

export const SESSION_COOKIE = 'os_session';

export function decodeClaims(token: string): SessionClaims {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as SessionClaims;
  } catch {
    return {};
  }
}

export function sessionUser(session: Session): AuthUser {
  const c = session.claims;
  const roles = c.realm_access?.roles ?? (Array.isArray(c.roles) ? c.roles.filter((r): r is string => typeof r === 'string') : []);
  const groups = Array.isArray(c.groups) ? c.groups.filter((g): g is string => typeof g === 'string') : [];
  const wanted = ADMIN_ROLE.toLowerCase();
  // Post-login role selection: operate with the chosen granted role; default
  // to the highest granted (admin when present) so behaviour is unchanged
  // until the operator explicitly switches.
  const active =
    session.activeRole && roles.some((r) => r.toLowerCase() === session.activeRole!.toLowerCase())
      ? session.activeRole
      : roles.some((r) => r.toLowerCase() === wanted)
        ? ADMIN_ROLE
        : (roles[0] ?? null);
  return {
    name: String(c.preferred_username ?? c.name ?? c.email ?? c.sub ?? 'unknown'),
    email: String(c.email ?? ''),
    roles,
    groups,
    activeRole: active,
    issuer: session.issuer,
    admin: active?.toLowerCase() === wanted,
  };
}

async function discoveryDoc(issuer: string): Promise<DiscoveryDoc> {
  const hit = discovery.get(issuer);
  if (hit) return hit;
  const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer} (${res.status})`);
  const doc = (await res.json()) as {
    token_endpoint?: string;
    device_authorization_endpoint?: string;
    authorization_endpoint?: string;
    jwks_uri?: string;
  };
  if (!doc.token_endpoint) throw new Error(`OIDC discovery for ${issuer} has no token_endpoint`);
  const value: DiscoveryDoc = {
    token_endpoint: doc.token_endpoint,
    device_authorization_endpoint: doc.device_authorization_endpoint,
    authorization_endpoint: doc.authorization_endpoint,
    jwks_uri: doc.jwks_uri,
  };
  discovery.set(issuer, value);
  return value;
}

// ---------------------------------------------------------------------------
// Token verification: JWKS signature + iss / aud / exp / nonce
// ---------------------------------------------------------------------------

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}
const jwksCache = new Map<string, { keys: Jwk[]; fetched: number }>();

async function jwks(issuer: string, force = false): Promise<Jwk[]> {
  const hit = jwksCache.get(issuer);
  if (hit && !force && Date.now() - hit.fetched < 10 * 60_000) return hit.keys;
  const doc = await discoveryDoc(issuer);
  if (!doc.jwks_uri) throw new Error(`OIDC discovery for ${issuer} has no jwks_uri`);
  const res = await fetch(doc.jwks_uri, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed for ${issuer} (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(issuer, { keys, fetched: Date.now() });
  return keys;
}

/**
 * Verify an IdP-issued JWT the enterprise way: RS256 signature against the
 * issuer's JWKS (with kid-rotation refetch), then issuer, audience, expiry and
 * — when supplied — the PKCE-flow nonce. Never trust a decoded payload alone.
 */
export async function verifyJwt(
  token: string,
  issuer: string,
  clientId: string,
  nonce?: string,
  /** Keycloak omits `aud` on access tokens by default; the PKCE code exchange
   * is already client-bound, so a missing aud is acceptable there — but an
   * aud that IS present must match. id_tokens always require aud (OIDC core). */
  allowMissingAud = false,
  /** Expected audience override (e.g. ARM tokens for tenant discovery). */
  audOverride?: string,
  /** Accept any Microsoft tenant issuer (organizations-endpoint sign-ins land
   * in the user's home tenant, which is not known before the redirect). */
  msAnyIssuer = false,
): Promise<SessionClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  let header: { alg?: string; kid?: string };
  let claims: SessionClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('malformed token');
  }
  if (header.alg !== 'RS256') throw new Error(`unsupported token algorithm: ${header.alg}`);
  let keys = await jwks(issuer);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await jwks(issuer, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error('token signing key not found in issuer JWKS');
  const key = crypto.createPublicKey({ key: jwk as crypto.webcrypto.JsonWebKey, format: 'jwk' });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!crypto.verify('RSA-SHA256', signed, key, Buffer.from(parts[2], 'base64url'))) {
    throw new Error('token signature invalid');
  }
  const now = Math.floor(Date.now() / 1000);
  // Entra quirk: id_tokens carry login.microsoftonline.com/{tid}/v2.0 while
  // access tokens carry sts.windows.net/{tid}/ — both are the same issuer.
  const iss = String(claims.iss ?? '').replace(/\/$/, '');
  const msTenant = /^https:\/\/(login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0|sts\.windows\.net\/[0-9a-f-]{36})$/;
  if (msAnyIssuer) {
    if (!msTenant.test(iss)) throw new Error('token issuer mismatch');
  } else {
    const aliases = [issuer.replace(/\/$/, '')];
    const ms = issuer.match(/^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0\/?$/);
    if (ms) aliases.push(`https://sts.windows.net/${ms[1]}`);
    if (!aliases.includes(iss)) throw new Error('token issuer mismatch');
  }
  const expectedAud = audOverride ?? clientId;
  if (claims.aud !== undefined) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(expectedAud)) throw new Error('token audience mismatch');
  } else if (!allowMissingAud) {
    throw new Error('token audience missing');
  }
  if (typeof claims.exp !== 'number' || claims.exp < now) throw new Error('token expired');
  if (nonce !== undefined && claims.nonce !== nonce) throw new Error('token nonce mismatch');
  return claims;
}

async function tokenEndpoint(issuer: string): Promise<string> {
  return (await discoveryDoc(issuer)).token_endpoint;
}

async function tokenRequest(issuer: string, params: Record<string, string>): Promise<TokenBundle> {
  const endpoint = await tokenEndpoint(issuer);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const doc = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !doc.access_token) {
    throw new Error(doc.error_description || doc.error || `token request failed (${res.status})`);
  }
  return {
    access_token: doc.access_token,
    refresh_token: doc.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (doc.expires_in ?? 300),
    token_type: doc.token_type,
  };
}

/** OIDC password grant (iam-lab's `lab-cli` public client enables direct access grants). */
export function passwordGrant(
  issuer: string,
  clientId: string,
  username: string,
  password: string,
): Promise<TokenBundle> {
  return tokenRequest(issuer, {
    grant_type: 'password',
    client_id: clientId,
    username,
    password,
    scope: 'openid profile email',
  });
}

// ---------------------------------------------------------------------------
// Enterprise sign-in: OIDC authorization code + PKCE (Keycloak and Entra alike)
// ---------------------------------------------------------------------------

interface OidcFlow {
  state: string;
  issuer: string;
  clientId: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  purpose: 'session' | 'discover';
}
const oidcFlows = new Map<string, OidcFlow>();

/** Microsoft multi-tenant endpoint: authenticate first, discover tenants after. */
export const ENTRA_ORGANIZATIONS_ISSUER = 'https://login.microsoftonline.com/organizations/v2.0';
/** ARM delegated scope used only to list the tenants the user belongs to. */
export const ENTRA_DISCOVER_SCOPES = 'openid profile email offline_access https://management.azure.com/user_impersonation';

export function clientIdFor(issuer: string): string {
  // any Microsoft authority (tenant, organizations, common) uses the Entra app
  if (ENTRA_ENABLED && issuer.startsWith('https://login.microsoftonline.com/')) return ENTRA.clientId;
  return issuer === entraIssuer() ? ENTRA.clientId : OIDC_CLIENT_ID;
}

/**
 * Start an authorization-code + PKCE sign-in: the browser is redirected to the
 * IdP's own login page (MFA, SSO, conditional access and federation all happen
 * there — the console never sees a password). The verifier/nonce/state live
 * server-side, keyed by state, until the callback.
 */
export async function oidcStart(
  issuer: string,
  redirectUri: string,
  scopes?: string,
  purpose: 'session' | 'discover' = 'session',
): Promise<{ url: string; state: string }> {
  const doc = await discoveryDoc(issuer);
  if (!doc.authorization_endpoint) {
    throw new Error(`issuer ${issuer} does not advertise an authorization_endpoint`);
  }
  const clientId = clientIdFor(issuer);
  const scope = (scopes ?? '').trim() || (issuer === entraIssuer() ? ENTRA.scopes : 'openid profile email');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const flow: OidcFlow = {
    state: crypto.randomUUID(),
    issuer,
    clientId,
    nonce: crypto.randomUUID(),
    verifier,
    redirectUri,
    expiresAt: Date.now() + 10 * 60_000,
    purpose,
  };
  oidcFlows.set(flow.state, flow);
  for (const [k, f] of oidcFlows) if (Date.now() > f.expiresAt) oidcFlows.delete(k);
  while (oidcFlows.size > 50) {
    const oldest = oidcFlows.keys().next().value;
    if (oldest === undefined) break;
    oidcFlows.delete(oldest);
  }
  const url =
    doc.authorization_endpoint +
    '?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
  return { url, state: flow.state };
}

/** The UI origin a pending flow will return to (without consuming the flow). */
export function peekOidcFlowOrigin(state: string): string | null {
  const flow = oidcFlows.get(state);
  if (!flow) return null;
  try {
    return new URL(flow.redirectUri).origin;
  } catch {
    return null;
  }
}

export function peekOidcFlowPurpose(state: string): 'session' | 'discover' | null {
  return oidcFlows.get(state)?.purpose ?? null;
}

// ---------------------------------------------------------------------------
// Tenant discovery: authenticate at `organizations`, list tenants, then pick
// ---------------------------------------------------------------------------

export interface EntraTenant {
  tenantId: string;
  displayName: string;
  defaultDomain: string;
}

interface EntraSelection {
  id: string;
  refreshToken: string;
  tenants: EntraTenant[];
  expiresAt: number;
}
const entraSelections = new Map<string, EntraSelection>();

async function fetchEntraTenants(armToken: string): Promise<EntraTenant[]> {
  const res = await fetch('https://management.azure.com/tenants?api-version=2020-01-01', {
    headers: { authorization: `Bearer ${armToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`tenant listing failed (${res.status}) — the ARM scope may need consent`);
  const body = (await res.json()) as { value?: Array<{ tenantId?: string; displayName?: string; defaultDomain?: string }> };
  return (body.value ?? []).map((t) => ({
    tenantId: String(t.tenantId ?? ''),
    displayName: String(t.displayName ?? t.tenantId ?? ''),
    defaultDomain: String(t.defaultDomain ?? ''),
  }));
}

/**
 * Discover-mode callback: exchange the code, verify the tokens (home-tenant
 * issuer, ARM audience), list the user's tenants and park the refresh token
 * until the operator picks one. No session exists yet.
 */
export async function oidcCallbackDiscover(code: string, state: string): Promise<string> {
  const flow = oidcFlows.get(state);
  oidcFlows.delete(state);
  if (!flow || Date.now() > flow.expiresAt) throw new Error('unknown or expired sign-in state — start again');
  const endpoint = await tokenEndpoint(flow.issuer);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientId,
      code_verifier: flow.verifier,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token || !body.id_token || !body.refresh_token) {
    throw new Error(body.error_description || body.error || `code exchange failed (${res.status})`);
  }
  await verifyJwt(body.id_token, flow.issuer, flow.clientId, flow.nonce, false, undefined, true);
  await verifyJwt(body.access_token, flow.issuer, flow.clientId, undefined, true, 'https://management.azure.com', true);
  const tenants = await fetchEntraTenants(body.access_token);
  const sel: EntraSelection = {
    id: crypto.randomUUID(),
    refreshToken: body.refresh_token,
    tenants,
    expiresAt: Date.now() + 10 * 60_000,
  };
  entraSelections.set(sel.id, sel);
  for (const [k, v] of entraSelections) if (Date.now() > v.expiresAt) entraSelections.delete(k);
  audit('entra-discover ok', { tenants: tenants.length });
  return sel.id;
}

export function listEntraTenants(selectionId: string): EntraTenant[] {
  const sel = entraSelections.get(selectionId);
  if (!sel || Date.now() > sel.expiresAt) throw new Error('tenant selection expired — sign in again');
  return sel.tenants;
}

/** Mint the session in the chosen tenant via the parked refresh token. */
export async function selectEntraTenant(selectionId: string, tenantId: string): Promise<Session> {
  const sel = entraSelections.get(selectionId);
  if (!sel || Date.now() > sel.expiresAt) throw new Error('tenant selection expired — sign in again');
  if (!sel.tenants.some((t) => t.tenantId === tenantId)) throw new Error('tenant not in your listed tenants');
  if (!ENTRA_ALLOWED_TENANTS.includes(tenantId)) {
    throw new Error('tenant not allowed for this console — ask your administrator to add it to OPENSHELL_UI_ENTRA_ALLOWED_TENANTS');
  }
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const bundle = await tokenRequest(issuer, {
    grant_type: 'refresh_token',
    client_id: ENTRA.clientId,
    refresh_token: sel.refreshToken,
    scope: ENTRA.scopes,
  });
  const claims = await verifyJwt(bundle.access_token, issuer, ENTRA.clientId, undefined, true);
  entraSelections.delete(selectionId);
  const session: Session = {
    id: crypto.randomUUID(),
    issuer,
    clientId: ENTRA.clientId,
    bundle,
    claims,
  };
  sessions.set(session.id, session);
  audit('entra-tenant-select ok', { tenantId, user: sessionUser(session).name });
  return session;
}

/** Exchange the callback code, verify both tokens, mint the session. */
export async function oidcCallback(code: string, state: string): Promise<Session> {
  const flow = oidcFlows.get(state);
  oidcFlows.delete(state);
  if (!flow || Date.now() > flow.expiresAt) {
    throw new Error('unknown or expired sign-in state — start again');
  }
  const endpoint = await tokenEndpoint(flow.issuer);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientId,
      code_verifier: flow.verifier,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token || !body.id_token) {
    throw new Error(body.error_description || body.error || `code exchange failed (${res.status})`);
  }
  const idClaims = await verifyJwt(body.id_token, flow.issuer, flow.clientId, flow.nonce);
  const accessClaims = await verifyJwt(body.access_token, flow.issuer, flow.clientId, undefined, true);
  const claims: SessionClaims = {
    ...accessClaims,
    ...idClaims,
    roles: accessClaims.roles ?? idClaims.roles,
    realm_access: accessClaims.realm_access ?? idClaims.realm_access,
  };
  const session: Session = {
    id: crypto.randomUUID(),
    issuer: flow.issuer,
    clientId: flow.clientId,
    bundle: {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (body.expires_in ?? 300),
      token_type: body.token_type,
    },
    claims,
  };
  sessions.set(session.id, session);
  audit('oidc-code ok', { issuer: flow.issuer, user: sessionUser(session).name });
  return session;
}

export async function ensureFresh(session: Session): Promise<void> {
  if (session.bundle.expires_at - 30 > Math.floor(Date.now() / 1000)) return;
  if (!session.bundle.refresh_token) throw new Error('session expired — sign in again');
  const bundle = await tokenRequest(session.issuer, {
    grant_type: 'refresh_token',
    client_id: session.clientId,
    refresh_token: session.bundle.refresh_token,
  });
  // local operator sessions carry no IdP tokens; nothing to verify there
  if (bundle.access_token) {
    session.claims = await verifyJwt(bundle.access_token, session.issuer, session.clientId, undefined, true);
  }
  session.bundle = { ...bundle, refresh_token: bundle.refresh_token ?? session.bundle.refresh_token };
}

export function logout(sessionId: string | undefined): void {
  if (sessionId) sessions.delete(sessionId);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionFromRequest(req: http.IncomingMessage): Session | null {
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!id) return null;
  return sessions.get(id) ?? null;
}

export function sessionCookie(id: string, maxAge?: number, secure?: boolean): string {
  const attrs = [`${SESSION_COOKIE}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) attrs.push(`Max-Age=${maxAge}`);
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

// ---------------------------------------------------------------------------
// Local operator sign-in: provisioned token
// ---------------------------------------------------------------------------

const LOCAL_FAIL_LIMIT = 5;
const LOCAL_FAIL_WINDOW = 60_000;
const localFailures = new Map<string, { count: number; reset: number }>();

/** Constant-time token check with a per-source rate limit on failures. */
export function localLogin(token: string, source: string): Session {
  if (!LOCAL_TOKEN) throw new Error('local token sign-in is not configured on this bridge');
  const now = Date.now();
  const rec = localFailures.get(source);
  if (rec && now < rec.reset && rec.count >= LOCAL_FAIL_LIMIT) {
    audit('local-token throttled', { source });
    throw new Error('too many failed attempts — try again in a minute');
  }
  const a = Buffer.from(token);
  const b = Buffer.from(LOCAL_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const next = rec && now < rec.reset ? rec : { count: 0, reset: now + LOCAL_FAIL_WINDOW };
    next.count += 1;
    localFailures.set(source, next);
    audit('local-token denied', { source });
    throw new Error('invalid local token');
  }
  localFailures.delete(source);
  const session: Session = {
    id: crypto.randomUUID(),
    issuer: 'urn:openshell:local:token',
    clientId: 'local-operator',
    // Local sessions do not refresh; they live until logout or restart.
    bundle: { access_token: '', expires_at: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600 },
    claims: { preferred_username: 'local-operator', name: 'Local operator', roles: [ADMIN_ROLE] },
  };
  sessions.set(session.id, session);
  audit('local-token ok', { source });
  return session;
}

// ---------------------------------------------------------------------------
// Local operator sign-in: verified mTLS client certificate
// ---------------------------------------------------------------------------

export interface PeerCert {
  fingerprint256?: string;
  subject?: { CN?: string | string[] };
}

const certSessions = new Map<string, Session>();

/**
 * A client certificate verified against OPENSHELL_UI_TLS_CLIENT_CA is itself
 * the credential: the session is keyed by the cert fingerprint and re-derived
 * on every request, so revoking the cert (or omitting it) ends access.
 */
export function sessionFromCert(cert: PeerCert | null | undefined): Session | null {
  const fp = cert?.fingerprint256;
  if (!fp) return null;
  let session = certSessions.get(fp);
  if (!session) {
    const cnRaw = cert?.subject?.CN;
    const cn = (Array.isArray(cnRaw) ? cnRaw[0] : cnRaw) ?? 'mtls-client';
    session = {
      id: crypto.randomUUID(),
      issuer: 'urn:openshell:local:mtls',
      clientId: 'local-operator',
      bundle: { access_token: '', expires_at: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600 },
      claims: { preferred_username: cn, name: cn, sub: fp, roles: [ADMIN_ROLE] },
    };
    certSessions.set(fp, session);
    while (certSessions.size > 1000) {
      const oldest = certSessions.keys().next().value;
      if (oldest === undefined) break;
      certSessions.delete(oldest);
    }
    audit('local-mtls ok', { cn, fingerprint: fp.slice(0, 16) });
  }
  return session;
}

// ---------------------------------------------------------------------------
// Microsoft Entra ID — device code flow
// ---------------------------------------------------------------------------

interface DeviceFlow {
  id: string;
  issuer: string;
  clientId: string;
  scopes: string;
  deviceCode: string;
  interval: number;
  expiresAt: number;
  lastPoll: number;
  /** session = console sign-in; gateway-token = hand the access token to the
   *  gateway-registration dialog instead of creating a console session. */
  purpose: 'session' | 'gateway-token';
}

const deviceFlows = new Map<string, DeviceFlow>();
const DEVICE_FLOW_MAX = 20;

function cleanupDeviceFlows(): void {
  const now = Date.now();
  for (const [id, flow] of deviceFlows) {
    if (now > flow.expiresAt + 60_000) deviceFlows.delete(id);
  }
  while (deviceFlows.size > DEVICE_FLOW_MAX) {
    const oldest = deviceFlows.keys().next().value;
    if (oldest === undefined) break;
    deviceFlows.delete(oldest);
  }
}

export interface DeviceStart {
  flow: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export type DevicePollStatus = 'pending' | 'slow_down' | 'ok' | 'expired' | 'denied' | 'error';

export interface DevicePollResult {
  status: DevicePollStatus;
  message?: string;
  user?: AuthUser;
  session?: Session;
  /** gateway-token purpose only: the bearer token for gateway registration. */
  access_token?: string;
  expires_in?: number;
}

export interface EntraStartOptions {
  /** Override the requested scopes (e.g. the gateway's audience/.default). */
  scopes?: string;
  purpose?: 'session' | 'gateway-token';
}

/** Start an Entra device-code sign-in; the browser shows the code, the bridge polls. */
export async function entraStart(opts: EntraStartOptions = {}): Promise<DeviceStart> {
  if (!ENTRA_ENABLED) {
    throw new Error(
      'Entra sign-in is not configured — set OPENSHELL_UI_ENTRA_TENANT and OPENSHELL_UI_ENTRA_CLIENT_ID',
    );
  }
  const purpose = opts.purpose === 'gateway-token' ? 'gateway-token' : 'session';
  const scopes = (opts.scopes ?? '').trim() || ENTRA.scopes;
  if (scopes.length > 512 || !/^[A-Za-z0-9 :/._-]+$/.test(scopes)) {
    throw new Error('invalid scopes override');
  }
  const issuer = entraIssuer();
  const doc = await discoveryDoc(issuer);
  if (!doc.device_authorization_endpoint) {
    throw new Error(`issuer ${issuer} does not advertise a device_authorization_endpoint`);
  }
  const res = await fetch(doc.device_authorization_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ENTRA.clientId,
      scope: scopes,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.device_code || !body.user_code || !body.verification_uri) {
    throw new Error(body.error_description || body.error || `device authorization failed (${res.status})`);
  }
  const flow: DeviceFlow = {
    id: crypto.randomUUID(),
    issuer,
    clientId: ENTRA.clientId,
    scopes,
    purpose,
    deviceCode: body.device_code,
    interval: Math.max(Number(body.interval) || 5, 3),
    expiresAt: Date.now() + (Number(body.expires_in) || 900) * 1000,
    lastPoll: 0,
  };
  deviceFlows.set(flow.id, flow);
  cleanupDeviceFlows();
  return {
    flow: flow.id,
    user_code: body.user_code,
    verification_uri: body.verification_uri,
    verification_uri_complete: body.verification_uri_complete,
    expires_in: Math.round((flow.expiresAt - Date.now()) / 1000),
    interval: flow.interval,
  };
}

/** Poll one step of the device flow. Safe to call repeatedly from the browser. */
export async function entraPoll(flowId: string): Promise<DevicePollResult> {
  const flow = deviceFlows.get(flowId);
  if (!flow) return { status: 'expired', message: 'sign-in request is unknown or expired — start again' };
  const now = Date.now();
  if (now > flow.expiresAt) {
    deviceFlows.delete(flowId);
    return { status: 'expired', message: 'the sign-in code expired — start again' };
  }
  if (now - flow.lastPoll < flow.interval * 1000) return { status: 'pending' };
  flow.lastPoll = now;

  const doc = await discoveryDoc(flow.issuer);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: flow.clientId,
      device_code: flow.deviceCode,
      scope: flow.scopes,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (res.ok && body.access_token) {
    deviceFlows.delete(flowId);
    if (flow.purpose === 'gateway-token') {
      audit('entra gateway-token ok', { issuer: flow.issuer });
      return {
        status: 'ok',
        access_token: body.access_token,
        expires_in: body.expires_in ?? 300,
      };
    }
    const claims = await verifyJwt(body.access_token, flow.issuer, flow.clientId);
    const session: Session = {
      id: crypto.randomUUID(),
      issuer: flow.issuer,
      clientId: flow.clientId,
      bundle: {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (body.expires_in ?? 300),
        token_type: body.token_type,
      },
      claims,
    };
    sessions.set(session.id, session);
    audit('entra-device ok', { issuer: flow.issuer, user: sessionUser(session).name });
    return { status: 'ok', user: sessionUser(session), session };
  }
  switch (body.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      flow.interval += 5;
      return { status: 'slow_down', message: 'approval took a while — polling slower' };
    case 'expired_token':
      deviceFlows.delete(flowId);
      return { status: 'expired', message: 'the sign-in code expired — start again' };
    case 'access_denied':
    case 'authorization_declined':
      deviceFlows.delete(flowId);
      return { status: 'denied', message: body.error_description || 'sign-in was denied' };
    default:
      return {
        status: 'error',
        message: body.error_description || body.error || `device code exchange failed (${res.status})`,
      };
  }
}

/**
 * Destructive / security-sensitive operations require the `admin` realm role
 * when OIDC mode is on. Reads, exec/run/terminal and sandbox lifecycle stay
 * available to ordinary users.
 */
export function isAdminOnly(method: string, pathname: string): boolean {
  if (method === 'DELETE') return true;
  if (method === 'PATCH') return true;
  if (pathname.startsWith('/api/gateways')) return true;
  if (pathname.startsWith('/api/oidc/')) return true;
  if (/^\/api\/sandboxes\/[^/]+\/(policy|settings|rules)(\/|$)/.test(pathname)) return true;
  // reads stay available to ordinary users (create-from-template and the
  // network page need them); mutations remain admin-only
  if (pathname === '/api/services' || pathname === '/api/forwards') return method !== 'GET';
  if (pathname === '/api/templates' || pathname === '/api/providers') return method !== 'GET';
  if (pathname === '/api/profiles/import') return true;
  return false;
}
