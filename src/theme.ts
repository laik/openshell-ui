import { createTheme } from '@mui/material/styles';

/**
 * OpenShell Console — NVIDIA design language.
 *
 * NVIDIA green (#76B900) on pure black / pure white canvases, 2px corners,
 * flat bordered surfaces (no gradients, no glass, no elevation), uppercase
 * engineering eyebrows, solid green nav/Tab indicators, and monospace for
 * every identifier the gateway hands back. Motion is limited to fast
 * colour/border transitions — nothing lifts or floats.
 */
export const INK = {
  dark: {
    bg: '#000000',
    bgDeep: '#000000',
    panel: '#111111',
    panelStrong: '#1a1a1a',
    line: '#2b2b2b',
    lineStrong: '#3d3d3d',
    text: '#ffffff',
    dim: '#b8b8b8',
    faint: '#8a8a8a',
    accent: '#76b900',
    accent2: '#76b900',
    ok: '#76b900',
    warn: '#ffb800',
    err: '#ff5449',
    info: '#6eb4ff',
    violet: '#b8b8b8',
  },
  light: {
    bg: '#f7f7f7',
    bgDeep: '#efefef',
    panel: '#ffffff',
    panelStrong: '#ffffff',
    line: '#e0e0e0',
    lineStrong: '#c6c6c6',
    text: '#000000',
    dim: '#545454',
    faint: '#767676',
    accent: '#76b900',
    accent2: '#4c7a00',
    ok: '#4c7a00',
    warn: '#9a6b00',
    err: '#d0342c',
    info: '#1a66c9',
    violet: '#545454',
  },
};

/** NVIDIA Sans where installed, otherwise the Helvetica/Arial grotesques. */
export const SANS =
  '"NVIDIA Sans", "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

export const MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Code", Consolas, "Liberation Mono", monospace';

/** NVIDIA green alpha helpers (fills and hovers). */
export const GREEN = '#76b900';
export const greenAlpha = (a: number) => `rgba(118,185,0,${a})`;

export function buildTheme(mode: 'dark' | 'light') {
  const ink = INK[mode];
  const dark = mode === 'dark';
  const monoCta = dark ? '#ffffff' : '#000000';
  const monoCtaInk = dark ? '#000000' : '#ffffff';
  const layerShadow = dark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(0,0,0,0.12)';
  return createTheme({
    palette: {
      mode,
      background: { default: ink.bg, paper: ink.panel },
      primary: { main: ink.accent, contrastText: '#000000' },
      secondary: { main: monoCta, contrastText: monoCtaInk },
      success: { main: ink.ok },
      warning: { main: ink.warn },
      error: { main: ink.err },
      info: { main: ink.info },
      text: { primary: ink.text, secondary: ink.dim, disabled: ink.faint },
      divider: ink.line,
    },
    shape: { borderRadius: 2 },
    typography: {
      fontFamily: SANS,
      fontSize: 14,
      fontWeightLight: 400,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 700,
      h1: {
        fontFamily: SANS,
        fontSize: 'clamp(26px, 2.4vw, 32px)',
        fontWeight: 700,
        lineHeight: 1.15,
        letterSpacing: '-0.015em',
        textWrap: 'balance',
      },
      h2: {
        fontFamily: SANS,
        fontSize: 'clamp(20px, 1.8vw, 24px)',
        fontWeight: 700,
        lineHeight: 1.25,
        letterSpacing: '-0.012em',
        textWrap: 'balance',
      },
      h3: { fontSize: 18, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.008em', textWrap: 'balance' },
      h4: { fontSize: 15, fontWeight: 700, lineHeight: 1.4 },
      h6: { fontSize: 17, fontWeight: 700, lineHeight: 1.35, letterSpacing: '-0.008em' },
      body1: { fontSize: 14, lineHeight: 1.6 },
      body2: { fontSize: 13.5, lineHeight: 1.6 },
      caption: { fontSize: 11.5, lineHeight: 1.5, letterSpacing: '0.01em' },
      button: { textTransform: 'none', fontWeight: 700, fontSize: 13.5, letterSpacing: '0.01em' },
      overline: { fontSize: 10.5, lineHeight: 1.6, letterSpacing: '0.14em', fontWeight: 700 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          'html, body, #root': { height: '100%' },
          'html': { colorScheme: mode, textSizeAdjust: '100%' },
          'h1, h2, h3, h4': { textWrap: 'balance' },
          'p': { textWrap: 'pretty' },
          body: {
            margin: 0,
            fontFamily: SANS,
            color: ink.text,
            backgroundColor: ink.bg,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            textRendering: 'optimizeLegibility',
          },
          '::selection': { background: greenAlpha(0.35), color: ink.text },
          ':focus-visible': { outline: `2px solid ${ink.accent}`, outlineOffset: 2 },
          'a': { color: ink.accent2, textDecorationColor: greenAlpha(0.4) },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            background: ink.lineStrong,
            borderRadius: 0,
            border: '3px solid transparent',
            backgroundClip: 'content-box',
          },
          '*::-webkit-scrollbar-thumb:hover': { background: `${ink.faint}aa`, backgroundClip: 'content-box' },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          '@keyframes os-pulse': {
            '0%,100%': { opacity: '1', transform: 'scale(1)' },
            '50%': { opacity: '0.35', transform: 'scale(0.82)' },
          },
          '@keyframes os-sweep': {
            from: { backgroundPosition: '0% 50%' },
            to: { backgroundPosition: '200% 50%' },
          },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.001ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.001ms !important',
              scrollBehavior: 'auto !important',
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          outlined: { borderColor: ink.line },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: {
            background: dark ? '#000000' : '#ffffff',
            borderBottom: `1px solid ${ink.line}`,
            color: ink.text,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            background: dark ? '#0a0a0a' : '#ffffff',
            borderRight: `1px solid ${ink.line}`,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 2,
            minHeight: 36,
            paddingInline: 16,
            whiteSpace: 'nowrap',
            transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
            '&.Mui-focusVisible': { boxShadow: `0 0 0 2px ${ink.bg}, 0 0 0 4px ${ink.accent}` },
          },
          sizeSmall: { minHeight: 30, paddingInline: 12, fontSize: 12.5, borderRadius: 2 },
          text: {
            '&:hover': { backgroundColor: greenAlpha(0.08) },
            '&.MuiButton-colorInherit, &.MuiButton-colorPrimary': { color: ink.dim },
            '&.MuiButton-colorInherit:hover, &.MuiButton-colorPrimary:hover': { color: ink.text },
          },
          outlined: {
            borderColor: ink.lineStrong,
            backgroundColor: 'transparent',
            '&.MuiButton-colorInherit, &.MuiButton-colorPrimary': { color: ink.text },
            '&:hover': {
              borderColor: ink.accent,
              backgroundColor: greenAlpha(0.08),
            },
          },
        },
        variants: [
          {
            props: { variant: 'contained', color: 'primary' },
            style: {
              background: ink.accent,
              border: `1px solid ${ink.accent}`,
              color: '#000000',
              fontWeight: 700,
              '&:hover': { background: '#6aa800', borderColor: '#6aa800' },
              '&:active': { background: '#5e9400', borderColor: '#5e9400' },
              '&.Mui-disabled': { background: dark ? '#1a1a1a' : '#e0e0e0', borderColor: dark ? '#1a1a1a' : '#e0e0e0', color: ink.faint },
            },
          },
          {
            props: { variant: 'contained', color: 'secondary' },
            style: {
              background: monoCta,
              border: `1px solid ${monoCta}`,
              color: monoCtaInk,
              fontWeight: 700,
              '&:hover': { background: dark ? '#d9d9d9' : '#333333', borderColor: dark ? '#d9d9d9' : '#333333' },
              '&.Mui-disabled': { background: dark ? '#1a1a1a' : '#e0e0e0', borderColor: dark ? '#1a1a1a' : '#e0e0e0', color: ink.faint },
            },
          },
          {
            props: { variant: 'contained', color: 'error' },
            style: {
              background: ink.err,
              border: `1px solid ${ink.err}`,
              color: '#ffffff',
              fontWeight: 700,
            },
          },
        ],
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
            '&:hover': { backgroundColor: greenAlpha(0.1), color: ink.text },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 2,
            borderColor: ink.line,
            '&.Mui-selected': {
              backgroundColor: greenAlpha(0.14),
              borderColor: ink.accent,
              color: ink.text,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            fontWeight: 600,
            letterSpacing: '0.01em',
            transition: 'background-color 120ms ease, border-color 120ms ease',
          },
          sizeSmall: { height: 22, fontSize: 11 },
          outlined: {
            borderColor: ink.lineStrong,
            backgroundColor: 'transparent',
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: {
            fontFamily: MONO,
            fontSize: 11.5,
            lineHeight: 1.5,
            padding: '7px 10px',
            borderRadius: 2,
            bgcolor: dark ? '#1a1a1a' : '#000000',
            color: '#ffffff',
            border: `1px solid ${ink.lineStrong}`,
          },
          arrow: { color: dark ? '#1a1a1a' : '#000000' },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: ink.line,
            padding: '10px 12px',
            fontVariantNumeric: 'tabular-nums',
          },
          head: {
            color: ink.faint,
            fontFamily: SANS,
            fontSize: 10.5,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            backgroundColor: 'transparent',
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: 'background-color 120ms ease',
            '&:hover': { backgroundColor: greenAlpha(0.06) },
          },
        },
      },
      MuiTable: { styleOverrides: { root: { fontVariantNumeric: 'tabular-nums' } } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiInputBase: {
        styleOverrides: {
          root: { fontSize: 13.5 },
          input: { '&::placeholder': { color: ink.faint, opacity: 1 } },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            backgroundColor: dark ? '#0d0d0d' : '#ffffff',
            transition: 'border-color 120ms ease, background-color 120ms ease',
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: ink.accent },
          },
          notchedOutline: { borderColor: ink.lineStrong },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontSize: 13.5,
            '&.Mui-selected': { backgroundColor: greenAlpha(0.14), color: ink.text },
            '&.Mui-selected:hover': { backgroundColor: greenAlpha(0.2) },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            fontSize: 13.5,
            minHeight: 44,
            letterSpacing: '0.01em',
            '&.Mui-selected': { color: ink.accent2 },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { height: 3, borderRadius: 0, background: ink.accent },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 0, height: 3, backgroundColor: ink.line },
          bar: { backgroundColor: ink.accent },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            border: `1px solid ${ink.line}`,
            borderRadius: 2,
            backgroundColor: ink.panel,
            boxShadow: layerShadow,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${ink.line}`,
            borderRadius: 2,
            background: ink.panel,
            boxShadow: layerShadow,
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { fontSize: 17, fontWeight: 700, letterSpacing: '-0.008em', padding: '20px 24px 8px' },
        },
      },
      MuiDialogContent: {
        styleOverrides: { root: { padding: '8px 24px 20px' } },
      },
      MuiDialogActions: {
        styleOverrides: { root: { padding: '12px 20px 20px', gap: 8 } },
      },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 0 } } },
      MuiAlert: {
        styleOverrides: {
          root: { border: `1px solid ${ink.line}`, borderRadius: 2, backgroundImage: 'none' },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: ink.line } } },
    },
  });
}

/** Shared surface styling: flat, bordered, square — the NVIDIA panel. */
export const panelSx = (mode: 'dark' | 'light') => ({
  position: 'relative',
  borderRadius: '2px',
  border: '1px solid',
  borderColor: 'divider',
  background: mode === 'dark' ? '#111111' : '#ffffff',
  textAlign: 'left',
});