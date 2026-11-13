import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type Scope } from './api/client';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
  lastFetch: number | null;
}

/**
 * Fetch with optional polling. Keeps the previous payload on screen while a
 * refresh is in flight, so a 2s poll never flashes the table.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  opts: { intervalMs?: number; enabled?: boolean; deps?: unknown[] } = {},
): AsyncState<T> {
  const { intervalMs = 0, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);
  const load = useRef(loader);
  load.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const hasData = data !== null;
    setRefreshing(hasData);
    setLoading(!hasData);
    (load.current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
        setLastFetch(Date.now());
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : String((err as Error)?.message ?? err));
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRefreshing(false);
      }) as Promise<void>);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, enabled, ...(opts.deps ?? [])]);

  useEffect(() => {
    if (!enabled || !intervalMs) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled, ...(opts.deps ?? [])]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refreshing, reload, lastFetch };
}

/** localStorage-backed state, used for the gateway/workspace scope. */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage disabled — the value still lives for this session */
      }
    },
    [key],
  );
  return [value, set];
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useScopeStore() {
  const [gateway, setGateway] = usePersistentState<string>('os.gateway', '');
  const [workspace, setWorkspace] = usePersistentState<string>('os.workspace', 'default');
  const scope: Scope = {
    gateway: gateway || undefined,
    workspace: workspace && workspace !== 'default' ? workspace : undefined,
  };
  return { gateway, setGateway, workspace, setWorkspace, scope };
}
