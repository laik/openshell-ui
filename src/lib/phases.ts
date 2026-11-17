import type { Phase, Sandbox } from '../api/types';

export interface PhaseStyle {
  /** Human label. */
  label: string;
  color: string;
  /** Readable-on-white variant for light mode text. */
  colorLight?: string;
  /** Whether the phase implies live compute we pay for. */
  live: boolean;
  /** Whether the state is changing right now. */
  transient: boolean;
}

const PHASES: Record<string, PhaseStyle> = {
  Ready: { label: 'Ready', color: '#76b900', colorLight: '#4c7a00', live: true, transient: false },
  Running: { label: 'Running', color: '#76b900', colorLight: '#4c7a00', live: true, transient: false },
  Pending: { label: 'Pending', color: '#ffb800', colorLight: '#9a6b00', live: true, transient: true },
  Provisioning: { label: 'Provisioning', color: '#ffb800', colorLight: '#9a6b00', live: true, transient: true },
  Creating: { label: 'Creating', color: '#ffb800', colorLight: '#9a6b00', live: true, transient: true },
  Suspended: { label: 'Suspended', color: '#b8b8b8', colorLight: '#545454', live: false, transient: false },
  Stopped: { label: 'Stopped', color: '#6eb4ff', colorLight: '#1a66c9', live: false, transient: false },
  Completed: { label: 'Completed', color: '#8a8a8a', colorLight: '#545454', live: false, transient: false },
  Failed: { label: 'Failed', color: '#ff5449', colorLight: '#d0342c', live: false, transient: false },
  Error: { label: 'Error', color: '#ff5449', colorLight: '#d0342c', live: false, transient: false },
  Terminating: { label: 'Terminating', color: '#ffb800', colorLight: '#9a6b00', live: true, transient: true },
  Deleting: { label: 'Deleting', color: '#ffb800', colorLight: '#9a6b00', live: true, transient: true },
  Unknown: { label: 'Unknown', color: '#767676', colorLight: '#767676', live: false, transient: false },
};

export function phaseStyle(phase: Phase | undefined | null): PhaseStyle {
  const key = String(phase ?? 'Unknown');
  return PHASES[key] ?? { label: key || 'Unknown', color: '#767676', live: false, transient: false };
}

export function isLive(s: Sandbox): boolean {
  return phaseStyle(s.phase).live;
}

export interface ActionSet {
  start: boolean;
  stop: boolean;
  suspend: boolean;
  resume: boolean;
  exec: boolean;
  delete: boolean;
}

/**
 * Which lifecycle commands apply to a phase, mirroring what the CLI accepts:
 * stop preserves the workspace, suspend keeps memory state, resume needs a
 * suspended sandbox, and exec only works against a Ready sandbox.
 */
export function allowedActions(s: Sandbox): ActionSet {
  const phase = String(s.phase ?? '');
  return {
    start: phase === 'Stopped',
    stop: phase === 'Ready' || phase === 'Running' || phase === 'Suspended',
    suspend: phase === 'Ready' || phase === 'Running',
    resume: phase === 'Suspended',
    exec: phase === 'Ready' || phase === 'Running',
    delete: true,
  };
}

export function readyCondition(s: Sandbox) {
  return s.conditions?.find?.((c) => c.type === 'Ready');
}

export function failureHint(s: Sandbox): string {
  if (String(s.phase) === 'Completed') return '';
  const cond = readyCondition(s);
  if (cond && cond.status === 'False' && cond.message && cond.reason !== 'MainProcessCompleted') {
    return cond.message;
  }
  if (s.configuration_admission?.error) return s.configuration_admission.error;
  if (s.provisioning?.cleanup_error) return s.provisioning.cleanup_error;
  if (s.exit_code && s.exit_code !== 0) return `main process exited with code ${s.exit_code}`;
  return '';
}
