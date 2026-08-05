import { useCallback, useEffect, useRef, useState } from 'react';
import { isNetworkError } from './api';

/**
 * Minimal async-data hook.
 *
 * Two bugs this exists to prevent:
 *  1. setState after unmount  -> `alive` guard.
 *  2. a slow request resolving *after* a newer one -> monotonic `seq` guard,
 *     so only the most recent call is allowed to write state.
 *
 * `deps` behaves like useEffect's dep array.
 */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);

  const alive = useRef(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  const dataRef = useRef(data);
  const runRef = useRef(null);
  const retryTimer = useRef(null);
  const retryAttempt = useRef(0);
  fnRef.current = fn;
  dataRef.current = data;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, []);

  const scheduleRetry = useCallback(() => {
    if (!alive.current) return;
    const delays = [1000, 2000, 4000, 8000, 12000];
    const wait = delays[Math.min(retryAttempt.current, delays.length - 1)];
    retryAttempt.current += 1;
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      runRef.current?.().catch(() => {});
    }, wait);
  }, []);

  const run = useCallback(async (...args) => {
    const mine = ++seq.current;
    let keepLoading = false;
    if (retryTimer.current) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current(...args);
      if (alive.current && mine === seq.current) {
        retryAttempt.current = 0;
        setData(result);
      }
      return result;
    } catch (e) {
      if (alive.current && mine === seq.current) {
        if (isNetworkError(e)) {
          setError(dataRef.current ? e : null);
          setLoading(!dataRef.current);
          keepLoading = !dataRef.current;
          scheduleRetry();
        } else {
          setError(e);
        }
      }
      throw e;
    } finally {
      if (alive.current && mine === seq.current && !keepLoading) {
        setLoading(false);
      }
    }
  }, [scheduleRetry]);

  runRef.current = run;

  useEffect(() => {
    const retry = () => {
      if (error && isNetworkError(error)) run().catch(() => {});
    };
    window.addEventListener('pos:network-restored', retry);
    return () => window.removeEventListener('pos:network-restored', retry);
  }, [error, run]);

  useEffect(() => {
    if (!immediate) return;
    run().catch(() => {}); // error already captured in state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, run, setData, reload: run };
}

/** Debounce a rapidly-changing value (search boxes, scan fields). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useInvalidateOn(domains, reload) {
  useEffect(() => {
    const handler = (event) => {
      const changed = event?.detail?.domains || [];
      if (!domains?.length || changed.some((domain) => domains.includes(domain))) {
        reload?.().catch(() => {});
      }
    };
    window.addEventListener('pos:data-changed', handler);
    return () => window.removeEventListener('pos:data-changed', handler);
  }, [domains, reload]);
}
