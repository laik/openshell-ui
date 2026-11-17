import type {
  AllRules,
  AuthConfig,
  AuthUser,
  Context,
  EntraTenant,
  ExecResult,
  GatewayAddResult,
  GatewayHealth,
  GatewayMetadata,
  GatewayRecord,
  GatewayTokenResult,
  LogLine,
  PolicyUpdateBody,
  PortForward,
  ProviderList,
  ProviderProfile,
  RuleCollection,
  RuleHistoryCollection,
  RunResult,
  Sandbox,
  StartupCommand,
  SandboxTemplate,
  ServiceEndpoint,
  Workspace,
} from './types';

export class ApiError extends Error {
  readonly args: string[] | null;
  readonly exitCode: number | null;
  constructor(message: string, args: string[] | null = null, exitCode: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.args = args;
    this.exitCode = exitCode;
  }
}

export interface Scope {
  gateway?: string;
  workspace?: string;
}

function scopeParams(scope: Scope, extra: Record<string, string | number | boolean | undefined> = {}): string {
  const p = new URLSearchParams();
  if (scope.gateway) p.set('gateway', scope.gateway);
  if (scope.workspace) p.set('workspace', scope.workspace);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== '') p.set(key, String(value));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
  } catch (err) {
    throw new ApiError(
      'the API bridge is not reachable — start it with `npm run dev:server`, or use `npm run dev`',
    );
  }
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`unexpected response: ${text.slice(0, 240)}`);
  }
  if (!res.ok) {
    const p = payload as { error?: string; args?: string[] | null; exit_code?: number | null };
    throw new ApiError(p?.error ?? `request failed (${res.status})`, p?.args ?? null, p?.exit_code ?? null);
  }
  return payload as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export interface CreateSandboxBody {
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
}

export const api = {
  authConfig: () => get<AuthConfig>('/api/auth/config'),
  authMe: () => get<{ user: AuthUser | null; mode: 'local' | 'oidc' }>('/api/auth/me'),
  oidcStart: (issuer: string, scopes?: string) =>
    post<{ url: string; state: string }>('/api/auth/oidc/start', { issuer, scopes }),
  authLogout: () => post<{ ok: boolean }>('/api/auth/logout'),
  authRole: (role: string) => post<{ user: AuthUser }>('/api/auth/role', { role }),
  authLocal: (token: string) => post<{ user: AuthUser }>('/api/auth/local', { token }),
  entraStart: (opts?: { scopes?: string; purpose?: 'session' | 'gateway-token' }) =>
    post<{
      flow: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
      expires_in: number;
      interval: number;
    }>('/api/auth/entra/start', opts),
  entraDiscover: () => post<{ url: string; state: string }>('/api/auth/entra/discover'),
  entraTenants: (flow: string) =>
    get<{ tenants: EntraTenant[] }>(`/api/auth/entra/tenants?flow=${encodeURIComponent(flow)}`),
  entraSelect: (flow: string, tenantId: string) =>
    post<{ user: AuthUser }>('/api/auth/entra/select', { flow, tenantId }),
  entraPoll: (flow: string) =>
    post<{
      status: 'pending' | 'slow_down' | 'ok' | 'expired' | 'denied' | 'error';
      message?: string;
      user?: AuthUser;
      access_token?: string;
      expires_in?: number;
    }>('/api/auth/entra/poll', { flow }),
  oidcToken: (body: { issuer: string; clientId?: string; username: string; password: string }) =>
    post<{ access_token: string; expires_in: number }>('/api/oidc/token', body),

  context: (scope: Scope = {}) => get<Context>(`/api/context${scopeParams(scope)}`),

  sandboxes: (scope: Scope, all = false) =>
    get<{ sandboxes: Sandbox[] }>(`/api/sandboxes${scopeParams(scope)}${all ? (scopeParams(scope) ? '&' : '?') + 'all=1' : ''}`),

  sandbox: (name: string, scope: Scope) =>
    get<{
      sandbox: Sandbox;
      policy: unknown;
      providers: { providers: unknown[] } | null;
      services: { services: ServiceEndpoint[] } | null;
    }>(`/api/sandboxes/${encodeURIComponent(name)}${scopeParams(scope)}`),

  createSandbox: (body: CreateSandboxBody, scope: Scope) =>
    post<Sandbox>(`/api/sandboxes${scopeParams(scope)}`, body),

  deleteSandbox: (name: string, scope: Scope) =>
    del<string>(`/api/sandboxes/${encodeURIComponent(name)}${scopeParams(scope)}`),

  sandboxAction: (name: string, action: 'start' | 'stop' | 'suspend' | 'resume', scope: Scope) =>
    post<{ output: string }>(`/api/sandboxes/${encodeURIComponent(name)}/${action}${scopeParams(scope)}`),

  exec: (name: string, command: string, scope: Scope) =>
    post<ExecResult>(`/api/sandboxes/${encodeURIComponent(name)}/exec${scopeParams(scope)}`, { command }),

  logs: (
    name: string,
    opts: { lines?: number; level?: string; source?: string; since?: string },
    scope: Scope,
  ) => {
    const p = new URLSearchParams(scopeParams(scope));
    if (opts.lines) p.set('lines', String(opts.lines));
    if (opts.level) p.set('level', opts.level);
    if (opts.source) p.set('source', opts.source);
    if (opts.since) p.set('since', opts.since);
    return get<{ lines: LogLine[] }>(`/api/sandboxes/${encodeURIComponent(name)}/logs?${p}`);
  },

  sshConfig: (name: string, scope: Scope) =>
    get<string>(`/api/sandboxes/${encodeURIComponent(name)}/ssh${scopeParams(scope)}`),

  policyHistory: (name: string, scope: Scope) =>
    get<{ revisions: Array<Record<string, unknown>> }>(
      `/api/sandboxes/${encodeURIComponent(name)}/policy${scopeParams(scope)}`,
    ),

  services: (scope: Scope) =>
    get<{ services: ServiceEndpoint[] }>(`/api/services${scopeParams(scope)}`),

  exposeService: (body: { sandbox: string; port: string; service?: string }, scope: Scope) =>
    post<string>(`/api/services${scopeParams(scope)}`, body),

  deleteService: (sandbox: string, service: string, scope: Scope) =>
    del<string>(
      `/api/services/${encodeURIComponent(sandbox)}/${encodeURIComponent(service || '_')}${scopeParams(scope)}`,
    ),

  forwards: (scope: Scope) => get<PortForward[]>(`/api/forwards${scopeParams(scope)}`),

  startForward: (body: { port: string; sandbox: string }, scope: Scope) =>
    post<string>(`/api/forwards${scopeParams(scope)}`, body),

  stopForward: (port: string, sandbox: string, scope: Scope) =>
    del<string>(`/api/forwards/${encodeURIComponent(port)}/${encodeURIComponent(sandbox)}${scopeParams(scope)}`),

  templates: (scope: Scope) =>
    get<{ templates: SandboxTemplate[] }>(`/api/templates${scopeParams(scope)}`),

  createTemplate: (body: Record<string, unknown>, scope: Scope) =>
    post<unknown>(`/api/templates${scopeParams(scope)}`, body),

  deleteTemplate: (name: string, scope: Scope) =>
    del<string>(`/api/templates/${encodeURIComponent(name)}${scopeParams(scope)}`),

  profiles: (scope: Scope) => get<ProviderProfile[]>(`/api/profiles${scopeParams(scope)}`),

  profileDetail: (id: string, scope: Scope, global = false) =>
    get<ProviderProfile>(
      `/api/profiles/${encodeURIComponent(id)}${scopeParams(scope, { global: global ? 1 : undefined })}`,
    ),

  profileExport: (id: string, scope: Scope, format: 'yaml' | 'json' = 'yaml', global = false) =>
    get<string>(
      `/api/profiles/${encodeURIComponent(id)}/export${scopeParams(scope, { format, global: global ? 1 : undefined })}`,
    ),

  importProfile: (
    body: { content?: string; url?: string; fileName?: string; global?: boolean },
    scope: Scope,
  ) => post<string>(`/api/profiles/import${scopeParams(scope)}`, body),

  lintProfile: (body: { content?: string; url?: string; fileName?: string; global?: boolean }, scope: Scope) =>
    post<string>(`/api/profiles/lint${scopeParams(scope)}`, body),

  updateProfile: (id: string, body: { content?: string; url?: string; fileName?: string; global?: boolean }, scope: Scope) =>
    post<string>(`/api/profiles/${encodeURIComponent(id)}/update${scopeParams(scope)}`, body),

  deleteProfile: (id: string, scope: Scope, global = false) =>
    del<string>(`/api/profiles/${encodeURIComponent(id)}${scopeParams(scope, { global: global ? 1 : undefined })}`),

  providers: (scope: Scope) => get<ProviderList>(`/api/providers${scopeParams(scope)}`),

  createProvider: (
    body: {
      name: string;
      type: string;
      credentials?: string[];
      config?: string[];
      labels?: string[];
      fromExisting?: boolean;
      fromOidcToken?: boolean;
      fromGcloudAdc?: boolean;
      runtimeCredentials?: boolean;
      globalProfile?: boolean;
    },
    scope: Scope,
  ) => post<string>(`/api/providers${scopeParams(scope)}`, body),

  updateProvider: (
    name: string,
    body: { credentials?: string[]; config?: string[]; fromExisting?: boolean; fromOidcToken?: boolean },
    scope: Scope,
  ) => request<string>(`/api/providers/${encodeURIComponent(name)}${scopeParams(scope)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),

  deleteProvider: (name: string, scope: Scope) =>
    del<string>(`/api/providers/${encodeURIComponent(name)}${scopeParams(scope)}`),

  // --- network rule approvals ---
  allRules: (scope: Scope, status?: string) =>
    get<AllRules>(`/api/rules${scopeParams(scope, { status })}`),

  rules: (name: string, scope: Scope, status?: string) =>
    get<RuleCollection>(`/api/sandboxes/${encodeURIComponent(name)}/rules${scopeParams(scope, { status })}`),

  ruleHistory: (name: string, scope: Scope) =>
    get<RuleHistoryCollection>(
      `/api/sandboxes/${encodeURIComponent(name)}/rules/history${scopeParams(scope)}`,
    ),

  approveRule: (name: string, chunkId: string, scope: Scope) =>
    post<string>(
      `/api/sandboxes/${encodeURIComponent(name)}/rules/${encodeURIComponent(chunkId)}/approve${scopeParams(scope)}`,
    ),

  rejectRule: (name: string, chunkId: string, reason: string, scope: Scope) =>
    post<string>(
      `/api/sandboxes/${encodeURIComponent(name)}/rules/${encodeURIComponent(chunkId)}/reject${scopeParams(scope)}`,
      { reason },
    ),

  approveAllRules: (name: string, includeSecurityFlagged: boolean, scope: Scope) =>
    post<string>(
      `/api/sandboxes/${encodeURIComponent(name)}/rules/approve-all${scopeParams(scope)}`,
      { includeSecurityFlagged },
    ),

  clearRules: (name: string, scope: Scope) =>
    del<string>(`/api/sandboxes/${encodeURIComponent(name)}/rules${scopeParams(scope)}`),

  updatePolicy: (name: string, body: PolicyUpdateBody, scope: Scope) =>
    post<{ output: string; args: string[] }>(
      `/api/sandboxes/${encodeURIComponent(name)}/policy/update${scopeParams(scope)}`,
      body,
    ),

  setPolicy: (name: string, yaml: string, scope: Scope, wait = true) =>
    post<{ output: string; args: string[] }>(
      `/api/sandboxes/${encodeURIComponent(name)}/policy/set${scopeParams(scope)}`,
      { yaml, wait },
    ),

  startupCommand: (name: string, scope: Scope) =>
    get<StartupCommand>(`/api/sandboxes/${encodeURIComponent(name)}/startup${scopeParams(scope)}`),

  // --- quick run ---
  run: (name: string, command: string, scope: Scope, start = true) =>
    post<RunResult>(`/api/sandboxes/${encodeURIComponent(name)}/run${scopeParams(scope)}`, {
      command,
      start,
    }),

  workspaces: (scope: Scope) => get<{ workspaces: Workspace[] }>(`/api/workspaces${scopeParams(scope)}`),

  settingsText: (name: string, scope: Scope) =>
    get<string>(`/api/settings/${encodeURIComponent(name)}${scopeParams(scope)}`),

  setSetting: (name: string, key: string, value: string, scope: Scope) =>
    post<string>(`/api/sandboxes/${encodeURIComponent(name)}/settings${scopeParams(scope)}`, { key, value }),

  deleteSetting: (name: string, key: string, scope: Scope) =>
    del<string>(`/api/sandboxes/${encodeURIComponent(name)}/settings/${encodeURIComponent(key)}${scopeParams(scope)}`),

  gateways: {
    // Registration commands act on the local CLI config, not on a scoped gateway,
    // so they deliberately carry no gateway/workspace params.
    list: (probe = false) => get<GatewayRecord[]>(`/api/gateways${probe ? '?probe=1' : ''}`),
    health: (name: string) => get<GatewayHealth>(`/api/gateways/${encodeURIComponent(name)}/health`),
    detail: (name: string) =>
      get<{ metadata: GatewayMetadata; token_kind: 'edge' | 'oidc' | null }>(
        `/api/gateways/${encodeURIComponent(name)}`,
      ),
    add: (body: {
      endpoint: string;
      name?: string;
      mode?: 'auto' | 'edge' | 'oidc' | 'local' | 'remote' | 'plaintext';
      token?: string;
      remoteHost?: string;
      oidcIssuer?: string;
      oidcClientId?: string;
      oidcAudience?: string;
      oidcScopes?: string;
      insecure?: boolean;
      verify?: boolean;
      rollback?: boolean;
      activate?: boolean;
    }) => post<GatewayAddResult>('/api/gateways', body),
    select: (name: string) => post<string>(`/api/gateways/${encodeURIComponent(name)}/select`),
    login: (name: string) => post<string>(`/api/gateways/${encodeURIComponent(name)}/login`),
    logout: (name: string) => post<string>(`/api/gateways/${encodeURIComponent(name)}/logout`),
    setToken: (name: string, token: string, opts: { insecure?: boolean; verify?: boolean } = {}) =>
      post<GatewayTokenResult>(`/api/gateways/${encodeURIComponent(name)}/token`, { token, ...opts }),
    forgetTokens: (name: string) =>
      post<{ removed: string[] }>(`/api/gateways/${encodeURIComponent(name)}/forget-tokens`),
    remove: (name: string) => del<string>(`/api/gateways/${encodeURIComponent(name)}`),
  },
};

export type GatewayList = GatewayRecord[];
