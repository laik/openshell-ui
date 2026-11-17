import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { useAsync } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  LoadingBlock,
  Mono,
  PageHeader,
  Panel,
  SectionLabel,
} from '../components/ui';

export default function Templates() {
  const { scope, toast } = useShell();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const state = useAsync(() => api.templates(scope), { deps: [scope.gateway, scope.workspace] });

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="Templates"
        description="Reusable workload specs — image, resources, env — applied with sandbox create --template."
        actions={
          <>
            <IconButton onClick={state.reload} sx={{ border: '1px solid', borderColor: 'divider' }}>
              <RefreshRoundedIcon />
            </IconButton>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setOpen(true)}>
              new template
            </Button>
          </>
        }
      />

      <Panel sx={{ p: 0, overflow: 'hidden' }}>
        {state.loading ? (
          <Box sx={{ p: 2.25 }}>
            <LoadingBlock rows={3} />
          </Box>
        ) : state.error ? (
          <Box sx={{ p: 2.25 }}>
            <ErrorNote message={state.error} onRetry={state.reload} hint="openshell sandbox template list -o json" />
          </Box>
        ) : (state.data?.templates ?? []).length === 0 ? (
          <EmptyState
            icon={<LayersRoundedIcon />}
            title="no templates registered"
            hint="templates keep image and resource choices out of every create call"
            action={
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setOpen(true)}>
                create a template
              </Button>
            }
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>name</TableCell>
                <TableCell>image</TableCell>
                <TableCell>resources</TableCell>
                <TableCell>labels</TableCell>
                <TableCell align="right">actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(state.data?.templates ?? []).map((t) => {
                const resources = t.resources as
                  | { cpu?: string; memory?: string; gpu?: { count?: number } }
                  | undefined;
                return (
                  <TableRow key={t.name} hover>
                    <TableCell>
                      <Mono sx={{ fontWeight: 620 }}>{t.name}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono dim>{t.image ?? 'gateway default'}</Mono>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                        {resources?.cpu ? (
                          <Mono dim sx={{ fontSize: 11.5 }}>cpu {resources.cpu}</Mono>
                        ) : null}
                        {resources?.memory ? (
                          <Mono dim sx={{ fontSize: 11.5 }}>mem {resources.memory}</Mono>
                        ) : null}
                        {resources?.gpu?.count ? (
                          <Mono dim sx={{ fontSize: 11.5 }}>gpu {resources.gpu.count}</Mono>
                        ) : null}
                        {!resources?.cpu && !resources?.memory && !resources?.gpu?.count ? (
                          <Mono dim sx={{ fontSize: 11.5 }}>driver defaults</Mono>
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                        {Object.entries(t.labels ?? {}).length === 0 ? (
                          <Mono dim sx={{ fontSize: 11.5 }}>—</Mono>
                        ) : (
                          Object.entries(t.labels ?? {}).map(([k, v]) => (
                            <Mono key={k} dim sx={{ fontSize: 11.5 }}>
                              {k}={v}
                            </Mono>
                          ))
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
                        <Button size="small" color="inherit" onClick={() => navigate('/sandboxes?new=1')}>
                          use
                        </Button>
                        <IconButton size="small" sx={{ color: 'error.main' }} onClick={() => setConfirm(t.name)}>
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <SectionLabel>how templates are applied</SectionLabel>
        <Grid container spacing={2}>
          {[
            {
              cmd: 'openshell sandbox template create py \\\n  --image nvcr.io/nvidia/base/ubuntu:24.04 \\\n  --cpu 2 --memory 4Gi',
              note: 'register once',
            },
            {
              cmd: 'openshell sandbox create --template py --name worker',
              note: 'reuse everywhere',
            },
            {
              cmd: 'openshell sandbox template delete py',
              note: 'remove',
            },
          ].map((b) => (
            <Grid size={{ xs: 12, md: 4 }} key={b.note}>
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'rgba(0,0,0,0.28)',
                }}
              >
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO, mb: 0.75 }}>
                  {b.note}
                </Typography>
                <Mono sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{b.cmd}</Mono>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Panel>

      <TemplateDialog
        open={open}
        onClose={() => setOpen(false)}
        scope={scope}
        onDone={() => state.reload()}
        toast={toast}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={`delete template ${confirm}?`}
        body="Existing sandboxes are untouched; new sandboxes can no longer be created from it."
        confirmLabel="delete"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const name = confirm!;
          setConfirm(null);
          try {
            await api.deleteTemplate(name, scope);
            toast(`deleted template ${name}`);
            state.reload();
          } catch (err) {
            toast('delete failed', { kind: 'err', detail: (err as Error).message });
          }
        }}
      />
    </Stack>
  );
}

function TemplateDialog({
  open,
  onClose,
  scope,
  onDone,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  scope: { gateway?: string; workspace?: string };
  onDone: () => void;
  toast: (t: string, o?: { kind?: 'ok' | 'err' | 'info'; detail?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', image: '', cpu: '', memory: '' });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New template</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            fullWidth
            label="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />
          <TextField
            fullWidth
            label="--image"
            value={form.image}
            onChange={(e) => setForm({ ...form, image: e.target.value })}
            helperText="empty uses the gateway default image"
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />
          <TextField
            fullWidth
            label="--cpu"
            placeholder="2"
            value={form.cpu}
            onChange={(e) => setForm({ ...form, cpu: e.target.value })}
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />
          <TextField
            fullWidth
            label="--memory"
            placeholder="4Gi"
            value={form.memory}
            onChange={(e) => setForm({ ...form, memory: e.target.value })}
            slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button color="inherit" onClick={onClose}>
          cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || !form.name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await api.createTemplate(
                {
                  name: form.name.trim(),
                  image: form.image.trim() || undefined,
                  cpu: form.cpu.trim() || undefined,
                  memory: form.memory.trim() || undefined,
                },
                scope,
              );
              toast(`template ${form.name.trim()} created`);
              onDone();
              onClose();
            } catch (err) {
              toast('create failed', { kind: 'err', detail: (err as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'creating…' : 'create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
