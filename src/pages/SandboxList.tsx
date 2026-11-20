import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, styled } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api, type CreateSandboxBody } from '../api/client';
import { useAsync, useNow } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import { allowedActions, failureHint, isLive, phaseStyle } from '../lib/phases';
import { fullTime, relativeTime } from '../lib/format';
import { cliFor } from '../lib/cli';
import {
  CommandPreview,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  HintTip,
  IconAction,
  LoadingBlock,
  Mono,
  PageHeader,
  Panel,
  PhaseChip,
} from '../components/ui';

const THIN = 3;
const Track = styled('span')(({ theme }) => ({
  height: THIN,
  display: 'block',
  marginTop: 5,
  borderRadius: 99,
  overflow: 'hidden',
  background: alpha(theme.palette.text.primary, 0.12),
}));

const FILTERS = ['all', 'live', 'stopped', 'failed'] as const;
type Filter = (typeof FILTERS)[number];

export default function SandboxList() {
  const navigate = useNavigate();
  const { scope, toast } = useShell();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const now = useNow(2000);

  const state = useAsync(() => api.sandboxes(scope), {
    deps: [scope.gateway, scope.workspace],
    intervalMs: 4000,
  });
  const templates = useAsync(() => api.templates(scope), { deps: [scope.gateway, scope.workspace] });
  const providers = useAsync(() => api.providers(scope), { deps: [scope.gateway, scope.workspace] });

  const rows = useMemo(() => {
    const all = state.data?.sandboxes ?? [];
    const q = query.trim().toLowerCase();
    return all
      .filter((s) => {
        if (q && !s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false;
        if (filter === 'live') return isLive(s);
        if (filter === 'stopped') return s.phase === 'Stopped' || s.phase === 'Suspended';
        if (filter === 'failed') return s.phase === 'Failed' || s.phase === 'Error' || Boolean(failureHint(s));
        return true;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [state.data, query, filter]);

  const runAction = async (name: string, action: 'start' | 'stop' | 'suspend' | 'resume' | 'delete') => {
    setPending(`${name}:${action}`);
    try {
      if (action === 'delete') await api.deleteSandbox(name, scope);
      else await api.sandboxAction(name, action, scope);
      toast(`${action} · ${name}`);
      state.reload();
    } catch (err) {
      toast(`${action} failed`, { kind: 'err', detail: (err as Error).message });
    } finally {
      setPending(null);
    }
  };

  useEffect(() => {
    if (!creating && params.get('new') === '1') {
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [creating, params, setParams]);

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Sandboxes"
        eyebrow={
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
            {state.data ? `${rows.length} shown of ${state.data.sandboxes.length}` : 'reading fleet…'} ·{' '}
            {scope.gateway ?? 'active gateway'} / {scope.workspace ?? 'default'}
          </Typography>
        }
        actions={
          <>
            <TextField
              placeholder="filter by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ width: { xs: '100%', sm: 230 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <SearchRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.75 }} />
                  ),
                },
              }}
            />
            <HintTip title="refresh the sandbox list" command={cliFor.sandbox.list(scope)}>
              <IconButton onClick={state.reload} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <RefreshRoundedIcon />
              </IconButton>
            </HintTip>
            <HintTip title="new sandbox">
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreating(true)}>
                new
              </Button>
            </HintTip>
          </>
        }
      />

      <Panel dense sx={{ py: 1.25 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={filter}
            onChange={(_, v) => v && setFilter(v as Filter)}
          >
            {FILTERS.map((f) => (
              <ToggleButton key={f} value={f} sx={{ textTransform: 'capitalize', fontSize: 12.5 }}>
                {f}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {state.refreshing ? (
            <Mono dim sx={{ fontSize: 11 }}>
              refreshing…
            </Mono>
          ) : (
            <Mono dim sx={{ fontSize: 11 }}>
              last read {state.lastFetch ? new Date(state.lastFetch).toLocaleTimeString() : '—'}
            </Mono>
          )}
        </Stack>
      </Panel>

      <Panel sx={{ p: 0, overflow: 'hidden' }}>
        {state.loading ? (
          <Box sx={{ p: 2.25 }}>
            <LoadingBlock rows={5} />
          </Box>
        ) : state.error ? (
          <Box sx={{ p: 2.25 }}>
            <ErrorNote
              message={state.error}
              onRetry={state.reload}
              hint="openshell sandbox list -o json — check the gateway is running with `openshell status`"
            />
          </Box>
        ) : rows.length === 0 ? (
          <EmptyState
            title={query || filter !== 'all' ? 'no sandbox matches this filter' : 'no sandboxes yet'}
            hint={
              query || filter !== 'all'
                ? 'clear the filter to see the whole fleet'
                : 'sandboxes are isolated workloads with kernel-enforced file and network policy'
            }
            action={
              <HintTip title="create sandbox">
                <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreating(true)}>
                  create sandbox
                </Button>
              </HintTip>
            }
          />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>name</TableCell>
                  <TableCell>phase</TableCell>
                  <TableCell>provisioning</TableCell>
                  <TableCell>created</TableCell>
                  <TableCell>workspace</TableCell>
                  <TableCell align="right">actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((s) => {
                  const acts = allowedActions(s);
                  const hint = failureHint(s);
                  const step = s.provisioning?.phase ?? '';
                  return (
                    <TableRow
                      key={s.id}
                      hover
                      onClick={() => navigate(`/sandboxes/${s.name}`)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <Mono sx={{ fontWeight: 620, fontSize: 13.5 }}>{s.name}</Mono>
                          {s.created_from_workload_template ? (
                            <Chip
                              label={
                                typeof s.created_from_workload_template === 'string'
                                  ? s.created_from_workload_template
                                  : s.created_from_workload_template.name
                              }
                              size="small"
                              variant="outlined"
                              sx={{ fontFamily: MONO, fontSize: 10 }}
                            />
                          ) : null}
                        </Stack>
                        {hint ? (
                          <Typography sx={{ fontSize: 11, color: 'warning.main', fontFamily: MONO, mt: 0.3 }}>
                            {hint}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <PhaseChip phase={s.phase} />
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.25} sx={{ minWidth: 150 }}>
                          <Mono dim sx={{ fontSize: 11.5 }}>
                            {step || '—'}
                            {s.provisioning?.driver_operation_pending ? ' · pending' : ''}
                          </Mono>
                          <Track>
                            <Box
                              component="span"
                              sx={{
                                display: 'block',
                                height: THIN,
                                borderRadius: 99,
                                width: isLive(s) || step === 'ready' ? '100%' : '28%',
                                background: `linear-gradient(90deg, ${phaseStyle(s.phase).color}, ${phaseStyle(s.phase).color}66)`,
                              }}
                            />
                          </Track>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={fullTime(s.created_at)}>
                          <Mono dim sx={{ fontSize: 12 }}>
                            {relativeTime(s.created_at, now)}
                          </Mono>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Mono dim sx={{ fontSize: 12 }}>{s.workspace}</Mono>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
                          {acts.exec ? (
                            <IconAction
                              title="open terminal"
                              color="primary"
                              onClick={() => {
                                navigate(`/sandboxes/${s.name}?tab=terminal`);
                              }}
                            >
                              <OpenInNewRoundedIcon fontSize="small" />
                            </IconAction>
                          ) : null}
                          {acts.start ? (
                            <IconAction
                              title="start (preserves workspace)"
                              command={cliFor.sandbox.action(s.name, 'start', scope)}
                              color="success"
                              disabled={pending === `${s.name}:start`}
                              onClick={() => runAction(s.name, 'start')}
                            >
                              <PlayArrowRoundedIcon fontSize="small" />
                            </IconAction>
                          ) : null}
                          {acts.resume ? (
                            <IconAction
                              title="resume from memory state"
                              command={cliFor.sandbox.action(s.name, 'resume', scope)}
                              color="success"
                              disabled={pending === `${s.name}:resume`}
                              onClick={() => runAction(s.name, 'resume')}
                            >
                              <BoltRoundedIcon fontSize="small" />
                            </IconAction>
                          ) : null}
                          {acts.suspend ? (
                            <IconAction
                              title="suspend (retain memory)"
                              command={cliFor.sandbox.action(s.name, 'suspend', scope)}
                              color="warning"
                              disabled={pending === `${s.name}:suspend`}
                              onClick={() => runAction(s.name, 'suspend')}
                            >
                              <PauseRoundedIcon fontSize="small" />
                            </IconAction>
                          ) : null}
                          {acts.stop ? (
                            <IconAction
                              title="stop (preserve workspace)"
                              command={cliFor.sandbox.action(s.name, 'stop', scope)}
                              color="warning"
                              disabled={pending === `${s.name}:stop`}
                              onClick={() => runAction(s.name, 'stop')}
                            >
                              <StopRoundedIcon fontSize="small" />
                            </IconAction>
                          ) : null}
                          <IconAction
                            title="delete sandbox"
                            command={cliFor.sandbox.remove(s.name, scope)}
                            color="error"
                            disabled={pending === `${s.name}:delete`}
                            onClick={() => setConfirmDelete(s.name)}
                          >
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          </IconAction>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Panel>

      <CreateSandboxDialog
        open={creating}
        onClose={() => setCreating(false)}
        templates={templates.data?.templates ?? []}
        providerNames={(providers.data?.providers ?? []).map((p) => p.name)}
        scope={scope}
        onCreated={(name) => {
          state.reload();
          if (name) navigate(`/sandboxes/${name}`);
        }}
        toast={toast}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`delete ${confirmDelete}?`}
        body="The sandbox and its workspace are removed. This cannot be undone from the console."
        confirmLabel="delete"
        danger
        command={confirmDelete ? cliFor.sandbox.remove(confirmDelete, scope) : null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const name = confirmDelete!;
          setConfirmDelete(null);
          runAction(name, 'delete');
        }}
      />
    </Stack>
  );
}

/** The create form, shared by `createBody` so the preview and submit cannot drift. */
type CreateForm = {
  name: string;
  mode: 'image' | 'template';
  from: string;
  template: string;
  command: string;
  cpu: string;
  memory: string;
  gpu: boolean;
  providers: string[];
  env: string;
  detach: boolean;
};

/** The exact `POST /api/sandboxes` body this dialog sends — used by submit and by the preview. */
function createBody(form: CreateForm): CreateSandboxBody {
  const body: CreateSandboxBody = {
    name: form.name.trim() || undefined,
    command: form.command.trim() || undefined,
    cpu: form.cpu.trim() || undefined,
    memory: form.memory.trim() || undefined,
    gpu: form.gpu || undefined,
    detach: form.detach || !form.command.trim(),
  };
  if (form.mode === 'image' && form.from.trim()) body.from = form.from.trim();
  if (form.mode === 'template') body.template = form.template;
  if (form.providers.length) body.providers = form.providers;
  const env = Object.fromEntries(
    form.env
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf('=');
        return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)];
      }),
  );
  if (Object.keys(env).length) body.env = env;
  return body;
}

function CreateSandboxDialog({
  open,
  onClose,
  templates,
  providerNames,
  scope,
  onCreated,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  templates: Array<{ name: string; image?: string; resources?: { cpu?: string; memory?: string; gpu?: number } }>;
  providerNames: string[];
  scope: { gateway?: string; workspace?: string };
  onCreated: (name: string | null) => void;
  toast: (t: string, o?: { kind?: 'ok' | 'err' | 'info'; detail?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CreateForm>({
    name: '',
    mode: 'image',
    from: '',
    template: '',
    command: '',
    cpu: '',
    memory: '',
    gpu: false,
    providers: [],
    env: '',
    detach: true,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const selectedTemplate = templates.find((t) => t.name === form.template);

  // The body the create call will send, and the command it maps to — rebuilt
  // from the current form so the preview follows every keystroke.
  const body = useMemo(() => createBody(form), [form]);
  const preview = useMemo(
    () =>
      cliFor.sandbox.create(
        body,
        scope,
        // The selected template's own resources: passing them is what makes the
        // derived-template detour show up when cpu / memory / gpu differ.
        form.mode === 'template' ? (selectedTemplate?.resources ?? null) : null,
      ),
    [body, scope, form.mode, selectedTemplate],
  );

  const submit = async () => {
    setBusy(true);
    try {
      const created = await api.createSandbox(body, scope);
      toast(`created ${(created as { name?: string })?.name ?? 'sandbox'}`);
      onCreated((created as { name?: string })?.name ?? (form.name.trim() || null));
      onClose();
    } catch (err) {
      toast('create failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>New sandbox</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.55, mb: 2 }}>
          <Mono>openshell sandbox create</Mono> — isolated workload, default-deny policy.
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="name"
              placeholder="auto-generated when empty"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <ToggleButtonGroup exclusive size="small" value={form.mode} onChange={(_, v) => v && set('mode', v)}>
              <ToggleButton value="image">image</ToggleButton>
              <ToggleButton value="template">template</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
          {form.mode === 'image' ? (
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="--from"
                placeholder="nvcr.io/nvidia/base/ubuntu:24.04  (or a local .tar.gz rootfs)"
                value={form.from}
                onChange={(e) => set('from', e.target.value)}
                helperText="empty uses the gateway default image"
                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
              />
            </Grid>
          ) : (
            <Grid size={{ xs: 12 }}>
              <TextField
                select
                fullWidth
                label="--template"
                value={form.template}
                onChange={(e) => {
                  const name = e.target.value;
                  set('template', name);
                  const t = templates.find((x) => x.name === name);
                  set('cpu', t?.resources?.cpu ?? '');
                  set('memory', t?.resources?.memory ?? '');
                }}
                helperText={templates.length ? '' : 'no templates registered in this scope'}
              >
                {templates.map((t) => (
                  <MenuItem key={t.name} value={t.name}>
                    {t.name} {t.image ? `· ${t.image}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          )}
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label="main process (after --)"
              placeholder="sleep 3600   ·   python -m http.server 8000"
              value={form.command}
              onChange={(e) => set('command', e.target.value)}
              helperText="empty starts a detached keep-alive sandbox"
              slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TextField
              fullWidth
              label="--cpu"
              placeholder="1"
              value={form.cpu}
              onChange={(e) => set('cpu', e.target.value)}
              helperText={form.mode === 'template' ? `baseline ${selectedTemplate?.resources?.cpu ?? '—'}` : ' '}
              slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TextField
              fullWidth
              label="--memory"
              placeholder="512Mi"
              value={form.memory}
              onChange={(e) => set('memory', e.target.value)}
              helperText={form.mode === 'template' ? `baseline ${selectedTemplate?.resources?.memory ?? '—'}` : ' '}
              slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Stack direction="row" spacing={1} sx={{ pl: 0.5, alignItems: "center" }}>
              <Switch checked={form.gpu} onChange={(e) => set('gpu', e.target.checked)} />
              <Typography sx={{ fontSize: 13 }}>
                {form.mode === 'template' && selectedTemplate?.resources?.gpu != null
                  ? `--gpu (template: ${selectedTemplate.resources.gpu})`
                  : '--gpu (driver default)'}
              </Typography>
            </Stack>
          </Grid>
          {form.mode === 'template' ? (
            <Grid size={{ xs: 12 }}>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.6 }}>
                The CLI forbids <Mono>--template</Mono> together with resource flags. Leaving the baseline unchanged
                creates straight from the template; changing cpu / memory / gpu creates a one-off derived template
                (a full copy with your resources), creates from it, then removes it. The sandbox keeps an{' '}
                <Mono>openshell.io/template-source</Mono> label pointing at the original.
              </Typography>
            </Grid>
          ) : null}
          <Grid size={{ xs: 12 }}>
            <Autocomplete
              multiple
              fullWidth
              disabled={providerNames.length === 0}
              options={providerNames}
              value={form.providers}
              onChange={(_, value) => set('providers', value.map(String))}
              renderValue={(value, getItemProps) =>
                (value as string[]).map((option, index) => (
                  <Chip
                    {...getItemProps({ index })}
                    key={option}
                    label={option}
                    size="small"
                    sx={{ fontFamily: MONO }}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="--provider"
                  placeholder={providerNames.length ? 'pick providers in this workspace' : 'none in this workspace'}
                  helperText={
                    providerNames.length
                      ? `workspace providers: ${providerNames.join(', ')} · credentials are injected as handles, never as raw values`
                      : 'create one on the Profiles page first; credentials are injected as handles, never as raw values'
                  }
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="--env (KEY=VALUE per line)"
              value={form.env}
              onChange={(e) => set('env', e.target.value)}
              helperText="non-secret values only — use providers for API keys"
              slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 12.5 } } }}
            />
          </Grid>
        </Grid>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Switch checked={form.detach} onChange={(e) => set('detach', e.target.checked)} />
          <Typography sx={{ fontSize: 13 }}>--detach (do not attach to the main process)</Typography>
        </Stack>
      </DialogContent>
      <CommandPreview command={preview} divider />
      <DialogActions sx={{ p: 2 }}>
        <Button color="inherit" onClick={onClose}>
          cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || (form.mode === 'template' && !form.template)}
        >
          {busy ? 'creating…' : 'create sandbox'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
