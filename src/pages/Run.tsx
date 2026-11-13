import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { useAsync } from '../hooks';
import { useShell } from '../Shell';
import { MONO } from '../theme';
import type { RunResult } from '../api/types';
import { copyToClipboard } from '../lib/format';
import { EmptyState, ErrorNote, LoadingBlock, Mono, Panel, PhaseChip, SectionLabel } from '../components/ui';

interface RunRecord {
  id: number;
  sandbox: string;
  command: string;
  result: RunResult;
  at: number;
}

const EXAMPLES = [
  'pwd && id',
  'ls -la /workspace',
  'uname -a',
  'env | sort | head -40',
  'bash -lc "echo hello from $HOSTNAME"',
];

export default function Run() {
  const { scope, toast } = useShell();
  const navigate = useNavigate();
  const [sandbox, setSandbox] = useState('');
  const [command, setCommand] = useState('pwd && id');
  const [start, setStart] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [starting, setStarting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const sandboxes = useAsync(() => api.sandboxes(scope), { deps: [scope.gateway, scope.workspace] });
  const list = sandboxes.data?.sandboxes ?? [];
  const selected = useMemo(() => list.find((s) => s.name === sandbox), [list, sandbox]);

  useEffect(() => {
    if (!sandbox && list.length > 0) {
      const preferred = list.find((s) => s.phase === 'Ready' || s.phase === 'Running') ?? list[0];
      setSandbox(preferred.name);
    }
  }, [list, sandbox]);

  useEffect(() => {
    if (result && outputRef.current) outputRef.current.scrollTop = 0;
  }, [result]);

  const run = async () => {
    if (!sandbox || !command.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.run(sandbox, command, scope, start);
      setResult(res);
      setHistory((prev) =>
        [{ id: Date.now(), sandbox, command, result: res, at: Date.now() }, ...prev].slice(0, 12),
      );
      if (!res.ok) toast(`command exited ${res.exit_code}`, { kind: 'err', detail: res.stderr });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const startOnly = async () => {
    if (!selected) return;
    setStarting(true);
    try {
      if (selected.phase === 'Suspended') await api.sandboxAction(selected.name, 'resume', scope);
      else if (selected.phase === 'Stopped') await api.sandboxAction(selected.name, 'start', scope);
      toast(`${selected.name} is starting`);
      sandboxes.reload();
    } catch (err) {
      toast('could not start sandbox', { kind: 'err', detail: (err as Error).message });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-end' } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h2">Run</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontFamily: MONO, mt: 0.4 }}>
            start a sandbox if needed, then run one command through its shell and collect the exit status
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<OpenInNewRoundedIcon />}
            disabled={!selected}
            onClick={() => selected && navigate(`/sandboxes/${selected.name}`)}
          >
            open sandbox
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={starting ? <CircularProgress size={14} /> : <RestartAltRoundedIcon />}
            disabled={!selected || starting || !['Stopped', 'Suspended'].includes(selected.phase)}
            onClick={startOnly}
          >
            start only
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Panel>
            <SectionLabel>target</SectionLabel>
            {sandboxes.loading ? <LoadingBlock rows={2} /> : null}
            {sandboxes.error ? <ErrorNote message={sandboxes.error} onRetry={sandboxes.reload} /> : null}
            {!sandboxes.loading && list.length === 0 ? (
              <EmptyState
                icon={<RocketLaunchRoundedIcon />}
                title="no sandboxes"
                hint="create a sandbox first; Run starts a stopped or suspended one for you."
                action={<Button onClick={() => navigate('/sandboxes?new=1')}>new sandbox</Button>}
              />
            ) : null}
            {list.length > 0 ? (
              <Stack spacing={1.5}>
                <Autocomplete
                  options={list}
                  value={selected ?? null}
                  onChange={(_, value) => setSandbox(value?.name ?? '')}
                  getOptionLabel={(option) => option.name}
                  renderOption={(props, option) => (
                    <Box component="li" {...props} key={option.id}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
                        <PhaseChip phase={option.phase} />
                        <Mono>{option.name}</Mono>
                        <Box sx={{ flex: 1 }} />
                        <Mono dim sx={{ fontSize: 10 }}>
                          {option.workspace}
                        </Mono>
                      </Stack>
                    </Box>
                  )}
                  renderInput={(params) => <TextField {...params} label="sandbox" placeholder="pick a sandbox" />}
                />
                {selected ? (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <PhaseChip phase={selected.phase} />
                    <Mono dim sx={{ fontSize: 11 }}>
                      {selected.workspace} · {selected.restart_policy || 'no restart policy'}
                    </Mono>
                    {selected.created_from_workload_template ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`template ${selected.created_from_workload_template}`}
                        sx={{ fontFamily: MONO, fontSize: 10 }}
                      />
                    ) : null}
                  </Stack>
                ) : null}
              </Stack>
            ) : null}

            <Box sx={{ mt: 2.5 }}>
              <SectionLabel>command</SectionLabel>
              <TextField
                fullWidth
                multiline
                minRows={4}
                maxRows={10}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="bash -lc is applied for you"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    run();
                  }
                }}
                slotProps={{
                  htmlInput: { spellCheck: false, style: { fontFamily: MONO, fontSize: 12.5, lineHeight: 1.65 } },
                }}
              />
              <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', mt: 1 }}>
                {EXAMPLES.map((example) => (
                  <Chip
                    key={example}
                    size="small"
                    label={example}
                    variant="outlined"
                    onClick={() => setCommand(example)}
                    sx={{ fontFamily: MONO, fontSize: 10.5, cursor: 'pointer' }}
                  />
                ))}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center' }}>
                <Button
                  variant="contained"
                  startIcon={running ? <CircularProgress size={15} color="inherit" /> : <PlayArrowRoundedIcon />}
                  disabled={!sandbox || !command.trim() || running}
                  onClick={run}
                >
                  {running ? 'running…' : 'run command'}
                </Button>
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<ClearRoundedIcon />}
                  disabled={!result && !error}
                  onClick={() => {
                    setResult(null);
                    setError(null);
                  }}
                >
                  clear
                </Button>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                  ⌘↵ to run
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
                <Checkbox
                  size="small"
                  checked={start}
                  onChange={(e) => setStart(e.target.checked)}
                  sx={{ p: 0.4 }}
                />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  start or resume the sandbox when it is not ready
                </Typography>
              </Stack>
            </Box>
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Panel sx={{ height: '100%' }}>
            <SectionLabel
              right={
                result ? (
                  <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                    <Chip
                      size="small"
                      label={`exit ${result.exit_code}`}
                      color={result.exit_code === 0 ? 'success' : 'error'}
                      variant="outlined"
                      sx={{ fontFamily: MONO }}
                    />
                    <Mono dim sx={{ fontSize: 10.5 }}>
                      {result.duration_ms} ms{result.started ? ' · started' : ''}
                      {result.phase ? ` · ${result.phase}` : ''}
                    </Mono>
                  </Stack>
                ) : null
              }
            >
              output
            </SectionLabel>
            {error ? <ErrorNote message={error} /> : null}
            {!result && !error ? (
              <EmptyState
                icon={<TerminalRoundedIcon />}
                title="nothing run yet"
                hint="Commands run non-interactively with bash -lc. Use the terminal on a sandbox page for a live PTY."
              />
            ) : null}
            {result ? (
              <Stack spacing={1}>
                <Box
                  sx={{
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: (t) =>
                      t.palette.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(16,22,44,0.045)',
                    overflow: 'hidden',
                  }}
                >
                  <Stack
                    direction="row"
                    sx={{ px: 1.25, py: 0.55, borderBottom: '1px solid', borderColor: 'divider', alignItems: 'center' }}
                  >
                    <Stack direction="row" spacing={0.6}>
                      {['#ff5f6d', '#f2a53c', '#35d29a'].map((c) => (
                        <Box key={c} sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: `${c}bb` }} />
                      ))}
                    </Stack>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title="copy output">
                      <IconButton
                        size="small"
                        onClick={async () => {
                          await copyToClipboard(`${result.stdout}${result.stderr}`.trim());
                          toast('output copied');
                        }}
                      >
                        <ContentCopyRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  <Box
                    ref={outputRef}
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      maxHeight: 420,
                      overflow: 'auto',
                      fontFamily: MONO,
                      fontSize: 12.2,
                      lineHeight: 1.65,
                      color: result.ok ? 'text.primary' : 'error.main',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {`${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim() || '(no output)'}
                  </Box>
                </Box>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                  {sandbox} · exit {result.exit_code} · {result.duration_ms} ms
                </Typography>
              </Stack>
            ) : null}

            {history.length > 0 ? (
              <>
                <Box sx={{ mt: 2 }}>
                  <SectionLabel right={<Mono dim sx={{ fontSize: 10 }}>this session</Mono>}>recent runs</SectionLabel>
                </Box>
                <Stack spacing={0.6}>
                  {history.map((item) => (
                    <Stack
                      key={item.id}
                      direction="row"
                      spacing={1}
                      onClick={() => {
                        setSandbox(item.sandbox);
                        setCommand(item.command);
                        setResult(item.result);
                      }}
                      sx={{
                        p: 0.85,
                        borderRadius: 1.5,
                        cursor: 'pointer',
                        alignItems: 'center',
                        border: '1px solid',
                        borderColor: 'divider',
                        '&:hover': { borderColor: 'primary.main' },
                      }}
                    >
                      <Chip
                        size="small"
                        label={item.result.exit_code}
                        color={item.result.exit_code === 0 ? 'success' : 'error'}
                        variant="outlined"
                        sx={{ fontFamily: MONO, minWidth: 34 }}
                      />
                      <Mono sx={{ fontSize: 11.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.command}
                      </Mono>
                      <Mono dim sx={{ fontSize: 10 }}>
                        {item.sandbox}
                      </Mono>
                      <Mono dim sx={{ fontSize: 10 }}>
                        {new Date(item.at).toLocaleTimeString()}
                      </Mono>
                    </Stack>
                  ))}
                </Stack>
              </>
            ) : null}
          </Panel>
        </Grid>
      </Grid>
    </Stack>
  );
}
