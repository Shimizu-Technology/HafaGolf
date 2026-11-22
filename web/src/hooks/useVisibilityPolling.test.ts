import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVisibilityPoller,
  type OnlineWindowLike,
  type VisibilityDocumentLike,
} from './useVisibilityPolling';

class MockEventSource {
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const existing = this.listeners.get(type) ?? new Set<() => void>();
    existing.add(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe('createVisibilityPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses polling while hidden and refreshes immediately when tab becomes visible', () => {
    const docEvents = new MockEventSource();
    const winEvents = new MockEventSource();
    const doc: VisibilityDocumentLike & { visibilityState: DocumentVisibilityState } = {
      visibilityState: 'visible',
      addEventListener: (t, l) => docEvents.addEventListener(t, l),
      removeEventListener: (t, l) => docEvents.removeEventListener(t, l),
    };
    const win: OnlineWindowLike = {
      addEventListener: (t, l) => winEvents.addEventListener(t, l),
      removeEventListener: (t, l) => winEvents.removeEventListener(t, l),
    };

    const onTick = vi.fn();
    const stop = createVisibilityPoller({
      intervalMs: 5000,
      runImmediately: true,
      onTick,
      doc,
      win,
    });

    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(2);

    // Hide tab — no further ticks should fire while hidden
    doc.visibilityState = 'hidden';
    docEvents.emit('visibilitychange');
    vi.advanceTimersByTime(20000);
    expect(onTick).toHaveBeenCalledTimes(2);

    // Return to visible — immediate refresh plus resumed interval
    doc.visibilityState = 'visible';
    docEvents.emit('visibilitychange');
    expect(onTick).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(4);

    stop();
    expect(docEvents.listenerCount('visibilitychange')).toBe(0);
    expect(winEvents.listenerCount('online')).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(onTick).toHaveBeenCalledTimes(4);
  });

  it('refreshes when browser comes back online while visible', () => {
    const docEvents = new MockEventSource();
    const winEvents = new MockEventSource();
    const doc: VisibilityDocumentLike & { visibilityState: DocumentVisibilityState } = {
      visibilityState: 'visible',
      addEventListener: (t, l) => docEvents.addEventListener(t, l),
      removeEventListener: (t, l) => docEvents.removeEventListener(t, l),
    };
    const win: OnlineWindowLike = {
      addEventListener: (t, l) => winEvents.addEventListener(t, l),
      removeEventListener: (t, l) => winEvents.removeEventListener(t, l),
    };

    const onTick = vi.fn();
    const stop = createVisibilityPoller({
      intervalMs: 30000,
      onTick,
      doc,
      win,
    });

    expect(onTick).not.toHaveBeenCalled();

    winEvents.emit('online');
    expect(onTick).toHaveBeenCalledTimes(1);

    // Online while hidden should not wake the API
    doc.visibilityState = 'hidden';
    docEvents.emit('visibilitychange');
    winEvents.emit('online');
    expect(onTick).toHaveBeenCalledTimes(1);

    stop();
  });

  it('does not poll when disabled', () => {
    const onTick = vi.fn();
    const stop = createVisibilityPoller({
      intervalMs: 1000,
      enabled: false,
      runImmediately: true,
      onTick,
      doc: null,
      win: null,
    });

    vi.advanceTimersByTime(10000);
    expect(onTick).not.toHaveBeenCalled();
    stop();
  });
});
