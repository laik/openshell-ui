import { useMemo } from 'react';
import {
  Box,
  Button,
  Divider,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { useAsync, useNow } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import { failureHint, isLive, phaseStyle } from '../lib/phases';
import { fullTime, relativeTime } from '../lib/format';
import {
  Busy,
  CodeBlock,
  EmptyState,
  ErrorNote,
  LoadingBlock,
  Mono,
  Panel,
  PhaseChip,
  SectionLabel,
  SpectrumBar,
} from '../components/ui';
import type { Context, Sandbox } from '../api/types';

function Metric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Box>
      <Typography
        sx={{
          fontSize: 10.5,
          letterSpacing: '0.075em',
          textTransform: 'uppercase',
          color: 'text.secondary',
          fontWeight: 650,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 29,
          fontWeight: 690,
          letterSpacing: '-0.026em',
          lineHeight: 1.15,
          color: color ?? 'text.primary',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
      {sub ? (
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.5 }}>{sub}</Typography>
      ) : null}
    </Box>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const { scope } = useShell();
  const now = useNow(5000);

  const ctx = useAsync<Context>(() => api.context(scope), {
    intervalMs: 20000,
    deps: [scope.gateway, scope.workspace],
  });
  const fleet = useAsync(() => api.sandboxes(scope), { deps: [scope.gateway, scope.workspace], intervalMs: 4000 });
  const services = useAsync(() => api.services(scope), { deps: [scope.gateway, scope.workspace] });
  const forwards = useAsync(() => api.forwards(scope), { deps: [scope.gateway, scope.workspace] });

  const sandboxes = fleet.data?.sandboxes ?? [];

  const byPhase = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sandboxes) map.set(String(s.phase), (map.get(String(s.phase)) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [sandboxes]);

  const attention = useMemo(
    () =>
      sandboxes
        .filter((s) => !isLive(s) && s.phase !== 'Completed')
        .map((s) => ({ sandbox: s, hint: failureHint(s) }))
        .filter((a) => a.hint)
        .slice(0, 4),
    [sandboxes],
  );

  const recent = useMemo(
    () =>
      [...sandboxes]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 6),
    [sandboxes],
  );

  const liveCount = sandboxes.filter(isLive).length;
  const gateway = ctx.data?.status;

  const cliHint = `openshell sandbox list --gateway ${gateway?.gateway ?? '<active>'} --workspace ${scope.workspace ?? 'default'}`;

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 0.5, alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: MONO }}>
              gateway · {gateway?.gateway ?? '—'} · {gateway?.server ?? '—'}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Typography variant="h1">Console</Typography>
              {gateway?.status === 'connected' ? (
                <Box
                  sx={{
                    px: 1,
                    py: 0.35,
                    borderRadius: 1.5,
                    bgcolor: 'rgba(53,210,154,0.12)',
                    border: '1px solid rgba(53,210,154,0.35)',
                    color: 'success.main',
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  connected
                </Box>
              ) : (
                <Box
                  sx={{
                    px: 1,
                    py: 0.35,
                    borderRadius: 1.5,
                    bgcolor: 'rgba(255,95,109,0.12)',
                    border: '1px solid rgba(255,95,109,0.35)',
                    color: 'error.main',
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  offline
                </Box>
              )}
            </Stack>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" color="inherit" startIcon={<TerminalRoundedIcon />} onClick={() => navigate('/network')}>
              services
            </Button>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => navigate('/sandboxes?new=1')}>
              new sandbox
            </Button>
          </Stack>
        </Stack>
      </Grid>

      <Grid size={{ xs: 12, md: 7 }}>
        <Panel sx={{ height: '100%' }}>
          <SectionLabel
            right={
              fleet.refreshing ? (
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                  refreshing…
                </Typography>
              ) : (
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                  polled every 4s
                </Typography>
              )
            }
          >
            fleet
          </SectionLabel>

          {fleet.loading ? (
            <LoadingBlock rows={4} />
          ) : fleet.error ? (
            <ErrorNote message={fleet.error} onRetry={fleet.reload} hint={cliHint} />
          ) : (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Metric label="sandboxes" value={sandboxes.length} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Metric label="live" value={liveCount} color={phaseStyle('Ready').color} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Metric label="services" value={services.data?.services?.length ?? 0} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Metric label="forwards" value={forwards.data?.length ?? 0} />
                </Grid>
              </Grid>

              <SpectrumBar
                segments={byPhase.map(([phase, count]) => ({
                  value: count,
                  color: phaseStyle(phase).color,
                  label: phase,
                }))}
              />
              <Stack direction="row" spacing={1.5} sx={{ mt: 1.25, gap: 1, flexWrap: "wrap" }}>
                {byPhase.map(([phase, count]) => (
                  <Stack key={phase} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: phaseStyle(phase).color }} />
                    <Mono dim sx={{ fontSize: 11.5 }}>
                      {phase.toLowerCase()} · {count}
                    </Mono>
                  </Stack>
                ))}
              </Stack>

              <Divider sx={{ my: 2 }} />

              {recent.length === 0 ? (
                <EmptyState
                  title="no sandboxes in this scope"
                  hint="Create one from the console, or with `openshell sandbox create --name dev --detach`."
                  action={
                    <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => navigate('/sandboxes?new=1')}>
                      create the first sandbox
                    </Button>
                  }
                />
              ) : (
                <Stack spacing={1}>
                  {recent.map((s: Sandbox) => {
                    const hint = failureHint(s);
                    return (
                      <Box
                        key={s.id}
                        onClick={() => navigate(`/sandboxes/${s.name}`)}
                        sx={{
                          cursor: 'pointer',
                          p: 1.25,
                          borderRadius: 2,
                          border: '1px solid',
                          borderColor: 'divider',
                          '&:hover': { borderColor: 'primary.main', bgcolor: 'rgba(118,185,0,0.06)' },
                        }}
                      >
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                          <Mono sx={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</Mono>
                          <PhaseChip phase={s.phase} />
                          {s.exit_code ? (
                            <Mono dim sx={{ fontSize: 11 }}>exit {s.exit_code}</Mono>
                          ) : null}
                          <Box sx={{ flex: 1 }} />
                          <Mono dim sx={{ fontSize: 11 }}>
                            {relativeTime(s.created_at, now)}
                          </Mono>
                          <ArrowForwardRoundedIcon sx={{ fontSize: 16, color: 'action.disabled' }} />
                        </Stack>
                        {hint ? (
                          <Typography sx={{ mt: 0.5, fontSize: 11.5, color: 'warning.main', fontFamily: MONO }}>
                            {hint}
                          </Typography>
                        ) : null}
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </>
          )}
        </Panel>
      </Grid>

      <Grid size={{ xs: 12, md: 5 }}>
        <Stack spacing={2.5}>
          <Panel>
            <SectionLabel>gateway</SectionLabel>
            {ctx.loading ? (
              <Busy label="reading gateway status…" />
            ) : ctx.error ? (
              <ErrorNote
                message={ctx.error}
                onRetry={ctx.reload}
                hint="the console bridge shells out to the local openshell CLI — start it with `npm run dev:server`"
              />
            ) : (
              <Stack spacing={1.25}>
                {gateway?.error ? (
                  <ErrorNote
                    message={gateway.error}
                    onRetry={ctx.reload}
                    hint="choose another gateway in the header, or start this gateway and refresh"
                  />
                ) : null}
                <Row label="endpoint" value={gateway?.server ?? '—'} />
                <Row label="server version" value={gateway?.version ?? '—'} />
                <Row label="cli" value={ctx.data?.cli_version ?? '—'} />
                <Row label="auth" value={gateway?.authentication?.provider ?? '—'} />
                <Row label="principal" value={ctx.data?.whoami?.subject ?? '—'} />
                <Row label="roles" value={(ctx.data?.whoami?.roles ?? []).join(', ') || '—'} />
                <Row label="binary" value={ctx.data?.binary ?? '—'} />
                <Divider sx={{ my: 0.5 }} />
                <CodeBlock value={cliHint} maxHeight={110} />
              </Stack>
            )}
          </Panel>

          <Panel>
            <SectionLabel
              right={
                <Button size="small" color="inherit" onClick={() => navigate('/gateways')}>
                  manage
                </Button>
              }
            >
              registered gateways
            </SectionLabel>
            <Stack spacing={0.75}>
              {(ctx.data?.gateways ?? []).map((g) => (
                <Box
                  key={g.name}
                  sx={{
                    p: 1,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: g.active ? 'primary.main' : 'divider',
                    bgcolor: g.active ? 'rgba(118,185,0,0.08)' : 'transparent',
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Mono sx={{ fontWeight: 600 }}>{g.name}</Mono>
                    <Box sx={{ flex: 1 }} />
                    <Mono dim sx={{ fontSize: 11 }}>{g.endpoint}</Mono>
                    <Mono dim sx={{ fontSize: 10.5 }}>{g.auth}</Mono>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Panel>

          <Panel>
            <SectionLabel>needs attention</SectionLabel>
            {attention.length === 0 ? (
              <Stack direction="row" spacing={1} sx={{ py: 1, alignItems: "center" }}>
                <BoltRoundedIcon sx={{ color: 'success.main', fontSize: 18 }} />
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  nothing failed — every sandbox is either ready or finished cleanly
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1}>
                {attention.map(({ sandbox, hint }) => (
                  <Box
                    key={sandbox.id}
                    onClick={() => navigate(`/sandboxes/${sandbox.name}`)}
                    sx={{
                      cursor: 'pointer',
                      p: 1.25,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'error.main',
                      bgcolor: 'rgba(255,95,109,0.06)',
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Mono sx={{ fontWeight: 600 }}>{sandbox.name}</Mono>
                      <PhaseChip phase={sandbox.phase} />
                    </Stack>
                    <Typography sx={{ mt: 0.5, fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
                      {hint}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Panel>

          <Panel>
            <SectionLabel>last refresh</SectionLabel>
            <Stack spacing={0.75}>
              <LinearProgress variant="determinate" value={100} color="primary" />
              <Mono dim sx={{ fontSize: 11.5 }}>
                fleet {fleet.lastFetch ? new Date(fleet.lastFetch).toLocaleTimeString() : '—'} ·{' '}
                {fullTime(gateway ? new Date().toISOString() : null)}
              </Mono>
            </Stack>
          </Panel>
        </Stack>
      </Grid>
    </Grid>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "baseline" }}>
      <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO, width: 110, flexShrink: 0 }}>
        {label}
      </Typography>
      <Mono sx={{ fontSize: 12.5, wordBreak: 'break-all' }}>{value}</Mono>
    </Stack>
  );
}
