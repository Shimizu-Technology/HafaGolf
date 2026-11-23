// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY } from '../hooks/useMotionOk';
import { FINE_POINTER_QUERY, PINNED_VIEWPORT_QUERY } from '../components/platform/motion';
import { payoutTotal, SAMPLE_GOLFERS, SAMPLE_PAYOUT_LINES, SAMPLE_STYLES } from '../components/platform/sampleData';
import { HERO_HEADLINE } from '../components/platform/PlatformHero';
import { PlatformHomePage } from './PlatformHomePage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MediaState {
  reducedMotion: boolean;
  finePointer: boolean;
  tallDesktop: boolean;
}

function installMatchMedia(state: MediaState) {
  const answers: Record<string, boolean> = {
    [REDUCED_MOTION_QUERY]: state.reducedMotion,
    [FINE_POINTER_QUERY]: state.finePointer,
    [PINNED_VIEWPORT_QUERY]: state.tallDesktop,
  };
  window.matchMedia = vi.fn((query: string) => ({
    matches: answers[query] ?? false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

let container: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[];

function render() {
  act(() => {
    root.render(<PlatformHomePage />);
  });
}

const tabs = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const button = (label: string) => {
  const el = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`No button labelled ${label}`);
  return el;
};
const text = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)?.textContent;
const press = (el: HTMLElement, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('PlatformHomePage', () => {
  it('renders the hero, organizer sign-in, and three style tabs that switch by click', () => {
    installMatchMedia({ reducedMotion: false, finePointer: true, tallDesktop: false });
    render();

    expect(container.querySelector('h1')?.textContent).toContain(HERO_HEADLINE);
    const signIn = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('Organizer Sign In'));
    expect(signIn?.getAttribute('href')).toBe('/admin');
    expect(tabs().map((tab) => tab.textContent)).toEqual(['Memorial', 'Charity', 'Alumni']);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Pacific Links Memorial Classic');

    act(() => tabs()[1].click());
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0].getAttribute('tabindex')).toBe('-1');
    expect(container.textContent).toContain('Island Youth Charity Cup');
    expect(container.textContent).toContain('Charity Bright theme');
    expect(container.textContent).not.toContain('Pacific Links Memorial Classic');
  });

  it('moves between style tabs with arrow, Home, and End keys', () => {
    installMatchMedia({ reducedMotion: false, finePointer: true, tallDesktop: false });
    render();

    press(tabs()[0], 'ArrowRight');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[1]);

    press(tabs()[1], 'End');
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Heritage Alumni Invitational');

    press(tabs()[2], 'ArrowRight');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');

    press(tabs()[0], 'ArrowLeft');
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');

    press(tabs()[2], 'Home');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('lets visitors tap through the mini check-in and updates the counts', () => {
    installMatchMedia({ reducedMotion: false, finePointer: false, tallDesktop: false });
    render();

    expect(text('ph-checkin-count')).toBe('1 of 4 checked in');
    expect(text('ph-waiver-count')).toBe('2 of 4 waivers signed');

    const checkIn = button('Check in Greer Halvorsen');
    expect(checkIn.getAttribute('aria-pressed')).toBe('false');
    act(() => checkIn.click());
    expect(checkIn.getAttribute('aria-pressed')).toBe('true');
    expect(checkIn.textContent).toContain('Checked in');
    expect(text('ph-checkin-count')).toBe('2 of 4 checked in');

    act(() => button('Waiver for Avery Lindqvist').click());
    expect(text('ph-waiver-count')).toBe('3 of 4 waivers signed');

    act(() => button('Check in Greer Halvorsen').click());
    expect(text('ph-checkin-count')).toBe('1 of 4 checked in');

    const reset = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Reset');
    act(() => reset?.click());
    expect(text('ph-waiver-count')).toBe('2 of 4 waivers signed');
  });

  it('renders everything still under reduced motion, with no scroll listener or animation frames', () => {
    installMatchMedia({ reducedMotion: true, finePointer: true, tallDesktop: true });
    const addListener = vi.spyOn(window, 'addEventListener');
    render();

    expect(container.querySelector('[data-motion="reduced"]')).not.toBeNull();
    expect(container.querySelector('[data-pinned]')).toBeNull();
    expect(container.querySelector('[data-tilt="on"]')).toBeNull();
    expect(addListener.mock.calls.some(([type]) => type === 'scroll')).toBe(false);

    const stage = container.querySelector('[role="tabpanel"]') as HTMLElement;
    act(() => {
      stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 10, clientY: 10 }));
    });
    expect(frames).toHaveLength(0);

    for (const heading of ['Registration and the sponsor portal', 'A–J and K–Z phone check-in', 'Live raffle board and payout statement']) {
      expect(container.textContent).toContain(heading);
    }
    expect(container.querySelector('[inert]')).toBeNull();
    expect(container.querySelector('[style*="opacity"]')).toBeNull();
  });

  it('keeps phones and short screens in the still layout even when motion is allowed', () => {
    installMatchMedia({ reducedMotion: false, finePointer: false, tallDesktop: false });
    const addListener = vi.spyOn(window, 'addEventListener');
    render();

    expect(container.querySelector('[data-pinned]')).toBeNull();
    expect(container.querySelector('[data-tilt="on"]')).toBeNull();
    expect(addListener.mock.calls.some(([type]) => type === 'scroll')).toBe(false);
  });

  it('pins the tournament day flow on tall desktops and cleans up its one scroll listener', () => {
    installMatchMedia({ reducedMotion: false, finePointer: true, tallDesktop: true });
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    render();

    expect(container.querySelector('[data-pinned]')).not.toBeNull();
    expect(container.querySelector('[data-tilt="on"]')).not.toBeNull();
    expect(addListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1);

    act(() => {
      frames.splice(0).forEach((frame) => frame(performance.now()));
    });
    const panels = Array.from(container.querySelectorAll<HTMLElement>('.ph-flow-panel'));
    expect(panels).toHaveLength(3);
    expect(Number(panels[0].style.opacity)).toBe(1);
    expect(Number(panels[1].style.opacity)).toBe(0);
    expect(panels[0].hasAttribute('inert')).toBe(false);
    expect(panels[1].hasAttribute('inert')).toBe(true);
    expect(panels[2].getAttribute('aria-hidden')).toBe('true');

    act(() => root.unmount());
    expect(removeListener.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
    root = createRoot(container);
  });
});

describe('platform sample data', () => {
  it('maps each style tab to a real theme pack', () => {
    expect(SAMPLE_STYLES.map((style) => style.packId)).toEqual(['memorial-formal', 'charity-bright', 'crest-classic']);
  });

  it('keeps the payout total tied to its lines', () => {
    expect(payoutTotal()).toBe(SAMPLE_PAYOUT_LINES.reduce((sum, line) => sum + line.amount, 0));
    expect(payoutTotal()).toBe(27275);
  });

  it('uses distinctive fictional golfer names, not common local surnames', () => {
    const common = ['cruz', 'santos', 'reyes', 'garcia', 'flores', 'torres', 'guerrero', 'perez', 'mendiola'];
    for (const golfer of SAMPLE_GOLFERS) {
      expect(common).not.toContain(golfer.lastName.toLowerCase());
    }
  });
});
