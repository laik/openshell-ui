import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Snackbar, Stack, Typography } from '@mui/material';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { usePersistentState, useScopeStore } from './hooks';
import { MONO } from './theme';
import type { Scope } from './api/client';

export interface Toast {
  id: number;
  kind: 'ok' | 'err' | 'info';
  title: string;
  detail?: string;
}

interface ShellValue {
  scope: Scope;
  gateway: string;
  setGateway: (v: string) => void;
  workspace: string;
  setWorkspace: (v: string) => void;
  toast: (title: string, opts?: { kind?: Toast['kind']; detail?: string }) => void;
  dark: boolean;
  toggleDark: () => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('ShellProvider missing');
  return ctx;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const scopes = useScopeStore();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dark, setDark] = usePersistentState<boolean>('os.dark', true);

  const toast = useCallback((title: string, opts: { kind?: Toast['kind']; detail?: string } = {}) => {
    const item: Toast = { id: Date.now() + Math.random(), kind: opts.kind ?? 'ok', title, detail: opts.detail };
    setToasts((prev) => [...prev, item]);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const value = useMemo<ShellValue>(
    () => ({
      ...scopes,
      toast,
      dark,
      toggleDark: () => setDark(!dark),
    }),
    [scopes, toast, dark, setDark],
  );

  // show the newest toast; older ones stay queued until dismissed/auto-hidden
  const active = toasts[toasts.length - 1];

  return (
    <ShellContext.Provider value={value}>
      {children}
      <Snackbar
        open={Boolean(active)}
        autoHideDuration={active?.kind === 'err' ? 9000 : 4200}
        onClose={(_, reason) => {
          if (reason !== 'clickaway' && active) dismiss(active.id);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={active?.kind === 'err' ? 'error' : active?.kind === 'info' ? 'info' : 'success'}
          variant="filled"
          icon={
            active?.kind === 'err' ? (
              <ErrorOutlineRoundedIcon fontSize="small" />
            ) : (
              <CheckCircleOutlineRoundedIcon fontSize="small" />
            )
          }
          sx={{ minWidth: 320, maxWidth: 520 }}
        >
          <Stack spacing={0.4}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{active?.title}</Typography>
            {active?.detail ? (
              <Typography
                sx={{
                  fontSize: 12,
                  fontFamily: MONO,
                  opacity: 0.9,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {active.detail}
              </Typography>
            ) : null}
          </Stack>
        </Alert>
      </Snackbar>
    </ShellContext.Provider>
  );
}
