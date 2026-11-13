import { useMemo, useState } from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Divider,
  Grid,
  IconButton,
  Link,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { useAsync, useNow } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import { allowedActions, failureHint, phaseStyle } from '../lib/phases';
import { durationBetween, fullTime, parseGatewayTime, relativeTime } from '../lib/format';
import {
  CodeBlock,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorNote,
  LoadingBlock,
  Mono,
  Panel,
  PhaseChip,
  SectionLabel,
} from '../components/ui';
import { TerminalPanel } from '../components/Terminal';
import { LogViewer } from '../components/LogViewer';
import type { LogLine, Sandbox } from '../api/types';

const TABS = [
  { id: 'overview', label: 'overview' },
  { id: 'exec', label: 'exec' },
  { id: 'terminal', label: 'terminal' },
  { id: 'logs', label: 'logs' },
  { id: 'policy', label: 'policy' },
  { id: 'network', label: 'network' },
  { id: 'raw', label: 'raw' },
] as const;

export default function SandboxDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const { scope, toast } = useShell();
  const [params] = useSearchParams();
  const initial = TABS.some((t) => t.id === params.get('tab')) ? String(params.get('tab')) : 'overview';
  const [tab, setTab] = useState<string>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = useNow(1000);

  const state = useAsync(() => api.sandbox(name, scope), {
    deps: [name, scope.gateway, scope.workspace],
    intervalMs: 4000,
  });
  const sandbox = state.data?.sandbox as Sandbox | undefined;
  const acts = sandbox ? allowedActions(sandbox) : null;

  const act = async (action: 'start' | 'stop' | 'suspend' | 'resume' | 'delete') => {
    if (!sandbox) return;
    setPending(action);
    try {
      if (action === 'delete') {
        await api.deleteSandbox(sandbox.name, scope);
        toast(`deleted ${sandbox.name}`);
        navigate('/sandboxes');
      } else {
        const res = await api.sandboxAction(sandbox.name, action, scope);
        toast(`${action} · ${sandbox.name}`, { detail: res.output?.trim().split('\n')[0] });
        state.reload();
      }
    } catch (err) {
      toast(`${action} failed`, { kind: 'err', detail: (err as Error).message });
    } finally {
      setPending(null);
    }
  };

  if (state.loading) {
    return (
      <Panel>
        <LoadingBlock rows={6} />
      </Panel>
    );
  }
  if (state.error || !sandbox) {
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackRoundedIcon />} color="inherit" onClick={() => navigate('/sandboxes')}>
          back to sandboxes
        </Button>
        <ErrorNote
          message={state.error ?? `sandbox ${name} not found`}
          onRetry={state.reload}
          hint={`openshell sandbox get ${name} -o json`}
        />
      </Stack>
    );
  }

  const hint = failureHint(sandbox);
  const started = parseGatewayTime(sandbox.created_at);
  const ageSeconds = started ? Math.round((now - started.getTime()) / 1000) : 0;

  return (
    <Stack spacing={2.5}>
      <Breadcrumbs sx={{ fontSize: 12 }}>
        <Link component={RouterLink} to="/sandboxes" color="inherit" sx={{ fontFamily: MONO, fontSize: 12 }}>
          sandboxes
        </Link>
        <Typography sx={{ fontFamily: MONO, fontSize: 12, color: 'text.primary' }}>{sandbox.name}</Typography>
      </Breadcrumbs>

      <Grid container spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Grid size={{ xs: 12, md: 'grow' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <IconButton onClick={() => navigate('/sandboxes')} sx={{ border: '1px solid', borderColor: 'divider' }}>
              <ArrowBackRoundedIcon />
            </IconButton>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                <Typography variant="h1" sx={{ fontFamily: MONO, fontSize: { xs: 22, md: 27 } }}>
                  {sandbox.name}
                </Typography>
                <PhaseChip phase={sandbox.phase} />
              </Stack>
              <Stack direction="row" spacing={1.5} sx={{ mt: 0.25, flexWrap: "wrap" }}>
                <Mono dim sx={{ fontSize: 11.5 }}>
                  id {sandbox.id.slice(0, 8)}
                </Mono>
                <Mono dim sx={{ fontSize: 11.5 }}>
                  workspace {sandbox.workspace}
                </Mono>
                <Mono dim sx={{ fontSize: 11.5 }}>
                  rev {sandbox.resource_version}
                </Mono>
                <Mono dim sx={{ fontSize: 11.5 }}>
                  age {durationBetween(sandbox.created_at, null)}
                </Mono>
              </Stack>
            </Box>
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 'auto' }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            {acts?.exec ? (
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<TerminalRoundedIcon />}
                onClick={() => setTab('terminal')}
              >
                terminal
              </Button>
            ) : null}
            {acts?.start ? (
              <Button startIcon={<PlayArrowRoundedIcon />} onClick={() => act('start')} disabled={pending === 'start'}>
                start
              </Button>
            ) : null}
            {acts?.resume ? (
              <Button startIcon={<BoltRoundedIcon />} onClick={() => act('resume')} disabled={pending === 'resume'}>
                resume
              </Button>
            ) : null}
            {acts?.suspend ? (
              <Button startIcon={<PauseRoundedIcon />} onClick={() => act('suspend')} disabled={pending === 'suspend'}>
                suspend
              </Button>
            ) : null}
            {acts?.stop ? (
              <Button startIcon={<StopRoundedIcon />} onClick={() => act('stop')} disabled={pending === 'stop'}>
                stop
              </Button>
            ) : null}
            <IconButton onClick={state.reload} sx={{ border: '1px solid', borderColor: 'divider' }}>
              <RefreshRoundedIcon />
            </IconButton>
            <Button
              color="error"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => setConfirmDelete(true)}
            >
              delete
            </Button>
          </Stack>
        </Grid>
      </Grid>

      {hint ? (
        <Panel sx={{ borderColor: 'warning.main', bgcolor: 'rgba(242,165,60,0.06)' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'warning.main', fontWeight: 700 }}>
              why
            </Typography>
            <Mono sx={{ fontSize: 12.5 }}>{hint}</Mono>
          </Stack>
        </Panel>
      ) : null}

      <Panel sx={{ p: 0 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          {TABS.map((t) => (
            <Tab key={t.id} value={t.id} label={t.label} />
          ))}
        </Tabs>

        <Box sx={{ p: { xs: 1.75, md: 2.5 } }}>
          {tab === 'overview' ? (
            <OverviewTab sandbox={sandbox} ageSeconds={ageSeconds} now={now} scope={scope} />
          ) : null}
          {tab === 'exec' ? <ExecTab name={sandbox.name} scope={scope} toast={toast} /> : null}
          {tab === 'terminal' ? <TerminalPanel name={sandbox.name} phase={sandbox.phase} /> : null}
          {tab === 'logs' ? <LogsTab name={sandbox.name} scope={scope} /> : null}
          {tab === 'policy' ? <PolicyTab name={sandbox.name} sandbox={sandbox} scope={scope} /> : null}
          {tab === 'network' ? (
            <NetworkTab name={sandbox.name} scope={scope} services={state.data?.services?.services ?? []} toast={toast} />
          ) : null}
          {tab === 'raw' ? (
            <Stack spacing={2}>
              <SectionLabel
                right={
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<DownloadRoundedIcon />}
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(sandbox, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${sandbox.name}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    download
                  </Button>
                }
              >
                sandbox object
              </SectionLabel>
              <CodeBlock value={JSON.stringify(sandbox, null, 2)} maxHeight={620} />
            </Stack>
          ) : null}
        </Box>
      </Panel>

      <ConfirmDialog
        open={confirmDelete}
        title={`delete ${sandbox.name}?`}
        body="The sandbox and its workspace are removed."
        confirmLabel="delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          act('delete');
        }}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------- overview ---

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.4 }}>
      <Typography
        sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO, width: 132, flexShrink: 0, pt: 0.35 }}
      >
        {label}
      </Typography>
      {mono ? <Mono sx={{ fontSize: 12.5, wordBreak: 'break-all' }}>{value}</Mono> : (
        <Typography sx={{ fontSize: 12.5, wordBreak: 'break-all' }}>{value}</Typography>
      )}
    </Stack>
  );
}

function OverviewTab({
  sandbox,
  ageSeconds,
  now,
  scope,
}: {
  sandbox: Sandbox;
  ageSeconds: number;
  now: number;
  scope: { gateway?: string; workspace?: string };
}) {
  const conditions = sandbox.conditions ?? [];
  const timeline = useMemo(() => {
    const entries: Array<{ at: string | null; label: string; detail?: string }> = [
      { at: sandbox.created_at, label: 'created' },
      { at: sandbox.provisioning?.admission_start_time, label: 'admission' },
      { at: sandbox.provisioning?.configuration_change_time, label: 'configuration accepted' },
      { at: sandbox.provisioning?.preparation_deadline, label: 'preparation deadline' },
      { at: sandbox.provisioning?.timeout_time, label: 'timeout' },
      { at: sandbox.provisioning?.cleanup_completed_time as string | null, label: 'cleanup completed' },
    ];
    return entries.filter((e) => Boolean(e.at));
  }, [sandbox]);

  const ssh = useAsync(() => api.sshConfig(sandbox.name, scope), { deps: [sandbox.name] });

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Stack spacing={2.5}>
          <Panel>
            <SectionLabel>identity</SectionLabel>
            <Field label="name" value={sandbox.name} />
            <Field label="id" value={sandbox.id} />
            <Field label="workspace" value={sandbox.workspace} />
            <Field label="phase" value={phaseStyle(sandbox.phase).label} />
            <Field label="provisioning" value={sandbox.provisioning?.phase ?? '—'} />
            <Field label="created" value={`${fullTime(sandbox.created_at)}  ·  ${relativeTime(sandbox.created_at, now)}`} />
            <Field label="uptime" value={`${ageSeconds}s`} />
            <Field label="policy" value={`v${sandbox.current_policy_version} · ${sandbox.policy_source}`} />
            <Field label="restart policy" value={`${sandbox.restart_policy} · count ${sandbox.restart_count}`} />
            <Field label="exit code" value={String(sandbox.exit_code ?? 'null')} />
            <Field label="config revision" value={String(sandbox.configuration_admission?.config_revision ?? '—')} />
            <Field label="policy hash" value={sandbox.configuration_admission?.policy_hash?.slice(0, 24) ?? '—'} />
            <Field label="admission" value={sandbox.configuration_admission?.state ?? '—'} />
          </Panel>

          <Panel>
            <SectionLabel
              right={
                ssh.data ? (
                  <CopyButton
                    value={typeof ssh.data === 'string' ? ssh.data : JSON.stringify(ssh.data)}
                    label="copy ssh config"
                  />
                ) : null
              }
            >
              ssh access
            </SectionLabel>
            {ssh.loading ? <Mono dim>reading ssh-config…</Mono> : null}
            {ssh.error ? <Mono sx={{ color: 'error.main' }}>{ssh.error}</Mono> : null}
            {ssh.data ? <CodeBlock value={String(ssh.data)} maxHeight={220} /> : null}
            <Typography sx={{ mt: 1, fontSize: 11.5, color: 'text.secondary' }}>
              host key {sandbox.host_key_fingerprint}
            </Typography>
          </Panel>
        </Stack>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Stack spacing={2.5}>
          <Panel>
            <SectionLabel>conditions</SectionLabel>
            {conditions.length === 0 ? (
              <Mono dim>no conditions reported</Mono>
            ) : (
              <Stack spacing={1}>
                {conditions.map((c) => {
                  const completed =
                    c.reason === 'MainProcessCompleted' || String(sandbox.phase) === 'Completed';
                  const good = c.status === 'True' && c.type === 'Ready';
                  const bad = c.type === 'Ready' && c.status !== 'True' && !completed;
                  const color = bad ? 'error.main' : good ? 'success.main' : 'text.secondary';
                  return (
                    <Box
                      key={c.type}
                      sx={{
                        p: 1.25,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: bad ? 'error.main' : 'divider',
                        bgcolor: bad ? 'rgba(255,95,109,0.06)' : 'transparent',
                      }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <Mono sx={{ fontWeight: 620, fontSize: 13 }}>{c.type}</Mono>
                        <Chip
                          label={c.status}
                          size="small"
                          sx={{ fontFamily: MONO, fontSize: 10, color, borderColor: color }}
                          variant="outlined"
                        />
                        <Box sx={{ flex: 1 }} />
                        <Mono dim sx={{ fontSize: 10.5 }}>
                          {c.reason}
                        </Mono>
                      </Stack>
                      {c.message ? (
                        <Typography sx={{ mt: 0.5, fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
                          {c.message}
                        </Typography>
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Panel>

          <Panel>
            <SectionLabel>provisioning timeline</SectionLabel>
            {timeline.length === 0 ? (
              <Mono dim>no timestamps</Mono>
            ) : (
              <Stack  sx={{ position: 'relative', pl: 2 }}>
                <Box
                  sx={{
                    position: 'absolute',
                    left: 4,
                    top: 6,
                    bottom: 6,
                    width: 1,
                    bgcolor: 'divider',
                  }}
                />
                {timeline.map((e, i) => (
                  <Stack key={i} direction="row" spacing={1.5} sx={{ py: 0.65, position: 'relative' }}>
                    <Box
                      sx={{
                        position: 'absolute',
                        left: -2,
                        top: 10,
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        bgcolor: phaseStyle(sandbox.phase).color,
                      }}
                    />
                    <Box sx={{ pl: 1 }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 560 }}>{e.label}</Typography>
                      <Mono dim sx={{ fontSize: 11 }}>
                        {fullTime(e.at)}
                      </Mono>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            )}
          </Panel>

          <Panel>
            <SectionLabel>labels and annotations</SectionLabel>
            {Object.keys(sandbox.labels ?? {}).length === 0 &&
            Object.keys(sandbox.annotations ?? {}).length === 0 ? (
              <Mono dim>none</Mono>
            ) : (
              <Stack spacing={0.5}>
                {Object.entries(sandbox.labels ?? {}).map(([k, v]) => (
                  <Chip key={`l${k}`} label={`${k}=${v}`} size="small" variant="outlined" sx={{ fontFamily: MONO }} />
                ))}
                {Object.entries(sandbox.annotations ?? {}).map(([k, v]) => (
                  <Chip
                    key={`a${k}`}
                    label={`${k}=${v}`}
                    size="small"
                    color="secondary"
                    variant="outlined"
                    sx={{ fontFamily: MONO }}
                  />
                ))}
              </Stack>
            )}
          </Panel>
        </Stack>
      </Grid>
    </Grid>
  );
}

// -------------------------------------------------------------------- exec ---

interface HistoryItem {
  command: string;
  ok: boolean;
  exit: number;
  stdout: string;
  stderr: string;
  ms: number;
  at: number;
}

function ExecTab({
  name,
  scope,
  toast,
}: {
  name: string;
  scope: { gateway?: string; workspace?: string };
  toast: (t: string, o?: { kind?: 'ok' | 'err' | 'info'; detail?: string }) => void;
}) {
  const [command, setCommand] = useState('uname -a');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const run = async () => {
    if (!command.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.exec(name, command.trim(), scope);
      setHistory((h) => [
        {
          command: command.trim(),
          ok: res.ok,
          exit: res.exit_code,
          stdout: res.stdout,
          stderr: res.stderr,
          ms: res.duration_ms,
          at: Date.now(),
        },
        ...h,
      ]);
      if (!res.ok) toast(`exit ${res.exit_code}`, { kind: 'err', detail: res.stderr || res.stdout });
    } catch (err) {
      toast('exec failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Panel>
        <SectionLabel>openshell sandbox exec {name} -- …</SectionLabel>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            fullWidth
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="ls -la /workspace"
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
            }}
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />
          <Button variant="contained" startIcon={<PlayCircleRoundedIcon />} onClick={run} disabled={busy}>
            {busy ? 'running…' : 'run'}
          </Button>
        </Stack>
        <Typography sx={{ mt: 1, fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
          non-interactive; stdin is closed. use the terminal tab for a shell
        </Typography>
      </Panel>

      {history.length === 0 ? (
        <EmptyState title="no commands run yet" hint="results stream back from the sandbox over the gateway" />
      ) : (
        <Stack spacing={1.5}>
          {history.map((h) => (
            <Panel key={h.at} dense>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Box
                    sx={{
                      px: 0.75,
                      py: 0.2,
                      borderRadius: 1,
                      bgcolor: h.ok ? 'rgba(53,210,154,0.14)' : 'rgba(255,95,109,0.14)',
                      color: h.ok ? 'success.main' : 'error.main',
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {h.ok ? '0' : h.exit}
                  </Box>
                  <Mono sx={{ fontWeight: 600 }}>{h.command}</Mono>
                  <Box sx={{ flex: 1 }} />
                  <Mono dim sx={{ fontSize: 11 }}>
                    {h.ms}ms · {new Date(h.at).toLocaleTimeString()}
                  </Mono>
                </Stack>
                <CodeBlock
                  value={[h.stdout, h.stderr].filter(Boolean).join('\n') || '(no output)'}
                  maxHeight={280}
                />
              </Stack>
            </Panel>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// -------------------------------------------------------------------- logs ---

function LogsTab({ name, scope }: { name: string; scope: { gateway?: string; workspace?: string } }) {
  const [lines, setLines] = useState(400);
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [auto, setAuto] = useState(true);

  const state = useAsync(
    () => api.logs(name, { lines, level: level || undefined, source: source || undefined }, scope),
    { deps: [name, lines, level, source], intervalMs: auto ? 5000 : 0 },
  );

  const filtered = useMemo(() => {
    const all: LogLine[] = state.data?.lines ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) => l.raw.toLowerCase().includes(q));
  }, [state.data, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of state.data?.lines ?? []) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  }, [state.data]);

  const levelColor: Record<string, string> = {
    error: '#ff5f6d',
    warn: '#f2a53c',
    info: '#98a3ba',
    debug: '#5aa9ff',
    trace: '#68727f',
    other: '#68727f',
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
        <TextField
          select
          label="lines"
          value={lines}
          onChange={(e) => setLines(Number(e.target.value))}
          sx={{ width: 120 }}
        >
          {[100, 400, 1000, 3000, 5000].map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
        <ToggleButtonGroup exclusive size="small" value={level} onChange={(_, v) => setLevel(v ?? '')}>
          {['', 'error', 'warn', 'info', 'debug', 'trace'].map((l) => (
            <ToggleButton key={l || 'any'} value={l} sx={{ fontSize: 12 }}>
              {l || 'any level'}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup exclusive size="small" value={source} onChange={(_, v) => setSource(v ?? '')}>
          {[
            ['', 'all sources'],
            ['sandbox', 'sandbox'],
            ['gateway', 'gateway'],
          ].map(([v, label]) => (
            <ToggleButton key={v || 'all'} value={v} sx={{ fontSize: 12 }}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TextField
          placeholder="grep"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
          slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
        />
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <Button
            size="small"
            variant={auto ? 'contained' : 'outlined'}
            color={auto ? 'primary' : 'inherit'}
            onClick={() => setAuto(!auto)}
          >
            {auto ? 'auto' : 'paused'}
          </Button>
          <IconButton onClick={state.reload} sx={{ border: '1px solid', borderColor: 'divider' }}>
            <RefreshRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      <Panel dense>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
          {Object.entries(levelColor).map(([lvl, color]) => (
            <Stack key={lvl} direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 7, height: 7, borderRadius: 0.5, bgcolor: color }} />
              <Mono dim sx={{ fontSize: 11 }}>
                {lvl} {counts[lvl] ?? 0}
              </Mono>
            </Stack>
          ))}
          <Box sx={{ flex: 1 }} />
          <Mono dim sx={{ fontSize: 11 }}>
            {filtered.length} lines · openshell logs {name} -n {lines}
          </Mono>
        </Stack>
      </Panel>

      {state.error ? <ErrorNote message={state.error} onRetry={state.reload} /> : null}
      <LogViewer lines={filtered} />
    </Stack>
  );
}

// ------------------------------------------------------------------ policy ---

function PolicyTab({
  name,
  sandbox,
  scope,
}: {
  name: string;
  sandbox: Sandbox;
  scope: { gateway?: string; workspace?: string };
}) {
  const history = useAsync(() => api.policyHistory(name, scope), { deps: [name] });
  const fs = sandbox.policy?.filesystem_policy;

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel>
          <SectionLabel>filesystem</SectionLabel>
          <Stack spacing={1.5}>
            <div>
              <Typography sx={{ fontSize: 11, color: 'success.main', fontFamily: MONO, mb: 0.5 }}>
                read-write
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                {(fs?.read_write ?? []).map((p) => (
                  <Chip key={p} label={p} size="small" sx={{ fontFamily: MONO }} color="success" variant="outlined" />
                ))}
              </Stack>
            </div>
            <div>
              <Typography sx={{ fontSize: 11, color: 'info.main', fontFamily: MONO, mb: 0.5 }}>
                read-only
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                {(fs?.read_only ?? []).map((p) => (
                  <Chip key={p} label={p} size="small" sx={{ fontFamily: MONO }} color="info" variant="outlined" />
                ))}
              </Stack>
            </div>
            <Field label="include workdir" value={String(fs?.include_workdir ?? false)} />
            <Field label="landlock" value={sandbox.policy?.landlock?.compatibility ?? '—'} />
            <Field label="source" value={sandbox.policy_source} />
            <Field label="version" value={`v${sandbox.current_policy_version}`} />
          </Stack>
        </Panel>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel>
          <SectionLabel>policy revisions</SectionLabel>
          {history.loading ? <LoadingBlock rows={3} /> : null}
          {history.error ? <Mono sx={{ color: 'error.main' }}>{history.error}</Mono> : null}
          {(history.data?.revisions ?? []).length === 0 ? (
            <EmptyState title="no revision history" hint={`openshell policy list ${name}`} />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>rev</TableCell>
                  <TableCell>source</TableCell>
                  <TableCell>hash</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(history.data?.revisions ?? []).map((r, i) => (
                  <TableRow key={i} hover>
                    <TableCell>
                      <Mono>v{String(r.version)}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono dim>{String(r.policy_source ?? '—')}</Mono>
                    </TableCell>
                    <TableCell>
                      <Tooltip title={String(r.hash ?? '')}>
                        <Mono dim>{String(r.hash ?? '—').slice(0, 16)}</Mono>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </Grid>
    </Grid>
  );
}

// ----------------------------------------------------------------- network ---

function NetworkTab({
  name,
  scope,
  services,
  toast,
}: {
  name: string;
  scope: { gateway?: string; workspace?: string };
  services: Array<{ service: string; target_port: number; url: string; authorization_mode: string }>;
  toast: (t: string, o?: { kind?: 'ok' | 'err' | 'info'; detail?: string }) => void;
}) {
  const [port, setPort] = useState('8080');
  const [service, setService] = useState('');
  const [busy, setBusy] = useState(false);
  const forwards = useAsync(() => api.forwards(scope), { deps: [scope.gateway, scope.workspace] });

  const expose = async () => {
    setBusy(true);
    try {
      const out = await api.exposeService({ sandbox: name, port, service: service.trim() || undefined }, scope);
      toast('service exposed', { detail: out?.trim() });
      setService('');
      window.setTimeout(() => {
        forwards.reload();
      }, 300);
    } catch (err) {
      toast('expose failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const mine = (forwards.data ?? []).filter((f) => !f.sandbox || String(f.sandbox) === name);

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel>
          <SectionLabel>exposed http services</SectionLabel>
          <Stack spacing={1.25}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField label="loopback port" value={port} onChange={(e) => setPort(e.target.value)} sx={{ width: 140 }} />
              <TextField
                fullWidth
                label="service name (optional)"
                value={service}
                onChange={(e) => setService(e.target.value)}
                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
              />
              <Button variant="contained" onClick={expose} disabled={busy}>
                expose
              </Button>
            </Stack>
            <Divider />
            {services.length === 0 ? (
              <Mono dim>nothing exposed yet</Mono>
            ) : (
              services.map((s) => (
                <Box
                  key={`${s.service}-${s.target_port}`}
                  sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
                >
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Mono sx={{ fontWeight: 620 }}>{s.service || '(unnamed)'}</Mono>
                      <Chip label={`:${s.target_port}`} size="small" sx={{ fontFamily: MONO }} variant="outlined" />
                      <Chip
                        label={s.authorization_mode}
                        size="small"
                        sx={{ fontFamily: MONO }}
                        variant="outlined"
                      />
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        color="error"
                        onClick={async () => {
                          try {
                            await api.deleteService(name, s.service, scope);
                            toast('service removed');
                          } catch (err) {
                            toast('delete failed', { kind: 'err', detail: (err as Error).message });
                          }
                        }}
                      >
                        remove
                      </Button>
                    </Stack>
                    <Link href={s.url} target="_blank" rel="noreferrer" sx={{ fontFamily: MONO, fontSize: 12 }}>
                      {s.url}
                    </Link>
                  </Stack>
                </Box>
              ))
            )}
          </Stack>
        </Panel>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel>
          <SectionLabel
            right={
              <Button size="small" color="inherit" onClick={forwards.reload}>
                reload
              </Button>
            }
          >
            port forwards
          </SectionLabel>
          {mine.length === 0 ? (
            <Mono dim>
              no tracked forwards — start one from the Network page, or `openshell forward start 8080 {name}
              --background`
            </Mono>
          ) : (
            <Stack spacing={1}>
              {mine.map((f, i) => (
                <Box key={i} sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Mono sx={{ fontWeight: 620 }}>{String(f.local ?? f.target_port ?? '?')}</Mono>
                    <Mono dim>→ {String(f.target_host ?? '127.0.0.1')}:{String(f.target_port ?? '?')}</Mono>
                    <Box sx={{ flex: 1 }} />
                    <Button
                      size="small"
                      color="error"
                      onClick={async () => {
                        try {
                          await api.stopForward(String(f.local ?? f.target_port), name, scope);
                          toast('forward stopped');
                          forwards.reload();
                        } catch (err) {
                          toast('stop failed', { kind: 'err', detail: (err as Error).message });
                        }
                      }}
                    >
                      stop
                    </Button>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Panel>
      </Grid>
    </Grid>
  );
}
