import { memo, useMemo, useRef } from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { MONO } from '../theme';
import type { LogLine } from '../api/types';

const LEVEL_COLOR: Record<string, string> = {
  error: '#ff5f6d',
  warn: '#f2a53c',
  info: '#8f9bb0',
  debug: '#5aa9ff',
  trace: '#5f6a7d',
  other: '#6b7688',
};

const ROW = 22;

/**
 * Virtualised log surface. A 5000-line fetch stays smooth, and the gutter keeps
 * the timestamp + source + level readable without wrapping the message.
 */
export const LogViewer = memo(function LogViewer({ lines }: { lines: LogLine[] }) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => lines, [lines]);

  const renderRow = (l: LogLine, i: number) => {
    const color = LEVEL_COLOR[l.level] ?? LEVEL_COLOR.other;
    return (
      <Box
        key={l.id}
        sx={{
          height: ROW,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          fontFamily: MONO,
          fontSize: 12,
          whiteSpace: 'pre',
          overflow: 'hidden',
          borderLeft: `2px solid ${l.level === 'error' ? color : 'transparent'}`,
          bgcolor:
            l.level === 'error'
              ? 'rgba(255,95,109,0.07)'
              : i % 2 === 0
                ? 'transparent'
                : dark
                  ? 'rgba(255,255,255,0.018)'
                  : 'rgba(0,0,0,0.022)',
        }}
      >
        <Box sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 11 }}>{shortTimeTs(l)}</Box>
        <Box
          sx={{
            color: l.source === 'gateway' ? '#a78bfa' : '#22d3ee',
            flexShrink: 0,
            fontSize: 10.5,
            width: 56,
          }}
        >
          {l.source}
        </Box>
        <Box sx={{ color, flexShrink: 0, width: 44, fontSize: 10.5, fontWeight: 700 }}>{l.level}</Box>
        <Box
          sx={{
            color: dark ? '#c3ccdd' : '#2b3446',
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={l.raw}
        >
          {l.target ? <span style={{ opacity: 0.55 }}>{l.target} </span> : null}
          {l.message}
        </Box>
      </Box>
    );
  };

  return (
    <Box
      ref={scrollRef}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: dark ? 'rgba(8,10,16,0.72)' : 'rgba(255,255,255,0.92)',
        maxHeight: '58vh',
        minHeight: 220,
        overflow: 'auto',
      }}
    >
      {rows.length === 0 ? (
        <Box
          sx={{
            p: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: MONO,
          }}
        >
          no log lines matched
        </Box>
      ) : (
        rows.map((l, i) => renderRow(l, i))
      )}
    </Box>
  );
});

function shortTimeTs(l: LogLine): string {
  if (l.ts === null) return '--:--:--';
  return new Date(l.ts).toLocaleTimeString([], { hour12: false });
}

export const LogLegend = () => null;
