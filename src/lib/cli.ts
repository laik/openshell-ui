/**
 * Client-side mirror of the `openshell` command line the bridge runs.
 *
 * The browser cannot speak to the gateway (gRPC over mTLS), so every action in
 * this console is executed by `server/index.ts` through the local CLI. This
 * module rebuilds the same argv so the UI can show the exact command behind a
 * button before it is pressed, and inside confirmation dialogs for destructive
 * actions.
 *
 * Keep in sync with `server/index.ts` and `server/gateways.ts`: flag names,
 * flag order, and where the scope flags go — `runCli()` in `server/cli.ts`
 * *unshifts* them, so a scoped command reads
 * `openshell --workspace w --gateway g <subcommand> …`.
 *
 * A builder returns one line, or several lines when the bridge runs several
 * commands for one action. `null` means the bridge does something the CLI has
 * no surface for (writing a token file, switching the console role); callers
 * must handle that rather than invent a command.
 */
import type { CreateSandboxBody, Scope } from '../api/client';
import type { PolicyUpdateBody } from '../api/types';

/** Binary the bridge invokes. Override server-side with OPENSHELL_BIN. */
export const CLI_BIN = 'openshell';

export type CommandLines = string | string[] | null;

type Token = string | number | boolean | null | undefined | false;

/** Quote only what a POSIX shell would otherwise split or expand. */
function quote(token: string): string {
  if (!token) return "''";
  if (/^[\w@:,./=+~%\[\]{}-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

/**
 * One shell-ready command line, with the scope flags placed exactly the way
 * `runCli()` places them. Pass no scope for the local-CLI-only routes
 * (gateway registration), which deliberately carry no scope flags.
 */
export function argv(scope: Scope | undefined, args: Token[]): string {
  const out: string[] = [CLI_BIN];
  if (scope?.workspace) out.push('--workspace', quote(scope.workspace));
  if (scope?.gateway) out.push('--gateway', quote(scope.gateway));
  for (const a of args) {
    if (a === undefined || a === null || a === false) continue;
    out.push(quote(String(a)));
  }
  return out.join(' ');
}

/** Split of a builder result: one entry per command the bridge will run. */
export function commandLines(command: CommandLines | undefined): string[] {
  if (command === null || command === undefined) return [];
  return Array.isArray(command) ? command : [command];
}

/** Multi-line text for a code block; empty string when there is no CLI path. */
export function commandText(command: CommandLines | undefined): string {
  return commandLines(command).join('\n');
}

/** `KEY=VALUE` pairs, in the order the bridge appends them. */
function kvFlags(prefix: string, entries: Record<string, string> | undefined): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(entries ?? {})) out.push(prefix, `${k}=${v}`);
  return out;
}

/** Repeat a flag once per value. */
function each(flag: string, values: (string | number)[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) out.push(flag, String(v));
  return out;
}

/** Mirror of `tokenize()` in server/cli.ts: quote-aware split, no escapes. */
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

/**
 * Mirror of `needsShell()` in server/index.ts: a leading `VAR=` assignment or
 * any shell metacharacter makes the bridge wrap the line in the sandbox's own
 * `$SHELL -c …` instead of exec'ing argv directly.
 */
const SHELL_META = new Set(['|', '&', ';', '<', '>', '(', ')', '$', '`', '\\', '*', '?', '[', ']', '{', '}', '~', '\n']);

export function needsShell(command: string): boolean {
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command)) return true;
  for (const ch of command) if (SHELL_META.has(ch)) return true;
  return false;
}

/**
 * Mirror of `execInSandbox()` in server/index.ts. The shell the bridge picks
 * comes from a cached `printenv SHELL` probe, so the preview keeps the literal
 * `$SHELL` rather than guessing a path.
 */
function execArgs(name: string, command: string, opts: { workdir?: string; timeout?: number; env?: Record<string, string> }): Token[] {
  const args: Token[] = ['sandbox', 'exec', name, '--no-tty'];
  if (opts.workdir) args.push('--workdir', opts.workdir);
  if (opts.timeout) args.push('--timeout', opts.timeout);
  args.push(...kvFlags('--env', opts.env));
  const line = command.trim();
  if (needsShell(line)) args.push('--', '$SHELL', '-c', line);
  else args.push('--', ...tokenize(line));
  return args;
}

function createArgs(body: CreateSandboxBody): Token[] {
  const args: Token[] = ['sandbox', 'create', '-o', 'json'];
  if (body.name) args.push('--name', body.name);
  if (body.template) args.push('--template', body.template);
  if (body.from) args.push('--from', body.from);
  // The CLI forbids --template together with the resource flags.
  if (!body.template) {
    if (body.cpu) args.push('--cpu', body.cpu);
    if (body.memory) args.push('--memory', body.memory);
    if (body.gpu === true) args.push('--gpu');
    else if (typeof body.gpu === 'string' && body.gpu) args.push('--gpu', body.gpu);
  }
  args.push(...kvFlags('--env', body.env));
  args.push(...kvFlags('--label', body.labels));
  args.push(...each('--provider', body.providers));
  args.push(...each('--forward', body.forward));
  args.push(...each('--expose', body.expose));
  if (body.restartPolicy && body.restartPolicy !== 'never') args.push('--restart-policy', body.restartPolicy);
  const command = body.command?.trim() ?? '';
  if (body.detach ?? !command) args.push('--detach');
  if (command) args.push('--', ...tokenize(command));
  return args;
}

/**
 * Mirror of `createArgs()` plus `createSandboxResolved()` in server/index.ts.
 * `baseline` is the selected template's own resources; passing it lets the
 * preview show the derived-template detour the bridge takes when cpu / memory
 * / gpu differ from that baseline (the CLI rejects --template with resources).
 */
function createLines(body: CreateSandboxBody, scope: Scope, baseline?: { cpu?: string; memory?: string; gpu?: number } | null): string[] {
  if (!body.template) return [argv(scope, createArgs(body))];

  const cpuOverride = body.cpu?.trim() && body.cpu.trim() !== baseline?.cpu ? body.cpu.trim() : null;
  const memOverride = body.memory?.trim() && body.memory.trim() !== baseline?.memory ? body.memory.trim() : null;
  const gpuOverride = body.gpu ? body.gpu : null;
  if (!baseline || (!cpuOverride && !memOverride && !gpuOverride)) return [argv(scope, createArgs(body))];

  // The bridge copies the template into a one-off template, creates from it,
  // then removes it. Its uuid is not knowable here, so it reads `<derived>`,
  // and the copy carries the template's own resources with the overrides applied.
  const derived = '<derived>';
  const tpl: Token[] = ['sandbox', 'template', 'create', derived];
  if (cpuOverride ?? baseline.cpu) tpl.push('--cpu', String(cpuOverride ?? baseline.cpu));
  if (memOverride ?? baseline.memory) tpl.push('--memory', String(memOverride ?? baseline.memory));
  if (gpuOverride === true) tpl.push('--gpu');
  else if (typeof gpuOverride === 'string' && gpuOverride) tpl.push('--gpu', gpuOverride);
  else if (baseline.gpu != null) tpl.push('--gpu', String(baseline.gpu));

  return [
    argv(scope, tpl),
    argv(
      scope,
      createArgs({
        ...body,
        template: derived,
        cpu: undefined,
        memory: undefined,
        gpu: undefined,
        // The copy is labelled with the template it came from, and the new
        // sandbox keeps that lineage label.
        labels: { ...(body.labels ?? {}), 'openshell.io/template-source': body.template },
      }),
    ),
    argv(scope, ['sandbox', 'template', 'delete', derived]),
  ];
}

/** Mirror of `policyUpdateArgs()`, including the two-step endpoint + L7 split. */
function policyUpdateLines(name: string, b: PolicyUpdateBody, scope: Scope): string[] {
  const build = (b2: PolicyUpdateBody): Token[] => {
    const args: Token[] = ['policy', 'update', name];
    args.push(...each('--add-endpoint', b2.addEndpoints));
    args.push(...each('--remove-endpoint', b2.removeEndpoints));
    args.push(...each('--binary', b2.binaries));
    if (b2.ruleName) args.push('--rule-name', b2.ruleName);
    if (b2.anyBinary) args.push('--any-binary');
    if (b2.endpointPath) args.push('--endpoint-path', b2.endpointPath);
    args.push(...each('--add-allow', b2.addAllow));
    args.push(...each('--add-deny', b2.addDeny));
    args.push(...each('--remove-rule', b2.removeRules));
    if (b2.dryRun) args.push('--dry-run');
    else if (b2.wait) args.push('--wait');
    return args;
  };
  const hasEndpoint = Boolean(b.addEndpoints?.length || b.removeEndpoints?.length);
  const hasL7 = Boolean(b.addAllow?.length || b.addDeny?.length);
  if (hasEndpoint && hasL7) {
    return [
      argv(scope, build({ ...b, addAllow: [], addDeny: [], anyBinary: false, endpointPath: '' })),
      argv(scope, build({ ...b, addEndpoints: [], removeEndpoints: [] })),
    ];
  }
  return [argv(scope, build(b))];
}

export const cliFor = {
  sandbox: {
    /** `POST /api/sandboxes/:name/{start,stop,suspend,resume}` */
    action: (name: string, action: 'start' | 'stop' | 'suspend' | 'resume', scope: Scope): string =>
      argv(scope, ['sandbox', action, name]),
    /** `DELETE /api/sandboxes/:name` */
    remove: (name: string, scope: Scope): string => argv(scope, ['sandbox', 'delete', name]),
    /** `POST /api/sandboxes` — one line, or three for a template override. */
    create: createLines,
    /** `GET /api/sandboxes/:name` — the detail read behind the console page. */
    get: (name: string, scope: Scope): string => argv(scope, ['sandbox', 'get', name, '-o', 'json']),
    /** `GET /api/sandboxes` — `--all-workspaces` only when the scope is not narrowed. */
    list: (scope: Scope, all = false): string =>
      argv(scope, ['sandbox', 'list', '-o', 'json', '--page-size', '200', ...(all ? ['--all-workspaces'] : [])]),
    /** `POST /api/sandboxes/:name/exec` — `--no-tty`, then the command after `--`. */
    exec: (
      name: string,
      command: string,
      scope: Scope,
      opts: { workdir?: string; timeout?: number; env?: Record<string, string> } = {},
    ): string => argv(scope, execArgs(name, command, opts)),
    /**
     * `POST /api/sandboxes/:name/run` — `ensureSandboxReady()` first, which
     * starts or resumes the sandbox when `start` was requested and the current
     * phase says it is needed, then the exec itself.
     */
    run: (name: string, command: string, scope: Scope, opts: { start?: boolean; phase?: string } = {}): string[] => {
      const phase = String(opts.phase ?? '');
      const lines: string[] = [];
      if (opts.start !== false && (phase === 'Stopped' || phase === 'Suspended')) {
        lines.push(argv(scope, ['sandbox', phase === 'Stopped' ? 'start' : 'resume', name]));
      }
      lines.push(argv(scope, execArgs(name, command, {})));
      return lines;
    },
    /** `GET /api/sandboxes/:name/logs` */
    logs: (name: string, scope: Scope, opts: { lines?: number; level?: string; source?: string } = {}): string => {
      const args: Token[] = ['logs', name, '-n', opts.lines ?? 400];
      if (opts.level) args.push('--level', opts.level);
      if (opts.source) args.push('--source', opts.source);
      return argv(scope, args);
    },
    /** `GET /api/sandboxes/:name/ssh` */
    sshConfig: (name: string, scope: Scope): string => argv(scope, ['sandbox', 'ssh-config', name]),
    /** `GET /api/settings/:name` */
    settingsGet: (name: string, scope: Scope): string => argv(scope, ['settings', 'get', name]),
    /** `POST /api/sandboxes/:name/settings` */
    setSetting: (name: string, key: string, value: string, scope: Scope): string =>
      argv(scope, ['settings', 'set', name, '--key', key, '--value', value]),
    /** `DELETE /api/sandboxes/:name/settings/:key` */
    deleteSetting: (name: string, key: string, scope: Scope): string =>
      argv(scope, ['settings', 'delete', name, '--key', key]),
    /** `POST /api/sandboxes/:name/policy/update` */
    updatePolicy: (name: string, body: PolicyUpdateBody, scope: Scope): string[] => policyUpdateLines(name, body, scope),
    /** `POST /api/sandboxes/:name/policy/set` — the bridge writes the YAML to a temp file. */
    setPolicy: (name: string, scope: Scope, wait = true): string =>
      argv(scope, ['policy', 'set', name, '--policy', '<temp.yaml>', ...(wait ? ['--wait'] : [])]),
    /** `POST /api/sandboxes/:name/rules/:chunk/approve` */
    approveRule: (name: string, chunkId: string, scope: Scope): string =>
      argv(scope, ['rule', 'approve', '--chunk-id', chunkId, name]),
    /** `POST /api/sandboxes/:name/rules/:chunk/reject` */
    rejectRule: (name: string, chunkId: string, scope: Scope, reason?: string): string =>
      argv(scope, ['rule', 'reject', '--chunk-id', chunkId, name, ...(reason ? ['--reason', reason] : [])]),
    /** `POST /api/sandboxes/:name/rules/approve-all` */
    approveAllRules: (name: string, includeSecurityFlagged: boolean, scope: Scope): string =>
      argv(scope, [
        'rule',
        'approve-all',
        name,
        ...(includeSecurityFlagged ? ['--include-security-flagged'] : []),
      ]),
    /** `DELETE /api/sandboxes/:name/rules` */
    clearRules: (name: string, scope: Scope): string => argv(scope, ['rule', 'clear', name]),
    /** `POST /api/services` */
    exposeService: (sandbox: string, port: string, scope: Scope, service?: string): string =>
      argv(scope, ['service', 'expose', sandbox, port, ...(service ? [service] : [])]),
    /** `DELETE /api/services/:sandbox/:service` */
    deleteService: (sandbox: string, service: string, scope: Scope): string =>
      argv(scope, ['service', 'delete', sandbox, ...(service && service !== '_' ? [service] : [])]),
    /** `POST /api/forwards` */
    startForward: (port: string, sandbox: string, scope: Scope): string =>
      argv(scope, ['forward', 'start', '--background', port, sandbox]),
    /** `DELETE /api/forwards/:port/:sandbox` */
    stopForward: (port: string, sandbox: string, scope: Scope): string =>
      argv(scope, ['forward', 'stop', port, sandbox]),
  },

  templates: {
    /** `POST /api/templates` */
    create: (
      body: { name: string; image?: string; cpu?: string; memory?: string },
      scope: Scope,
    ): string =>
      argv(scope, [
        'sandbox',
        'template',
        'create',
        body.name,
        ...(body.image ? ['--image', body.image] : []),
        ...(body.cpu ? ['--cpu', body.cpu] : []),
        ...(body.memory ? ['--memory', body.memory] : []),
      ]),
    /** `DELETE /api/templates/:name` */
    remove: (name: string, scope: Scope): string => argv(scope, ['sandbox', 'template', 'delete', name]),
  },

  profiles: {
    /** `POST /api/profiles/import` — `-f <temp.yaml>` stands for the temp file. */
    import: (scope: Scope, opts: { url?: string; global?: boolean } = {}): string =>
      argv(scope, [
        'profile',
        'import',
        ...(opts.url ? ['--url', opts.url] : ['-f', '<temp.yaml>']),
        ...(opts.global ? ['--global'] : []),
      ]),
    /** `POST /api/profiles/lint` */
    lint: (scope: Scope, opts: { url?: string; global?: boolean } = {}): string =>
      argv(scope, [
        'profile',
        'lint',
        ...(opts.url ? ['--url', opts.url] : ['-f', '<temp.yaml>']),
        ...(opts.global ? ['--global'] : []),
      ]),
    /**
     * `POST /api/profiles/:id/update` — `-f` comes before the id, and only a
     * pasted file is supported here (unlike import/lint, there is no --url).
     */
    update: (id: string, scope: Scope, opts: { global?: boolean } = {}): string =>
      argv(scope, ['profile', 'update', '-f', '<temp.yaml>', id, ...(opts.global ? ['--global'] : [])]),
    /** `DELETE /api/profiles/:id` */
    remove: (id: string, scope: Scope, global = false): string =>
      argv(scope, ['profile', 'delete', id, ...(global ? ['--global'] : [])]),
    /** `GET /api/profiles/:id/export` */
    export: (id: string, scope: Scope, format: 'yaml' | 'json' = 'yaml', global = false): string =>
      argv(scope, ['profile', 'export', id, '-o', format, ...(global ? ['--global'] : [])]),
  },

  providers: {
    /** `POST /api/providers` */
    create: (
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
    ): string =>
      argv(scope, [
        'provider',
        'create',
        '--name',
        body.name,
        '--type',
        body.type,
        ...each('--credential', body.credentials),
        ...each('--config', body.config),
        ...each('--label', body.labels),
        ...(body.fromExisting ? ['--from-existing'] : []),
        ...(body.fromOidcToken ? ['--from-oidc-token'] : []),
        ...(body.fromGcloudAdc ? ['--from-gcloud-adc'] : []),
        ...(body.runtimeCredentials ? ['--runtime-credentials'] : []),
        ...(body.globalProfile ? ['--global-profile'] : []),
      ]),
    /** `PATCH /api/providers/:name` */
    update: (
      name: string,
      body: { credentials?: string[]; config?: string[]; fromExisting?: boolean; fromOidcToken?: boolean },
      scope: Scope,
    ): string =>
      argv(scope, [
        'provider',
        'update',
        name,
        ...each('--credential', body.credentials),
        ...each('--config', body.config),
        ...(body.fromExisting ? ['--from-existing'] : []),
        ...(body.fromOidcToken ? ['--from-oidc-token'] : []),
      ]),
    /** `DELETE /api/providers/:name` */
    remove: (name: string, scope: Scope): string => argv(scope, ['provider', 'delete', name]),
  },

  /**
   * Read commands behind explicit refresh / list controls. Kept separate from
   * the mutations so a page cannot accidentally hint a write with a read.
   */
  reads: {
    /** `GET /api/gateways` — local CLI metadata, no scope flags. */
    gatewayList: (): string => argv(undefined, ['gateway', 'list', '-o', 'json']),
    /** `GET /api/workspaces` */
    workspaceList: (scope: Scope): string => argv(scope, ['workspace', 'list', '-o', 'json']),
    /** `GET /api/profiles` */
    profileList: (scope: Scope): string => argv(scope, ['profile', 'list', '-o', 'json']),
    /** `GET /api/providers` */
    providerList: (scope: Scope): string => argv(scope, ['provider', 'list', '-o', 'json']),
    /** `GET /api/templates` */
    templateList: (scope: Scope): string => argv(scope, ['sandbox', 'template', 'list', '-o', 'json']),
    /** `GET /api/services` — or the per-sandbox form used by the detail page. */
    serviceList: (scope: Scope, sandbox?: string): string =>
      argv(scope, ['service', 'list', ...(sandbox ? [sandbox] : []), '-o', 'json']),
    /** `GET /api/forwards` */
    forwardList: (scope: Scope): string => argv(scope, ['forward', 'list', '-o', 'json']),
    /** `GET /api/sandboxes/:name/rules` */
    ruleList: (name: string, scope: Scope, status?: string): string =>
      argv(scope, ['rule', 'get', name, ...(status ? ['--status', status] : [])]),
    /** `GET /api/sandboxes/:name/rules/history` */
    ruleHistory: (name: string, scope: Scope): string => argv(scope, ['rule', 'history', name]),
    /** `GET /api/sandboxes/:name/policy` */
    policyHistory: (name: string, scope: Scope): string =>
      argv(scope, ['policy', 'list', name, '-o', 'json', '--page-size', '50']),
  },

  /**
   * Gateway registration edits the local CLI config, so — like the bridge —
   * these commands take no `--gateway` / `--workspace` flags.
   */
  gateways: {
    add: (
      body: {
        endpoint: string;
        name?: string;
        mode?: 'auto' | 'edge' | 'oidc' | 'local' | 'remote' | 'plaintext';
        oidcIssuer?: string;
        oidcClientId?: string;
        oidcAudience?: string;
        oidcScopes?: string;
        insecure?: boolean;
        remoteHost?: string;
      },
    ): string => {
      const args: Token[] = ['gateway', 'add'];
      const mode = body.mode ?? 'auto';
      if (mode === 'oidc') {
        args.push('--oidc-issuer', body.oidcIssuer ?? '');
        if (body.oidcClientId) args.push('--oidc-client-id', body.oidcClientId);
        if (body.oidcAudience) args.push('--oidc-audience', body.oidcAudience);
        if (body.oidcScopes) args.push('--oidc-scopes', body.oidcScopes);
      } else if (mode === 'local' || mode === 'plaintext') {
        args.push('--local');
      } else if (mode === 'remote' && !body.endpoint.startsWith('ssh://')) {
        args.push('--remote', body.remoteHost || '<remote host>');
      }
      args.push(body.endpoint);
      if (body.name) args.push('--name', body.name);
      if (body.insecure) args.push('--gateway-insecure');
      return argv(undefined, args);
    },
    select: (name: string): string => argv(undefined, ['gateway', 'select', name]),
    login: (name: string): string => argv(undefined, ['gateway', 'login', name]),
    logout: (name: string): string => argv(undefined, ['gateway', 'logout', name]),
    remove: (name: string): string => argv(undefined, ['gateway', 'remove', name]),
    /**
     * `GET /api/gateways/:name/health` — probeGateway() pins the probe to that
     * gateway with a scope flag rather than a subcommand flag.
     */
    probe: (name: string): string => argv({ gateway: name }, ['status', '-o', 'json']),
    /**
     * Pasting a token, forgetting tokens and switching the console role are
     * file / session operations the CLI has no command for — `null` keeps the
     * UI honest instead of inventing one.
     */
    setToken: (): null => null,
    forgetTokens: (): null => null,
    authRole: (): null => null,
  },
} as const;
