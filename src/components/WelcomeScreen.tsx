import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, CircularProgress, Link, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import WindowRoundedIcon from '@mui/icons-material/WindowRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { AuthConfig, AuthUser, EntraTenant } from '../api/types';
import { MONO } from '../theme';
import { LoginScreen } from './LoginScreen';
import { CopyButton, Mono, Panel } from './ui';

type Provider = 'oidc' | 'entra' | 'operator';

/**
 * Enterprise sign-in page: a brand/trust pane beside the authentication pane.
 * Only configured credential paths are offered — organization OIDC (when the
 * bridge runs in oidc mode), Microsoft Entra ID (when tenant + client are set,
 * MFA per tenant policy), and operator credentials (mTLS client certificate or
 * provisioned token; the dev loopback convenience when nothing is configured).
 * One session model and one role gate behind all of them.
 */
export function WelcomeScreen({ onLoggedIn }: { onLoggedIn?: (user: AuthUser) => void }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [params] = useSearchParams();
  const idpError = params.get('oidc_error');

  useEffect(() => {
    api
      .authConfig()
      .then(setConfig)
      .catch((err) => setError((err as Error).message));
  }, []);

  const done = (user: AuthUser) => {
    onLoggedIn?.(user);
    navigate('/');
  };
  const available: Provider[] = config
    ? ([
        config.mode === 'oidc' && config.issuers.length > 0 ? 'oidc' : null,
        config.entra.enabled ? 'entra' : null,
        config.mode === 'local' || config.local.token || config.local.mtls ? 'operator' : null,
      ].filter(Boolean) as Provider[])
    : [];
  const active: Provider | null =
    provider && available.includes(provider)
      ? provider
      : params.get('entra_flow') && available.includes('entra')
        ? 'entra'
        : (available[0] ?? null);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(340px, 40%) 1fr' },
      }}
    >
      <BrandPane config={config} />
      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 2, sm: 3, md: 4 }, minWidth: 0 }}>
        <Box sx={{ width: 'min(460px, 100%)', minWidth: 0 }}>
          <Stack spacing={0.75} sx={{ mb: 2.5 }}>
            <Typography sx={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Secure sign-in</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              Authenticate to this console with your organization’s identity provider or operator credentials.
            </Typography>
          </Stack>

          {error ? (
            <Panel sx={{ mb: 2 }}>
              <Typography role="alert" sx={{ fontSize: 12.5, color: 'error.main' }}>
                {error}
              </Typography>
            </Panel>
          ) : null}

          {idpError ? (
            <Panel sx={{ mb: 2, borderColor: 'error.main' }}>
              <Typography role="alert" sx={{ fontSize: 12.5, color: 'error.main', lineHeight: 1.55 }}>
                sign-in failed: {idpError}
              </Typography>
            </Panel>
          ) : null}

          {!config ? (
            <Stack sx={{ py: 6, alignItems: 'center' }}>
              <CircularProgress size={22} />
            </Stack>
          ) : (
            <>
              {available.length > 1 ? (
                <Tabs
                  value={active}
                  onChange={(_e, v: Provider) => setProvider(v)}
                  variant="fullWidth"
                  sx={{ mb: 2, minHeight: 44, '& .MuiTab-root': { minHeight: 44, fontSize: 12, fontWeight: 640 } }}
                >
                  {available.includes('oidc') ? (
                    <Tab value="oidc" icon={<LockRoundedIcon fontSize="small" />} iconPosition="start" label="OIDC" />
                  ) : null}
                  {available.includes('entra') ? (
                    <Tab value="entra" icon={<WindowRoundedIcon fontSize="small" />} iconPosition="start" label="Entra ID" />
                  ) : null}
                  {available.includes('operator') ? (
                    <Tab
                      value="operator"
                      icon={<TerminalRoundedIcon fontSize="small" />}
                      iconPosition="start"
                      label={config.local.anonymous ? 'Local (dev)' : 'Operator'}
                    />
                  ) : null}
                </Tabs>
              ) : null}
              <Panel sx={{ p: 3 }}>
                {active === 'oidc' ? <LoginScreen config={config} /> : null}
                {active === 'entra' ? (
                  <EntraForm config={config} onLoggedIn={done} flowId={params.get('entra_flow')} />
                ) : null}
                {active === 'operator' ? <OperatorForm config={config} onLoggedIn={done} /> : null}
              </Panel>
            </>
          )}

          <Stack direction="row" spacing={2} sx={{ mt: 2.5, flexWrap: 'wrap', rowGap: 0.75 }}>
            <Trust icon={<CloudDoneRoundedIcon />} text="server-side sessions" />
            <Trust icon={<VerifiedUserRoundedIcon />} text="MFA via your IdP" />
            <Trust icon={<ShieldRoundedIcon />} text="role-based access" />
            <Trust icon={<HistoryRoundedIcon />} text="audit-logged sign-ins" />
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ mt: 1.5, alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: MONO }}>
              bridge mode: {config?.mode ?? '…'} · tls: {config?.tls ? 'on' : 'off'}
            </Typography>
            {config && config.mode === 'oidc' && !available.includes('operator') ? (
              <Link href={config.localUrl} sx={{ fontSize: 11, fontFamily: MONO }}>
                local console ↗
              </Link>
            ) : null}
            {config && config.mode === 'local' ? (
              <Link href={config.oidcUrl} sx={{ fontSize: 11, fontFamily: MONO }}>
                OIDC console ↗
              </Link>
            ) : null}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}

function Trust({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', color: 'text.secondary' }}>
      <Box sx={{ display: 'grid', placeItems: 'center', fontSize: 14, '& svg': { fontSize: 14 } }}>{icon}</Box>
      <Typography sx={{ fontSize: 10.5, fontFamily: MONO }}>{text}</Typography>
    </Stack>
  );
}

/** Left pane: product identity, deployment posture and the trust contract. */
function BrandPane({ config }: { config: AuthConfig | null }) {
  const marks = (
    <>
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2.5,
          display: 'grid',
          placeItems: 'center',
          bgcolor: '#76b900',
          flexShrink: 0,
        }}
      >
        <Box component="svg" viewBox="0 0 24 24" sx={{ width: 22, height: 22, fill: 'none', stroke: '#07080c', strokeWidth: 2 }}>
          <path d="M12 3 20 7.5v9L12 21 4 16.5v-9z" />
          <circle cx="12" cy="12" r="2.4" fill="#07080c" stroke="none" />
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>OpenShell Console</Typography>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: MONO }}>sandbox fleet operations</Typography>
      </Box>
    </>
  );
  const chips = (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      <Chip size="small" label={`mode: ${config?.mode ?? '…'}`} variant="outlined" sx={{ fontFamily: MONO, fontSize: 10 }} />
      <Chip
        size="small"
        label={config?.tls ? 'tls: on' : 'tls: off'}
        variant="outlined"
        color={config?.tls ? 'success' : 'default'}
        sx={{ fontFamily: MONO, fontSize: 10 }}
      />
    </Stack>
  );
  return (
    <>
      {/* compact header on small screens */}
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', p: 2, pb: 0, flexWrap: 'wrap', rowGap: 1 }}
      >
        {marks}
        {chips}
      </Stack>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 4,
          borderRight: '1px solid',
          borderColor: 'divider',
          backgroundImage:
            'radial-gradient(1000px 460px at -10% -10%, rgba(118,185,0,0.14), transparent 60%), linear-gradient(rgba(127,127,127,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(127,127,127,0.06) 1px, transparent 1px)',
          backgroundSize: 'auto, auto, 32px 32px, 32px 32px',
        }}
      >
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            {marks}
          </Stack>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.7, maxWidth: 380 }}>
            Operate your OpenShell sandbox fleet — lifecycle, live terminals, network policy and provider profiles —
            behind organization-grade access control.
          </Typography>
          {chips}
        </Stack>
        <Stack spacing={1.5}>
          <BrandPoint icon={<CloudDoneRoundedIcon />} title="Tokens stay server-side" body="Sessions are HttpOnly cookies; access and refresh tokens never reach browser storage." />
          <BrandPoint icon={<VerifiedUserRoundedIcon />} title="Your IdP, your policies" body="OIDC realms or Microsoft Entra ID — MFA and conditional access apply as configured in your tenant." />
          <BrandPoint icon={<ShieldRoundedIcon />} title="Least privilege by role" body="admin manages gateways, policies and deletions; user operates sandboxes. mTLS / token operators are admins." />
          <BrandPoint icon={<HistoryRoundedIcon />} title="Accountable access" body="Every sign-in path is audit-logged; failed operator-token attempts are rate limited." />
        </Stack>
      </Box>
    </>
  );
}

function BrandPoint({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Stack direction="row" spacing={1.25}>
      <Box sx={{ color: 'primary.main', display: 'grid', placeItems: 'center', mt: 0.25, '& svg': { fontSize: 18 } }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontSize: 12.5, fontWeight: 660 }}>{title}</Typography>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.6 }}>{body}</Typography>
      </Box>
    </Stack>
  );
}

/** Post-authentication tenant picker: list the user's tenants, then sign in. */
function TenantPicker({ flowId, onLoggedIn }: { flowId: string; onLoggedIn: (user: AuthUser) => void }) {
  const [tenants, setTenants] = useState<EntraTenant[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api
      .entraTenants(flowId)
      .then((r) => setTenants(r.tenants))
      .catch((err) => setError((err as Error).message));
  }, [flowId]);

  const pick = async (t: EntraTenant) => {
    setBusy(t.tenantId);
    setError('');
    try {
      const r = await api.entraSelect(flowId, t.tenantId);
      onLoggedIn(r.user);
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  };

  return (
    <Stack spacing={1.5}>
      <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Choose your tenant</Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.6 }}>
        You are authenticated. Pick the organization this console session should belong to — roles come from that
        tenant’s app assignment.
      </Typography>
      {error ? (
        <Typography role="alert" sx={{ fontSize: 12, color: 'error.main', lineHeight: 1.5 }}>
          {error}
        </Typography>
      ) : null}
      {!tenants && !error ? <CircularProgress size={18} /> : null}
      {tenants?.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>no tenants listed for this account</Typography>
      ) : null}
      {tenants?.map((t) => (
        <Button
          key={t.tenantId}
          variant="outlined"
          color="inherit"
          disabled={busy !== ''}
          onClick={() => pick(t)}
          sx={{ justifyContent: 'flex-start', textAlign: 'left', py: 1.25, px: 1.5, width: '100%' }}
        >
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
              {busy === t.tenantId ? 'signing in…' : t.displayName}
            </Typography>
            <Typography noWrap sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
              {t.defaultDomain} · {t.tenantId}
            </Typography>
          </Stack>
        </Button>
      ))}
      <Button size="small" color="inherit" onClick={() => (window.location.hash = '#/welcome')}>
        ← back
      </Button>
    </Stack>
  );
}

/** Entra sign-in: direct redirect, tenant discovery, or device code. */
function EntraForm({
  config,
  onLoggedIn,
  flowId,
}: {
  config: AuthConfig;
  onLoggedIn: (user: AuthUser) => void;
  flowId?: string | null;
}) {
  const [device, setDevice] = useState<{
    flow: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  } | null>(null);
  const [status, setStatus] = useState<'starting' | 'waiting' | 'ok' | 'expired' | 'denied' | 'error'>('starting');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [useDevice, setUseDevice] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [redirectError, setRedirectError] = useState('');
  const loginRef = useRef(onLoggedIn);
  loginRef.current = onLoggedIn;

  const redirect = async () => {
    setRedirecting(true);
    setRedirectError('');
    try {
      const r = await api.oidcStart(config.entra.issuer);
      window.location.assign(r.url);
    } catch (err) {
      setRedirectError((err as Error).message);
      setRedirecting(false);
    }
  };

  const discover = async () => {
    setRedirecting(true);
    setRedirectError('');
    try {
      const r = await api.entraDiscover();
      window.location.assign(r.url);
    } catch (err) {
      setRedirectError((err as Error).message);
      setRedirecting(false);
    }
  };

  useEffect(() => {
    if (!useDevice) return;
    let alive = true;
    let timer: number | undefined;
    setStatus('starting');
    setMessage('');
    setDevice(null);
    setSeconds(0);
    (async () => {
      try {
        const d = await api.entraStart();
        if (!alive) return;
        setDevice(d);
        setStatus('waiting');
        const tick = async () => {
          try {
            const r = await api.entraPoll(d.flow);
            if (!alive) return;
            if (r.status === 'ok' && r.user) {
              setStatus('ok');
              loginRef.current(r.user);
              return;
            }
            if (r.status === 'pending' || r.status === 'slow_down') {
              timer = window.setTimeout(tick, Math.max(d.interval, 3) * 1000);
              return;
            }
            setStatus(r.status === 'denied' ? 'denied' : r.status === 'expired' ? 'expired' : 'error');
            setMessage(r.message ?? '');
          } catch (err) {
            if (!alive) return;
            setStatus('error');
            setMessage((err as Error).message);
          }
        };
        timer = window.setTimeout(tick, Math.max(d.interval, 3) * 1000);
      } catch (err) {
        if (!alive) return;
        setStatus('error');
        setMessage((err as Error).message);
      }
    })();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [retry, useDevice]);

  useEffect(() => {
    if (status !== 'waiting') return;
    const id = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const remaining = device ? Math.max(device.expires_in - seconds, 0) : 0;
  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const verifyUrl = device ? device.verification_uri_complete || device.verification_uri : '';

  return (
    <Stack spacing={2}>
      <Box>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Microsoft Entra ID</Typography>
        {/* no tenant GUID / flow label in the default redirect mode — the IdP
            page identifies the organization; infra ids stay server-side */}
        {useDevice ? (
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
            device code flow
          </Typography>
        ) : null}
      </Box>

      {flowId ? (
        <TenantPicker flowId={flowId} onLoggedIn={onLoggedIn} />
      ) : !useDevice ? (
        <Stack spacing={1.25}>
          <Button
            variant="contained"
            fullWidth
            disabled={redirecting}
            startIcon={redirecting ? <CircularProgress size={15} color="inherit" /> : <WindowRoundedIcon />}
            onClick={redirect}
          >
            {redirecting ? 'redirecting…' : 'continue to Microsoft sign-in'}
          </Button>
          <Button variant="outlined" color="inherit" fullWidth disabled={redirecting} onClick={discover}>
            list my tenants first
          </Button>
          {redirectError ? (
            <Typography role="alert" sx={{ fontSize: 12, color: 'error.main', lineHeight: 1.5 }}>
              {redirectError}
            </Typography>
          ) : null}
          <Button size="small" color="inherit" onClick={() => setUseDevice(true)}>
            use a device code instead
          </Button>
        </Stack>
      ) : (
        <Button size="small" color="inherit" onClick={() => setUseDevice(false)}>
          ← back to redirect sign-in
        </Button>
      )}

      {useDevice && status === 'starting' ? (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', py: 2 }}>
          <CircularProgress size={18} />
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>requesting a sign-in code…</Typography>
        </Stack>
      ) : null}

      {useDevice && device ? (
        <>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.65 }}>
            Open the Microsoft verification page, enter this code and approve with your work or school account. MFA
            applies as configured in your tenant.
          </Typography>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                flex: 1,
                py: 1.25,
                px: 2,
                borderRadius: 2,
                border: '1px dashed',
                borderColor: 'success.main',
                bgcolor: 'rgba(118,185,0,0.08)',
                textAlign: 'center',
              }}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: '0.22em' }}>
                {device.user_code}
              </Typography>
            </Box>
            <CopyButton value={device.user_code} label="copy code" />
          </Stack>
          <Button variant="contained" href={verifyUrl} target="_blank" rel="noreferrer" startIcon={<WindowRoundedIcon />}>
            open verification page
          </Button>
          <Typography aria-live="polite" sx={{ fontSize: 12, color: 'text.secondary' }}>
            {status === 'waiting' ? `waiting for approval… code expires in ${mmss}` : null}
            {status === 'ok' ? 'approved — entering the console…' : null}
          </Typography>
          {status === 'expired' || status === 'denied' || status === 'error' ? (
            <Stack spacing={1.25}>
              <Typography role="alert" sx={{ fontSize: 12.5, color: 'error.main', lineHeight: 1.55 }}>
                {message || (status === 'expired' ? 'the code expired' : 'sign-in failed')}
              </Typography>
              <Button size="small" variant="outlined" color="inherit" onClick={() => setRetry((n) => n + 1)}>
                start again
              </Button>
            </Stack>
          ) : null}
        </>
      ) : null}

      {useDevice && status === 'error' && !device ? (
        <Typography role="alert" sx={{ fontSize: 12.5, color: 'error.main', lineHeight: 1.55 }}>
          {message}
        </Typography>
      ) : null}

      <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.6 }}>
        The console polls your tenant for approval; no client secret is used. Entra app roles control admin-only
        operations.
      </Typography>
    </Stack>
  );
}

/** Operator credentials: mTLS client certificate or provisioned token; dev loopback enters directly. */
function OperatorForm({ config, onLoggedIn }: { config: AuthConfig; onLoggedIn: (user: AuthUser) => void }) {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const withCert = async () => {
    setBusy(true);
    setError('');
    try {
      const me = await api.authMe();
      if (me.user) onLoggedIn(me.user);
      else setError('no trusted client certificate on this connection — present one issued by the bridge CA, or use the operator token');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  const withToken = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.authLocal(token);
      onLoggedIn(r.user);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography sx={{ fontSize: 15, fontWeight: 660 }}>
          {config.local.anonymous ? 'Local console (development)' : 'Operator credentials'}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
          {config.local.anonymous ? 'loopback · CLI mTLS identity' : 'mTLS client certificate / provisioned token · admin'}
        </Typography>
      </Box>

      {config.local.anonymous ? (
        <>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.65 }}>
            No sign-in: every operation runs with this machine’s CLI identity (mTLS to the gateway). Development
            convenience only — disabled by a non-loopback bind, any configured credential, or{' '}
            <Mono>OPENSHELL_UI_REQUIRE_AUTH</Mono>.
          </Typography>
          <Button fullWidth variant="contained" color="secondary" endIcon={<ArrowForwardRoundedIcon />} onClick={() => navigate('/')}>
            enter local console
          </Button>
        </>
      ) : (
        <>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.65 }}>
            Present a client certificate issued by the bridge CA (mTLS), or unlock with the provisioned operator
            token. Both grant the admin role and are verified server-side.
          </Typography>
          {error ? (
            <Typography role="alert" sx={{ fontSize: 12, color: 'error.main', lineHeight: 1.5 }}>
              {error}
            </Typography>
          ) : null}
          {config.local.mtls ? (
            <Button fullWidth variant="contained" color="secondary" disabled={busy} startIcon={<LockRoundedIcon />} onClick={withCert}>
              continue with client certificate
            </Button>
          ) : null}
          {config.local.token ? (
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                type="password"
                fullWidth
                label="operator token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && token) void withToken();
                }}
                slotProps={{ htmlInput: { autoComplete: 'off', style: { fontFamily: MONO, fontSize: 12 } } }}
              />
              <Button variant="contained" color="secondary" disabled={busy || !token} onClick={withToken}>
                unlock
              </Button>
            </Stack>
          ) : null}
        </>
      )}
    </Stack>
  );
}