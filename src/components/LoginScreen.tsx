import { useState } from 'react';
import { Box, Button, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';

import { api } from '../api/client';
import type { AuthConfig } from '../api/types';
import { MONO } from '../theme';
import { Mono } from './ui';

/**
 * Enterprise organization-OIDC sign-in: authorization code + PKCE. The console
 * never collects a password — the operator is redirected to the IdP's own
 * login page, where MFA, SSO, conditional access and federation apply. The
 * bridge exchanges the code server-side and verifies the tokens (JWKS).
 */
export function LoginScreen({ config }: { config: AuthConfig }) {
  const [issuer, setIssuer] = useState(config.issuers[0]?.issuer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.oidcStart(issuer);
      window.location.assign(r.url);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Organization OIDC</Typography>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontFamily: MONO }}>
          authorization code + PKCE · client {config.clientId}
        </Typography>
      </Box>

      {config.issuers.length === 1 ? (
        <Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>realm / issuer</Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{config.issuers[0].name}</Typography>
          <Typography noWrap title={issuer} sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
            {issuer}
          </Typography>
        </Box>
      ) : (
        <TextField
          select
          fullWidth
          label="realm / issuer"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          helperText={issuer}
          slotProps={{ formHelperText: { sx: { fontFamily: MONO, fontSize: 10.5 } } }}
        >
          {config.issuers.map((i) => (
            <MenuItem key={i.issuer} value={i.issuer}>
              {i.name}
            </MenuItem>
          ))}
        </TextField>
      )}

      {error ? (
        <Typography role="alert" sx={{ fontSize: 12, color: 'error.main', lineHeight: 1.55 }}>
          {error}
        </Typography>
      ) : null}

      <Button
        variant="contained"
        fullWidth
        disabled={busy || !issuer}
        startIcon={busy ? <CircularProgress size={15} color="inherit" /> : <LoginRoundedIcon />}
        onClick={submit}
      >
        {busy ? 'redirecting…' : 'continue to sign-in'}
      </Button>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.6 }}>
        You will be redirected to your organization’s sign-in page — MFA, SSO and conditional access apply there.
        Roles map to console permissions: <Mono>admin</Mono> manages gateways, policies and deletions;{' '}
        <Mono>user</Mono> runs and operates sandboxes.
      </Typography>
    </Stack>
  );
}