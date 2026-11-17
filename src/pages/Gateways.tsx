import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import WindowRoundedIcon from '@mui/icons-material/WindowRounded';

import { api } from '../api/client';
import { useAsync } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import type { GatewayHealth, GatewayRecord } from '../api/types';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorNote,
  LoadingBlock,
  Mono,
  PageHeader,
  Panel,
} from '../components/ui';

type Mode = 'edge' | 'oidc' | 'local' | 'remote' | 'plaintext';

const MODES: Array<{ value: Mode; label: string; blurb: string }> = [
  { value: 'edge', label: 'Edge / cloud (token)', blurb: 'HTTPS endpoint behind Cloudflare Access or an edge proxy. Paste the bearer token.' },
  { value: 'oidc', label: 'OIDC (token)', blurb: 'HTTPS endpoint with an OIDC issuer. Paste an access token or use browser login later.' },
  { value: 'local', label: 'Local mTLS', blurb: 'Gateway running on this machine with certificates already in the CLI config.' },
  { value: 'remote', label: 'Remote mTLS (SSH)', blurb: 'Gateway reachable through an SSH destination such as user@host.' },
  { value: 'plaintext', label: 'Plaintext HTTP', blurb: 'Local http:// endpoint with no transport authentication.' },
];

export default function Gateways() {
  const { toast, gateway: scopedGateway, setGateway } = useShell();
  const [health, setHealth] = useState<Record<string, GatewayHealth>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [probingAll, setProbingAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tokenFor, setTokenFor] = useState<GatewayRecord | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'login' | 'logout'; gateway: GatewayRecord } | null>(
    null,
  );

  const state = useAsync(() => api.gateways.list(false), {});
  const gateways = useMemo(() => state.data ?? [], [state.data]);

  useEffect(() => {
    setHealth((prev) => {
      const next = { ...prev };
      for (const g of gateways) if (g.health) next[g.name] = g.health;
      return next;
    });
  }, [gateways]);

  const active = gateways.find((g) => g.active);
  const healthy = gateways.filter((g) => health[g.name]?.ok).length;

  const check = async (name: string) => {
    setChecking((prev) => ({ ...prev, [name]: true }));
    try {
      const result = await api.gateways.health(name);
      setHealth((prev) => ({ ...prev, [name]: result }));
      if (!result.ok) toast(`gateway ${name} is unreachable`, { kind: 'err', detail: result.error });
    } catch (err) {
      toast('health check failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setChecking((prev) => ({ ...prev, [name]: false }));
    }
  };

  const checkAll = async () => {
    setProbingAll(true);
    try {
      const all = await api.gateways.list(true);
      const next: Record<string, GatewayHealth> = {};
      for (const g of all) if (g.health) next[g.name] = g.health;
      setHealth(next);
      state.reload();
      toast(`checked ${all.length} gateway${all.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast('could not check gateways', { kind: 'err', detail: (err as Error).message });
    } finally {
      setProbingAll(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Gateways"
        description="Register, verify and switch between gateways. Tokens are written to the local CLI config, never kept in the browser."
        actions={
          <>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={probingAll ? <CircularProgress size={14} /> : <ShieldRoundedIcon />}
              disabled={probingAll || gateways.length === 0}
              onClick={checkAll}
            >
              check all
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<RefreshRoundedIcon />}
              onClick={state.reload}
            >
              refresh
            </Button>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAddOpen(true)}>
              add gateway
            </Button>
          </>
        }
      />

      <Grid container spacing={1.5}>
        {[
          { label: 'registered', value: String(gateways.length), hint: 'in the local CLI config' },
          { label: 'cli active', value: active?.name ?? '—', hint: active?.endpoint ?? 'no gateway selected' },
          { label: 'healthy', value: `${healthy}/${gateways.length}`, hint: 'responded to status checks' },
          { label: 'scoped', value: scopedGateway || 'CLI active', hint: 'used by every console page' },
        ].map((stat) => (
          <Grid key={stat.label} size={{ xs: 6, md: 3 }}>
            <Panel dense sx={{ height: '100%' }}>
              <Typography
                sx={{
                  fontSize: 10.5,
                  letterSpacing: '0.075em',
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                  fontWeight: 650,
                }}
              >
                {stat.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: 22,
                  fontWeight: 680,
                  mt: 0.5,
                  lineHeight: 1.15,
                  letterSpacing: '-0.025em',
                  fontVariantNumeric: 'tabular-nums',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.value}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.4, lineHeight: 1.45 }}>
                {stat.hint}
              </Typography>
            </Panel>
          </Grid>
        ))}
      </Grid>

      {state.error ? <ErrorNote message={state.error} onRetry={state.reload} /> : null}
      {state.loading ? <LoadingBlock rows={3} /> : null}

      {!state.loading && gateways.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<DnsRoundedIcon />}
            title="no gateways registered"
            hint="add an edge gateway with a bearer token, an OIDC gateway, a local mTLS gateway, or a remote SSH gateway."
            action={
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAddOpen(true)}>
                add gateway
              </Button>
            }
          />
        </Panel>
      ) : null}

      <Grid container spacing={2}>
        {gateways.map((g) => {
          const h = health[g.name];
          const selected = g.name === scopedGateway;
          const auth = authLabel(g.auth);
          const canToken = auth.kind === 'edge' || auth.kind === 'oidc';
          return (
            <Grid key={g.name} size={{ xs: 12, lg: gateways.length === 1 ? 12 : 6 }}>
              <Panel
                sx={{
                  height: '100%',
                  borderColor: selected ? 'primary.main' : 'divider',
                  bgcolor: selected ? 'rgba(118,185,0,0.06)' : undefined,
                }}
              >
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: 2,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: 'action.hover',
                        color: selected ? 'primary.main' : 'text.secondary',
                      }}
                    >
                      <DnsRoundedIcon fontSize="small" />
                    </Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 660, fontFamily: MONO }}>{g.name}</Typography>
                    {g.active ? (
                      <Chip
                        size="small"
                        label="cli active"
                        color="primary"
                        variant="outlined"
                        icon={<CheckCircleRoundedIcon />}
                      />
                    ) : null}
                    {selected ? <Chip size="small" label="scoped" variant="outlined" /> : null}
                    <Box sx={{ flex: 1 }} />
                    <HealthBadge
                      health={h}
                      loading={checking[g.name]}
                      onCheck={() => check(g.name)}
                    />
                  </Stack>

                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Mono dim sx={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>
                      {g.endpoint}
                    </Mono>
                    <CopyButton value={g.endpoint} label="endpoint" />
                  </Stack>

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.25}
                    sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap', rowGap: 1.25 }}
                  >
                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={g.is_remote ? 'remote' : 'local'}
                        sx={{ fontFamily: MONO }}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        color={auth.color}
                        label={auth.label}
                        sx={{ fontFamily: MONO }}
                      />
                      {g.metadata?.oidc_issuer ? (
                        <Tooltip title={g.metadata.oidc_issuer}>
                          <Chip
                            size="small"
                            variant="outlined"
                            label="oidc issuer"
                            sx={{ fontFamily: MONO }}
                          />
                        </Tooltip>
                      ) : null}
                      {g.remote_host ? (
                        <Chip size="small" variant="outlined" label={g.remote_host} sx={{ fontFamily: MONO }} />
                      ) : null}
                    </Stack>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                      <Button
                        size="small"
                        variant={selected ? 'outlined' : 'contained'}
                        startIcon={<SwapHorizRoundedIcon />}
                        disabled={selected}
                        onClick={async () => {
                          try {
                            await api.gateways.select(g.name);
                            setGateway(g.name);
                            toast(`scope switched to ${g.name}`);
                            state.reload();
                          } catch (err) {
                            toast('could not select gateway', { kind: 'err', detail: (err as Error).message });
                          }
                        }}
                      >
                        {selected ? 'in scope' : g.active ? 'use' : 'switch to'}
                      </Button>
                      {canToken ? (
                        <IconButton size="small" title="update token" onClick={() => setTokenFor(g)}>
                          <KeyRoundedIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                      {canToken ? (
                        <IconButton
                          size="small"
                          title="browser login"
                          onClick={() => setConfirm({ kind: 'login', gateway: g })}
                        >
                          <LoginRoundedIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                      {canToken ? (
                        <IconButton
                          size="small"
                          title="log out"
                          onClick={() => setConfirm({ kind: 'logout', gateway: g })}
                        >
                          <LogoutRoundedIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                      <IconButton
                        size="small"
                        color="error"
                        title="remove gateway"
                        onClick={() => setConfirm({ kind: 'remove', gateway: g })}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>
                </Stack>
              </Panel>
            </Grid>
          );
        })}
      </Grid>

      <Panel dense>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
          <ShieldRoundedIcon sx={{ color: 'text.secondary', fontSize: 18, mt: 0.2 }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.6 }}>
            A gateway password or token is sent only to this local bridge, stored as <Mono>edge_token</Mono> or{' '}
            <Mono>oidc_token.json</Mono> with <Mono>0600</Mono> permissions in the CLI config directory, then checked
            with <Mono>openshell status</Mono>. If verification fails the registration is rolled back automatically.
            Browser login opens on the machine running the bridge.
          </Typography>
        </Stack>
      </Panel>

      <AddGatewayDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(result) => {
          setAddOpen(false);
          state.reload();
          if (result.token_kind) toast(`gateway ${result.name} registered with a ${result.token_kind} token`);
          else toast(`gateway ${result.name} registered`);
          for (const warning of result.warnings) toast('gateway warning', { kind: 'info', detail: warning });
        }}
      />

      <TokenDialog
        gateway={tokenFor}
        onClose={() => setTokenFor(null)}
        onSaved={(name) => {
          setTokenFor(null);
          toast(`token updated for ${name}`);
          check(name);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.kind === 'remove'
            ? `Remove gateway ${confirm.gateway.name}?`
            : confirm?.kind === 'login'
              ? `Browser login for ${confirm.gateway.name}?`
              : confirm
                ? `Log out of ${confirm.gateway.name}?`
                : ''
        }
        body={
          confirm?.kind === 'remove'
            ? 'This removes the local CLI registration and stored tokens. It does not stop or destroy the gateway service.'
            : confirm?.kind === 'login'
              ? 'A browser window opens on the machine hosting the bridge. The command waits for the login flow to finish.'
              : 'Stored OIDC or edge tokens are removed; the next command needs a fresh login.'
        }
        confirmLabel={confirm?.kind === 'remove' ? 'remove' : confirm?.kind === 'login' ? 'open browser' : 'log out'}
        danger={confirm?.kind === 'remove'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const target = confirm;
          setConfirm(null);
          if (!target) return;
          try {
            if (target.kind === 'remove') {
              await api.gateways.remove(target.gateway.name);
              toast(`removed gateway ${target.gateway.name}`);
              if (scopedGateway === target.gateway.name) setGateway('');
              state.reload();
            } else if (target.kind === 'logout') {
              await api.gateways.logout(target.gateway.name);
              toast(`logged out of ${target.gateway.name}`);
              check(target.gateway.name);
            } else {
              toast('waiting for browser login…', { kind: 'info' });
              const out = await api.gateways.login(target.gateway.name);
              toast('login complete', { detail: out.trim() });
              check(target.gateway.name);
            }
          } catch (err) {
            toast(`${target.kind} failed`, { kind: 'err', detail: (err as Error).message });
          }
        }}
      />
    </Stack>
  );
}

function HealthBadge({
  health,
  loading,
  onCheck,
}: {
  health: GatewayHealth | undefined;
  loading?: boolean;
  onCheck: () => void;
}) {
  if (loading) {
    return (
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <CircularProgress size={13} />
        <Typography sx={{ fontSize: 11, fontFamily: MONO, color: 'text.secondary' }}>checking…</Typography>
      </Stack>
    );
  }
  if (!health) {
    return (
      <Button size="small" color="inherit" variant="outlined" onClick={onCheck} sx={{ fontFamily: MONO }}>
        check
      </Button>
    );
  }
  return (
    <Tooltip
      title={
        health.ok
          ? `${String(health.status?.version ?? '')} · ${String(health.status?.server ?? '')}`
          : health.error ?? 'unreachable'
      }
    >
      <Stack
        direction="row"
        spacing={0.6}
        onClick={onCheck}
        sx={{
          px: 0.9,
          py: 0.45,
          borderRadius: 1.5,
          cursor: 'pointer',
          alignItems: 'center',
          border: '1px solid',
          borderColor: health.ok ? 'success.main' : 'error.main',
          bgcolor: health.ok ? 'rgba(53,210,154,0.1)' : 'rgba(255,95,109,0.1)',
        }}
      >
        {health.ok ? (
          <CheckCircleRoundedIcon sx={{ fontSize: 14, color: 'success.main' }} />
        ) : (
          <ErrorRoundedIcon sx={{ fontSize: 14, color: 'error.main' }} />
        )}
        <Typography
          sx={{
            fontSize: 10.5,
            fontFamily: MONO,
            fontWeight: 640,
            color: health.ok ? 'success.main' : 'error.main',
          }}
        >
          {health.ok ? `connected · ${health.latency_ms} ms` : 'unreachable'}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

function authLabel(auth: string): { kind: 'edge' | 'oidc' | 'mtls' | 'plaintext' | 'unknown'; label: string; color: 'primary' | 'secondary' | 'success' | 'warning' | 'default' } {
  const mode = auth.toLowerCase();
  if (mode.includes('cloudflare') || mode === 'edge') return { kind: 'edge', label: 'edge token', color: 'warning' };
  if (mode === 'oidc') return { kind: 'oidc', label: 'OIDC', color: 'secondary' };
  if (mode === 'mtls') return { kind: 'mtls', label: 'mTLS', color: 'success' };
  if (mode === 'plaintext') return { kind: 'plaintext', label: 'plaintext', color: 'warning' };
  return { kind: 'unknown', label: auth || 'unknown', color: 'default' };
}

interface AddForm {
  mode: Mode;
  endpoint: string;
  name: string;
  token: string;
  remoteHost: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcAudience: string;
  oidcScopes: string;
  insecure: boolean;
  verify: boolean;
  activate: boolean;
}

const EMPTY_FORM: AddForm = {
  mode: 'edge',
  endpoint: 'https://',
  name: '',
  token: '',
  remoteHost: '',
  oidcIssuer: '',
  oidcClientId: 'openshell-cli',
  oidcAudience: '',
  oidcScopes: '',
  insecure: false,
  verify: true,
  activate: true,
};

/**
 * Entra device-code token fetch for gateway registration: the second auth
 * model beside the Keycloak-style password grant. The token's audience is the
 * gateway's (audience/.default or the scopes field), not the console app, and
 * no console session is created — the token lands in the dialog's token field.
 */
function EntraGatewayFetch({
  audience,
  scopes,
  onToken,
  onError,
}: {
  audience: string;
  scopes: string;
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [device, setDevice] = useState<{
    flow: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [done, setDone] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    api
      .authConfig()
      .then((c) => setEnabled(c.entra.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!device || !waiting) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const r = await api.entraPoll(device.flow);
        if (!alive) return;
        if (r.status === 'ok' && r.access_token) {
          setWaiting(false);
          setDone(true);
          onToken(r.access_token);
          return;
        }
        if (r.status === 'pending' || r.status === 'slow_down') {
          timer = window.setTimeout(tick, Math.max(device.interval, 3) * 1000);
          return;
        }
        setWaiting(false);
        onError(r.message ?? 'Entra sign-in failed');
      } catch (err) {
        if (!alive) return;
        setWaiting(false);
        onError((err as Error).message);
      }
    };
    timer = window.setTimeout(tick, Math.max(device.interval, 3) * 1000);
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, waiting]);

  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [waiting]);

  if (!enabled) return null;
  const remaining = device ? Math.max(device.expires_in - seconds, 0) : 0;
  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;

  return (
    <Box sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 660, color: 'text.secondary', mb: 0.75 }}>
        or fetch a token with Microsoft Entra device code
      </Typography>
      {device ? (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Mono sx={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.18em' }}>{device.user_code}</Mono>
            <CopyButton value={device.user_code} label="copy" />
            <Button size="small" variant="outlined" color="inherit" href={device.verification_uri_complete || device.verification_uri} target="_blank" rel="noreferrer" startIcon={<WindowRoundedIcon fontSize="small" />}>
              approve
            </Button>
          </Stack>
          <Typography aria-live="polite" sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
            {done ? 'token placed in the field above' : waiting ? `waiting for approval… expires in ${mmss}` : 'start again to retry'}
          </Typography>
        </Stack>
      ) : null}
      {!waiting && !done ? (
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<WindowRoundedIcon fontSize="small" />}
          onClick={async () => {
            onError('');
            setDone(false);
            setSeconds(0);
            try {
              const aud = audience.trim();
              const d = await api.entraStart({
                purpose: 'gateway-token',
                scopes: scopes.trim() || (aud ? `${aud}/.default` : undefined),
              });
              setDevice(d);
              setWaiting(true);
            } catch (err) {
              onError((err as Error).message);
            }
          }}
        >
          get device code
        </Button>
      ) : null}
      <Typography sx={{ fontSize: 10.5, color: 'text.secondary', mt: 0.75, lineHeight: 1.5 }}>
        MFA-friendly sign-in with your work/school account. The token audience is the gateway’s (audience
        <Mono>/.default</Mono> or the scopes field); no console session is created.
      </Typography>
    </Box>
  );
}

function AddGatewayDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (result: Awaited<ReturnType<typeof api.gateways.add>>) => void;
}) {
  const { toast } = useShell();
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantUser, setGrantUser] = useState('');
  const [grantPass, setGrantPass] = useState('');
  const [grantClient, setGrantClient] = useState('lab-cli');
  const [grantBusy, setGrantBusy] = useState(false);
  const set = <K extends keyof AddForm>(key: K, value: AddForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setError(null);
      setShowToken(false);
      setGrantUser('');
      setGrantPass('');
      setGrantBusy(false);
    }
  }, [open]);

  const mode = MODES.find((m) => m.value === form.mode) ?? MODES[0];
  const needsToken = form.mode === 'edge' || form.mode === 'oidc';
  const endpointOk = /^(https?|ssh):\/\/[^\s]+$/.test(form.endpoint.trim());
  const needsTokenForVerify = form.verify && needsToken && !form.token.trim();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.gateways.add({
        endpoint: form.endpoint.trim(),
        name: form.name.trim() || undefined,
        mode: form.mode,
        token: needsToken ? form.token.trim() || undefined : undefined,
        remoteHost: form.mode === 'remote' ? form.remoteHost.trim() : undefined,
        oidcIssuer: form.mode === 'oidc' ? form.oidcIssuer.trim() : undefined,
        oidcClientId: form.mode === 'oidc' ? form.oidcClientId.trim() : undefined,
        oidcAudience: form.mode === 'oidc' ? form.oidcAudience.trim() || undefined : undefined,
        oidcScopes: form.mode === 'oidc' ? form.oidcScopes.trim() || undefined : undefined,
        insecure: form.insecure || undefined,
        verify: form.verify,
        rollback: true,
        activate: form.activate,
      });
      onAdded(result);
    } catch (err) {
      setError((err as Error).message);
      toast('could not add gateway', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Add a gateway
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.55, mt: 0.6 }}>
          The endpoint is verified with <Mono>openshell status</Mono> before it is kept.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            fullWidth
            label="connection type"
            value={form.mode}
            onChange={(e) => set('mode', e.target.value as Mode)}
            helperText={mode.blurb}
          >
            {MODES.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {m.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth
            label="endpoint"
            value={form.endpoint}
            onChange={(e) => set('endpoint', e.target.value)}
            placeholder={
              form.mode === 'plaintext' || form.mode === 'local'
                ? 'http://127.0.0.1:8080'
                : 'https://gateway.example.com'
            }
            error={Boolean(form.endpoint.trim()) && !endpointOk}
            helperText={
              form.endpoint.trim() && !endpointOk ? 'must start with https://, http:// or ssh://' : undefined
            }
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />

          {form.mode === 'remote' ? (
            <TextField
              fullWidth
              label="ssh destination"
              value={form.remoteHost}
              onChange={(e) => set('remoteHost', e.target.value)}
              placeholder="user@host"
              helperText="the gateway is reached through this SSH host; mTLS certificates must already exist locally"
              slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
            />
          ) : null}

          {form.mode === 'oidc' ? (
            <>
              <TextField
                fullWidth
                label="OIDC issuer"
                value={form.oidcIssuer}
                onChange={(e) => set('oidcIssuer', e.target.value)}
                placeholder="https://idp.example.com"
                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  fullWidth
                  label="client id"
                  value={form.oidcClientId}
                  onChange={(e) => set('oidcClientId', e.target.value)}
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
                <TextField
                  fullWidth
                  label="audience (optional)"
                  value={form.oidcAudience}
                  onChange={(e) => set('oidcAudience', e.target.value)}
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
              </Stack>
              <TextField
                fullWidth
                label="scopes (optional)"
                value={form.oidcScopes}
                onChange={(e) => set('oidcScopes', e.target.value)}
                placeholder="openid profile email"
                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
              />
            </>
          ) : null}

          {needsToken ? (
            <TextField
              fullWidth
              label={form.mode === 'oidc' ? 'access token (optional)' : 'bearer token'}
              type={showToken ? 'text' : 'password'}
              value={form.token}
              onChange={(e) => set('token', e.target.value)}
              placeholder={form.mode === 'oidc' ? 'paste an OIDC access token, or leave blank for browser login' : 'paste the edge token'}
              helperText={
                needsTokenForVerify
                  ? 'required to verify a new gateway · uncheck verify to add it unauthenticated and log in later'
                  : form.mode === 'oidc'
                    ? 'stored as oidc_token.json; expiry is read from the JWT when present'
                    : 'stored as edge_token with 0600 permissions in the CLI config directory'
              }
              slotProps={{
                htmlInput: { style: { fontFamily: MONO }, autoComplete: 'off', spellCheck: false },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowToken((v) => !v)} edge="end">
                        {showToken ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          ) : null}

          {form.mode === 'oidc' ? (
            <Box sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 660, color: 'text.secondary', mb: 0.75 }}>
                or fetch a token with a password grant
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                <TextField
                  fullWidth
                  label="client id"
                  value={grantClient}
                  onChange={(e) => setGrantClient(e.target.value)}
                  sx={{ maxWidth: 140 }}
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
                <TextField
                  fullWidth
                  label="username"
                  value={grantUser}
                  onChange={(e) => setGrantUser(e.target.value)}
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
                <TextField
                  fullWidth
                  label="password"
                  type="password"
                  value={grantPass}
                  onChange={(e) => setGrantPass(e.target.value)}
                />
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  disabled={grantBusy || !grantUser.trim() || !grantPass || !form.oidcIssuer.trim()}
                  startIcon={grantBusy ? <CircularProgress size={13} /> : <KeyRoundedIcon />}
                  onClick={async () => {
                    setGrantBusy(true);
                    setError(null);
                    try {
                      const res = await api.oidcToken({
                        issuer: form.oidcIssuer.trim(),
                        clientId: grantClient.trim() || undefined,
                        username: grantUser.trim(),
                        password: grantPass,
                      });
                      set('token', res.access_token);
                      toast('token fetched from the issuer');
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setGrantBusy(false);
                    }
                  }}
                >
                  fetch
                </Button>
              </Stack>
              <Typography sx={{ fontSize: 10.5, color: 'text.secondary', mt: 0.75, lineHeight: 1.5 }}>
                Uses the issuer above (e.g. an iam-lab Keycloak realm with a direct-access-grants client). The token
                lands in the field above and is stored by the bridge like a pasted one.
              </Typography>
            </Box>
          ) : null}

          {form.mode === 'oidc' ? (
            <EntraGatewayFetch
              audience={form.oidcAudience}
              scopes={form.oidcScopes}
              onToken={(t) => {
                set('token', t);
                toast('Entra token fetched — stored like a pasted one');
              }}
              onError={(m) => setError(m || null)}
            />
          ) : null}

          <TextField
            fullWidth
            label="name (optional)"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="derived from the endpoint host when empty"
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <FormControlLabel
              control={<Checkbox checked={form.verify} onChange={(e) => set('verify', e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5 }}>verify before keeping</Typography>}
            />
            <FormControlLabel
              control={<Checkbox checked={form.activate} onChange={(e) => set('activate', e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5 }}>make active</Typography>}
            />
            <FormControlLabel
              control={<Checkbox checked={form.insecure} onChange={(e) => set('insecure', e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5 }}>skip TLS verify</Typography>}
            />
          </Stack>

          {error ? <ErrorNote message={error} /> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={
            busy || !endpointOk || (form.mode === 'oidc' && !form.oidcIssuer.trim()) || needsTokenForVerify
          }
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <AddRoundedIcon />}
        >
          {busy ? 'verifying…' : form.verify ? 'add & verify' : 'add gateway'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TokenDialog({
  gateway,
  onClose,
  onSaved,
}: {
  gateway: GatewayRecord | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { toast } = useShell();
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken('');
    setShow(false);
    setVerify(true);
  }, [gateway?.name]);

  const kind = gateway ? authLabel(gateway.auth).kind : 'unknown';

  const save = async () => {
    if (!gateway) return;
    setBusy(true);
    try {
      const result = await api.gateways.setToken(gateway.name, token.trim(), { verify });
      if (result.verification && !result.verification.ok) {
        toast('token stored but verification failed', {
          kind: 'err',
          detail: result.verification.error,
        });
      } else {
        onSaved(gateway.name);
      }
    } catch (err) {
      toast('could not store token', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(gateway)} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Update token</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            Paste a new {kind === 'oidc' ? 'OIDC access token' : 'edge bearer token'} for{' '}
            <Mono>{gateway?.name}</Mono>. It replaces the stored token.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            type={show ? 'text' : 'password'}
            label="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            slotProps={{
              htmlInput: { style: { fontFamily: MONO }, autoComplete: 'off', spellCheck: false },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShow((v) => !v)} edge="end">
                      {show ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <FormControlLabel
            control={<Checkbox checked={verify} onChange={(e) => setVerify(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12.5 }}>verify with openshell status</Typography>}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || !token.trim()}
          onClick={save}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <KeyRoundedIcon />}
        >
          {busy ? 'saving…' : 'store token'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
