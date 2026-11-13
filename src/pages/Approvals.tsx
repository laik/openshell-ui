import { useMemo, useState } from 'react';
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
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import GavelRoundedIcon from '@mui/icons-material/GavelRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import LanRoundedIcon from '@mui/icons-material/LanRounded';

import { api } from '../api/client';
import { useAsync } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import type { NetworkRule, RuleHistoryEntry } from '../api/types';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  LoadingBlock,
  Mono,
  Panel,
  SectionLabel,
} from '../components/ui';

type StatusFilter = 'pending' | 'approved' | 'rejected' | '';

const TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: 'pending' },
  { value: 'approved', label: 'approved' },
  { value: 'rejected', label: 'rejected' },
  { value: '', label: 'all' },
];

export default function Approvals() {
  const { scope, toast } = useShell();
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [sandbox, setSandbox] = useState('');
  const [rejecting, setRejecting] = useState<NetworkRule | null>(null);
  const [reason, setReason] = useState('');
  const [approvingAll, setApprovingAll] = useState<string | null>(null);
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyRule, setBusyRule] = useState<string | null>(null);

  const sandboxes = useAsync(() => api.sandboxes(scope), { deps: [scope.gateway, scope.workspace] });
  const data = useAsync(
    () =>
      sandbox
        ? api.rules(sandbox, scope, status || undefined).then((c) => ({
            rules: c.rules,
            scanned: 1,
            errors: [] as Array<{ sandbox: string; error: string }>,
          }))
        : api.allRules(scope, status || undefined),
    { deps: [scope.gateway, scope.workspace, sandbox, status], intervalMs: status === 'pending' ? 20000 : 0 },
  );
  const history = useAsync(
    () => (sandbox ? api.ruleHistory(sandbox, scope) : Promise.resolve({ entries: [] as RuleHistoryEntry[] })),
    { enabled: historyOpen && Boolean(sandbox), deps: [scope.gateway, scope.workspace, sandbox, historyOpen] },
  );

  const rules = data.data?.rules ?? [];
  const pendingRules = rules.filter((r) => r.status === 'pending');
  const grouped = useMemo(() => {
    const map = new Map<string, NetworkRule[]>();
    for (const rule of rules) {
      const key = rule.sandbox ?? 'sandbox';
      const list = map.get(key) ?? [];
      list.push(rule);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);
  const securityFlagged = rules.some((r) => r.security.trim() !== '');
  const changed = () => window.dispatchEvent(new Event('openshell:rules-changed'));

  const act = async (rule: NetworkRule, action: 'approve' | 'reject', why = '') => {
    if (!rule.sandbox) return;
    setBusyRule(rule.chunk_id);
    try {
      if (action === 'approve') {
        await api.approveRule(rule.sandbox, rule.chunk_id, scope);
        toast(`approved ${rule.name || rule.chunk_id.slice(0, 8)}`, { detail: rule.sandbox });
      } else {
        await api.rejectRule(rule.sandbox, rule.chunk_id, why, scope);
        toast(`rejected ${rule.name || rule.chunk_id.slice(0, 8)}`, { detail: rule.sandbox });
      }
      setRejecting(null);
      setReason('');
      data.reload();
      changed();
    } catch (err) {
      toast(`${action} failed`, { kind: 'err', detail: (err as Error).message });
    } finally {
      setBusyRule(null);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-end' } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h2">Approvals</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontFamily: MONO, mt: 0.4 }}>
            the gateway proposes network rules when a sandbox is denied; approve the ones the workload needs
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {sandbox ? (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<HistoryRoundedIcon />}
              onClick={() => setHistoryOpen(true)}
            >
              history
            </Button>
          ) : null}
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<DeleteSweepRoundedIcon />}
            disabled={!sandbox || pendingRules.length === 0}
            onClick={() => setClearing(true)}
          >
            clear pending
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<DoneAllRoundedIcon />}
            disabled={!sandbox || pendingRules.length === 0}
            onClick={() => {
              setIncludeFlagged(false);
              setApprovingAll(sandbox);
            }}
          >
            approve all
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<RefreshRoundedIcon />}
            onClick={data.reload}
          >
            refresh
          </Button>
        </Stack>
      </Stack>

      <Panel dense>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {TABS.map((tab) => (
              <Button
                key={tab.value || 'all'}
                size="small"
                onClick={() => setStatus(tab.value)}
                variant={status === tab.value ? 'contained' : 'text'}
                color={status === tab.value ? 'primary' : 'inherit'}
                sx={{ fontFamily: MONO, fontSize: 12 }}
              >
                {tab.label}
              </Button>
            ))}
          </Stack>
          <Box sx={{ flex: 1 }} />
          <TextField
            select
            size="small"
            label="sandbox"
            value={sandbox}
            onChange={(e) => setSandbox(e.target.value)}
            sx={{ minWidth: 230 }}
            slotProps={{ input: { style: { fontFamily: MONO } } }}
          >
            <MenuItem value="">all live sandboxes</MenuItem>
            {(sandboxes.data?.sandboxes ?? []).map((s) => (
              <MenuItem key={s.id} value={s.name} sx={{ fontFamily: MONO }}>
                {s.name} · {s.phase}
              </MenuItem>
            ))}
          </TextField>
          {status === 'pending' ? (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <CircularProgress size={13} />
              <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                auto-refresh 20s
              </Typography>
            </Stack>
          ) : null}
        </Stack>
      </Panel>

      {data.error ? <ErrorNote message={data.error} onRetry={data.reload} /> : null}
      {data.loading ? <LoadingBlock rows={4} /> : null}

      {!data.loading && rules.length === 0 && !data.error ? (
        <Panel>
          <EmptyState
            icon={<GavelRoundedIcon />}
            title={status === 'pending' ? 'no pending rules' : `no ${status || ''} rules`}
            hint={
              sandbox
                ? 'Denied connections from this sandbox will appear here as draft rules.'
                : 'Pick a sandbox or wait for a sandbox to be denied a connection. The gateway proposes rules automatically.'
            }
          />
        </Panel>
      ) : null}

      {data.data?.errors?.length ? (
        <Panel dense>
          <SectionLabel>partial scan</SectionLabel>
          <Stack spacing={0.5}>
            {data.data.errors.map((e) => (
              <Mono key={e.sandbox} dim sx={{ fontSize: 11.5 }}>
                {e.sandbox}: {e.error}
              </Mono>
            ))}
          </Stack>
        </Panel>
      ) : null}

      <Grid container spacing={2}>
        {grouped.map(([sandboxName, list]) => (
          <Grid key={sandboxName} size={{ xs: 12, xl: 6 }}>
            <Panel>
              <SectionLabel
                right={
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Chip size="small" label={`${list.length} rule${list.length === 1 ? '' : 's'}`} variant="outlined" />
                    {list.some((r) => r.status === 'pending') ? (
                      <Button
                        size="small"
                        startIcon={<DoneAllRoundedIcon />}
                        onClick={() => {
                          setSandbox(sandboxName);
                          setIncludeFlagged(false);
                          setApprovingAll(sandboxName);
                        }}
                      >
                        approve all
                      </Button>
                    ) : null}
                  </Stack>
                }
              >
                {sandboxName}
              </SectionLabel>
              <Stack spacing={1.25}>
                {list.map((rule) => (
                  <RuleCard
                    key={`${rule.sandbox}-${rule.chunk_id}`}
                    rule={rule}
                    busy={busyRule === rule.chunk_id}
                    onApprove={() => act(rule, 'approve')}
                    onReject={() => {
                      setRejecting(rule);
                      setReason('');
                    }}
                  />
                ))}
              </Stack>
            </Panel>
          </Grid>
        ))}
      </Grid>

      <Dialog open={Boolean(rejecting)} onClose={() => setRejecting(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Reject rule</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              <Mono>{rejecting?.name || rejecting?.chunk_id}</Mono> will not be added to the sandbox policy.
            </Typography>
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={2}
              label="reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 1 }}>
          <Button color="inherit" onClick={() => setRejecting(null)}>
            cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={Boolean(busyRule)}
            onClick={() => rejecting && act(rejecting, 'reject', reason.trim())}
          >
            reject rule
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(approvingAll)}
        title={`Approve all pending rules${approvingAll ? ` on ${approvingAll}` : ''}?`}
        body={
          <Stack spacing={1.2}>
            <Typography sx={{ fontSize: 13 }}>
              Every pending draft rule on this sandbox is added to its effective policy.
            </Typography>
            <FormControlLabel
              control={<Checkbox checked={includeFlagged} onChange={(e) => setIncludeFlagged(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5 }}>also approve security-flagged rules</Typography>}
            />
            {securityFlagged && !includeFlagged ? (
              <Typography sx={{ fontSize: 11.5, color: 'warning.main', fontFamily: MONO }}>
                some rules carry security findings and stay pending
              </Typography>
            ) : null}
          </Stack>
        }
        confirmLabel="approve all"
        onCancel={() => setApprovingAll(null)}
        onConfirm={async () => {
          const name = approvingAll;
          setApprovingAll(null);
          if (!name) return;
          try {
            const out = await api.approveAllRules(name, includeFlagged, scope);
            toast('rules approved', { detail: out.trim() });
            data.reload();
            changed();
          } catch (err) {
            toast('approve-all failed', { kind: 'err', detail: (err as Error).message });
          }
        }}
      />

      <ConfirmDialog
        open={clearing}
        title="Clear all pending rules?"
        body={
          <Typography sx={{ fontSize: 13 }}>
            Pending drafts for <Mono>{sandbox}</Mono> are discarded. Denied connections will simply be proposed
            again if the workload retries.
          </Typography>
        }
        confirmLabel="clear pending"
        danger
        onCancel={() => setClearing(false)}
        onConfirm={async () => {
          setClearing(false);
          try {
            await api.clearRules(sandbox, scope);
            toast('pending rules cleared', { detail: sandbox });
            data.reload();
            changed();
          } catch (err) {
            toast('clear failed', { kind: 'err', detail: (err as Error).message });
          }
        }}
      />

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Rule history · {sandbox}</DialogTitle>
        <DialogContent>
          {history.loading ? <LoadingBlock rows={4} /> : null}
          {history.error ? <ErrorNote message={history.error} onRetry={history.reload} /> : null}
          {!history.loading && (history.data?.entries.length ?? 0) === 0 ? (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', py: 2 }}>
              no history recorded for this sandbox
            </Typography>
          ) : null}
          <Stack spacing={1} sx={{ pt: 1 }}>
            {(history.data?.entries ?? []).map((entry) => (
              <Stack
                key={entry.id}
                direction="row"
                spacing={1.25}
                sx={{ alignItems: 'flex-start', p: 1, borderRadius: 1.5, bgcolor: 'action.hover' }}
              >
                <Mono dim sx={{ fontSize: 10.5, flexShrink: 0 }}>
                  {entry.time}
                </Mono>
                <Chip
                  size="small"
                  label={entry.status}
                  color={entry.status === 'approved' ? 'success' : entry.status === 'rejected' ? 'error' : 'default'}
                  variant="outlined"
                  sx={{ fontFamily: MONO, flexShrink: 0 }}
                />
                <Typography sx={{ fontSize: 12, lineHeight: 1.5 }}>{entry.message}</Typography>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setHistoryOpen(false)}>close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function RuleCard({
  rule,
  busy,
  onApprove,
  onReject,
}: {
  rule: NetworkRule;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const statusColor =
    rule.status === 'approved' ? 'success' : rule.status === 'rejected' ? 'error' : 'warning';
  return (
    <Box
      sx={{
        p: 1.4,
        borderRadius: 2,
        border: '1px solid',
        borderColor: rule.status === 'pending' ? 'warning.main' : 'divider',
        bgcolor: rule.status === 'pending' ? 'rgba(242,165,60,0.045)' : 'transparent',
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={rule.status}
            color={statusColor}
            variant="outlined"
            sx={{ fontFamily: MONO, textTransform: 'lowercase' }}
          />
          <Mono sx={{ fontWeight: 640, fontSize: 13 }}>{rule.name || '(unnamed rule)'}</Mono>
          {rule.confidence !== null ? <Confidence value={rule.confidence} /> : null}
          <Box sx={{ flex: 1 }} />
          {rule.security ? (
            <Tooltip title={rule.security}>
              <Chip
                size="small"
                icon={<SecurityRoundedIcon />}
                label="security finding"
                color="warning"
                variant="outlined"
                sx={{ fontFamily: MONO, fontSize: 10 }}
              />
            </Tooltip>
          ) : null}
        </Stack>

        {rule.rationale ? (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.55 }}>
            {rule.rationale}
          </Typography>
        ) : null}

        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
          {rule.endpoints.map((e) => (
            <Chip
              key={e.raw}
              size="small"
              icon={<LanRoundedIcon />}
              label={e.raw}
              variant="outlined"
              sx={{ fontFamily: MONO, fontSize: 10.5 }}
            />
          ))}
          {rule.binary ? (
            <Chip
              size="small"
              icon={<TerminalRoundedIcon />}
              label={rule.binary}
              variant="outlined"
              sx={{ fontFamily: MONO, fontSize: 10.5 }}
            />
          ) : null}
        </Stack>

        {rule.status === 'pending' ? (
          <>
            <Divider />
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={busy ? <CircularProgress size={13} color="inherit" /> : <CheckCircleOutlineRoundedIcon />}
                disabled={busy}
                onClick={onApprove}
              >
                approve
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<BlockRoundedIcon />}
                disabled={busy}
                onClick={onReject}
              >
                reject
              </Button>
              <Box sx={{ flex: 1 }} />
              <Mono dim sx={{ fontSize: 10 }}>
                {rule.chunk_id.slice(0, 8)} · {rule.sandbox}
              </Mono>
            </Stack>
          </>
        ) : (
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Mono dim sx={{ fontSize: 10 }}>
              {rule.chunk_id.slice(0, 8)} · {rule.sandbox}
            </Mono>
            {rule.candidate ? <Mono dim sx={{ fontSize: 10 }}>candidate {rule.candidate}</Mono> : null}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function Confidence({ value }: { value: number }) {
  const color = value >= 80 ? 'success.main' : value >= 60 ? 'warning.main' : 'text.secondary';
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 46, height: 4, borderRadius: 99, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', bgcolor: color }} />
      </Box>
      <Typography sx={{ fontSize: 10, fontFamily: MONO, color }}>{value}%</Typography>
    </Stack>
  );
}
