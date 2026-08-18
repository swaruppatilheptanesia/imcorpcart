import { useCallback, useEffect, useState } from 'react';

export type AsyncState = 'loading' | 'live' | 'empty' | 'error';

interface UseAsyncResult<T> {
  data: T | undefined;
  state: AsyncState;
  error: string | null;
  reload: () => void;
}

/** Runs an async fetcher on mount and whenever `deps` change, exposing a
 *  loading/live/empty/error state machine the screens render. `isEmpty` lets a
 *  caller flag an empty result (e.g. zero rows) as the 'empty' state. */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  isEmpty?: (data: T) => boolean,
): UseAsyncResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [state, setState] = useState<AsyncState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError(null);
    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setState(isEmpty && isEmpty(result) ? 'empty' : 'live');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Something went wrong');
        setState('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, state, error, reload };
}
