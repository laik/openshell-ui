import { createTheme } from '@mui/material/styles';

/**
 * OpenShell Console palette.
 *
 * The visual language is deliberately terminal-adjacent: near-black canvas,
 * hairline borders, one violet→cyan accent used only for things that are
 * alive, and monospace for every identifier the gateway hands back.
 */
export const INK = {
  dark: {
    bg: '#07080c',
    bgDeep: '#05060a',
    panel: 'rgba(255,255,255,0.035)',
    panelStrong: 'rgba(255,255,255,0.06)',
    line: 'rgba(255,255,255,0.09)',
    lineStrong: 'rgba(255,255,255,0.16)',
    text: '#e9edf6',
    dim: '#9aa5ba',
    faint: '#6b7585',
    accent: '#7c5cff',
    accent2: '#22d3ee',
    ok: '#35d29a',
    warn: '#f2a53c',
    err: '#ff5f6d',
    info: '#5aa9ff',
    violet: '#a78bfa',
  },
  light: {
    bg: '#f4f5fa',
    bgDeep: '#e9ebf4',
    panel: 'rgba(255,255,255,0.88)',
    panelStrong: '#ffffff',
    line: 'rgba(16,22,44,0.11)',
    lineStrong: 'rgba(16,22,44,0.2)',
    text: '#141824',
    dim: '#525c70',
    faint: '#77808f',
    accent: '#5b3df0',
    accent2: '#087f9e',
    ok: '#0b8f61',
    warn: '#9a5b00',
    err: '#c92c40',
    info: '#1a66c9',
    violet: '#6238d8',
  },
};

/** The console's two families: a geometric UI sans and a coding mono. */
export const SANS =
  '"Inter Variable", "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';

export const MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Code", Consolas, "Liberation Mono", monospace';

export function buildTheme(mode: 'dark' | 'light') {
  const ink = INK[mode];
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      background: { default: ink.bg, paper: dark ? '#0b0d14' : '#ffffff' },
      primary: { main: ink.accent, contrastText: dark ? '#08090e' : '#ffffff' },
      secondary: { main: ink.accent2 },
      success: { main: ink.ok },
      warning: { main: ink.warn },
      error: { main: ink.err },
      info: { main: ink.info },
      text: { primary: ink.text, secondary: ink.dim, disabled: ink.faint },
      divider: ink.line,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: SANS,
      fontSize: 14,
      fontWeightLight: 380,
      fontWeightRegular: 430,
      fontWeightMedium: 540,
      fontWeightBold: 660,
      h1: {
        fontFamily: SANS,
        fontSize: 'clamp(24px, 2.4vw, 30px)',
        fontWeight: 680,
        lineHeight: 1.18,
        letterSpacing: '-0.028em',
      },
      h2: {
        fontFamily: SANS,
        fontSize: 'clamp(19px, 1.8vw, 22px)',
        fontWeight: 660,
        lineHeight: 1.25,
        letterSpacing: '-0.02em',
      },
      h3: { fontSize: 16.5, fontWeight: 640, lineHeight: 1.35, letterSpacing: '-0.012em' },
      h4: { fontSize: 14.5, fontWeight: 640, lineHeight: 1.4 },
      body1: { fontSize: 14, lineHeight: 1.62 },
      body2: { fontSize: 13.5, lineHeight: 1.6 },
      caption: { fontSize: 11.5, lineHeight: 1.45, letterSpacing: '0.015em' },
      button: { textTransform: 'none', fontWeight: 580, letterSpacing: '0.005em' },
      overline: { fontSize: 10.5, lineHeight: 1.6, letterSpacing: '0.15em', fontWeight: 640 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          'html, body, #root': { height: '100%' },
          'html': { colorScheme: mode, textSizeAdjust: '100%' },
          body: {
            margin: 0,
            fontFamily: SANS,
            color: ink.text,
            backgroundColor: ink.bg,
            backgroundImage: dark
              ? `radial-gradient(900px 520px at 8% -8%, rgba(124,92,255,0.16), transparent 60%),
                 radial-gradient(760px 460px at 92% 0%, rgba(34,211,238,0.10), transparent 55%),
                 radial-gradient(1100px 700px at 50% 110%, rgba(124,92,255,0.07), transparent 60%)`
              : `radial-gradient(900px 520px at 8% -8%, rgba(91,61,240,0.09), transparent 60%),
                 radial-gradient(760px 460px at 92% 0%, rgba(8,127,158,0.06), transparent 55%)`,
            backgroundAttachment: 'fixed',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            textRendering: 'optimizeLegibility',
            fontFeatureSettings: '"cv02" 1, "cv03" 1, "cv04" 1, "cv11" 1, "ss01" 1',
          },
          '::selection': { background: `${ink.accent}55`, color: ink.text },
          ':focus-visible': { outline: `2px solid ${ink.accent}`, outlineOffset: 2 },
          'a': { color: ink.accent2, textDecorationColor: `${ink.accent2}66` },
          '*::-webkit-scrollbar': { width: 11, height: 11 },
          '*::-webkit-scrollbar-thumb': {
            background: ink.lineStrong,
            borderRadius: 8,
            border: `3px solid transparent`,
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
            background: dark ? 'rgba(7,8,12,0.74)' : 'rgba(255,255,255,0.82)',
            backdropFilter: 'saturate(160%) blur(14px)',
            borderBottom: `1px solid ${ink.line}`,
            color: ink.text,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            background: dark ? 'rgba(9,10,16,0.76)' : 'rgba(255,255,255,0.82)',
            backdropFilter: 'saturate(160%) blur(14px)',
            borderRight: `1px solid ${ink.line}`,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 10,
            minHeight: 32,
            whiteSpace: 'nowrap',
            '&.Mui-focusVisible': { boxShadow: `0 0 0 3px ${ink.accent}40` },
          },
          sizeSmall: { minHeight: 30, paddingInline: 12 },
        },
        variants: [
          {
            props: { variant: 'contained', color: 'primary' },
            style: {
              background: `linear-gradient(100deg, ${ink.accent}, ${ink.accent2})`,
              color: dark ? '#08090e' : '#ffffff',
              fontWeight: 640,
              '&:hover': { background: `linear-gradient(100deg, ${ink.accent2}, ${ink.accent})` },
            },
          },
        ],
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 560, letterSpacing: '0.005em' },
          sizeSmall: { height: 22 },
          outlined: { borderColor: ink.lineStrong },
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
            bgcolor: dark ? '#12141d' : '#1a1f2e',
            border: `1px solid ${ink.lineStrong}`,
          },
          arrow: { color: dark ? '#12141d' : '#1a1f2e' },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: ink.line,
            padding: '11px 12px',
            fontVariantNumeric: 'tabular-nums',
          },
          head: {
            color: ink.faint,
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 620,
            whiteSpace: 'nowrap',
            backgroundColor: 'transparent',
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: 'background-color 120ms ease',
            '&:hover': { backgroundColor: `${ink.accent}12` },
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
            borderRadius: 10,
            backgroundColor: dark ? 'rgba(255,255,255,0.02)' : 'rgba(16,22,44,0.015)',
            transition: 'border-color 120ms ease, background-color 120ms ease',
          },
          notchedOutline: { borderColor: ink.lineStrong },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 580, fontSize: 13.5, minHeight: 42, letterSpacing: '0.005em' },
        },
      },
      MuiTabs: { styleOverrides: { indicator: { height: 2, borderRadius: 2 } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 8, height: 4 } } },
      MuiMenu: {
        styleOverrides: {
          paper: {
            border: `1px solid ${ink.line}`,
            backdropFilter: 'saturate(160%) blur(14px)',
            boxShadow: dark ? '0 18px 50px -18px rgba(0,0,0,0.85)' : '0 18px 50px -22px rgba(20,30,60,0.3)',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${ink.line}`,
            background: dark ? '#0c0e16' : '#ffffff',
            boxShadow: dark ? '0 30px 80px -20px rgba(0,0,0,0.9)' : '0 30px 80px -24px rgba(20,30,60,0.25)',
          },
        },
      },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiAlert: {
        styleOverrides: {
          root: { border: `1px solid ${ink.line}`, borderRadius: 10, backgroundImage: 'none' },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: { backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(16,22,44,0.07)' },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: ink.line } } },
    },
  });
}

/** Shared surface styling used by every panel in the console. */
export const panelSx = (mode: 'dark' | 'light') => ({
  position: 'relative',
  borderRadius: 3,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: mode === 'dark' ? 'rgba(255,255,255,0.028)' : 'rgba(255,255,255,0.9)',
  backdropFilter: 'saturate(140%) blur(10px)',
});
