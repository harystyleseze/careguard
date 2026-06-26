import { useCallback, useState } from "react";
import { getFetchErrorMessage } from "./fetch-health";

export interface UseFetchState<T> {
  data: T | null;
  error: string | null;
  lastSuccessAt: number | null;
  loading: boolean;
  run: (fetcher: () => Promise<T>) => Promise<T>;
  setData: (data: T) => void;
}

export function useFetch<T>(): UseFetchState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const setData = useCallback((nextData: T) => {
    setDataState(nextData);
    setError(null);
    setLastSuccessAt(Date.now());
  }, []);

  const run = useCallback(
    async (fetcher: () => Promise<T>) => {
      setLoading(true);
      try {
        const nextData = await fetcher();
        setData(nextData);
        return nextData;
      } catch (err) {
        setError(getFetchErrorMessage(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [setData],
  );

  return {
    data,
    error,
    lastSuccessAt,
    loading,
    run,
    setData,
  };
}
