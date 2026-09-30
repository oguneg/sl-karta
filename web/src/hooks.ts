import { useEffect, useRef, useState } from 'react';

/** Re-render every `ms` so countdowns stay fresh. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Fetch data and refresh it every `intervalMs` while the page is visible.
 * `deps` restart the cycle; `fetcher` receives an AbortSignal.
 */
export function usePolling<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | null,
  intervalMs: number,
  deps: unknown[],
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const ref = useRef(fetcher);
  ref.current = fetcher;

  useEffect(() => {
    if (!ref.current) {
      setData(undefined);
      return;
    }
    let ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    setData(undefined);
    setError(undefined);

    const run = async () => {
      clearTimeout(timer);
      ctrl.abort();
      ctrl = new AbortController();
      setLoading(true);
      let failed = false;
      try {
        const v = await ref.current!(ctrl.signal);
        if (alive) {
          setData(v);
          setError(undefined);
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        failed = true;
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
      if (alive && document.visibilityState === 'visible') timer = setTimeout(run, failed ? Math.min(intervalMs, 5000) : intervalMs);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') void run();
      else clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', onVis);
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
      ctrl.abort();
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading };
}
