// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RaffleBoardPage } from './RaffleBoardPage';

const cable = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('@rails/actioncable', () => ({
  createConsumer: () => ({ subscriptions: { create: cable.subscribe }, disconnect: vi.fn() }),
}));
vi.mock('../components/OrganizationProvider', () => ({
  useOrganization: () => ({ organization: { slug: 'test-org' } }),
}));
vi.mock('../components/SignedInAdminBar', () => ({ SignedInAdminBar: () => <p>Admin tools</p> }));
vi.mock('../hooks/useVisibilityPolling', () => ({ useVisibilityPolling: () => {} }));

const tournament = { id: '42', name: 'Spring Open', raffle_enabled: true, raffle_hold_winner_on_screen: true };
const prize = {
  id: 1, name: 'Golf Bag', tier: 'gold', tier_display: 'Gold', sponsor_name: 'Example Sponsor',
  image_url: 'https://images.example.com/bag.jpg', value_dollars: 124.5, position: 0, won: false, claimed: false,
};
const board = {
  tournament,
  prizes: [prize],
  stats: { total_prizes: 1, prizes_won: 0, prizes_remaining: 1, total_tickets_sold: 12 },
};

describe('Raffle Board', () => {
  let mount: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let router: ReturnType<typeof createMemoryRouter>;
  let holdOnScreen: boolean;
  let lookup: ReturnType<typeof vi.fn<(url: string, options?: RequestInit) => Promise<Response>>>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    cable.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
    holdOnScreen = true;
    lookup = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/raffle/check_ticket?')) return lookup(url, options);
      if (url.endsWith('/raffle/board')) return Response.json({ ...board, tournament: { ...tournament, raffle_hold_winner_on_screen: holdOnScreen } });
      if (url.endsWith('/tournaments/spring-open')) return Response.json(tournament);
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    router?.dispose();
    mount.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render(search = '') {
    router = createMemoryRouter([{ path: '/:tournamentSlug/raffle', element: <RaffleBoardPage /> }], {
      initialEntries: [`/spring-open/raffle${search}`],
    });
    await act(async () => root.render(<RouterProvider router={router} />));
  }

  function button(name: string) {
    const element = Array.from(mount.querySelectorAll('button')).find((item) => item.textContent?.trim() === name);
    if (!element) throw new Error(`Button not found: ${name}`);
    return element;
  }

  function fillTicket(number: string) {
    const label = Array.from(mount.querySelectorAll('label')).find((item) => item.textContent === 'Ticket number')!;
    const input = document.getElementById(label.htmlFor) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, number);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  }

  it.each([
    ['entered', null, 'Your ticket is active in the drawing.'],
    ['ineligible', null, 'This ticket is ineligible for the drawing.'],
    ['not_found', null, 'Ticket not found'],
    ['winner', { name: 'Golf Bag', tier_display: 'Gold', claimed: false }, 'Ready to claim.'],
    ['winner', { name: 'Golf Bag', tier_display: 'Gold', claimed: true }, 'Already claimed.'],
  ])('checks the exact ticket number and shows the %s result (%s)', async (status, wonPrize, message) => {
    lookup.mockResolvedValue(Response.json({
      found: status !== 'not_found', ticket_number: 'TIX-0001', eligible: ['entered', 'winner'].includes(status),
      status, prize: wonPrize,
    }));
    await render();
    const input = fillTicket('  tix-0001  ');
    await act(async () => button('Check Ticket').click());

    const url = new URL(lookup.mock.calls[0][0], window.location.origin);
    expect(url.pathname).toMatch(/\/api\/v1\/tournaments\/42\/raffle\/check_ticket$/);
    expect(Array.from(url.searchParams.entries())).toEqual([['ticket_number', 'tix-0001']]);
    const result = mount.querySelector('[role="status"]');
    expect(result?.textContent).toContain(message);
    if (wonPrize) {
      expect(result?.textContent).toContain('Golf Bag · Gold');
      expect(result?.textContent).toContain('raffle desk');
    }

    await act(async () => button('Clear').click());
    expect(result?.textContent).toBe('');
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('shows a network error, ignores a cleared request, and can retry', async () => {
    let resolveLookup!: (value: Response) => void;
    lookup.mockRejectedValueOnce(new Error('offline'));
    await render();
    fillTicket('TIX-0002');
    await act(async () => button('Check Ticket').click());
    expect(mount.querySelector('[role="status"]')?.textContent).toContain('Please try again');

    lookup.mockReturnValueOnce(new Promise((resolve) => { resolveLookup = resolve; }));
    await act(async () => button('Check Ticket').click());
    expect(button('Checking…').disabled).toBe(true);
    await act(async () => button('Clear').click());
    expect(lookup.mock.calls[1][1]?.signal?.aborted).toBe(true);
    await act(async () => resolveLookup(Response.json({ status: 'entered', ticket_number: 'TIX-0002', prize: null })));
    expect(mount.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('toggles TV mode through the URL and exits with Escape while preserving other query parameters', async () => {
    await render('?source=banquet');
    expect(mount.textContent).toContain('Check My Ticket');
    await act(async () => button('TV / Projector Mode').click());

    expect(router.state.location.search).toBe('?source=banquet&display=tv');
    expect(mount.textContent).toContain('Spring Open Raffle');
    expect(mount.textContent).toContain('Tickets sold');
    expect(mount.textContent).not.toContain('Check My Ticket');
    expect(mount.textContent).not.toContain('Admin tools');
    expect(mount.querySelector('select')).toBeNull();
    expect(mount.querySelector('a')).toBeNull();
    expect(document.activeElement).toBe(button('Exit TV Mode'));

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(router.state.location.search).toBe('?source=banquet');
    expect(mount.textContent).toContain('Check My Ticket');
    expect(document.activeElement).toBe(button('TV / Projector Mode'));
  });

  it('opens the projector alias and shows a live draw, held winner and cleared spotlight', async () => {
    vi.useFakeTimers();
    await render('?display=projector');
    const { received } = cable.subscribe.mock.calls[0][1] as { received: (event: object) => void };
    expect(mount.textContent).toContain('Waiting for the next draw');
    act(() => received({
      action: 'draw_started', draw_id: 'first-draw', prize: { id: 1, name: 'Golf Bag' },
      eligible_ticket_count: 12, preview_ticket_numbers: ['TIX-0001'],
    }));
    expect(mount.textContent).toContain('Drawing now');
    expect(mount.textContent).toContain('12 eligible tickets');

    act(() => received({
      action: 'prize_won', draw_id: 'first-draw', hold_on_screen: true,
      prize: { id: 1, name: 'Golf Bag', winner_name: 'First Winner', winning_ticket: { ticket_number: 'TIX-0001' } },
    }));
    await act(async () => vi.advanceTimersByTimeAsync(13_000));
    expect(mount.querySelector('[data-testid="spotlight-winner-name"]')?.textContent).toBe('First Winner');
    expect(mount.textContent).toContain('#TIX-0001');

    holdOnScreen = false;
    act(() => received({
      action: 'winner_revealed', draw_id: 'second-draw', hold_on_screen: false,
      prize: { id: 2, name: 'Golf Clubs', winner_name: 'Next Winner' },
    }));
    await act(async () => vi.advanceTimersByTimeAsync(3600));
    expect(mount.querySelector('[data-testid="spotlight-winner-name"]')?.textContent).toBe('Next Winner');
    await act(async () => vi.advanceTimersByTimeAsync(9000));
    expect(mount.querySelector('[data-testid="spotlight-winner-name"]')).toBeNull();

    act(() => received({
      action: 'draw_started', draw_id: 'third-draw', prize: { id: 3, name: 'Golf Balls' },
    }));
    act(() => received({ action: 'spotlight_cleared' }));
    expect(mount.textContent).toContain('Waiting for the next draw');
    await act(async () => button('Exit TV Mode').click());
    expect(router.state.location.search).toBe('');
  });

  it('replaces a failed prize photo while keeping the tier, value and sponsor credit visible', async () => {
    await render();
    const image = mount.querySelector('img[src$="/bag.jpg"]')!;
    act(() => image.dispatchEvent(new Event('error')));
    expect(mount.querySelector('img[src$="/bag.jpg"]')).toBeNull();
    expect(mount.textContent).toContain('Gold');
    expect(mount.textContent).toContain('$124.50');
    expect(mount.textContent).toContain('Sponsored by Example Sponsor');
  });
});
