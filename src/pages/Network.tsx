import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  IconButton,
  Link,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { useAsync } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import { cliFor } from '../lib/cli';
import {
  CommandPreview,
  EmptyState,
  ErrorNote,
  HintTip,
  LoadingBlock,
  Mono,
  PageHeader,
  Panel,
  SectionLabel,
} from '../components/ui';
import type { PortForward, ServiceEndpoint } from '../api/types';

export default function Network() {
  const { scope, toast } = useShell();
  const navigate = useNavigate();
  const [sandbox, setSandbox] = useState('');
  const [port, setPort] = useState('8080');
  const [serviceName, setServiceName] = useState('');
  const [fwdPort, setFwdPort] = useState('');
  const [fwdSandbox, setFwdSandbox] = useState('');
  const [busy, setBusy] = useState(false);

  const services = useAsync(() => api.services(scope), {
    deps: [scope.gateway, scope.workspace],
    intervalMs: 8000,
  });
  const forwards = useAsync(() => api.forwards(scope), {
    deps: [scope.gateway, scope.workspace],
    intervalMs: 8000,
  });
  const fleet = useAsync(() => api.sandboxes(scope), { deps: [scope.gateway, scope.workspace] });
  const names = (fleet.data?.sandboxes ?? []).map((s) => s.name);

  useEffect(() => {
    if (!sandbox && names.length) setSandbox(names[0]);
    if (!fwdSandbox && names.length) setFwdSandbox(names[0]);
  }, [names, sandbox, fwdSandbox]);

  // Live previews of the exact commands the two forms below will run, rebuilt
  // from the current field values. Empty until the required fields are filled,
  // so the block never shows a placeholder argument like `''`.
  const exposeCommand = useMemo(
    () =>
      sandbox && port.trim()
        ? cliFor.sandbox.exposeService(sandbox, port.trim(), scope, serviceName.trim() || undefined)
        : null,
    [sandbox, port, serviceName, scope],
  );
  const startForwardCommand = useMemo(
    () => (fwdSandbox && fwdPort.trim() ? cliFor.sandbox.startForward(fwdPort.trim(), fwdSandbox, scope) : null),
    [fwdPort, fwdSandbox, scope],
  );

  const expose = async () => {
    setBusy(true);
    try {
      const out = await api.exposeService(
        { sandbox, port, service: serviceName.trim() || undefined },
        scope,
      );
      toast('service exposed', { detail: out?.trim() });
      services.reload();
    } catch (err) {
      toast('expose failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const startForward = async () => {
    setBusy(true);
    try {
      const out = await api.startForward({ port: fwdPort, sandbox: fwdSandbox }, scope);
      toast('forward started', { detail: out?.trim() });
      forwards.reload();
    } catch (err) {
      toast('forward failed', { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const removeService = async (s: ServiceEndpoint) => {
    try {
      await api.deleteService(s.sandbox, s.service, scope);
      toast('service removed');
      services.reload();
    } catch (err) {
      toast('delete failed', { kind: 'err', detail: (err as Error).message });
    }
  };

  const stopForward = async (f: PortForward) => {
    try {
      await api.stopForward(String(f.local ?? f.target_port), String(f.sandbox ?? ''), scope);
      toast('forward stopped');
      forwards.reload();
    } catch (err) {
      toast('stop failed', { kind: 'err', detail: (err as Error).message });
    }
  };

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Network"
        description="Services publish a loopback port over the gateway; forwards bring a sandbox port back to your laptop."
      />

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Panel>
            <SectionLabel
              right={
                <HintTip title="re-read the services in this scope" command={cliFor.reads.serviceList(scope)}>
                  <IconButton size="small" onClick={services.reload}>
                    <RefreshRoundedIcon fontSize="small" />
                  </IconButton>
                </HintTip>
              }
            >
              exposed services
            </SectionLabel>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
              <TextField
                select
                label="sandbox"
                value={sandbox}
                onChange={(e) => setSandbox(e.target.value)}
                sx={{ flex: '1 1 170px', minWidth: 170 }}
                helperText={names.length ? '' : 'no sandboxes in this scope'}
              >
                {names.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                sx={{ width: 110 }}
                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
              />
              <TextField
                label="service name"
                placeholder="api"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                sx={{ flex: '1 1 150px', minWidth: 150 }}
                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
              />
              <HintTip
                title="expose this sandbox port as a service"
                command={exposeCommand}
              >
                <Button
                  variant="contained"
                  startIcon={<PublicRoundedIcon />}
                  onClick={expose}
                  disabled={busy || !sandbox || !port}
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap', alignSelf: { xs: 'stretch', md: 'center' } }}
                >
                  expose
                </Button>
              </HintTip>
            </Stack>
            <Box sx={{ mb: 2 }}>
              <CommandPreview command={exposeCommand} />
            </Box>

            <Divider sx={{ mb: 1.5 }} />

            {services.loading ? <LoadingBlock rows={3} /> : null}
            {services.error ? <ErrorNote message={services.error} onRetry={services.reload} /> : null}
            {(services.data?.services ?? []).length === 0 && !services.loading ? (
              <EmptyState
                icon={<HubRoundedIcon />}
                title="no services exposed in this scope"
                hint="pick a sandbox and a loopback port above, or run `openshell service expose <sandbox> 8080 api`"
              />
            ) : (
              <Stack spacing={1}>
                {(services.data?.services ?? []).map((s) => (
                  <Box
                    key={`${s.workspace}/${s.sandbox}/${s.service}`}
                    sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                      <Mono sx={{ fontWeight: 640, fontSize: 13.5 }}>{s.service || '(unnamed)'}</Mono>
                      <Button size="small" color="inherit" onClick={() => navigate(`/sandboxes/${s.sandbox}`)}>
                        {s.sandbox}
                      </Button>
                      <Chip label={`→ 127.0.0.1:${s.target_port}`} size="small" variant="outlined" sx={{ fontFamily: MONO }} />
                      <Chip label={s.authorization_mode} size="small" variant="outlined" sx={{ fontFamily: MONO }} />
                      <Chip label={s.workspace} size="small" variant="outlined" sx={{ fontFamily: MONO }} />
                      <Box sx={{ flex: 1 }} />
                      <HintTip
                        title={`stop exposing ${s.service || '(unnamed)'} on ${s.sandbox}`}
                        command={cliFor.sandbox.deleteService(s.sandbox, s.service, scope)}
                      >
                        <IconButton size="small" onClick={() => removeService(s)} sx={{ color: 'error.main' }}>
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </HintTip>
                    </Stack>
                    <Link
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      sx={{ fontFamily: MONO, fontSize: 12.5, mt: 0.75, display: 'inline-block' }}
                    >
                      {s.url}
                    </Link>
                  </Box>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Panel>
            <SectionLabel
              right={
                <HintTip title="re-read the tracked port forwards" command={cliFor.reads.forwardList(scope)}>
                  <IconButton size="small" onClick={forwards.reload}>
                    <RefreshRoundedIcon fontSize="small" />
                  </IconButton>
                </HintTip>
              }
            >
              port forwards
            </SectionLabel>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
              <TextField
                label="local port"
                value={fwdPort}
                onChange={(e) => setFwdPort(e.target.value)}
                sx={{ width: 120 }}
                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
              />
              <TextField
                select
                label="sandbox"
                value={fwdSandbox}
                onChange={(e) => setFwdSandbox(e.target.value)}
                sx={{ flex: '1 1 150px', minWidth: 150 }}
              >
                {names.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>
              <HintTip title="forward a sandbox port to this machine" command={startForwardCommand}>
                <Button
                  variant="contained"
                  startIcon={<AddRoundedIcon />}
                  onClick={startForward}
                  disabled={busy || !fwdPort || !fwdSandbox}
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap', alignSelf: { xs: 'stretch', sm: 'center' } }}
                >
                  start
                </Button>
              </HintTip>
            </Stack>
            <Box sx={{ mb: 2 }}>
              <CommandPreview command={startForwardCommand} />
            </Box>
            <Divider sx={{ mb: 1.5 }} />
            {forwards.loading ? <LoadingBlock rows={2} /> : null}
            {(forwards.data ?? []).length === 0 && !forwards.loading ? (
              <Mono dim>
                no tracked forwards — `openshell forward start 8080 &lt;sandbox&gt; --background`
              </Mono>
            ) : (
              <Stack spacing={1}>
                {(forwards.data ?? []).map((f, i) => (
                  <Box
                    key={i}
                    sx={{
                      p: 1.25,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                    }}
                  >
                    <Mono sx={{ fontWeight: 620 }}>{String(f.local ?? f.target_port)}</Mono>
                    <Mono dim>→ {String(f.target_host ?? '127.0.0.1')}:{String(f.target_port)}</Mono>
                    <Box sx={{ flex: 1 }} />
                    <HintTip
                      title="stop this port forward"
                      command={cliFor.sandbox.stopForward(String(f.local ?? f.target_port), String(f.sandbox ?? ''), scope)}
                    >
                      <Button size="small" color="error" startIcon={<StopRoundedIcon />} onClick={() => stopForward(f)}>
                        stop
                      </Button>
                    </HintTip>
                  </Box>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>
      </Grid>
    </Stack>
  );
}
