import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
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
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { stringify as yamlStringify } from 'yaml';

import { api } from '../api/client';
import { useAsync, useNow } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import { allowedActions, failureHint, phaseStyle } from '../lib/phases';
import { cliFor } from '../lib/cli';
import { durationBetween, fullTime, parseGatewayTime, relativeTime } from '../lib/format';
import {
  CodeBlock,
  CommandPreview,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorNote,
  HintTip,
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
          hint={cliFor.sandbox.get(name, scope)}
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
              <HintTip title="start (preserves the workspace)" command={cliFor.sandbox.action(sandbox.name, 'start', scope)}>
                <Button startIcon={<PlayArrowRoundedIcon />} onClick={() => act('start')} disabled={pending === 'start'}>
                  start
                </Button>
              </HintTip>
            ) : null}
            {acts?.resume ? (
              <HintTip title="resume from memory state" command={cliFor.sandbox.action(sandbox.name, 'resume', scope)}>
                <Button startIcon={<BoltRoundedIcon />} onClick={() => act('resume')} disabled={pending === 'resume'}>
                  resume
                </Button>
              </HintTip>
            ) : null}
            {acts?.suspend ? (
              <HintTip title="suspend (retain memory)" command={cliFor.sandbox.action(sandbox.name, 'suspend', scope)}>
                <Button startIcon={<PauseRoundedIcon />} onClick={() => act('suspend')} disabled={pending === 'suspend'}>
                  suspend
                </Button>
              </HintTip>
            ) : null}
            {acts?.stop ? (
              <HintTip title="stop (preserve workspace)" command={cliFor.sandbox.action(sandbox.name, 'stop', scope)}>
                <Button startIcon={<StopRoundedIcon />} onClick={() => act('stop')} disabled={pending === 'stop'}>
                  stop
                </Button>
              </HintTip>
            ) : null}
            <HintTip title="re-read this sandbox" command={cliFor.sandbox.get(sandbox.name, scope)}>
              <IconButton onClick={state.reload} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <RefreshRoundedIcon />
              </IconButton>
            </HintTip>
            <HintTip title="delete this sandbox" command={cliFor.sandbox.remove(sandbox.name, scope)}>
              <Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setConfirmDelete(true)}>
                delete
              </Button>
            </HintTip>
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
            <OverviewTab sandbox={sandbox} ageSeconds={ageSeconds} now={now} scope={scope} toast={toast} />
          ) : null}
          {tab === 'exec' ? <ExecTab name={sandbox.name} scope={scope} toast={toast} /> : null}
          {tab === 'terminal' ? (
            <TerminalPanel name={sandbox.name} phase={sandbox.phase} scope={scope} />
          ) : null}
          {tab === 'logs' ? <LogsTab name={sandbox.name} scope={scope} /> : null}
          {tab === 'policy' ? (
            <PolicyTab
              name={sandbox.name}
              sandbox={sandbox}
              scope={scope}
              toast={toast}
              onChanged={() => state.reload()}
            />
          ) : null}
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
        command={cliFor.sandbox.remove(sandbox.name, scope)}
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
  toast,
}: {
  sandbox: Sandbox;
  ageSeconds: number;
  now: number;
  scope: { gateway?: string; workspace?: string };
  toast: (t: string, o?: { kind?: 'ok' | 'err' | 'info'; detail?: string }) => void;
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
  const startup = useAsync(() => api.startupCommand(sandbox.name, scope), {
    deps: [sandbox.name, scope.gateway, scope.workspace, sandbox.phase],
  });
  const settings = useAsync(() => api.settingsText(sandbox.name, scope), {
    deps: [sandbox.name, scope.gateway, scope.workspace],
  });
  const [settingKey, setSettingKey] = useState('agent_policy_proposals_enabled');
  const [settingValue, setSettingValue] = useState('true');
  const settingRows = useMemo(() => {
    const rows: Array<{ key: string; value: string; source: string }> = [];
    for (const line of String(settings.data ?? '').split('\n')) {
      const m = /^\s+([a-z_]+) = (.+)$/.exec(line);
      if (!m) continue;
      const raw = m[2].trim();
      const src = /\(([^)]*)\)\s*$/.exec(raw)?.[1] ?? '';
      rows.push({ key: m[1], value: raw.replace(/\s*\([^)]*\)\s*$/, ''), source: src });
    }
    return rows;
  }, [settings.data]);

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
            <SectionLabel
              right={
                <Mono dim sx={{ fontSize: 10.5 }}>
                  {Object.keys(sandbox.labels ?? {}).length} labels ·{' '}
                  {Object.keys(sandbox.annotations ?? {}).length} annotations
                </Mono>
              }
            >
              labels and annotations
            </SectionLabel>
            {Object.keys(sandbox.labels ?? {}).length === 0 &&
            Object.keys(sandbox.annotations ?? {}).length === 0 ? (
              <Mono dim>none</Mono>
            ) : (
              <Stack spacing={1.25} sx={{ alignItems: 'stretch', textAlign: 'left' }}>
                {(
                  [
                    ['labels', sandbox.labels ?? {}, 'primary.main'],
                    ['annotations', sandbox.annotations ?? {}, 'secondary.main'],
                  ] as Array<[string, Record<string, string>, string]>
                )
                  .filter(([, entries]) => Object.keys(entries).length > 0)
                  .map(([group, entries, color]) => (
                    <Stack key={group} spacing={0.6} sx={{ alignItems: 'flex-start', width: '100%' }}>
                      <Typography
                        sx={{
                          fontSize: 10,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          fontWeight: 660,
                          color: 'text.secondary',
                        }}
                      >
                        {group}
                      </Typography>
                      {Object.entries(entries).map(([k, v]) => (
                        <Stack
                          key={k}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'baseline', width: '100%', textAlign: 'left' }}
                        >
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              bgcolor: color,
                              flexShrink: 0,
                              transform: 'translateY(-1px)',
                            }}
                          />
                          <Mono
                            dim
                            sx={{ fontSize: 11, flexShrink: 0, maxWidth: '46%', wordBreak: 'break-all' }}
                          >
                            {k}
                          </Mono>
                          <Mono sx={{ fontSize: 11.5, flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{v}</Mono>
                        </Stack>
                      ))}
                    </Stack>
                  ))}
              </Stack>
            )}
          </Panel>

          <Panel>
            <SectionLabel
              right={
                startup.data?.pid ? (
                  <Mono dim sx={{ fontSize: 10.5 }}>
                    pid {startup.data.pid}
                  </Mono>
                ) : null
              }
            >
              startup command
            </SectionLabel>
            {startup.loading ? <LoadingBlock rows={2} /> : null}
            {startup.data?.sandbox === sandbox.name && startup.data.command ? (
              <Stack spacing={1.25} sx={{ alignItems: 'stretch', textAlign: 'left' }}>
                <CodeBlock value={startup.data.command} maxHeight={120} />
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.55 }}>
                  {startup.data.stale
                    ? 'Last observed command of this sandbox’s main process (it is not running now). The terminal’s “startup” mode attaches this process while it runs.'
                    : 'Observed from the running canonical main process of this sandbox. The terminal’s “startup” mode attaches exactly this process.'}
                </Typography>
                <CodeBlock
                  value={`openshell sandbox connect ${sandbox.name}\nopenshell sandbox exec ${sandbox.name} -- <command…>`}
                  maxHeight={90}
                />
              </Stack>
            ) : !startup.loading && startup.data?.sandbox === sandbox.name ? (
              <Stack spacing={0.75} sx={{ alignItems: 'flex-start', textAlign: 'left' }}>
                <Mono dim sx={{ fontSize: 11.5 }}>
                  {startup.data?.reason ?? startup.error ?? 'not observable'}
                </Mono>
                <CodeBlock
                  value={`openshell sandbox connect ${sandbox.name}\nopenshell sandbox exec ${sandbox.name} -- <command…>`}
                  maxHeight={90}
                />
              </Stack>
            ) : null}
          </Panel>

          <Panel>
            <SectionLabel
              right={
                <HintTip title="re-read settings" command={cliFor.sandbox.settingsGet(sandbox.name, scope)}>
                  <IconButton size="small" onClick={settings.reload}>
                    <RefreshRoundedIcon fontSize="small" />
                  </IconButton>
                </HintTip>
              }
            >
              settings
            </SectionLabel>
            <Stack spacing={0.6} sx={{ textAlign: 'left' }}>
              {settingRows.map((row) => (
                <Stack key={row.key} direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                  <Mono dim sx={{ fontSize: 11, width: 250, flexShrink: 0, wordBreak: 'break-all' }}>
                    {row.key}
                  </Mono>
                  <Mono sx={{ fontSize: 11.5, flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{row.value}</Mono>
                  {row.source ? (
                    <Chip size="small" label={row.source} variant="outlined" sx={{ fontFamily: MONO, fontSize: 9.5 }} />
                  ) : null}
                  <HintTip title="delete setting" command={cliFor.sandbox.deleteSetting(sandbox.name, row.key, scope)}>
                    <IconButton
                      size="small"
                      color="error"
                      title="delete setting"
                      onClick={async () => {
                        try {
                          await api.deleteSetting(sandbox.name, row.key, scope);
                          toast(`deleted setting ${row.key}`);
                          settings.reload();
                        } catch (err) {
                          toast('delete setting failed', { kind: 'err', detail: (err as Error).message });
                        }
                      }}
                    >
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </HintTip>
                </Stack>
              ))}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { sm: 'center' } }}>
                <TextField
                  select
                  label="key"
                  value={settingKey}
                  onChange={(e) => setSettingKey(e.target.value)}
                  sx={{ minWidth: 260 }}
                >
                  {[
                    'agent_policy_proposals_enabled',
                    'proposal_approval_mode',
                    'ocsf_json_enabled',
                    'ocsf_schema_version',
                  ].map((k) => (
                    <MenuItem key={k} value={k}>
                      {k}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="value"
                  value={settingValue}
                  onChange={(e) => setSettingValue(e.target.value)}
                  sx={{ width: 140 }}
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
                <HintTip
                  title="write this setting"
                  command={cliFor.sandbox.setSetting(sandbox.name, settingKey, settingValue, scope)}
                >
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    onClick={async () => {
                      try {
                        await api.setSetting(sandbox.name, settingKey, settingValue, scope);
                        toast(`set ${settingKey}=${settingValue}`);
                        settings.reload();
                      } catch (err) {
                        toast('set setting failed', { kind: 'err', detail: (err as Error).message });
                      }
                    }}
                  >
                    set
                  </Button>
                </HintTip>
              </Stack>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.5 }}>
                agent_policy_proposals_enabled=true makes denied connections appear under Approvals.
              </Typography>
            </Stack>
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
        <SectionLabel>run a command in {name}</SectionLabel>
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
          <HintTip title="run this command in the sandbox" command={cliFor.sandbox.exec(name, command, scope)}>
            <Button variant="contained" startIcon={<PlayCircleRoundedIcon />} onClick={run} disabled={busy}>
              {busy ? 'running…' : 'run'}
            </Button>
          </HintTip>
        </Stack>
        <Box sx={{ mt: 1.5 }}>
          <CommandPreview command={cliFor.sandbox.exec(name, command, scope)} label="openshell command" maxHeight={110} />
        </Box>
        <Typography sx={{ mt: 1, fontSize: 11.5, color: 'text.secondary', lineHeight: 1.55 }}>
          non-interactive; stdin is closed. The CLI sources the sandbox’s login/profile startup files, and lines that
          need shell syntax use the sandbox’s own{' '}
          <Typography component="span" sx={{ fontFamily: MONO, fontSize: 11.5 }}>
            $SHELL
          </Typography>
          — not a hardcoded bash.
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
          <HintTip title="read these logs again" command={cliFor.sandbox.logs(name, scope, { lines, level, source })}>
            <IconButton onClick={state.reload} sx={{ border: '1px solid', borderColor: 'divider' }}>
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </HintTip>
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
  toast,
  onChanged,
}: {
  name: string;
  sandbox: Sandbox;
  scope: { gateway?: string; workspace?: string };
  toast: (t: string, o?: { kind?: 'ok' | 'err' | 'info'; detail?: string }) => void;
  onChanged: () => void;
}) {
  const history = useAsync(() => api.policyHistory(name, scope), { deps: [name] });
  const [addOpen, setAddOpen] = useState(false);
  const fs = sandbox.policy?.filesystem_policy;
  const networkRules = Object.entries(sandbox.policy?.network_policies ?? {});
  const [removal, setRemoval] = useState<
    | { kind: 'rule'; rule: string }
    | { kind: 'endpoint'; rule: string; target: string }
    | { kind: 'matcher'; rule: string; matcher: Record<string, unknown> }
    | null
  >(null);
  const [removing, setRemoving] = useState(false);

  const removalCommand = (r: NonNullable<typeof removal>): string =>
    r.kind === 'rule'
      ? cliFor.sandbox.updatePolicy(name, { removeRules: [r.rule], wait: true }, scope)[0]
      : r.kind === 'endpoint'
        ? cliFor.sandbox.updatePolicy(name, { removeEndpoints: [r.target], wait: true }, scope)[0]
        : cliFor.sandbox.setPolicy(name, scope, true);

  const doRemoval = async () => {
    if (!removal || removing) return;
    setRemoving(true);
    try {
      if (removal.kind === 'matcher') {
        // No CLI flag removes a single matcher: rewrite the policy without it.
        const doc = JSON.parse(JSON.stringify(sandbox.policy ?? {})) as {
          network_policies?: Record<string, { endpoints?: Array<{ rules?: unknown[] }>; rules?: unknown[] }>;
        };
        const rule = doc.network_policies?.[removal.rule];
        const same = (m: unknown) => JSON.stringify(m) === JSON.stringify(removal.matcher);
        if (rule) {
          for (const e of rule.endpoints ?? []) if (Array.isArray(e.rules)) e.rules = e.rules.filter((m) => !same(m));
          if (Array.isArray(rule.rules)) rule.rules = rule.rules.filter((m) => !same(m));
        }
        await api.setPolicy(name, yamlStringify(doc), scope, true);
        toast('matcher removed from policy');
      } else if (removal.kind === 'rule') {
        await api.updatePolicy(name, { removeRules: [removal.rule], wait: true }, scope);
        toast(`removed rule ${removal.rule}`);
      } else {
        await api.updatePolicy(name, { removeEndpoints: [removal.target], wait: true }, scope);
        toast(`removed endpoint ${removal.target}`);
      }
      setRemoval(null);
      history.reload();
      onChanged();
    } catch (err) {
      toast('policy removal failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.6 }}>
          Live policy of this sandbox. Add endpoints or L7 rules incrementally, or replace the whole policy YAML.
        </Typography>
        <Button variant="contained" startIcon={<PlaylistAddRoundedIcon />} onClick={() => setAddOpen(true)}>
          add policy
        </Button>
      </Stack>
      <Grid container spacing={2.5}>
      <Grid size={12}>
        <Panel>
          <SectionLabel
            right={
              <Mono dim sx={{ fontSize: 10.5 }}>
                {networkRules.length} rule{networkRules.length === 1 ? '' : 's'}
              </Mono>
            }
          >
            network policies
          </SectionLabel>
          {networkRules.length === 0 ? (
            <EmptyState
              title="no network rules yet"
              hint="default-deny: denied connections appear under Approvals, or add endpoints here"
            />
          ) : (
            <Stack spacing={1.25} sx={{ textAlign: 'left' }}>
              {networkRules.map(([ruleName, rule]) => (
                <Box
                  key={ruleName}
                  sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Mono sx={{ fontWeight: 640, fontSize: 12.5 }}>{ruleName}</Mono>
                    {ruleName.startsWith('_provider') ? (
                      <Chip size="small" label="provider" variant="outlined" sx={{ fontFamily: MONO, fontSize: 10 }} />
                    ) : null}
                    <Box sx={{ flex: 1 }} />
                    <Mono dim sx={{ fontSize: 10.5 }}>
                      {(rule.endpoints ?? []).length} endpoint{(rule.endpoints ?? []).length === 1 ? '' : 's'}
                    </Mono>
                    <HintTip
                      title="remove the whole rule from the live policy"
                      command={cliFor.sandbox.updatePolicy(name, { removeRules: [ruleName], wait: true }, scope)}
                    >
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => setRemoval({ kind: 'rule', rule: ruleName })}
                      >
                        <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </HintTip>
                  </Stack>
                  <Stack spacing={0.6} sx={{ mt: 0.75 }}>
                    {(rule.endpoints ?? []).map((e, i) => {
                      const target = `${e.host}:${e.port ?? (e.ports ?? [])[0] ?? ''}`;
                      return (
                      <Stack
                        key={i}
                        direction="row"
                        spacing={0.6}
                        sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.5 }}
                      >
                        <Mono sx={{ fontSize: 11.5 }}>
                          {e.host}:{e.port ?? (e.ports ?? []).join(',')}
                        </Mono>
                        {[e.protocol, e.access, e.enforcement].filter(Boolean).map((tag) => (
                          <Chip
                            key={String(tag)}
                            size="small"
                            label={String(tag)}
                            variant="outlined"
                            sx={{ fontFamily: MONO, fontSize: 10 }}
                          />
                        ))}
                        {(e.rules ?? []).map((r, j) => (
                          <Chip
                            key={j}
                            size="small"
                            color={r.allow ? 'success' : 'error'}
                            variant="outlined"
                            onDelete={() =>
                              setRemoval({ kind: 'matcher', rule: ruleName, matcher: r as Record<string, unknown> })
                            }
                            label={`${r.allow ? 'allow' : 'deny'} ${r.allow?.method ?? r.deny?.method ?? '*'} ${r.allow?.path ?? r.deny?.path ?? ''}`}
                            sx={{ fontFamily: MONO, fontSize: 10 }}
                          />
                        ))}
                        <HintTip
                          title="remove this endpoint from the live policy"
                          command={cliFor.sandbox.updatePolicy(name, { removeEndpoints: [target], wait: true }, scope)}
                        >
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setRemoval({ kind: 'endpoint', rule: ruleName, target })}
                          >
                            <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </HintTip>
                      </Stack>
                      );
                    })}
                    {(rule.binaries ?? []).length ? (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                        {(rule.binaries ?? []).map((b, i) => (
                          <Chip
                            key={i}
                            size="small"
                            label={typeof b === 'string' ? b : (b.path ?? '')}
                            variant="outlined"
                            sx={{ fontFamily: MONO, fontSize: 10 }}
                          />
                        ))}
                      </Stack>
                    ) : null}
                    {(rule.rules ?? []).length ? (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                        {(rule.rules ?? []).map((r, j) => (
                          <Chip
                            key={j}
                            size="small"
                            color={r.allow ? 'success' : 'error'}
                            variant="outlined"
                            onDelete={() =>
                              setRemoval({ kind: 'matcher', rule: ruleName, matcher: r as Record<string, unknown> })
                            }
                            label={`${r.allow ? 'allow' : 'deny'} ${r.allow?.method ?? r.deny?.method ?? '*'} ${r.allow?.path ?? r.deny?.path ?? ''}`}
                            sx={{ fontFamily: MONO, fontSize: 10 }}
                          />
                        ))}
                      </Stack>
                    ) : null}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Panel>
      </Grid>
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
      <ConfirmDialog
        open={Boolean(removal)}
        title={
          removal?.kind === 'rule'
            ? `Remove rule ${removal.rule}?`
            : removal?.kind === 'endpoint'
              ? `Remove endpoint ${removal.target}?`
              : 'Remove this allow/deny matcher?'
        }
        body={
          <Stack spacing={1.25}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
              {removal?.kind === 'rule'
                ? `The whole network rule (endpoints, binaries, matchers) is removed from the live policy.${removal.rule.startsWith('_provider') ? ' It is managed by a provider attachment and may be re-added by the gateway.' : ''}`
                : removal?.kind === 'endpoint'
                  ? 'The endpoint is removed from the live policy; matchers attached to it go with it.'
                  : 'Only this matcher is removed; the rest of the policy is preserved via a full policy set.'}
            </Typography>
          </Stack>
        }
        confirmLabel={removing ? 'removing…' : 'remove'}
        danger
        command={removal ? removalCommand(removal) : null}
        onCancel={() => setRemoval(null)}
        onConfirm={doRemoval}
      />
      <PolicyDialog
        open={addOpen}
        name={name}
        sandbox={sandbox}
        scope={scope}
        onClose={() => setAddOpen(false)}
        onApplied={() => {
          history.reload();
          onChanged();
        }}
        toast={toast}
      />
    </Stack>
  );
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', '*'];

function PolicyDialog({
  open,
  name,
  sandbox,
  scope,
  onClose,
  onApplied,
  toast,
}: {
  open: boolean;
  name: string;
  sandbox: Sandbox;
  scope: { gateway?: string; workspace?: string };
  onClose: () => void;
  onApplied: () => void;
  toast: (t: string, o?: { kind?: 'ok' | 'err' | 'info'; detail?: string }) => void;
}) {
  const [mode, setMode] = useState<'update' | 'filesystem' | 'yaml'>('update');
  const [rwPaths, setRwPaths] = useState('');
  const [roPaths, setRoPaths] = useState('');
  const [includeWorkdir, setIncludeWorkdir] = useState(true);
  const [landlock, setLandlock] = useState('best_effort');
  const [preset, setPreset] = useState('custom');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [access, setAccess] = useState('read-only');
  const [protocol, setProtocol] = useState('rest');
  const [enforcement, setEnforcement] = useState('enforce');
  const [optFlags, setOptFlags] = useState<string[]>([]);
  const [allowedIp, setAllowedIp] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [binaries, setBinaries] = useState('');
  const [anyBinary, setAnyBinary] = useState(false);
  const [endpointPath, setEndpointPath] = useState('');
  const [allowRows, setAllowRows] = useState<Array<{ method: string; path: string }>>([]);
  const [dryRun, setDryRun] = useState(false);
  const [wait, setWait] = useState(true);
  const [yaml, setYaml] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('update');
    setPreset('custom');
    setHost('');
    setPort('443');
    setAccess('read-only');
    setProtocol('rest');
    setEnforcement('enforce');
    setOptFlags([]);
    setAllowedIp('');
    setRuleName('');
    setBinaries('');
    setAnyBinary(false);
    setEndpointPath('');
    setAllowRows([]);
    setDryRun(false);
    setWait(true);
    setYaml('');
    setOutput('');
    const fs0 = sandbox.policy?.filesystem_policy;
    setRwPaths((fs0?.read_write ?? []).join('\n'));
    setRoPaths((fs0?.read_only ?? []).join('\n'));
    setIncludeWorkdir(fs0?.include_workdir ?? true);
    setLandlock(sandbox.policy?.landlock?.compatibility ?? 'best_effort');
  }, [open]);

  // Entering filesystem mode reloads the lists from the live policy.
  useEffect(() => {
    if (mode !== 'filesystem') return;
    const fs0 = sandbox.policy?.filesystem_policy;
    setRwPaths((fs0?.read_write ?? []).join('\n'));
    setRoPaths((fs0?.read_only ?? []).join('\n'));
    setIncludeWorkdir(fs0?.include_workdir ?? true);
    setLandlock(sandbox.policy?.landlock?.compatibility ?? 'best_effort');
  }, [mode]);

  const binaryList = binaries.split('\n').map((s) => s.trim()).filter(Boolean);
  const allows = allowRows.filter((r) => r.path.trim());
  const options = useMemo(
    () => [...optFlags, ...(allowedIp.trim() ? [`allowed-ip=${allowedIp.trim()}`] : [])].join(','),
    [optFlags, allowedIp],
  );
  const endpointSpec = useMemo(() => {
    const parts = [host.trim(), port.trim(), access, protocol, enforcement, options];
    while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
    return parts.join(':');
  }, [host, port, access, protocol, enforcement, options]);

  const applyPreset = (value: string) => {
    setPreset(value);
    const base = { port: '443', enforcement: 'enforce', endpointPath: '', optFlags: [] as string[], allowedIp: '' };
    switch (value) {
      case 'github':
        setHost('api.github.com');
        setAccess('read-only');
        setProtocol('rest');
        setRuleName('github');
        setBinaries('/usr/bin/gh\n/usr/bin/git');
        setAnyBinary(false);
        setAllowRows([{ method: 'GET', path: '/**' }]);
        break;
      case 'openai':
        setHost('api.openai.com');
        setAccess('read-write');
        setProtocol('rest');
        setRuleName('openai');
        setBinaries('');
        setAnyBinary(true);
        setAllowRows([{ method: 'POST', path: '/v1/**' }]);
        break;
      case 'anthropic':
        setHost('api.anthropic.com');
        setAccess('read-write');
        setProtocol('rest');
        setRuleName('anthropic');
        setBinaries('');
        setAnyBinary(true);
        setAllowRows([{ method: 'POST', path: '/v1/**' }]);
        break;
      case 'websocket':
        setHost('');
        setAccess('read-write');
        setProtocol('websocket');
        setRuleName('');
        setBinaries('');
        setAnyBinary(false);
        setAllowRows([]);
        break;
      case 'https':
        setHost('');
        setAccess('read-only');
        setProtocol('rest');
        setRuleName('');
        setBinaries('');
        setAnyBinary(false);
        setAllowRows([]);
        break;
      default:
        setHost('');
        setAccess('read-only');
        setProtocol('rest');
        setRuleName('');
        setBinaries('');
        setAnyBinary(false);
        setAllowRows([]);
    }
    setPort(base.port);
    setEnforcement(base.enforcement);
    setEndpointPath(base.endpointPath);
    setOptFlags(base.optFlags);
    setAllowedIp(base.allowedIp);
  };

  /** The exact body `submit()` sends, so the preview below can never drift from it. */
  const updateBody = useMemo(
    () => ({
      addEndpoints: host.trim() && port.trim() ? [endpointSpec] : [],
      binaries: binaryList,
      ruleName: ruleName.trim() || undefined,
      anyBinary: anyBinary || undefined,
      endpointPath: allows.length ? endpointPath.trim() || undefined : undefined,
      addAllow: allows.map((r) => `${host.trim()}:${port.trim()}:${r.method}:${r.path.trim()}`),
      dryRun: dryRun || undefined,
      wait: wait || undefined,
    }),
    [host, port, endpointSpec, binaryList, ruleName, anyBinary, endpointPath, allows, dryRun, wait],
  );

  /** The bridge runs `policy set` for the YAML/filesystem tabs, `policy update` otherwise. */
  const preview = useMemo(
    () => (mode === 'yaml' || mode === 'filesystem' ? cliFor.sandbox.setPolicy(name, scope, wait) : cliFor.sandbox.updatePolicy(name, updateBody, scope)),
    [mode, name, scope, wait, updateBody],
  );

  const l7Ok = allows.length === 0 || (Boolean(ruleName.trim()) && (anyBinary || binaryList.length > 0));
  const canSubmit =
    mode === 'yaml'
      ? yaml.trim().length > 0
      : mode === 'filesystem'
        ? true
        : Boolean(host.trim() && port.trim()) && l7Ok;

  const submit = async () => {
    setBusy(true);
    setOutput('');
    try {
      if (mode === 'filesystem') {
        const list = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
        const doc = {
          ...(sandbox.policy ?? {}),
          filesystem_policy: {
            include_workdir: includeWorkdir,
            read_only: list(roPaths),
            read_write: list(rwPaths),
          },
          landlock: { compatibility: landlock },
        };
        const res = await api.setPolicy(name, yamlStringify(doc), scope, wait);
        toast('filesystem policy updated', { detail: res.output.trim().split('\n')[0] });
        onApplied();
        onClose();
      } else if (mode === 'yaml') {
        const res = await api.setPolicy(name, yaml, scope, wait);
        toast('policy replaced', { detail: res.output.trim().split('\n')[0] });
        onApplied();
        onClose();
      } else {
        const res = await api.updatePolicy(name, updateBody, scope);
        if (dryRun) {
          setOutput(res.output);
          toast('dry-run preview ready', { kind: 'info' });
        } else {
          toast('policy updated', { detail: res.output.trim().split('\n')[0] });
          onApplied();
          onClose();
        }
      }
    } catch (err) {
      toast('policy change failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Add policy · {name}
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.55, mt: 0.6 }}>
          Incremental merge with <Mono>policy update</Mono>, or full replacement with <Mono>policy set</Mono>. The
          exact command is shown at the bottom.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_, v: 'update' | 'filesystem' | 'yaml' | null) => v && setMode(v)}
          >
            <ToggleButton value="update">endpoint / rules</ToggleButton>
            <ToggleButton value="filesystem">filesystem</ToggleButton>
            <ToggleButton value="yaml">full YAML</ToggleButton>
          </ToggleButtonGroup>

          {mode === 'update' ? (
            <Grid container spacing={1.75}>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  select
                  fullWidth
                  label="preset"
                  value={preset}
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  <MenuItem value="custom">custom…</MenuItem>
                  <MenuItem value="github">GitHub (api.github.com)</MenuItem>
                  <MenuItem value="openai">OpenAI (api.openai.com)</MenuItem>
                  <MenuItem value="anthropic">Anthropic (api.anthropic.com)</MenuItem>
                  <MenuItem value="https">generic HTTPS endpoint</MenuItem>
                  <MenuItem value="websocket">generic WebSocket endpoint</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 7 }} sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.55 }}>
                  Defaults: port 443 · read-only · rest · enforce. A preset fills host, protocol, rule name, binaries
                  and allow rules.
                </Typography>
              </Grid>

              <Grid size={{ xs: 12, sm: 7 }}>
                <TextField
                  fullWidth
                  label="host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="api.github.com"
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField
                  fullWidth
                  label="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
              </Grid>
              <Grid size={{ xs: 8, sm: 3 }}>
                <TextField select fullWidth label="access" value={access} onChange={(e) => setAccess(e.target.value)}>
                  <MenuItem value="read-only">read-only</MenuItem>
                  <MenuItem value="read-write">read-write</MenuItem>
                </TextField>
              </Grid>

              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField select fullWidth label="protocol" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                  <MenuItem value="rest">rest</MenuItem>
                  <MenuItem value="graphql">graphql</MenuItem>
                  <MenuItem value="websocket">websocket</MenuItem>
                  <MenuItem value="">L4 (none)</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  select
                  fullWidth
                  label="enforcement"
                  value={enforcement}
                  onChange={(e) => setEnforcement(e.target.value)}
                >
                  <MenuItem value="enforce">enforce</MenuItem>
                  <MenuItem value="audit">audit</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  label="allowed-ip (CIDR)"
                  value={allowedIp}
                  onChange={(e) => setAllowedIp(e.target.value)}
                  placeholder="10.0.0.0/8"
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="rule name (required for L7 rules)"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="github"
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="endpoint path (L7 only)"
                  value={endpointPath}
                  onChange={(e) => setEndpointPath(e.target.value)}
                  placeholder="/graphql"
                  disabled={allows.length === 0}
                  helperText={
                    allows.length === 0
                      ? 'only usable together with an allow/deny rule'
                      : 'endpoint path; the matcher path goes in the allow rule'
                  }
                  slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                />
              </Grid>

              <Grid size={12}>
                <Typography
                  sx={{
                    fontSize: 10.5,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    fontWeight: 660,
                    color: 'text.secondary',
                    mb: 0.75,
                  }}
                >
                  endpoint options
                </Typography>
                <Grid container spacing={1}>
                  {[
                    'allow-encoded-slash',
                    'allow-uninspected-credentials',
                    'request-body-credential-rewrite',
                    'websocket-credential-rewrite',
                  ].map((flag) => (
                    <Grid key={flag} size={{ xs: 6, md: 3 }}>
                      <FormControlLabel
                        sx={{ m: 0, width: '100%' }}
                        control={
                          <Checkbox
                            checked={optFlags.includes(flag)}
                            onChange={(e) =>
                              setOptFlags((flags) =>
                                e.target.checked ? [...flags, flag] : flags.filter((f) => f !== flag),
                              )
                            }
                          />
                        }
                        label={<Typography sx={{ fontSize: 11, fontFamily: MONO }}>{flag}</Typography>}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  label="binaries (one absolute path per line)"
                  value={binaries}
                  onChange={(e) => setBinaries(e.target.value)}
                  placeholder={'/usr/bin/gh\n/usr/bin/git'}
                  helperText="for L7 rules this must be the complete binary list, or check --any-binary"
                  slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
                />
              </Grid>
              <Grid size={12}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={<Checkbox checked={anyBinary} onChange={(e) => setAnyBinary(e.target.checked)} />}
                  label={<Typography sx={{ fontSize: 12.5 }}>--any-binary (rule applies to any binary)</Typography>}
                />
              </Grid>

              <Grid size={12}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
                  <Typography
                    sx={{
                      fontSize: 10.5,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontWeight: 660,
                      color: 'text.secondary',
                    }}
                  >
                    L7 allow rules
                  </Typography>
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => setAllowRows((rows) => [...rows, { method: 'GET', path: '/**' }])}
                  >
                    add rule
                  </Button>
                </Stack>
                <Stack spacing={1}>
                  {allowRows.map((row, i) => (
                    <Grid container spacing={1} key={i} sx={{ alignItems: 'center' }}>
                      <Grid size={{ xs: 4, sm: 3 }}>
                        <TextField
                          select
                          fullWidth
                          label="method"
                          value={row.method}
                          onChange={(e) =>
                            setAllowRows((rows) => rows.map((r, j) => (j === i ? { ...r, method: e.target.value } : r)))
                          }
                        >
                          {METHODS.map((m) => (
                            <MenuItem key={m} value={m}>
                              {m}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid size={{ xs: 7, sm: 8 }}>
                        <TextField
                          fullWidth
                          label="path glob"
                          value={row.path}
                          onChange={(e) =>
                            setAllowRows((rows) => rows.map((r, j) => (j === i ? { ...r, path: e.target.value } : r)))
                          }
                          placeholder="/repos/**"
                          slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                        />
                      </Grid>
                      <Grid size={{ xs: 1 }} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setAllowRows((rows) => rows.filter((_, j) => j !== i))}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Grid>
                    </Grid>
                  ))}
                  {!l7Ok ? (
                    <Typography sx={{ fontSize: 11.5, color: 'warning.main' }}>
                      L7 rules need a rule name and either the complete binary list or --any-binary.
                    </Typography>
                  ) : null}
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={<Checkbox checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />}
                  label={<Typography sx={{ fontSize: 12.5 }}>--dry-run (preview merge only)</Typography>}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Checkbox checked={wait && !dryRun} disabled={dryRun} onChange={(e) => setWait(e.target.checked)} />
                  }
                  label={<Typography sx={{ fontSize: 12.5 }}>--wait (sandbox loads revision)</Typography>}
                />
              </Grid>
            </Grid>
          ) : mode === 'filesystem' ? (
            <Grid container spacing={1.75}>
              <Grid size={12}>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.55 }}>
                  Merges into the current policy with <Mono>policy set</Mono>; network rules and providers are
                  preserved. Paths are absolute, one per line. The gateway refuses removing protected read-only
                  paths (e.g. /usr) while the sandbox is live.
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={5}
                  label="read-write paths"
                  value={rwPaths}
                  onChange={(e) => setRwPaths(e.target.value)}
                  placeholder={'/tmp\n/dev/null'}
                  slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={5}
                  label="read-only paths"
                  value={roPaths}
                  onChange={(e) => setRoPaths(e.target.value)}
                  placeholder={'/bin\n/usr'}
                  slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Checkbox checked={includeWorkdir} onChange={(e) => setIncludeWorkdir(e.target.checked)} />
                  }
                  label={<Typography sx={{ fontSize: 12.5 }}>include workdir (read-write)</Typography>}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  fullWidth
                  label="landlock compatibility"
                  value={landlock}
                  onChange={(e) => setLandlock(e.target.value)}
                >
                  <MenuItem value="best_effort">best_effort</MenuItem>
                  <MenuItem value="hard_requirement">hard_requirement</MenuItem>
                </TextField>
              </Grid>
              <Grid size={12}>
                <CodeBlock
                  value={yamlStringify({
                    filesystem_policy: {
                      include_workdir: includeWorkdir,
                      read_only: roPaths.split('\n').map((x) => x.trim()).filter(Boolean),
                      read_write: rwPaths.split('\n').map((x) => x.trim()).filter(Boolean),
                    },
                    landlock: { compatibility: landlock },
                  })}
                  maxHeight={180}
                />
              </Grid>
            </Grid>
          ) : (
            <TextField
              fullWidth
              multiline
              minRows={10}
              maxRows={20}
              label="policy YAML"
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              placeholder={'version: 1\nnetwork_policies:\n  example:\n    endpoints:\n      - host: api.example.com\n        port: 443\n        protocol: rest\n        enforcement: enforce\n    binaries:\n      - path: /usr/bin/curl'}
              helperText="replaces the whole sandbox policy; the bridge writes it to a private temp file"
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
            />
          )}

          {output ? <CodeBlock value={output} maxHeight={220} /> : null}
        </Stack>
      </DialogContent>
      <CommandPreview command={preview} divider />
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          cancel
        </Button>
        <Button variant="contained" disabled={busy || !canSubmit} onClick={submit}>
          {busy ? 'applying…' : mode === 'yaml' ? 'replace policy' : mode === 'filesystem' ? 'apply filesystem' : dryRun ? 'preview merge' : 'apply policy'}
        </Button>
      </DialogActions>
    </Dialog>
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
              <HintTip
                title="publish this loopback port through the gateway"
                command={cliFor.sandbox.exposeService(name, port, scope, service.trim() || undefined)}
              >
                <Button variant="contained" onClick={expose} disabled={busy}>
                  expose
                </Button>
              </HintTip>
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
                      <HintTip
                        title="stop publishing this service"
                        command={cliFor.sandbox.deleteService(name, s.service, scope)}
                      >
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
                      </HintTip>
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
              <HintTip title="re-read tracked forwards" command={cliFor.reads.forwardList(scope)}>
                <Button size="small" color="inherit" onClick={forwards.reload}>
                  reload
                </Button>
              </HintTip>
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
                    <HintTip
                      title="stop this port forward"
                      command={cliFor.sandbox.stopForward(String(f.local ?? f.target_port), name, scope)}
                    >
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
                    </HintTip>
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
