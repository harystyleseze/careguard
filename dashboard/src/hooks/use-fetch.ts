'use client';

import { useCallback, useRef, useState } from 'react';

export interface UseFetchState<T> {
  data: T | null;
  error: string | null;
  lastSuccessAt: number | null;
}

export interface UseFetchResult<T> extends UseFetchState<T> {
  fetch: () => Promise<void>;
}

/**
 * Per-source fetch hook with health tracking (Issue #213).
 * Returns { data, error, lastSuccessAt } so callers can surface
 * which data source is sick without hiding the error silently.
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
): UseFetchResult<T> {
  const [state, setState] = useState<UseFetchState<T>>({
    data: null,
    error: null,
    lastSuccessAt: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    try {
      const data = await fetcherRef.current();
      setState({ data, error: null, lastSuccessAt: Date.now() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
    }
  }, []);

  return { ...state, fetch: run };
}
