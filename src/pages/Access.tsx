import { Box, Button, Chip, Divider, Grid, IconButton, Stack, Typography } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { useAsync } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import { ErrorNote, LoadingBlock, Mono, Panel, PhaseChip, SectionLabel } from '../components/ui';

export default function Access() {
  const { scope, gateway, workspace } = useShell();
  const navigate = useNavigate();
  const ctx = useAsync(() => api.context(scope), { intervalMs: 30000, deps: [scope.gateway, scope.workspace] });
  const workspaces = useAsync(() => api.workspaces(scope), { deps: [scope.gateway, scope.workspace] });

  const whoami = ctx.data?.whoami;
  const status = ctx.data?.status;
  const selected = ctx.data?.gateways?.find((g) => g.name === (gateway || ctx.data?.gateways?.find((x) => x.active)?.name));

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h2">Identity</Typography>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontFamily: MONO, mt: 0.4 }}>
          who you are, which gateway answers this console, and the workspaces you can reach
        </Typography>
      </Box>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Panel sx={{ height: '100%' }}>
            <SectionLabel
              right={
                <IconButton size="small" onClick={ctx.reload}>
                  <RefreshRoundedIcon fontSize="small" />
                </IconButton>
              }
            >
              principal
            </SectionLabel>
            {ctx.loading ? <LoadingBlock rows={4} /> : null}
            {ctx.error ? <ErrorNote message={ctx.error} onRetry={ctx.reload} /> : null}
            {whoami ? (
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 3,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'linear-gradient(135deg,#7c5cff,#22d3ee)',
                      color: '#07080c',
                    }}
                  >
                    <PersonRoundedIcon />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 660, lineHeight: 1.25, fontSize: 15 }}>
                      {whoami.display_name}
                    </Typography>
                    <Mono dim sx={{ fontSize: 11.5 }}>{whoami.identity_provider}</Mono>
                  </Box>
                </Stack>
                <Divider />
                <KV label="subject" value={whoami.subject} />
                <KV label="roles" value={(whoami.roles ?? []).join(', ') || '—'} />
                <KV label="scopes" value={(whoami.scopes ?? []).join(', ') || 'none'} />
              </Stack>
            ) : null}
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Panel sx={{ height: '100%' }}>
            <SectionLabel
              right={
                <Button
                  size="small"
                  endIcon={<ArrowForwardRoundedIcon />}
                  onClick={() => navigate('/gateways')}
                >
                  manage gateways
                </Button>
              }
            >
              gateway session
            </SectionLabel>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <PhaseChip phase={status?.status === 'connected' ? 'Ready' : 'Failed'} />
                <Mono sx={{ fontWeight: 640, fontSize: 14 }}>{selected?.name ?? status?.gateway ?? 'no gateway'}</Mono>
                <Chip
                  label={status?.authentication?.provider ?? 'unknown auth'}
                  size="small"
                  variant="outlined"
                  sx={{ fontFamily: MONO, fontSize: 10.5 }}
                />
                {selected?.is_remote ? (
                  <Chip label="remote" size="small" variant="outlined" sx={{ fontFamily: MONO, fontSize: 10.5 }} />
                ) : null}
              </Stack>
              {status?.error ? <ErrorNote message={status.error} onRetry={ctx.reload} /> : null}
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'action.hover',
                }}
              >
                <KV label="server" value={String(status?.server ?? '—')} />
                <Box sx={{ height: 8 }} />
                <KV label="gateway" value={String(status?.gateway ?? selected?.endpoint ?? '—')} />
                <Box sx={{ height: 8 }} />
                <KV label="version" value={`${status?.version ?? '—'} · cli ${ctx.data?.cli_version ?? '?'}`} />
                <Box sx={{ height: 8 }} />
                <KV label="binary" value={ctx.data?.binary ?? '—'} />
              </Box>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Button size="small" startIcon={<DnsRoundedIcon />} onClick={() => navigate('/gateways')}>
                  gateways
                </Button>
                <Button size="small" startIcon={<TuneRoundedIcon />} onClick={() => navigate('/profiles')}>
                  profiles
                </Button>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: MONO }}>
                  scope: {gateway || 'CLI active'} · {workspace}
                </Typography>
              </Stack>
            </Stack>
          </Panel>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Panel>
            <SectionLabel
              right={
                <IconButton size="small" onClick={workspaces.reload}>
                  <RefreshRoundedIcon fontSize="small" />
                </IconButton>
              }
            >
              workspaces
            </SectionLabel>
            {workspaces.loading ? <LoadingBlock rows={2} /> : null}
            {workspaces.error ? <Mono sx={{ color: 'error.main' }}>{workspaces.error}</Mono> : null}
            <Grid container spacing={1.25}>
              {(workspaces.data?.workspaces ?? []).map((w) => {
                const current = w.name === (scope.workspace ?? 'default');
                return (
                  <Grid key={w.name} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Box
                      sx={{
                        p: 1.4,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: current ? 'primary.main' : 'divider',
                        bgcolor: current ? 'rgba(124,92,255,0.07)' : 'transparent',
                      }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <GroupsRoundedIcon sx={{ fontSize: 17, color: current ? 'primary.main' : 'text.secondary' }} />
                        <Mono sx={{ fontWeight: 640 }}>{w.name}</Mono>
                        <Chip label={w.status} size="small" variant="outlined" sx={{ fontFamily: MONO }} />
                        <Box sx={{ flex: 1 }} />
                        <Mono dim sx={{ fontSize: 10.5 }}>
                          {w.id.slice(0, 8)}
                        </Mono>
                      </Stack>
                    </Box>
                  </Grid>
                );
              })}
            </Grid>
            <Typography sx={{ mt: 1.5, fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
              switch scope from the header — every page re-reads against the selected gateway and workspace
            </Typography>
          </Panel>
        </Grid>
      </Grid>
    </Stack>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2}>
      <Typography sx={{ width: 100, flexShrink: 0, fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
        {label}
      </Typography>
      <Mono sx={{ fontSize: 12.2, wordBreak: 'break-all' }}>{value}</Mono>
    </Stack>
  );
}
