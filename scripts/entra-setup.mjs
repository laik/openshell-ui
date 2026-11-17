#!/usr/bin/env node
/**
 * One-shot Microsoft Entra setup for the openshell-ui device-code demo.
 *
 * Prereq: `az login` with a Global Administrator (or App Admin + User Admin)
 * account of the target tenant. Then:
 *
 *   node scripts/entra-setup.mjs [--disable-security-defaults]
 *
 * Idempotent. It will:
 *   1. create (or reuse) the `openshell-console` app registration,
 *   2. allow public client flows (device-code grant),
 *   3. define `admin` / `user` app roles,
 *   4. create the service principal,
 *   5. create test users openshell-admin / openshell-user with random passwords,
 *   6. assign the app roles,
 *   7. check security defaults (they block the device-code flow; disable only
 *      with the explicit --disable-security-defaults flag — test tenants only),
 *   8. write .entra-test-accounts.json (gitignored) and print the env exports.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APP_NAME = 'openshell-console';
const ROLE_IDS = {
  admin: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  user: '9b2deb3f-0bd2-4c69-8f17-2a3c4d5e6f70',
};
const TEST_USERS = [
  { prefix: 'openshell-admin', displayName: 'OpenShell Admin', role: 'admin' },
  { prefix: 'openshell-user', displayName: 'OpenShell User', role: 'user' },
];
const DISABLE_SD = process.argv.includes('--disable-security-defaults');
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_FILE = path.join(ROOT, '.entra-test-accounts.json');

function az(args, { allowFail = false } = {}) {
  try {
    const out = execFileSync('az', [...args, '--output', 'json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim() ? JSON.parse(out) : null;
  } catch (err) {
    if (allowFail) return null;
    const stderr = err.stderr?.toString() ?? '';
    throw new Error(`az ${args.join(' ')} failed:\n${stderr || err.message}`);
  }
}

function graph(method, urlPath, body) {
  const args = ['rest', '--method', method, '--uri', `https://graph.microsoft.com/v1.0${urlPath}`];
  if (body !== undefined) args.push('--body', JSON.stringify(body));
  return az(args, { allowFail: method === 'GET' });
}

function randomPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digit = '23456789';
  const symbol = '!@#$%^&*';
  const all = upper + lower + digit + symbol;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digit), pick(symbol)];
  while (chars.length < 16) chars.push(pick(all));
  // shuffle so the guaranteed classes aren't always leading
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const step = (msg) => console.log(`\n==> ${msg}`);

// --- 0. login check ---------------------------------------------------------
step('Checking az login');
const account = az(['account', 'show']);
const tenantId = account.tenantId;
console.log(`    tenant ${tenantId} · signed in as ${account.user?.name}`);

const domains = graph('GET', '/domains');
const defaultDomain = domains?.value?.find((d) => d.isDefault)?.id;
if (!defaultDomain) throw new Error('could not determine the tenant default domain (need Directory Readers+)');
console.log(`    default domain ${defaultDomain}`);

// --- 1. app registration ----------------------------------------------------
step(`App registration "${APP_NAME}"`);
let app = az(['ad', 'app', 'list', '--display-name', APP_NAME])?.find((a) => a.displayName === APP_NAME);
if (app) {
  console.log(`    reusing existing app ${app.appId}`);
} else {
  app = az(['ad', 'app', 'create', '--display-name', APP_NAME, '--sign-in-audience', 'AzureADMyOrg']);
  console.log(`    created app ${app.appId}`);
}
const clientId = app.appId;

// --- 2. public client flows (device code) -----------------------------------
step('Allowing public client flows (device-code grant)');
az(['ad', 'app', 'update', '--id', clientId, '--is-fallback-public-client', 'true']);
console.log('    isFallbackPublicClient = true');

// --- 3. app roles -----------------------------------------------------------
step('App roles admin / user');
const current = az(['ad', 'app', 'show', '--id', clientId]).appRoles ?? [];
const merged = [...current];
for (const [value, id] of Object.entries(ROLE_IDS)) {
  if (!merged.some((r) => r.value === value)) {
    merged.push({
      allowedMemberTypes: ['User'],
      description: `OpenShell console ${value} role`,
      displayName: value,
      id,
      isEnabled: true,
      value,
    });
  }
}
az(['ad', 'app', 'update', '--id', clientId, '--app-roles', JSON.stringify(merged)]);
console.log(`    roles: ${merged.map((r) => r.value).join(', ')}`);

// --- 3b. expose an API scope + self resource permission ---------------------
// Requesting `<clientId>/.default` (token audience = this app, so the `roles`
// claim is emitted) fails for non-admin users with AADSTS650057 unless the app
// lists itself in requiredResourceAccess. Expose `access_as_user` and point
// the app's required permissions at it.
step('API scope access_as_user + self resource permission');
const SCOPE_ID = 'b7c4e2a1-9d3f-4e8a-a6c2-5f1d0e9b8a73';
const appObj = az(['ad', 'app', 'show', '--id', clientId]);
const scopes = appObj.api?.oauth2PermissionScopes ?? [];
if (!scopes.some((s) => s.value === 'access_as_user')) {
  scopes.push({
    id: SCOPE_ID,
    adminConsentDescription: 'Allow access to the OpenShell console as the signed-in user',
    adminConsentDisplayName: 'Access OpenShell console',
    userConsentDescription: 'Access the OpenShell console as you',
    userConsentDisplayName: 'Access OpenShell console',
    isEnabled: true,
    type: 'User',
    value: 'access_as_user',
  });
}
const rra = appObj.requiredResourceAccess ?? [];
let self = rra.find((r) => r.resourceAppId === clientId);
if (!self) {
  self = { resourceAppId: clientId, resourceAccess: [] };
  rra.push(self);
}
if (!self.resourceAccess.some((a) => a.id === SCOPE_ID)) {
  self.resourceAccess.push({ id: SCOPE_ID, type: 'Scope' });
}
const identifierUris = appObj.identifierUris?.length ? appObj.identifierUris : [`api://${clientId}`];
graph('PATCH', `/applications/${appObj.id}`, {
  api: { oauth2PermissionScopes: scopes },
  requiredResourceAccess: rra,
  identifierUris,
});
console.log(`    identifierUri ${identifierUris[0]} · scope access_as_user · self permission listed`);

// --- 3c. redirect URIs for authorization code + PKCE ------------------------
// The enterprise sign-in path redirects the browser to Entra and back to the
// bridge callback. Public-client redirect URIs must be registered explicitly;
// add the local dev/demo origins (production origins go here too, or set
// OPENSHELL_UI_PUBLIC_URL and register that origin).
step('Redirect URIs (authorization code + PKCE)');
const REDIRECT_URIS = [
  'http://localhost:5273/api/auth/oidc/callback',
  'http://localhost:8787/api/auth/oidc/callback',
  'http://localhost:8788/api/auth/oidc/callback',
  'http://127.0.0.1:5273/api/auth/oidc/callback',
  'http://127.0.0.1:8787/api/auth/oidc/callback',
  'http://127.0.0.1:8788/api/auth/oidc/callback',
];
const appFull = az(['ad', 'app', 'show', '--id', clientId]);
const existingUris = appFull.publicClient?.redirectUris ?? [];
const mergedUris = [...new Set([...existingUris, ...REDIRECT_URIS])];
if (mergedUris.length !== existingUris.length) {
  graph('PATCH', `/applications/${appFull.id}`, { publicClient: { redirectUris: mergedUris } });
}
console.log(`    ${mergedUris.length} redirect uri(s): ${mergedUris.join(', ')}`);

// --- 3d. multi-tenant audience (tenant discovery flow) ----------------------
// "list my tenants first" authenticates at the organizations endpoint, which
// requires a multi-tenant app. Sessions stay restricted to
// OPENSHELL_UI_ENTRA_ALLOWED_TENANTS (default: the configured tenant).
step('Sign-in audience: AzureADMultipleOrgs (tenant discovery)');
if (appFull.signInAudience !== 'AzureADMultipleOrgs') {
  az(['ad', 'app', 'update', '--id', clientId, '--sign-in-audience', 'AzureADMultipleOrgs']);
}
console.log('    multi-tenant; allowed tenants via OPENSHELL_UI_ENTRA_ALLOWED_TENANTS');

// --- 4. service principal ---------------------------------------------------
step('Service principal');
let sp = az(['ad', 'sp', 'show', '--id', clientId], { allowFail: true });
if (!sp) {
  sp = az(['ad', 'sp', 'create', '--id', clientId]);
  console.log(`    created service principal ${sp.id}`);
} else {
  console.log(`    reusing service principal ${sp.id}`);
}

// --- 5+6. test users + role assignment --------------------------------------
step('Test users and role assignments');
const existingAssignments =
  graph('GET', `/servicePrincipals/${sp.id}/appRoleAssignedTo`)?.value ?? [];
const accounts = [];
for (const u of TEST_USERS) {
  const upn = `${u.prefix}@${defaultDomain}`;
  let user = az(['ad', 'user', 'show', '--id', upn], { allowFail: true });
  let password = null;
  if (!user) {
    password = randomPassword();
    user = az([
      'ad', 'user', 'create',
      '--display-name', u.displayName,
      '--user-principal-name', upn,
      '--password', password,
      '--force-change-password-next-sign-in', 'false',
    ]);
    console.log(`    created ${upn}`);
  } else {
    console.log(`    reusing ${upn} (password unchanged — see ${path.basename(OUT_FILE)} if saved earlier)`);
  }
  const already = existingAssignments.some(
    (a) => a.principalId === user.id && a.appRoleId === ROLE_IDS[u.role],
  );
  if (!already) {
    graph('POST', `/servicePrincipals/${sp.id}/appRoleAssignedTo`, {
      principalId: user.id,
      resourceId: sp.id,
      appRoleId: ROLE_IDS[u.role],
    });
    console.log(`    assigned app role "${u.role}"`);
  } else {
    console.log(`    app role "${u.role}" already assigned`);
  }
  accounts.push({ upn, password, role: u.role, objectId: user.id });
}

// --- 7. security defaults ---------------------------------------------------
step('Security defaults check');
const sd = graph('GET', '/policies/identitySecurityDefaultsEnforcementPolicy');
if (sd?.isEnabled) {
  if (DISABLE_SD) {
    graph('PATCH', '/policies/identitySecurityDefaultsEnforcementPolicy', { isEnabled: false });
    console.log('    DISABLED (test tenant only — re-enable after the demo if this tenant is used for anything real)');
  } else {
    console.log('    ENABLED — security defaults block the device-code flow and force MFA.');
    console.log('    For a disposable test tenant re-run with: node scripts/entra-setup.mjs --disable-security-defaults');
  }
} else {
  console.log('    already disabled — device-code sign-in with password only will work');
}

// --- 8. output --------------------------------------------------------------
// preserve previously saved passwords for reused users
let previous = [];
try {
  previous = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).users ?? [];
} catch {}
for (const a of accounts) {
  if (!a.password) a.password = previous.find((p) => p.upn === a.upn)?.password ?? null;
}
const result = { tenantId, clientId, defaultDomain, users: accounts, updatedAt: new Date().toISOString() };
fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });

console.log(`\nSaved ${path.relative(ROOT, OUT_FILE)} (mode 600, gitignored)`);
console.log('\nRun the console with:\n');
console.log(`  export OPENSHELL_UI_ENTRA_TENANT=${tenantId}`);
console.log(`  export OPENSHELL_UI_ENTRA_CLIENT_ID=${clientId}`);
console.log('  npm run demo:entra\n');
for (const a of accounts) {
  console.log(`  ${a.role.padEnd(5)} ${a.upn}  ${a.password ?? '(password from earlier run — reset in the portal if lost)'}`);
}
console.log('\nThen on the welcome page: Microsoft Entra ID → sign in with device code.');