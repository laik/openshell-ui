import type { Phase, Sandbox } from '../api/types';

export interface PhaseStyle {
  /** Human label. */
  label: string;
  color: string;
  /** Whether the phase implies live compute we pay for. */
  live: boolean;
  /** Whether the state is changing right now. */
  transient: boolean;
}

const PHASES: Record<string, PhaseStyle> = {
  Ready: { label: 'Ready', color: '#35d29a', live: true, transient: false },
  Running: { label: 'Running', color: '#35d29a', live: true, transient: false },
  Pending: { label: 'Pending', color: '#f2a53c', live: true, transient: true },
  Provisioning: { label: 'Provisioning', color: '#f2a53c', live: true, transient: true },
  Creating: { label: 'Creating', color: '#f2a53c', live: true, transient: true },
  Suspended: { label: 'Suspended', color: '#a78bfa', live: false, transient: false },
  Stopped: { label: 'Stopped', color: '#5aa9ff', live: false, transient: false },
  Completed: { label: 'Completed', color: '#98a3ba', live: false, transient: false },
  Failed: { label: 'Failed', color: '#ff5f6d', live: false, transient: false },
  Error: { label: 'Error', color: '#ff5f6d', live: false, transient: false },
  Terminating: { label: 'Terminating', color: '#f2a53c', live: true, transient: true },
  Deleting: { label: 'Deleting', color: '#f2a53c', live: true, transient: true },
  Unknown: { label: 'Unknown', color: '#68727f', live: false, transient: false },
};

export function phaseStyle(phase: Phase | undefined | null): PhaseStyle {
  const key = String(phase ?? 'Unknown');
  return PHASES[key] ?? { label: key || 'Unknown', color: '#68727f', live: false, transient: false };
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
