// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevealOnScroll } from './RevealOnScroll';
import { REDUCED_MOTION_QUERY } from '../hooks/useMotionOk';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockMatchMedia(reduced: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: reduced,
    media: REDUCED_MOTION_QUERY,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatchChange(nextReduced: boolean) {
      mql.matches = nextReduced;
      const event = { matches: nextReduced, media: REDUCED_MOTION_QUERY } as MediaQueryListEvent;
      listeners.forEach((l) => l(event));
    },
  };
  window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
  return mql;
}

describe('RevealOnScroll', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalMatchMedia = window.matchMedia;
  const originalIntersectionObserver = globalThis.IntersectionObserver;

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
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it('renders immediately without opacity or transform hiding when prefers-reduced-motion is active', () => {
    mockMatchMedia(true);
    const observerSpy = vi.fn();
    globalThis.IntersectionObserver = observerSpy as unknown as typeof IntersectionObserver;

    act(() => {
      root.render(
        <RevealOnScroll variant="warm-rise" distancePx={18}>
          <h1>Hero Content</h1>
        </RevealOnScroll>
      );
    });

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.dataset.revealState).toBe('immediate');
    expect(wrapper.dataset.motionReduced).toBe('true');
    expect(wrapper.style.opacity).toBe('');
    expect(wrapper.style.transform).toBe('');
    expect(observerSpy).not.toHaveBeenCalled();
    expect(wrapper.textContent).toContain('Hero Content');
  });

  it('reveals once on intersection and disconnects when motion is allowed', () => {
    mockMatchMedia(false);

    let observerCallback: IntersectionObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '';
      thresholds = [];
    }

    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

    act(() => {
      root.render(
        <RevealOnScroll variant="fade-up" distancePx={14} durationMs={460}>
          <h1>Hero Content</h1>
        </RevealOnScroll>
      );
    });

    const wrapper = container.firstElementChild as HTMLElement;
    expect(observe).toHaveBeenCalledTimes(1);
    expect(wrapper.dataset.revealState).toBe('pending');
    expect(wrapper.style.opacity).toBe('0');
    expect(wrapper.style.transform).toContain('translate3d(0, 14px, 0)');

    // Non-intersecting entry keeps it pending
    act(() => {
      observerCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(wrapper.dataset.revealState).toBe('pending');

    // Intersecting entry reveals it once and disconnects
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(wrapper.dataset.revealState).toBe('visible');
    expect(wrapper.style.opacity).toBe('1');
    expect(wrapper.style.transform).toBe('none');
    expect(disconnect).toHaveBeenCalled();
  });

  it('reveals immediately if user switches to reduced motion while pending', () => {
    const mql = mockMatchMedia(false);

    class NeverIntersectingObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '';
      thresholds = [];
    }

    globalThis.IntersectionObserver = NeverIntersectingObserver as unknown as typeof IntersectionObserver;

    act(() => {
      root.render(
        <RevealOnScroll variant="crest-reveal" distancePx={10}>
          <p>Crest Hero</p>
        </RevealOnScroll>
      );
    });

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.dataset.revealState).toBe('pending');

    act(() => {
      mql.dispatchChange(true);
    });

    expect(wrapper.dataset.revealState).toBe('immediate');
    expect(wrapper.dataset.motionReduced).toBe('true');
    expect(wrapper.style.opacity).toBe('');
    expect(wrapper.style.transform).toBe('');
  });

  it('falls back to visible immediately when IntersectionObserver is unavailable', () => {
    mockMatchMedia(false);
    // @ts-expect-error simulating environment without IntersectionObserver
    globalThis.IntersectionObserver = undefined;

    act(() => {
      root.render(
        <RevealOnScroll>
          <p>Always Readable</p>
        </RevealOnScroll>
      );
    });

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.dataset.revealState).toBe('visible');
    expect(wrapper.style.opacity).toBe('1');
    expect(wrapper.style.transform).toBe('none');
  });
});
