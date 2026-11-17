import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded';
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { MONO } from '../theme';
import { PhaseChip } from './ui';
import {
  acquireSession,
  dropSession,
  sessionKey,
  type SessionState,
  type TerminalMode,
  type TerminalSession,
} from './terminalSession';

/**
 * A real PTY inside the browser, backed by a persistent session: switching tabs
 * or navigating away keeps the remote shell / attached workload alive, and
 * coming back re-attaches the same scrollback. `workload` attaches the sandbox's
 * canonical main process (the command it was started with); `shell` opens the
 * sandbox user's own shell. Neither path assumes bash.
 */
export function TerminalPanel({
  name,
  phase,
  scope,
}: {
  name: string;
  phase: string;
  scope: { gateway?: string; workspace?: string };
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const [state, setState] = useState<SessionState>({ status: 'connecting', message: '' });
  const [mode, setMode] = useState<TerminalMode>(() => {
    try {
      return window.localStorage.getItem(`os.termMode.${name}`) === 'shell' ? 'shell' : 'workload';
    } catch {
      return 'workload';
    }
  });
  const [ended, setEnded] = useState(false);
  const [nonce, setNonce] = useState(0);

  const ready = phase === 'Ready' || phase === 'Running';
  const key = sessionKey({ name, mode, gateway: scope.gateway, workspace: scope.workspace });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready || ended) return;
    const session = acquireSession({ name, mode, gateway: scope.gateway, workspace: scope.workspace });
    sessionRef.current = session;
    host.appendChild(session.element);
    session.init();
    const unsubscribe = session.subscribe(setState);
    // Give the browser a frame to lay the element out, then size and focus it so
    // keystrokes land in the session immediately after opening the tab.
    const raf = requestAnimationFrame(() => {
      session.fit();
      session.focus();
    });
    const onResize = () => session.fit();
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      if (session.element.parentNode === host) host.removeChild(session.element);
      sessionRef.current = null;
    };
  }, [name, ready, mode, scope.gateway, scope.workspace, nonce, ended]);

  const view: SessionState = ended
    ? { status: 'closed', message: 'session ended — reconnect to start a new one' }
    : state;

  // Put the caret in the session as soon as it is live, so opening the tab (or
  // coming back to it) is immediately typeable without an extra click.
  useEffect(() => {
    if (view.status === 'open') sessionRef.current?.focus();
  }, [view.status]);

  const statusLabel = useMemo(
    () =>
      ({
        connecting: 'opening pty…',
        open: 'streaming',
        closed: 'session closed',
        error: 'disconnected',
      })[view.status],
    [view.status],
  );

  if (!ready) {
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <PhaseChip phase={phase} />
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            The terminal needs a Ready sandbox — start this one, then reopen the terminal.
          </Typography>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Tooltip title="startup attaches the sandbox's canonical main process (its startup command); shell opens the sandbox user's own shell. Sessions stay alive when you switch tabs or pages.">
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_, value: TerminalMode | null) => {
              if (value) {
                setMode(value);
                setEnded(false);
                try {
                  window.localStorage.setItem(`os.termMode.${name}`, value);
                } catch {
                  /* storage disabled — preference lives for this mount only */
                }
              }
            }}
          >
            <ToggleButton value="workload" sx={{ fontFamily: MONO, fontSize: 10.5, px: 1.1, py: 0.3 }}>
              startup
            </ToggleButton>
            <ToggleButton value="shell" sx={{ fontFamily: MONO, fontSize: 10.5, px: 1.1, py: 0.3 }}>
              shell
            </ToggleButton>
          </ToggleButtonGroup>
        </Tooltip>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.4,
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <FiberManualRecordRoundedIcon
            sx={{
              fontSize: 9,
              color:
                view.status === 'open' ? 'success.main' : view.status === 'closed' ? 'text.secondary' : 'warning.main',
            }}
          />
          <Typography sx={{ fontFamily: MONO, fontSize: 11.5 }}>{statusLabel}</Typography>
        </Box>
        <Chip
          label={
            mode === 'workload'
              ? `openshell sandbox connect ${name}`
              : `openshell sandbox exec ${name} --tty -- $SHELL`
          }
          size="small"
          variant="outlined"
          sx={{ fontFamily: MONO, fontSize: 10.5 }}
        />
        <Box sx={{ flex: 1 }} />
        {ended || view.status === 'closed' || view.status === 'error' ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<PowerSettingsNewRoundedIcon />}
            onClick={() => {
              if (ended) {
                setEnded(false);
                setNonce((n) => n + 1);
              } else {
                sessionRef.current?.reconnect();
              }
            }}
          >
            reconnect
          </Button>
        ) : null}
        <Tooltip title="close this session and kill the remote shell / detach the workload">
          <Button
            size="small"
            color="inherit"
            startIcon={<CloseRoundedIcon />}
            onClick={() => {
              dropSession(key);
              setEnded(true);
            }}
          >
            end session
          </Button>
        </Tooltip>
      </Stack>

      {view.message ? (
        <Typography sx={{ fontFamily: MONO, fontSize: 12, color: 'warning.main' }}>{view.message}</Typography>
      ) : null}

      <Box
        ref={hostRef}
        onMouseDown={() => sessionRef.current?.focus()}
        sx={{
          height: 'min(62vh, 560px)',
          minHeight: 300,
          bgcolor: '#080a10',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          p: 1,
          overflow: 'hidden',
          cursor: 'text',
        }}
      />
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.55 }}>
        ctrl-c interrupts · “startup” attaches the canonical main process; “shell” opens the sandbox user’s own{' '}
        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 11.5 }}>
          $SHELL
        </Typography>
        . Sessions survive tab and page switches — use “end session” to kill one.
      </Typography>
    </Stack>
  );
}
