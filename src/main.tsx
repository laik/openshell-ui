import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';

import { buildTheme } from './theme';
import { ShellProvider, useShell } from './Shell';
import { AppShell } from './components/AppShell';
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

function ThemedApp() {
  const { dark } = useShell();
  const theme = useMemo(() => buildTheme(dark ? 'dark' : 'light'), [dark]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <HashRouter>
        <AppShell>
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
            <Route path="*" element={<Overview />} />
          </Routes>
        </AppShell>
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
