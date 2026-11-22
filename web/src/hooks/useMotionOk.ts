import { useEffect, useState } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface MatchMediaWindowLike {
  matchMedia?: (query: string) => MediaQueryList;
}

/**
 * Returns true when motion is allowed (prefers-reduced-motion: reduce is NOT active).
 * SSR-safe: defaults to true when matchMedia is unavailable.
 */
export function getInitialMotionOk(
  win: MatchMediaWindowLike | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  if (!win || typeof win.matchMedia !== 'function') {
    return true;
  }

  try {
    return !win.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return true;
  }
}

/**
 * Reactive hook that returns false when the user prefers reduced motion
 * and updates immediately if the OS/browser preference changes.
 */
export function useMotionOk(): boolean {
  const [motionOk, setMotionOk] = useState<boolean>(() => getInitialMotionOk());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    setMotionOk(!mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setMotionOk(!event.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }

    // Legacy Safari/WebKit fallback
    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleChange);
      return () => {
        mediaQuery.removeListener(handleChange);
      };
    }

    return undefined;
  }, []);

  return motionOk;
}
