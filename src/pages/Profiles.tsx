import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
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
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RuleRoundedIcon from '@mui/icons-material/RuleRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import LanRoundedIcon from '@mui/icons-material/LanRounded';

import { api } from '../api/client';
import { cliFor } from '../lib/cli';
import { useAsync } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import type { ProfileCredential, ProfileEndpoint, ProviderConfig, ProviderProfile } from '../api/types';
import {
  CodeBlock,
  CommandPreview,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  HintTip,
  LoadingBlock,
  Mono,
  PageHeader,
  Panel,
  SectionLabel,
} from '../components/ui';

export default function Profiles() {
  const { scope, toast } = useShell();
  const [tab, setTab] = useState<'profiles' | 'credentials'>('profiles');
  const [importOpen, setImportOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<ProviderConfig | null>(null);

  const profiles = useAsync(() => api.profiles(scope), { deps: [scope.gateway, scope.workspace] });
  const providers = useAsync(() => api.providers(scope), { deps: [scope.gateway, scope.workspace] });

  const profileList = (profiles.data ?? []) as ProviderProfile[];
  const providerList = providers.data?.providers ?? [];

  const categories = useMemo(() => {
    const map = new Map<string, ProviderProfile[]>();
    for (const p of profileList) {
      const key = String(p.category ?? 'other');
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [profileList]);

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Profiles"
        description="Provider profiles declare endpoints and credential handles. Provider configs bind real credentials inside the gateway."
        actions={
          <>
            <HintTip
              title="re-read profiles and provider configs"
              command={[cliFor.reads.profileList(scope), cliFor.reads.providerList(scope)]}
            >
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => {
                  profiles.reload();
                  providers.reload();
                }}
              >
                refresh
              </Button>
            </HintTip>
            {tab === 'profiles' ? (
              <Button variant="contained" startIcon={<UploadFileRoundedIcon />} onClick={() => setImportOpen(true)}>
                import profile
              </Button>
            ) : (
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreateOpen(true)}>
                new provider
              </Button>
            )}
          </>
        }
      />

      <Panel dense>
        <Tabs value={tab} onChange={(_, value: 'profiles' | 'credentials') => setTab(value)}>
          <Tab value="profiles" label={`provider profiles · ${profileList.length}`} />
          <Tab value="credentials" label={`provider configs · ${providerList.length}`} />
        </Tabs>
      </Panel>

      {tab === 'profiles' ? (
        <>
          {profiles.error ? <ErrorNote message={profiles.error} onRetry={profiles.reload} /> : null}
          {profiles.loading ? <LoadingBlock rows={3} /> : null}
          {!profiles.loading && profileList.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<TuneRoundedIcon />}
                title="no provider profiles"
                hint="profiles are usually built into the gateway; import a YAML or JSON profile to add a custom one."
                action={
                  <Button variant="contained" startIcon={<UploadFileRoundedIcon />} onClick={() => setImportOpen(true)}>
                    import profile
                  </Button>
                }
              />
            </Panel>
          ) : null}
          {categories.map(([category, list]) => (
            <Box key={category}>
              <SectionLabel>{category}</SectionLabel>
              <Grid container spacing={2}>
                {list.map((profile) => (
                  <Grid key={String(profile.id ?? profile.name)} size={{ xs: 12, md: 6, xl: 4 }}>
                    <ProfileCard
                      profile={profile}
                      onOpen={() => setDetailId(String(profile.id ?? profile.name))}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </>
      ) : (
        <ProviderPanel
          providers={providerList}
          loading={providers.loading}
          error={providers.error}
          onReload={providers.reload}
          onCreate={() => setCreateOpen(true)}
          onEdit={setEditing}
          onDelete={setDeletingProvider}
        />
      )}

      <ImportProfileDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false);
          profiles.reload();
        }}
      />

      <ProfileDetailDialog
        profileId={detailId}
        onClose={() => setDetailId(null)}
        onDelete={(id) => {
          setDetailId(null);
          setDeleting(id);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete profile ${deleting}?`}
        body="Only custom profiles can be deleted. Built-in profiles are rejected by the gateway and stay listed."
        confirmLabel="delete"
        danger
        command={deleting ? cliFor.profiles.remove(deleting, scope) : undefined}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const id = deleting;
          setDeleting(null);
          if (!id) return;
          try {
            await api.deleteProfile(id, scope);
            toast(`deleted profile ${id}`);
            profiles.reload();
          } catch (err) {
            toast('delete failed', { kind: 'err', detail: (err as Error).message });
          }
        }}
      />

      <CreateProviderDialog
        open={createOpen}
        types={profileList.map((p) => String(p.id ?? p.name ?? '')).filter(Boolean)}
        onClose={() => setCreateOpen(false)}
        onDone={() => {
          setCreateOpen(false);
          providers.reload();
        }}
      />

      <EditProviderDialog
        provider={editing}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          providers.reload();
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingProvider)}
        title={`Delete provider ${deletingProvider?.name}?`}
        body="The provider config and its stored credential handles are removed from the gateway. Attached sandboxes keep running but lose access on their next credential refresh."
        confirmLabel="delete provider"
        danger
        command={deletingProvider ? cliFor.providers.remove(deletingProvider.name, scope) : undefined}
        onCancel={() => setDeletingProvider(null)}
        onConfirm={async () => {
          const target = deletingProvider;
          setDeletingProvider(null);
          if (!target) return;
          try {
            await api.deleteProvider(target.name, scope);
            toast(`deleted provider ${target.name}`);
            providers.reload();
          } catch (err) {
            toast('delete failed', { kind: 'err', detail: (err as Error).message });
          }
        }}
      />
    </Stack>
  );
}

function profileId(profile: ProviderProfile): string {
  return String(profile.id ?? profile.name ?? '');
}

function ProfileCard({ profile, onOpen }: { profile: ProviderProfile; onOpen: () => void }) {
  const credentials = (profile.credentials ?? []) as ProfileCredential[];
  const endpoints = (profile.endpoints ?? []) as ProfileEndpoint[];
  return (
    <Panel
      sx={{
        height: '100%',
        cursor: 'pointer',
        transition: 'border-color 120ms ease, transform 120ms ease',
        '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' },
      }}
    >
      <Box onClick={onOpen}>
        <Stack spacing={1.1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Box
              sx={{
                width: 30,
                height: 30,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'action.hover',
                color: 'primary.main',
                flexShrink: 0,
              }}
            >
              <KeyRoundedIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 14.5, fontWeight: 650, fontFamily: MONO, lineHeight: 1.25 }}>
                {profileId(profile)}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                {String(profile.display_name ?? '')}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            {profile.scope ? (
              <Chip size="small" label={String(profile.scope)} variant="outlined" sx={{ fontFamily: MONO }} />
            ) : null}
          </Stack>
          {profile.description ? (
            <Typography
              sx={{
                fontSize: 12,
                color: 'text.secondary',
                lineHeight: 1.5,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {String(profile.description)}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
            {credentials.slice(0, 3).map((c, i) => (
              <Chip
                key={i}
                size="small"
                label={c.env_var ?? ((c.env_vars ?? []).join(', ') || c.name || 'credential')}
                variant="outlined"
                sx={{ fontFamily: MONO, fontSize: 10.5 }}
              />
            ))}
            {credentials.length > 3 ? (
              <Chip size="small" label={`+${credentials.length - 3}`} variant="outlined" sx={{ fontFamily: MONO }} />
            ) : null}
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <LanRoundedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Mono dim sx={{ fontSize: 10.5 }}>
              {endpoints.length} endpoint{endpoints.length === 1 ? '' : 's'}
            </Mono>
            <Box sx={{ flex: 1 }} />
            <Mono dim sx={{ fontSize: 10.5 }}>
              open →
            </Mono>
          </Stack>
        </Stack>
      </Box>
    </Panel>
  );
}

function ProviderPanel({
  providers,
  loading,
  error,
  onReload,
  onCreate,
  onEdit,
  onDelete,
}: {
  providers: ProviderConfig[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onCreate: () => void;
  onEdit: (provider: ProviderConfig) => void;
  onDelete: (provider: ProviderConfig) => void;
}) {
  const { scope } = useShell();
  return (
    <Panel>
      <SectionLabel
        right={
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={onCreate}>
            new provider
          </Button>
        }
      >
        credentials bound in this workspace
      </SectionLabel>
      {error ? <ErrorNote message={error} onRetry={onReload} /> : null}
      {loading ? <LoadingBlock rows={3} /> : null}
      {!loading && providers.length === 0 && !error ? (
        <EmptyState
          icon={<LockRoundedIcon />}
          title="no provider configs yet"
          hint="a provider config lets a sandbox use a credential without ever seeing the raw secret; attach it when creating a sandbox."
          action={
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={onCreate}>
              new provider
            </Button>
          }
        />
      ) : null}
      {providers.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>name</TableCell>
              <TableCell>type</TableCell>
              <TableCell>credentials</TableCell>
              <TableCell>labels</TableCell>
              <TableCell align="right">actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((provider) => (
              <TableRow key={provider.id} hover>
                <TableCell>
                  <Mono sx={{ fontWeight: 620 }}>{provider.name}</Mono>
                </TableCell>
                <TableCell>
                  <Chip size="small" label={provider.type} variant="outlined" sx={{ fontFamily: MONO }} />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                    {(provider.credential_keys ?? []).map((key) => (
                      <Chip
                        key={key}
                        size="small"
                        label={key}
                        variant="outlined"
                        sx={{ fontFamily: MONO, fontSize: 10 }}
                      />
                    ))}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Mono dim sx={{ fontSize: 10.5 }}>
                    {Object.entries(provider.labels ?? {})
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' · ') || '—'}
                  </Mono>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" startIcon={<EditNoteRoundedIcon />} onClick={() => onEdit(provider)}>
                      update
                    </Button>
                    <HintTip title="delete provider" command={cliFor.providers.remove(provider.name, scope)}>
                      <IconButton size="small" color="error" onClick={() => onDelete(provider)}>
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </HintTip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Panel>
  );
}

function ProfileDetailDialog({
  profileId,
  onClose,
  onDelete,
}: {
  profileId: string | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const { scope } = useShell();
  const [format, setFormat] = useState<'json' | 'yaml'>('json');
  const detail = useAsync(
    () => (profileId ? api.profileDetail(profileId, scope) : Promise.resolve(null)),
    { enabled: Boolean(profileId), deps: [profileId, scope.gateway, scope.workspace] },
  );
  const exported = useAsync(
    () => (profileId ? api.profileExport(profileId, scope, format) : Promise.resolve('')),
    { enabled: Boolean(profileId), deps: [profileId, scope.gateway, scope.workspace, format] },
  );

  const text = useMemo(() => {
    if (format === 'yaml') return exported.data ?? '';
    return detail.data ? JSON.stringify(detail.data, null, 2) : '';
  }, [format, detail.data, exported.data]);

  return (
    <Dialog open={Boolean(profileId)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Mono sx={{ fontSize: 16, fontWeight: 660 }}>{profileId}</Mono>
          <Box sx={{ flex: 1 }} />
          <HintTip
            title={`export profile as ${format === 'json' ? 'yaml' : 'json'}`}
            command={
              profileId
                ? cliFor.profiles.export(profileId, scope, format === 'json' ? 'yaml' : 'json')
                : undefined
            }
          >
            <Chip
              size="small"
              label={format}
              variant="outlined"
              onClick={() => setFormat(format === 'json' ? 'yaml' : 'json')}
              sx={{ fontFamily: MONO, cursor: 'pointer' }}
            />
          </HintTip>
        </Stack>
      </DialogTitle>
      <DialogContent>
        {detail.loading || exported.loading ? <LoadingBlock rows={5} /> : null}
        {detail.error ? <ErrorNote message={detail.error} onRetry={detail.reload} /> : null}
        {exported.error ? <ErrorNote message={exported.error} onRetry={exported.reload} /> : null}
        {!detail.loading && !exported.loading ? (
          <CodeBlock value={text} maxHeight={520} />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <HintTip
          title="delete profile"
          command={profileId ? cliFor.profiles.remove(profileId, scope) : undefined}
        >
          <Button
            color="error"
            startIcon={<DeleteOutlineRoundedIcon />}
            onClick={() => profileId && onDelete(profileId)}
          >
            delete
          </Button>
        </HintTip>
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={onClose}>
          close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ImportProfileDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { scope, toast } = useShell();
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [global, setGlobal] = useState(false);
  const [lint, setLint] = useState(true);
  const [output, setOutput] = useState('');
  const [existsId, setExistsId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'lint' | 'import' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('profile.yaml');

  const body = () => ({ content: url ? undefined : content, url: url.trim() || undefined, fileName, global });
  const contentId = useMemo(() => /^id:\s*([^\s#]+)/m.exec(content)?.[1] ?? null, [content]);

  const cliOpts = useMemo(() => ({ url: url.trim() || undefined, global }), [url, global]);
  const lintCommand = useMemo(() => cliFor.profiles.lint(scope, cliOpts), [scope, cliOpts]);
  const importCommand = useMemo(() => cliFor.profiles.import(scope, cliOpts), [scope, cliOpts]);
  const importPreview = useMemo(
    () => (lint ? [lintCommand, importCommand] : [importCommand]),
    [lint, lintCommand, importCommand],
  );

  const runUpdate = async () => {
    const id = existsId ?? contentId;
    if (!id) return;
    setBusy('import');
    try {
      const out = await api.updateProfile(id, body(), scope);
      toast(`profile ${id} updated`, { detail: out.trim().slice(0, 180) });
      setExistsId(null);
      setContent('');
      setUrl('');
      onDone();
    } catch (err) {
      toast('profile update failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const run = async (action: 'lint' | 'import') => {
    setBusy(action);
    setExistsId(null);
    setOutput('');
    try {
      if (action === 'lint') {
        const out = await api.lintProfile(body(), scope);
        setOutput(out.trim() || 'profile is valid');
      } else {
        if (lint) {
          const preflight = await api.lintProfile(body(), scope);
          setOutput(preflight.trim());
        }
        const out = await api.importProfile(body(), scope);
        toast('profile imported', { detail: out.trim().slice(0, 180) });
        setContent('');
        setUrl('');
        onDone();
      }
    } catch (err) {
      const msg = (err as Error).message;
      toast(action === 'lint' ? 'lint failed' : 'import failed', { kind: 'err', detail: msg });
      const m = /profile '([^']+)' already exists/.exec(msg);
      if (action === 'import') setExistsId(m?.[1] ?? contentId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Import provider profile
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.55, mt: 0.6 }}>
          One YAML or JSON profile. Lint runs before import when enabled.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ pt: 1 }}>
          <TextField
            fullWidth
            label="profile URL (optional)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/profile.yaml"
            helperText="when set, the pasted content below is ignored"
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />
          <TextField
            fullWidth
            multiline
            minRows={8}
            maxRows={16}
            label="profile YAML or JSON"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={Boolean(url)}
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setContent(await file.text());
                setUrl('');
                e.target.value = '';
              }}
            />
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<UploadFileRoundedIcon />}
              onClick={() => fileRef.current?.click()}
            >
              choose file
            </Button>
            <Mono dim sx={{ fontSize: 10.5 }}>
              {fileName}
            </Mono>
            <Box sx={{ flex: 1 }} />
            <FormControlLabel
              control={<Checkbox checked={global} onChange={(e) => setGlobal(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5 }}>platform scope</Typography>}
            />
            <FormControlLabel
              control={<Checkbox checked={lint} onChange={(e) => setLint(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5 }}>lint first</Typography>}
            />
          </Stack>
          {output ? <CodeBlock value={output} maxHeight={160} /> : null}
          {existsId ? (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', p: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'warning.main' }}
            >
              <Typography sx={{ fontSize: 12, flex: 1, lineHeight: 1.5 }}>
                Profile <Mono>{existsId}</Mono> already exists in this scope — import refuses to overwrite it.
              </Typography>
              <HintTip title="update the existing profile" command={cliFor.profiles.update(existsId, scope, { global })}>
                <Button size="small" variant="outlined" color="inherit" disabled={Boolean(busy)} onClick={runUpdate}>
                  update it instead
                </Button>
              </HintTip>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <CommandPreview command={importPreview} divider />
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button color="inherit" onClick={onClose} disabled={Boolean(busy)}>
          cancel
        </Button>
        <HintTip title="lint this profile" command={lintCommand}>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={busy === 'lint' ? <CircularProgress size={14} /> : <RuleRoundedIcon />}
            disabled={Boolean(busy) || (!content.trim() && !url.trim())}
            onClick={() => run('lint')}
          >
            lint
          </Button>
        </HintTip>
        <HintTip title="import this profile" command={importCommand}>
          <Button
            variant="contained"
            startIcon={busy === 'import' ? <CircularProgress size={14} color="inherit" /> : <DownloadRoundedIcon />}
            disabled={Boolean(busy) || (!content.trim() && !url.trim())}
            onClick={() => run('import')}
          >
            import
          </Button>
        </HintTip>
      </DialogActions>
    </Dialog>
  );
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function CreateProviderDialog({
  open,
  types,
  onClose,
  onDone,
}: {
  open: boolean;
  types: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { scope, toast } = useShell();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [credentials, setCredentials] = useState('');
  const [config, setConfig] = useState('');
  const [labels, setLabels] = useState('');
  const [fromExisting, setFromExisting] = useState(false);
  const [fromOidcToken, setFromOidcToken] = useState(false);
  const [fromGcloudAdc, setFromGcloudAdc] = useState(false);
  const [runtimeCredentials, setRuntimeCredentials] = useState(false);
  const [globalProfile, setGlobalProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profileInfo, setProfileInfo] = useState<ProviderProfile | null>(null);

  useEffect(() => {
    const t = type.trim();
    if (!t || !types.includes(t)) {
      setProfileInfo(null);
      return;
    }
    let alive = true;
    api
      .profileDetail(t, scope)
      .then((prof) => {
        if (alive) setProfileInfo(prof);
      })
      .catch(() => {
        if (alive) setProfileInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [type, scope.gateway, scope.workspace]);

  const declaredCreds = (profileInfo?.credentials ?? []) as ProfileCredential[];
  const allowedKeys = declaredCreds.flatMap((c) => c.env_vars ?? (c.env_var ? [c.env_var] : []));
  const credKeys = credentials
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('=')[0].trim());
  const unknownKeys = profileInfo && allowedKeys.length ? credKeys.filter((k) => !allowedKeys.includes(k)) : [];
  const missingRequired = declaredCreds.filter(
    (c) => c.required && !(c.env_vars ?? []).some((k) => credKeys.includes(k)),
  );

  const createPreview = useMemo(
    () =>
      cliFor.providers.create(
        {
          name: name.trim(),
          type: type.trim(),
          credentials: parseLines(credentials),
          config: parseLines(config),
          labels: labels.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
          fromExisting,
          fromOidcToken,
          fromGcloudAdc,
          runtimeCredentials,
          globalProfile,
        },
        scope,
      ),
    [name, type, credentials, config, labels, fromExisting, fromOidcToken, fromGcloudAdc, runtimeCredentials, globalProfile, scope],
  );

  const reset = () => {
    setProfileInfo(null);
    setName('');
    setType('');
    setCredentials('');
    setConfig('');
    setLabels('');
    setFromExisting(false);
    setFromOidcToken(false);
    setFromGcloudAdc(false);
    setRuntimeCredentials(false);
    setGlobalProfile(false);
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ transition: { onExited: reset } }}
    >
      <DialogTitle sx={{ pb: 0.5 }}>
        New provider config
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.55, mt: 0.6 }}>
          Credentials are sent to the gateway and never stored in this browser.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ pt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              label="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-github"
              slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
            />
            <Autocomplete
              freeSolo
              options={types}
              value={type}
              onChange={(_, value) => setType(value ?? '')}
              onInputChange={(_, value) => setType(value)}
              sx={{ minWidth: 220 }}
              renderInput={(params) => (
                <TextField {...params} label="profile type" placeholder="github" />
              )}
            />
          </Stack>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="credentials"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            placeholder={'GITHUB_TOKEN=ghp_…\n# or just GITHUB_TOKEN to read it from the CLI environment'}
            helperText="one per line: KEY=VALUE, or KEY to read from the environment on the bridge host"
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
          />
          {profileInfo ? (
            <Stack spacing={0.75} sx={{ textAlign: 'left' }}>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, alignItems: 'center' }}>
                <Typography
                  sx={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 660, color: 'text.secondary' }}
                >
                  {type} declares
                </Typography>
                {allowedKeys.map((k) => (
                  <Chip key={k} size="small" label={k} variant="outlined" sx={{ fontFamily: MONO, fontSize: 10 }} />
                ))}
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => setCredentials(allowedKeys.map((k) => `${k}=`).join('\n'))}
                >
                  insert template
                </Button>
              </Stack>
              {unknownKeys.length ? (
                <Typography sx={{ fontSize: 11.5, color: 'error.main', lineHeight: 1.5 }}>
                  unknown credential keys: {unknownKeys.join(', ')} — the gateway only accepts the keys declared
                  by the profile.
                </Typography>
              ) : null}
              {missingRequired.length ? (
                <Typography sx={{ fontSize: 11.5, color: 'warning.main', lineHeight: 1.5 }}>
                  required credentials not set yet:{' '}
                  {missingRequired.map((c) => (c.env_vars ?? []).join('/')).join(', ')}
                </Typography>
              ) : null}
              <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.5 }}>
                {String(profileInfo.description ?? '')} · {(profileInfo.endpoints ?? []).length} endpoints ·{' '}
                {((profileInfo.binaries ?? []) as unknown[]).length} binaries
              </Typography>
            </Stack>
          ) : null}
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="config (optional)"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            placeholder="region=us-east-1"
            helperText="one KEY=VALUE per line"
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
          />
          <TextField
            fullWidth
            label="labels (optional)"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="env=dev,team=ml"
            helperText="comma or newline separated KEY=VALUE"
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {[
              ['from existing local state', fromExisting, setFromExisting],
              ['from OIDC token', fromOidcToken, setFromOidcToken],
              ['from gcloud ADC', fromGcloudAdc, setFromGcloudAdc],
              ['runtime credentials', runtimeCredentials, setRuntimeCredentials],
              ['global profile', globalProfile, setGlobalProfile],
            ].map(([label, checked, setter]) => (
              <FormControlLabel
                key={String(label)}
                control={
                  <Checkbox
                    checked={Boolean(checked)}
                    onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)}
                  />
                }
                label={<Typography sx={{ fontSize: 12 }}>{String(label)}</Typography>}
              />
            ))}
          </Box>
        </Stack>
      </DialogContent>
      <CommandPreview command={createPreview} divider />
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          cancel
        </Button>
        <HintTip title="create this provider" command={createPreview}>
          <Button
            variant="contained"
            disabled={busy || !name.trim() || !type.trim() || unknownKeys.length > 0}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <AddRoundedIcon />}
            onClick={async () => {
              setBusy(true);
              try {
                const out = await api.createProvider(
                  {
                    name: name.trim(),
                    type: type.trim(),
                    credentials: parseLines(credentials),
                    config: parseLines(config),
                    labels: labels.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
                    fromExisting,
                    fromOidcToken,
                    fromGcloudAdc,
                    runtimeCredentials,
                    globalProfile,
                  },
                  scope,
                );
                toast('provider created', { detail: out.trim().slice(0, 180) });
                onDone();
              } catch (err) {
                toast('create failed', { kind: 'err', detail: (err as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'creating…' : 'create provider'}
          </Button>
        </HintTip>
      </DialogActions>
    </Dialog>
  );
}

function EditProviderDialog({
  provider,
  onClose,
  onDone,
}: {
  provider: ProviderConfig | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { scope, toast } = useShell();
  const [credentials, setCredentials] = useState('');
  const [config, setConfig] = useState('');
  const [fromExisting, setFromExisting] = useState(false);
  const [fromOidcToken, setFromOidcToken] = useState(false);
  const [busy, setBusy] = useState(false);

  const updatePreview = useMemo(
    () =>
      provider
        ? cliFor.providers.update(
            provider.name,
            {
              credentials: parseLines(credentials),
              config: parseLines(config),
              fromExisting,
              fromOidcToken,
            },
            scope,
          )
        : null,
    [provider, credentials, config, fromExisting, fromOidcToken, scope],
  );

  return (
    <Dialog
      open={Boolean(provider)}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        transition: {
          onExited: () => {
            setCredentials('');
            setConfig('');
            setFromExisting(false);
            setFromOidcToken(false);
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.5 }}>
        Update {provider?.name}
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.55, mt: 0.6 }}>
          type <Mono>{provider?.type}</Mono> · credential keys{' '}
          <Mono>{(provider?.credential_keys ?? []).join(', ') || 'none'}</Mono>
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.75} sx={{ pt: 1 }}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            autoFocus
            label="new credentials"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            placeholder="GITHUB_TOKEN=ghp_…"
            helperText="one KEY=VALUE (or KEY from the environment) per line; empty leaves credentials untouched"
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="config updates (optional)"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            placeholder="region=us-west-2"
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12 } } }}
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            <FormControlLabel
              control={<Checkbox checked={fromExisting} onChange={(e) => setFromExisting(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12 }}>re-discover local credentials</Typography>}
            />
            <FormControlLabel
              control={<Checkbox checked={fromOidcToken} onChange={(e) => setFromOidcToken(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12 }}>use active OIDC token</Typography>}
            />
          </Box>
        </Stack>
      </DialogContent>
      <CommandPreview command={updatePreview} divider />
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          cancel
        </Button>
        <HintTip title="update this provider" command={updatePreview}>
          <Button
            variant="contained"
            disabled={busy || (!credentials.trim() && !config.trim() && !fromExisting && !fromOidcToken)}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <EditNoteRoundedIcon />}
            onClick={async () => {
              if (!provider) return;
              setBusy(true);
              try {
                const out = await api.updateProvider(
                  provider.name,
                  {
                    credentials: parseLines(credentials),
                    config: parseLines(config),
                    fromExisting,
                    fromOidcToken,
                  },
                  scope,
                );
                toast(`updated provider ${provider.name}`, { detail: out.trim().slice(0, 180) });
                onDone();
              } catch (err) {
                toast('update failed', { kind: 'err', detail: (err as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'saving…' : 'save changes'}
          </Button>
        </HintTip>
      </DialogActions>
    </Dialog>
  );
}
