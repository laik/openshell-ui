/**
 * Types for the gateway payloads the console renders.
 * Field names follow `openshell … -o json` output verbatim.
 */

export type Phase =
  | 'Pending'
  | 'Ready'
  | 'Running'
  | 'Stopped'
  | 'Suspended'
  | 'Completed'
  | 'Failed'
  | 'Terminating'
  | 'Deleting'
  | 'Unknown'
  | string;

export interface SandboxCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  last_transition_time: string;
}

export interface SandboxProvisioning {
  phase: string;
  attempt_id: string;
  admission_start_time: string | null;
  configuration_change_time: string | null;
  preparation_deadline: string | null;
  timeout_time: string | null;
  driver_operation_id: string | null;
  driver_operation_pending: boolean;
  cleanup_error: string;
  [k: string]: unknown;
}

export interface SandboxPolicy {
  version?: number;
  filesystem_policy?: {
    include_workdir: boolean;
    read_only: string[];
    read_write: string[];
  };
  network?: unknown;
  process?: unknown;
  landlock?: { compatibility: string };
}

export interface EndpointStatus {
  endpoint_id: string;
  host: string;
  ports: number[];
  last_result: string;
  last_reported_time: string;
  last_failure: unknown;
}

export interface Sandbox {
  id: string;
  name: string;
  phase: Phase;
  workspace: string;
  created_at: string;
  resource_version: number;
  revision: number;
  exit_code: number | null;
  restart_count: number;
  restart_policy: string;
  policy_source: string;
  current_policy_version: number;
  host_key_fingerprint: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  conditions: SandboxCondition[];
  provisioning: SandboxProvisioning;
  configuration_admission: {
    state: string;
    error: string;
    policy_hash: string;
    policy_version: number;
    config_revision: number;
  };
  endpoint_statuses: EndpointStatus[];
  policy?: SandboxPolicy;
  created_from_workload_template: string | null;
  main_process_instance_id?: string;
  main_process_started_at_ms?: number;
  last_token_grant_failure?: unknown;
}

export interface GatewayHealth {
  ok: boolean;
  status?: Record<string, unknown> | null;
  error?: string;
  latency_ms: number;
  checked_at: number;
}

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
  [k: string]: unknown;
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

export interface GatewayAddResult {
  name: string;
  gateway: GatewayRecord;
  verification: GatewayHealth | null;
  token_saved: boolean;
  token_kind: 'edge' | 'oidc' | null;
  warnings: string[];
  output: string;
}

export interface GatewayTokenResult {
  name: string;
  token_kind: 'edge' | 'oidc';
  token_saved: boolean;
  verification: GatewayHealth | null;
}

export interface GatewayStatus {
  gateway: string;
  server: string;
  status: string;
  version: string;
  authentication: { provider: string; status: string };
  /** Present when the bridge could not reach the selected gateway. */
  error?: string;
}

export interface Principal {
  subject: string;
  display_name: string;
  identity_provider: string;
  roles: string[];
  scopes: string[];
}

export interface Workspace {
  name: string;
  id: string;
  status: string;
  created_at: string;
}

export interface Context {
  status: GatewayStatus;
  whoami: Principal | null;
  gateways: GatewayRecord[];
  workspaces: { workspaces: Workspace[] } | null;
  cli_version: string;
  binary: string;
}

export interface ServiceEndpoint {
  sandbox: string;
  service: string;
  target_port: number;
  url: string;
  workspace: string;
  authorization_mode: string;
}

export interface PortForward {
  sandbox?: string;
  local?: string;
  target_port?: number;
  target_host?: string;
  [k: string]: unknown;
}

export interface ProviderAttachment {
  profile?: string;
  provider_id?: string;
  [k: string]: unknown;
}

export interface ProviderProfile {
  name?: string;
  display_name?: string;
  scope?: string;
  description?: string;
  endpoints?: unknown[];
  credentials?: unknown[];
  [k: string]: unknown;
}

export interface SandboxTemplate {
  name: string;
  image?: string;
  resources?: unknown;
  labels?: Record<string, string>;
  created_at?: string;
  [k: string]: unknown;
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

export interface LogLine {
  id: string;
  ts: number | null;
  source: 'gateway' | 'sandbox' | 'unknown';
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'other';
  target: string;
  message: string;
  raw: string;
}

export interface PolicyRevision {
  version: number;
  hash: string;
  policy_source: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface RuleEndpoint {
  raw: string;
  host: string;
  port: number | null;
  protocol: string;
}

export interface NetworkRule {
  chunk_id: string;
  status: 'pending' | 'approved' | 'rejected' | string;
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

export interface AllRules {
  rules: NetworkRule[];
  scanned: number;
  errors: Array<{ sandbox: string; error: string }>;
}

export interface ProfileCredential {
  name?: string;
  description?: string;
  env_vars?: string[];
  env_var?: string;
  required?: boolean;
  auth_style?: string;
  header_name?: string;
  query_param?: string;
  [k: string]: unknown;
}

export interface ProfileEndpoint {
  host?: string;
  port?: number;
  protocol?: string;
  access?: string;
  enforcement?: string;
  path?: string;
  [k: string]: unknown;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  workspace?: string;
  resource_version?: number;
  credential_keys?: string[];
  labels?: Record<string, string>;
  [k: string]: unknown;
}

export interface ProviderList {
  providers: ProviderConfig[];
  next_page_token?: string;
}

export interface RunResult extends ExecResult {
  started: boolean;
  phase: string | null;
}
