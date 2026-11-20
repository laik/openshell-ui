import { memo, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { MONO, SANS, panelSx } from '../theme';
import { phaseStyle } from '../lib/phases';
import { commandLines, type CommandLines } from '../lib/cli';
import { copyToClipboard } from '../lib/format';

export const Panel = memo(function Panel({
  children,
  sx,
  dense,
}: {
  children: ReactNode;
  sx?: object;
  dense?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        ...panelSx(palette.mode as 'dark' | 'light'),
        p: dense ? 1.75 : 2.5,
        ...sx,
      }}
    >
      {children}
    </Paper>
  );
});

export const SectionLabel = memo(function SectionLabel({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Stack direction="row" sx={{ mb: 1.5, gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
      <Stack direction="row" spacing={0.85} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Box
          sx={{
            width: 3,
            height: 12,
            borderRadius: 0,
            flexShrink: 0,
            bgcolor: 'primary.main',
          }}
        />
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: 10.5,
            letterSpacing: '0.085em',
            textTransform: 'uppercase',
            fontWeight: 680,
            fontFamily: SANS,
          }}
        >
          {children}
        </Typography>
      </Stack>
      {right ? (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {right}
        </Stack>
      ) : null}
    </Stack>
  );
});

export const PageHeader = memo(function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  sx,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  sx?: object;
}) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={{ xs: 2, md: 3 }}
      sx={{
        justifyContent: 'space-between',
        alignItems: { xs: 'stretch', md: 'flex-start' },
        textAlign: 'left',
        ...sx,
      }}
    >
      <Box sx={{ minWidth: 0, maxWidth: 840 }}>
        {eyebrow ? <Box sx={{ mb: 0.7 }}>{eyebrow}</Box> : null}
        <Typography variant="h2">{title}</Typography>
        {description ? (
          <Typography
            sx={{
              mt: 0.75,
              maxWidth: 760,
              fontSize: 13.5,
              lineHeight: 1.65,
              color: 'text.secondary',
            }}
          >
            {description}
          </Typography>
        ) : null}
      </Box>
      {actions ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, flexShrink: 0, alignItems: 'center' }}>
          {actions}
        </Stack>
      ) : null}
    </Stack>
  );
});

const pulse = keyframes`
  0%,100% { opacity: 1; transform: scale(1); }
  50% { opacity: .3; transform: scale(.7); }
`;

export const PhaseDot = memo(function PhaseDot({
  phase,
  size = 7,
}: {
  phase: string | undefined;
  size?: number;
}) {
  const s = phaseStyle(phase);
  return (
    <Box
      component="span"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        bgcolor: s.color,
        animation: s.transient ? `${pulse} 1.15s ease-in-out infinite` : 'none',
      }}
    />
  );
});

export const PhaseChip = memo(function PhaseChip({ phase }: { phase: string | undefined }) {
  const s = phaseStyle(phase);
  const { palette } = useTheme();
  const text = palette.mode === 'light' ? (s.colorLight ?? s.color) : s.color;
  return (
    <Stack direction="row" spacing={0.75} sx={{ px: 0.85, py: 0.3, borderRadius: 0.5, border: '1px solid', borderColor: `${s.color}55`, bgcolor: `${s.color}14`, width: 'fit-content', alignItems: "center" }}>
      <PhaseDot phase={phase} size={6} />
      <Typography sx={{ color: text, fontSize: 11.5, fontWeight: 700, fontFamily: MONO }}>
        {s.label}
      </Typography>
    </Stack>
  );
});

export const Mono = memo(function Mono({
  children,
  sx,
  dim,
}: {
  children: ReactNode;
  sx?: object;
  dim?: boolean;
}) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: MONO,
        fontSize: 12.5,
        color: dim ? 'text.secondary' : 'text.primary',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
});

export const CopyButton = memo(function CopyButton({
  value,
  label,
  size = 'small',
}: {
  value: string;
  label?: string;
  size?: 'small' | 'medium';
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      color="inherit"
      startIcon={done ? <CheckRoundedIcon /> : <ContentCopyRoundedIcon />}
      onClick={async () => {
        try {
          await copyToClipboard(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      sx={{
        color: done ? 'success.main' : 'text.secondary',
        fontFamily: MONO,
        fontSize: 11.5,
        border: '1px solid',
        borderColor: 'divider',
        px: 1,
        '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
      }}
    >
      {done ? 'copied' : (label ?? 'copy')}
    </Button>
  );
});

export const CodeBlock = memo(function CodeBlock({
  value,
  maxHeight = 320,
  actions,
  title = 'output',
}: {
  value: string;
  maxHeight?: number;
  actions?: ReactNode;
  /** Header label; command previews pass something other than "output". */
  title?: string;
}) {
  const { palette } = useTheme();
  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: palette.mode === 'dark' ? '#0d0d0d' : '#f7f7f7',
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" sx={{ px: 1.25, py: 0.6, borderBottom: '1px solid', borderColor: 'divider', alignItems: "center", justifyContent: "space-between" }}>
        <Stack direction="row" spacing={0.85} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 8, height: 8, bgcolor: 'primary.main' }} />
          <Typography sx={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'text.secondary' }}>
            {title}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <CopyButton value={value} />
          {actions}
        </Stack>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          overflow: 'auto',
          maxHeight,
          fontFamily: MONO,
          fontSize: 12.2,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {value || <span style={{ opacity: 0.5 }}>empty</span>}
      </Box>
    </Box>
  );
});

/**
 * The `openshell …` command a control will run, shown where the user can read
 * and copy it. Nothing renders for actions the bridge performs without the CLI.
 *
 * Every mutating control in this console goes through the local CLI, so each
 * one can be paired with `cliFor.*` (src/lib/cli.ts) to preview the exact argv
 * before it runs.
 */
export const CommandPreview = memo(function CommandPreview({
  command,
  label = 'openshell command',
  maxHeight = 96,
  divider,
}: {
  command: CommandLines | undefined;
  /** Header of the block; defaults to "openshell command". */
  label?: string;
  maxHeight?: number;
  /**
   * Dialog layout: inset the block and draw the rule that separates a dialog
   * body from its actions. Inline previews sit flush with the form instead.
   */
  divider?: boolean;
}) {
  const lines = commandLines(command);
  if (!lines.length) return null;
  return (
    <Box
      sx={{
        ...(divider
          ? { px: 3, pt: 1.5, pb: 0.5, borderTop: '1px solid', borderColor: 'divider' }
          : {}),
      }}
    >
      <CodeBlock value={lines.join('\n')} maxHeight={maxHeight} title={label} />
    </Box>
  );
});

const CommandTipBody = ({ title, command }: { title?: string; command: CommandLines | undefined }) => (
  <Stack spacing={title ? 0.6 : 0} sx={{ maxWidth: 520 }}>
    {title ? (
      <Typography sx={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.7)' }}>
        {title}
      </Typography>
    ) : null}
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 0,
        background: 'none',
        border: 0,
        fontFamily: MONO,
        fontSize: 11.5,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'inherit',
      }}
    >
      {commandLines(command).join('\n')}
    </Box>
  </Stack>
);

export const EmptyState = memo(function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Stack  sx={{ py: 6, px: 2, alignItems: 'center' }}>
      <Box sx={{ color: 'text.secondary', opacity: 0.55 }}>{icon ?? <InboxRoundedIcon />}</Box>
      <Stack spacing={0.4} sx={{ alignItems: 'center' }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{title}</Typography>
        {hint ? (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', maxWidth: 420, textAlign: 'center' }}>
            {hint}
          </Typography>
        ) : null}
      </Stack>
      {action}
    </Stack>
  );
});

export const ErrorNote = memo(function ErrorNote({
  message,
  onRetry,
  hint,
}: {
  message: string;
  onRetry?: () => void;
  hint?: string;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ p: 1.75, borderRadius: 0.5, border: '1px solid', borderColor: 'error.main', bgcolor: 'rgba(255,84,73,0.08)', alignItems: "flex-start" }}>
      <ErrorOutlineRoundedIcon sx={{ color: 'error.main', fontSize: 20 }} />
      <Stack spacing={0.6} sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'error.main' }}>
          the bridge could not complete that call
        </Typography>
        <Mono sx={{ wordBreak: 'break-word' }}>{message}</Mono>
        {hint ? (
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{hint}</Typography>
        ) : null}
      </Stack>
      {onRetry ? <Button size="small" onClick={onRetry}>retry</Button> : null}
    </Stack>
  );
});

export const LoadingBlock = memo(function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <Stack spacing={1.25} sx={{ p: 0.5 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={i === 0 ? 34 : 22} animation="wave" />
      ))}
    </Stack>
  );
});

export const Busy = memo(function Busy({ label }: { label: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ color: 'text.secondary', py: 2, alignItems: "center" }}>
      <CircularProgress size={15} />
      <Typography sx={{ fontSize: 12.5, fontFamily: MONO }}>{label}</Typography>
    </Stack>
  );
});

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'confirm',
  danger,
  command,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Show the exact command before the user commits to a destructive action. */
  command?: CommandLines | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth={commandLines(command).length ? 'sm' : 'xs'} fullWidth>
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>{body}</Typography>
      </DialogContent>
      {commandLines(command).length ? <CommandPreview command={command} divider maxHeight={140} /> : null}
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onCancel} color="inherit">
          cancel
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={danger ? 'error' : 'primary'}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Hover hint for a control. With `command` it names the exact `openshell …`
 * command the control runs under its label; without one it is a plain tooltip.
 * Wrapping in a span keeps the tooltip working on a disabled control, which is
 * usually what the user wants to know.
 */
export const HintTip = memo(function HintTip({
  title,
  command,
  children,
}: {
  title: string;
  command?: CommandLines | undefined;
  children: ReactNode;
}) {
  const tip = commandLines(command).length ? <CommandTipBody title={title} command={command} /> : title;
  return (
    <Tooltip enterDelay={220} title={tip}>
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </Tooltip>
  );
});

export const IconAction = memo(function IconAction({
  title,
  command,
  onClick,
  color,
  children,
  disabled,
}: {
  title: string;
  /** Command this control runs; shown in the same tooltip as its label. */
  command?: CommandLines | undefined;
  onClick: () => void;
  color?: 'error' | 'primary' | 'success' | 'warning' | 'inherit';
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <HintTip title={title} command={command}>
      <IconButton
        size="small"
        onClick={onClick}
        disabled={disabled}
        sx={{
          color: disabled ? 'action.disabled' : color === 'inherit' ? 'text.secondary' : `${color}.main`,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 0.5,
          '&:hover': { borderColor: 'primary.main', bgcolor: 'rgba(118,185,0,0.08)' },
        }}
      >
        {children}
      </IconButton>
    </HintTip>
  );
});

/**
 * A compact horizontal meter used for counts per phase — reads as one
 * continuous spectrum instead of a stack of bars.
 */
export function SpectrumBar({
  segments,
  height = 8,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  height?: number;
}) {
  const { palette } = useTheme();
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) {
    return (
      <Box
        sx={{
          height,
          borderRadius: 0,
          bgcolor: palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          border: '1px solid',
          borderColor: 'divider',
        }}
      />
    );
  }
  return (
    <Stack direction="row" sx={{ borderRadius: 0, overflow: 'hidden', gap: '2px', bgcolor: 'transparent' }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <HintTip key={s.label} title={`${s.label} · ${s.value}`}>
            <Box
              sx={{
                flex: s.value,
                height,
                bgcolor: s.color,
                opacity: 0.92,
                transition: 'flex 400ms cubic-bezier(.2,.8,.2,1)',
              }}
            />
          </HintTip>
        ))}
    </Stack>
  );
}
