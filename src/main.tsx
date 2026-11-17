import '@fontsource-variable/jetbrains-mono';

import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';

import { buildTheme } from './theme';
import { ShellProvider, useShell } from './Shell';
import { AppShell } from './components/AppShell';
import { WelcomeScreen } from './components/WelcomeScreen';
import { api } from './api/client';
import type { AuthConfig, AuthUser } from './api/types';
import Overview from './pages/Overview';
import SandboxList from './pages/SandboxList';
import SandboxDetail from './pages/SandboxDetail';
import Network from './pages/Network';
import Templates from './pages/Templates';
import Access from './pages/Access';
import Gateways from './pages/Gateways';
import Approvals from './pages/Approvals';
import Profiles from './pages/Profiles';
import Run from './pages/Run';

interface AuthState {
  loading: boolean;
  config: AuthConfig | null;
  user: AuthUser | null;
}

/**
 * Auth gate: in `local` mode the console behaves exactly as before (loopback,
 * CLI mTLS identity). In `oidc` mode an unauthenticated visitor gets the sign-in
 * screen; signed-in operators carry their realm roles into the shell header.
 */
function AuthGate({
  children,
}: {
  children: (user: AuthUser | null, logout: () => void, mode: 'local' | 'oidc') => React.ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ loading: true, config: null, user: null });

  const load = useCallback(async () => {
    try {
      const config = await api.authConfig();
      // local mode can require credentials too (token / mTLS); an mTLS client
      // certificate even yields a session without any sign-in interaction.
      let user: AuthUser | null = null;
      try {
        user = (await api.authMe()).user;
      } catch {
        user = null;
      }
      setState({ loading: false, config, user });
    } catch {
      // bridge unreachable: fall through to the app, which surfaces the error
      setState({
        loading: false,
        config: {
          mode: 'local',
          issuers: [],
          clientId: '',
          entra: { enabled: false, tenant: '', clientId: '', issuer: '' },
          local: { token: false, mtls: false, anonymous: true },
          tls: false,
          localUrl: 'http://localhost:5279',
          oidcUrl: 'http://localhost:5273',
        },
        user: null,
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // post-login role switches (Identity page) refresh the gate + header chip
  useEffect(() => {
    const onSession = () => {
      api
        .authMe()
        .then((r) => setState((s) => ({ ...s, user: r.user })))
        .catch(() => {});
    };
    window.addEventListener('openshell:session-changed', onSession);
    return () => window.removeEventListener('openshell:session-changed', onSession);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.authLogout();
    } catch {
      /* session already gone */
    }
    setState((s) => ({ ...s, user: null }));
  }, []);

  if (state.loading) return null;
  const requiresAuth = state.config ? state.config.mode === 'oidc' || !state.config.local.anonymous : false;
  if (requiresAuth && !state.user) {
    return <WelcomeScreen onLoggedIn={(user) => setState((s) => ({ ...s, user }))} />;
  }
  return <>{children(state.user, logout, state.config?.mode ?? 'local')}</>;
}

function ThemedApp() {
  const { dark } = useShell();
  const theme = useMemo(() => buildTheme(dark ? 'dark' : 'light'), [dark]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <HashRouter>
        <AuthGate>
          {(user, logout, mode) => (
            <AppShell user={user} onLogout={logout} authMode={mode}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/sandboxes" element={<SandboxList />} />
                <Route path="/sandboxes/:name" element={<SandboxDetail />} />
                <Route path="/run" element={<Run />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/network" element={<Network />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/profiles" element={<Profiles />} />
                <Route path="/gateways" element={<Gateways />} />
                <Route path="/access" element={<Access />} />
                <Route path="/welcome" element={<WelcomeScreen />} />
                <Route path="*" element={<Overview />} />
              </Routes>
            </AppShell>
          )}
        </AuthGate>
      </HashRouter>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellProvider>
      <ThemedApp />
    </ShellProvider>
  </StrictMode>,
);
