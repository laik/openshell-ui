import { useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  GlobalStyles,
  IconButton,
  ListItemButton,
  List,
  MenuItem,
  Select,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import ExtensionRoundedIcon from '@mui/icons-material/ExtensionRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import KeyboardCommandKeyRoundedIcon from '@mui/icons-material/KeyboardCommandKeyRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import GavelRoundedIcon from '@mui/icons-material/GavelRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import { useNavigate, useLocation } from 'react-router-dom';

import { useShell } from '../Shell';
import { useAsync } from '../hooks';
import { api } from '../api/client';
import { MONO } from '../theme';
import { PhaseDot } from './ui';
import type { Context } from '../api/types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  hint: string;
  badge?: 'approvals';
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'fleet',
    items: [
      { to: '/', label: 'Overview', icon: <DashboardRoundedIcon fontSize="small" />, hint: 'gateway health and sandbox fleet' },
      { to: '/sandboxes', label: 'Sandboxes', icon: <ExtensionRoundedIcon fontSize="small" />, hint: 'create, start, suspend, delete' },
      { to: '/run', label: 'Run', icon: <PlayCircleRoundedIcon fontSize="small" />, hint: 'start a sandbox and run a command' },
    ],
  },
  {
    section: 'operate',
    items: [
      { to: '/approvals', label: 'Approvals', icon: <GavelRoundedIcon fontSize="small" />, hint: 'review proposed network rules', badge: 'approvals' },
      { to: '/network', label: 'Network', icon: <HubRoundedIcon fontSize="small" />, hint: 'exposed services and port forwards' },
      { to: '/templates', label: 'Templates', icon: <LayersRoundedIcon fontSize="small" />, hint: 'reusable workload templates' },
    ],
  },
  {
    section: 'configure',
    items: [
      { to: '/profiles', label: 'Profiles', icon: <TuneRoundedIcon fontSize="small" />, hint: 'provider profiles and credentials' },
      { to: '/gateways', label: 'Gateways', icon: <DnsRoundedIcon fontSize="small" />, hint: 'register, verify and switch gateways' },
      { to: '/access', label: 'Identity', icon: <PersonRoundedIcon fontSize="small" />, hint: 'principal, roles and workspaces' },
    ],
  },
];

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ px: compact ? 0 : 0.5, alignItems: "center" }}>
      <Box
        sx={{
          width: 30,
          height: 30,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(135deg,#7c5cff,#22d3ee)',
          boxShadow: '0 6px 20px -6px rgba(124,92,255,0.6)',
        }}
      >
        <Box
          component="svg"
          viewBox="0 0 24 24"
          sx={{ width: 17, height: 17, fill: 'none', stroke: '#07080c', strokeWidth: 2 }}
        >
          <path d="M12 3 20 7.5v9L12 21 4 16.5v-9z" />
          <circle cx="12" cy="12" r="2.4" fill="#07080c" stroke="none" />
        </Box>
      </Box>
      <Box sx={{ lineHeight: 1.15 }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.02em' }}>OpenShell</Typography>
        <Typography sx={{ fontSize: 9.5, color: 'text.secondary', letterSpacing: '0.2em', fontFamily: MONO }}>
          CONSOLE
        </Typography>
      </Box>
    </Stack>
  );
}

function ScopeSelects({
  gateway,
  setGateway,
  workspace,
  setWorkspace,
  gateways,
  workspaces,
  connected,
  activeGateway,
  stacked,
}: {
  gateway: string;
  setGateway: (value: string) => void;
  workspace: string;
  setWorkspace: (value: string) => void;
  gateways: Context['gateways'];
  workspaces: Array<{ name: string; status: string }>;
  connected: boolean;
  activeGateway: { name: string } | undefined;
  stacked?: boolean;
}) {
  const theme = useTheme();
  return (
    <Stack direction={stacked ? 'column' : { xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, width: stacked ? '100%' : undefined }}>
      <Select
        size="small"
        displayEmpty
        value={gateway}
        onChange={(e) => setGateway(e.target.value)}
        sx={{
          minWidth: stacked ? 0 : 160,
          width: stacked ? '100%' : undefined,
          fontFamily: MONO,
          fontSize: 12.5,
          borderRadius: 2,
          '& fieldset': { borderColor: theme.palette.divider },
          '&:hover fieldset': { borderColor: theme.palette.action.active },
        }}
      >
        <MenuItem value="" sx={{ fontFamily: MONO, fontSize: 12.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <PhaseDot phase={connected ? 'Ready' : 'Unknown'} size={6} />
            <span>cli active · {activeGateway?.name ?? 'auto'}</span>
          </Stack>
        </MenuItem>
        {gateway && !gateways.some((g) => g.name === gateway) ? (
          <MenuItem value={gateway} sx={{ fontFamily: MONO, fontSize: 12.5 }}>
            {gateway}
          </MenuItem>
        ) : null}
        {gateways.map((g) => (
          <MenuItem key={g.name} value={g.name} sx={{ fontFamily: MONO, fontSize: 12.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
              <PhaseDot phase={g.name === gateway || g.active ? 'Ready' : 'Stopped'} size={6} />
              <span>{g.name}</span>
              <Typography
                sx={{
                  fontSize: 10.5,
                  color: 'text.secondary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 220,
                }}
              >
                {g.endpoint}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Select>
      <Select
        size="small"
        displayEmpty
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value)}
        sx={{
          minWidth: stacked ? 0 : 126,
          width: stacked ? '100%' : undefined,
          fontFamily: MONO,
          fontSize: 12.5,
          borderRadius: 2,
          '& fieldset': { borderColor: theme.palette.divider },
          '&:hover fieldset': { borderColor: theme.palette.action.active },
        }}
      >
        <MenuItem value="default" sx={{ fontFamily: MONO, fontSize: 12.5 }}>
          workspace: default
        </MenuItem>
        {workspace !== 'default' && !workspaces.some((w) => w.name === workspace) ? (
          <MenuItem value={workspace} sx={{ fontFamily: MONO, fontSize: 12.5 }}>
            workspace: {workspace}
          </MenuItem>
        ) : null}
        {workspaces
          .filter((w) => w.name !== 'default')
          .map((w) => (
            <MenuItem key={w.name} value={w.name} sx={{ fontFamily: MONO, fontSize: 12.5 }}>
              workspace: {w.name}
            </MenuItem>
          ))}
      </Select>
    </Stack>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { gateway, setGateway, workspace, setWorkspace, dark, toggleDark } = useShell();
  const wide = useMediaQuery(theme.breakpoints.up('lg'));
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileNav, setMobileNav] = useState(false);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [hotkeyOn, setHotkeyOn] = useState(false);

  const load = () => {
    api
      .context({ gateway: gateway || undefined, workspace: workspace !== 'default' ? workspace : undefined })
      .then(setCtx)
      .catch(() => setCtx(null));
  };

  // Re-read the scoped context when the person switches gateway or workspace.
  useEffect(load, [gateway, workspace]);

  // The approvals badge asks every live sandbox for its pending rules on a
  // slow poll; it is a count, not a data dependency of the page itself.
  const pending = useAsync(
    () =>
      api
        .allRules({ gateway: gateway || undefined, workspace: workspace !== 'default' ? workspace : undefined }, 'pending')
        .catch(() => ({ rules: [], scanned: 0, errors: [] })),
    { intervalMs: 90_000, deps: [gateway, workspace] },
  );
  const pendingCount = pending.data?.rules.length ?? 0;
  useEffect(() => {
    const onChange = () => pending.reload();
    window.addEventListener('openshell:rules-changed', onChange);
    return () => window.removeEventListener('openshell:rules-changed', onChange);
  }, [pending.reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHotkeyOn((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const workspaces = ctx?.workspaces?.workspaces ?? [];
  const activeGateway = ctx?.gateways?.find((g) => g.active);
  const connected = ctx?.status?.status === 'connected';

  const rail = (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.75, height: '100%', overflowY: 'auto' }}>
      <Brand />
      {compact ? (
        <Stack spacing={0.75}>
          <Typography
            sx={{ fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, color: 'text.disabled', fontFamily: MONO }}
          >
            scope
          </Typography>
          <ScopeSelects
            stacked
            gateway={gateway}
            setGateway={(value) => {
              setGateway(value);
              setMobileNav(false);
            }}
            workspace={workspace}
            setWorkspace={(value) => {
              setWorkspace(value);
              setMobileNav(false);
            }}
            gateways={ctx?.gateways ?? []}
            workspaces={workspaces}
            connected={connected}
            activeGateway={activeGateway}
          />
        </Stack>
      ) : null}
      <Divider />
      {NAV.map((group) => (
        <Box key={group.section}>
          <Typography
            sx={{
              px: 1.25,
              mb: 0.5,
              fontSize: 9.5,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'text.disabled',
              fontFamily: MONO,
            }}
          >
            {group.section}
          </Typography>
          <List dense sx={{ gap: 0.25, display: 'flex', flexDirection: 'column' }}>
            {group.items.map((item) => {
              const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
              const count = item.badge === 'approvals' ? pendingCount : 0;
              return (
                <ListItemButton
                  key={item.to}
                  selected={active}
                  onClick={() => {
                    navigate(item.to);
                    setMobileNav(false);
                  }}
                  sx={{
                    py: 0.85,
                    px: 1.25,
                    gap: 1.25,
                    borderRadius: 2,
                    border: '1px solid transparent',
                    borderColor: active ? 'rgba(124,92,255,0.4)' : 'transparent',
                    bgcolor: active ? 'rgba(124,92,255,0.13)' : 'transparent',
                    '&:hover': { bgcolor: 'rgba(124,92,255,0.08)' },
                    '&.Mui-selected:hover': { bgcolor: 'rgba(124,92,255,0.16)' },
                  }}
                >
                  <Box sx={{ color: active ? 'primary.main' : 'text.secondary', display: 'flex' }}>
                    {item.icon}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <Typography
                        sx={{
                          fontSize: 13.5,
                          fontWeight: active ? 650 : 500,
                          color: active ? 'text.primary' : 'text.secondary',
                        }}
                      >
                        {item.label}
                      </Typography>
                      {count > 0 ? (
                        <Box
                          sx={{
                            minWidth: 18,
                            height: 18,
                            px: 0.6,
                            borderRadius: 99,
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            fontFamily: MONO,
                            color: '#0a0b10',
                            background: 'linear-gradient(120deg,#f2a53c,#ff5f6d)',
                          }}
                        >
                          {count > 99 ? '99+' : count}
                        </Box>
                      ) : null}
                    </Stack>
                    {active ? (
                      <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                        {item.hint}
                      </Typography>
                    ) : null}
                  </Box>
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      ))}
      <Box sx={{ flex: 1, minHeight: 8 }} />
      <Stack spacing={1}>
        <Box
          sx={{
            p: 1.5,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.025)' : 'rgba(16,22,44,0.025)',
          }}
        >
          <Stack direction="row" spacing={1} sx={{ mb: 0.75, alignItems: "center" }}>
            <PhaseDot phase={connected ? 'Ready' : 'Failed'} size={6} />
            <Typography sx={{ fontSize: 11, fontFamily: MONO, color: 'text.secondary' }}>
              {connected ? 'gateway connected' : 'gateway unreachable'}
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 11, fontFamily: MONO, color: 'text.secondary', wordBreak: 'break-all' }}>
            {ctx?.status?.server ?? '—'}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
            <Chip
              label={`cli ${ctx?.cli_version ?? '?'}`}
              size="small"
              sx={{ fontFamily: MONO, fontSize: 10 }}
              variant="outlined"
            />
            <Chip
              label={ctx?.status?.authentication?.provider ?? '?'}
              size="small"
              sx={{ fontFamily: MONO, fontSize: 10 }}
              variant="outlined"
            />
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <IconButton size="small" onClick={toggleDark} sx={{ border: '1px solid', borderColor: 'divider' }}>
            {dark ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
          </IconButton>
          <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
            ⌘K jump to a sandbox
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <GlobalStyles
        styles={{
          '.os-hotkey': hotkeyOn
            ? {
                position: 'fixed',
                inset: 0,
                zIndex: 1300,
                display: 'grid',
                placeItems: 'start center',
                pt: '12vh',
                bgcolor: 'rgba(4,5,9,0.6)',
                backdropFilter: 'blur(6px)',
              }
            : undefined,
        }}
      />
      <AppBar position="static">
        <Toolbar sx={{ gap: 1.5, minHeight: { xs: 56, md: 60 } }}>
          {!wide ? (
            <IconButton
              onClick={() => setMobileNav(true)}
              sx={{ border: '1px solid', borderColor: 'divider' }}
              size="small"
            >
              <MenuRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}
          {!wide ? <Brand compact /> : null}

          <Box sx={{ display: compact ? 'none' : 'block' }}>
            <ScopeSelects
              gateway={gateway}
              setGateway={setGateway}
              workspace={workspace}
              setWorkspace={setWorkspace}
              gateways={ctx?.gateways ?? []}
              workspaces={workspaces}
              connected={connected}
              activeGateway={activeGateway}
            />
          </Box>
          {compact ? (
            <Chip
              size="small"
              variant="outlined"
              icon={<PhaseDot phase={connected ? 'Ready' : 'Unknown'} size={6} />}
              label={gateway || activeGateway?.name || 'auto'}
              onClick={() => setMobileNav(true)}
              sx={{
                fontFamily: MONO,
                fontSize: 11,
                maxWidth: 120,
                '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
              }}
            />
          ) : null}

          <Box sx={{ flex: 1 }} />

          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Tooltip title="open a quick-create sandbox">
              <Button
                size="small"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={() => navigate('/sandboxes?new=1')}
                sx={{ display: { xs: 'none', md: 'inline-flex' } }}
              >
                new sandbox
              </Button>
            </Tooltip>
            <Tooltip title="reload the bridge">
              <IconButton size="small" onClick={load} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <RefreshRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {wide ? (
          <Drawer
            variant="permanent"
            sx={{
              width: 244,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: 244,
                boxSizing: 'border-box',
                position: 'relative',
                height: '100%',
              },
            }}
          >
            {rail}
          </Drawer>
        ) : (
          <Drawer open={mobileNav} onClose={() => setMobileNav(false)} sx={{ zIndex: 1200 }}>
            <Box sx={{ width: 250 }}>{rail}</Box>
          </Drawer>
        )}
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            px: { xs: 1.75, sm: 3, md: 4 },
            py: { xs: 2, md: 3 },
          }}
        >
          {children}
        </Box>
      </Box>

      {hotkeyOn ? (
        <Box
          className="os-hotkey"
          onClick={() => setHotkeyOn(false)}
          component="div"
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              width: 'min(560px, 92vw)',
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              p: 1.5,
            }}
          >
            <HotkeyJump
              onPick={(name) => {
                setHotkeyOn(false);
                navigate(`/sandboxes/${name}`);
              }}
              gateway={gateway}
              workspace={workspace}
              onClose={() => setHotkeyOn(false)}
            />
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function HotkeyJump({
  onPick,
  onClose,
  gateway,
  workspace,
}: {
  onPick: (name: string) => void;
  onClose: () => void;
  gateway: string;
  workspace: string;
}) {
  const [term, setTerm] = useState('');
  const state = useAsync(
    () => api.sandboxes({ gateway: gateway || undefined, workspace: workspace !== 'default' ? workspace : undefined }),
    { deps: [gateway, workspace] },
  );
  const items = (state.data?.sandboxes ?? [])
    .filter((s) => s.name.includes(term.trim()))
    .slice(0, 8);
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <KeyboardCommandKeyRoundedIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
        <TextField
          autoFocus
          fullWidth
          placeholder="jump to sandbox…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && items[0]) onPick(items[0].name);
          }}
          sx={{ '& input': { fontFamily: MONO } }}
        />
      </Stack>
      <Divider />
      {state.error ? (
        <Typography sx={{ fontSize: 12, color: 'error.main', fontFamily: MONO }}>{state.error}</Typography>
      ) : items.length === 0 ? (
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>no match</Typography>
      ) : (
        <List dense>
          {items.map((s) => (
            <ListItemButton key={s.id} onClick={() => onPick(s.name)} sx={{ borderRadius: 2 }}>
              <PhaseDot phase={s.phase} />
              <Typography sx={{ ml: 1.25, fontFamily: MONO, fontSize: 13 }}>{s.name}</Typography>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                {s.phase}
              </Typography>
            </ListItemButton>
          ))}
        </List>
      )}
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
          enter to open · esc to close
        </Typography>
        <Button size="small" color="inherit" endIcon={<CloudOffRoundedIcon />} onClick={onClose}>
          dismiss
        </Button>
      </Stack>
    </Stack>
  );
}
