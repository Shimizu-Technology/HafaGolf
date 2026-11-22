// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInitialMotionOk, REDUCED_MOTION_QUERY, useMotionOk } from './useMotionOk';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  addListener?: ReturnType<typeof vi.fn>;
  removeListener?: ReturnType<typeof vi.fn>;
  dispatchChange: (nextMatches: boolean) => void;
}

function createMockMatchMedia(initialMatches: boolean, useLegacyApi = false): MockMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql: MockMediaQueryList = {
    matches: initialMatches,
    media: REDUCED_MOTION_QUERY,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatchChange(nextMatches: boolean) {
      mql.matches = nextMatches;
      const event = { matches: nextMatches, media: REDUCED_MOTION_QUERY } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };

  if (useLegacyApi) {
    mql.addEventListener = undefined as unknown as ReturnType<typeof vi.fn>;
    mql.removeEventListener = undefined as unknown as ReturnType<typeof vi.fn>;
    mql.addListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    });
    mql.removeListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    });
  }

  return mql;
}

function MotionProbe() {
  const motionOk = useMotionOk();
  return <span data-testid="motion-ok">{String(motionOk)}</span>;
}

describe('useMotionOk', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.matchMedia = originalMatchMedia;
  });

  it('returns true when prefers-reduced-motion is not active and reacts to live preference toggles', () => {
    const mql = createMockMatchMedia(false);
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    act(() => {
      root.render(<MotionProbe />);
    });

    const probe = container.querySelector('[data-testid="motion-ok"]');
    expect(probe?.textContent).toBe('true');

    // User enables reduced motion at OS/browser level
    act(() => {
      mql.dispatchChange(true);
    });
    expect(probe?.textContent).toBe('false');

    // User disables reduced motion
    act(() => {
      mql.dispatchChange(false);
    });
    expect(probe?.textContent).toBe('true');

    act(() => {
      root.unmount();
    });
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('returns false immediately when prefers-reduced-motion: reduce is active', () => {
    const mql = createMockMatchMedia(true);
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    act(() => {
      root.render(<MotionProbe />);
    });

    expect(container.querySelector('[data-testid="motion-ok"]')?.textContent).toBe('false');
  });

  it('supports legacy addListener/removeListener media query APIs', () => {
    const mql = createMockMatchMedia(false, true);
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    act(() => {
      root.render(<MotionProbe />);
    });

    expect(mql.addListener).toHaveBeenCalledTimes(1);
    act(() => {
      mql.dispatchChange(true);
    });
    expect(container.querySelector('[data-testid="motion-ok"]')?.textContent).toBe('false');

    act(() => {
      root.unmount();
    });
    expect(mql.removeListener).toHaveBeenCalledTimes(1);
  });

  it('defaults safely to true when matchMedia is unavailable', () => {
    expect(getInitialMotionOk(undefined)).toBe(true);
    expect(getInitialMotionOk({})).toBe(true);
  });
});
