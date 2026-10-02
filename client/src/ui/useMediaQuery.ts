// matchMedia 구독(SSR·jsdom 에 matchMedia 가 없으면 false).
import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener?.('change', cb);
      return () => m.removeEventListener?.('change', cb);
    },
    [query],
  );
  const get = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, get, () => false);
}

export const MQ_DESKTOP = '(min-width: 1024px)';
export const MQ_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
