import { useEffect, useRef } from 'react';

export interface VisibilityDocumentLike {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
}

export interface OnlineWindowLike {
  addEventListener: (type: 'online', listener: () => void) => void;
  removeEventListener: (type: 'online', listener: () => void) => void;
}

export interface VisibilityPollerOptions {
  intervalMs: number;
  enabled?: boolean;
  runImmediately?: boolean;
  onTick: () => void;
  doc?: VisibilityDocumentLike | null;
  win?: OnlineWindowLike | null;
}

/**
 * Pure controller for visibility-aware polling.
 * - Pauses interval ticks when the browser tab is hidden (avoids unnecessary API/DB wakeups).
 * - Immediately fires onTick when the tab becomes visible again or when the browser comes back online.
 */
export function createVisibilityPoller(options: VisibilityPollerOptions): () => void {
  const {
    intervalMs,
    enabled = true,
    runImmediately = false,
    onTick,
    doc = typeof document !== 'undefined' ? document : null,
    win = typeof window !== 'undefined' ? window : null,
  } = options;

  if (!enabled) {
    return () => {};
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  const isVisible = () => !doc || doc.visibilityState !== 'hidden';

  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    if (!isVisible() || intervalMs <= 0) return;
    timer = setInterval(() => {
      if (isVisible()) {
        onTick();
      }
    }, intervalMs);
  };

  const handleVisibilityChange = () => {
    if (isVisible()) {
      onTick();
      startTimer();
    } else {
      stopTimer();
    }
  };

  const handleOnline = () => {
    if (isVisible()) {
      onTick();
      startTimer();
    }
  };

  if (runImmediately && isVisible()) {
    onTick();
  }
  startTimer();

  doc?.addEventListener('visibilitychange', handleVisibilityChange);
  win?.addEventListener('online', handleOnline);

  return () => {
    stopTimer();
    doc?.removeEventListener('visibilitychange', handleVisibilityChange);
    win?.removeEventListener('online', handleOnline);
  };
}

/**
 * React hook wrapping createVisibilityPoller so components get adaptive,
 * visibility-aware polling fallback alongside ActionCable.
 */
export function useVisibilityPolling(
  onTick: () => void,
  intervalMs: number,
  options: { enabled?: boolean; runImmediately?: boolean } = {}
): void {
  const onTickRef = useRef(onTick);
  const { enabled = true, runImmediately = false } = options;

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    return createVisibilityPoller({
      intervalMs,
      enabled,
      runImmediately,
      onTick: () => onTickRef.current(),
    });
  }, [intervalMs, enabled, runImmediately]);
}
