import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

// All editorial motion on the platform homepage lives here: one hover/drag tilt and one
// rAF-scheduled scroll handler. No animation library. Only transform and opacity are written.

export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';
// Pinned scroll storytelling only runs on desktop-sized screens tall enough to show the whole
// check-in panel without clipping; shorter windows and phones get the still, stacked layout.
export const PINNED_VIEWPORT_QUERY = '(min-width: 1024px) and (min-height: 700px)';

/** Reactive matchMedia. Starts false when matchMedia is unavailable, so the still layout wins. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener?.(onChange);
    return () => mql.removeListener?.(onChange);
  }, [query]);

  return matches;
}

// Hover tilt follows the pointer up to this many degrees; a drag can turn the card further.
const HOVER_TILT = 7;
const DRAG_PER_PX = 0.3;
const DRAG_MAX = 26;
// The card closes the gap to its target by e every GLIDE_MS, so it eases back to rest when let go.
const GLIDE_MS = 110;
const SETTLED = 0.02;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface TiltHandlers {
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * A preview card that leans toward a mouse and turns when dragged, then glides back to rest.
 * Returns no handlers when disabled (reduced motion or touch), so phone scrolling is never captured.
 */
export function useTiltCard(cardRef: RefObject<HTMLElement>, enabled: boolean): TiltHandlers | undefined {
  const current = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!enabled && card) card.style.transform = '';
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      current.current = { x: 0, y: 0 };
      target.current = { x: 0, y: 0 };
      drag.current = null;
    };
  }, [cardRef, enabled]);

  if (!enabled) return undefined;

  const write = () => {
    const card = cardRef.current;
    if (!card) return;
    const { x, y } = current.current;
    card.style.transform = x === 0 && y === 0 ? '' : `rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg)`;
  };

  const run = () => {
    if (frame.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const step = 1 - Math.exp(-dt / GLIDE_MS);
      const c = current.current;
      const t = target.current;
      c.x += (t.x - c.x) * step;
      c.y += (t.y - c.y) * step;
      if (Math.abs(t.x - c.x) < SETTLED && Math.abs(t.y - c.y) < SETTLED) {
        current.current = { ...t };
        write();
        frame.current = 0;
        return;
      }
      write();
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const aim = (x: number, y: number) => {
    target.current = { x, y };
    run();
  };

  const rest = () => aim(0, 0);

  return {
    onPointerMove(event) {
      if (event.pointerType !== 'mouse') return;
      const held = drag.current;
      if (held && held.id === event.pointerId) {
        aim(
          clamp(-(event.clientY - held.y) * DRAG_PER_PX, -DRAG_MAX / 2, DRAG_MAX / 2),
          clamp((event.clientX - held.x) * DRAG_PER_PX, -DRAG_MAX, DRAG_MAX)
        );
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      aim(clamp(-ny * 2 * HOVER_TILT, -HOVER_TILT, HOVER_TILT), clamp(nx * 2 * HOVER_TILT, -HOVER_TILT, HOVER_TILT));
    },
    onPointerLeave(event) {
      if (event.pointerType !== 'mouse' || drag.current) return;
      rest();
    },
    onPointerDown(event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      event.preventDefault();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerUp(event) {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      rest();
    },
    onPointerCancel(event) {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      rest();
    },
  };
}

/**
 * Calls `onProgress` with 0..1 as the visitor scrolls through `sectionRef`, from one passive
 * scroll listener batched into at most one requestAnimationFrame per frame. Inactive when disabled.
 */
export function useScrollProgress(
  sectionRef: RefObject<HTMLElement>,
  enabled: boolean,
  onProgress: (progress: number) => void
): void {
  const callback = useRef(onProgress);
  callback.current = onProgress;

  useEffect(() => {
    const section = sectionRef.current;
    if (!enabled || !section) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      callback.current(range > 0 ? clamp(-rect.top / range, 0, 1) : 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [sectionRef, enabled]);
}
