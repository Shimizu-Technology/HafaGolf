// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentsDirectory, type DirectoryResponse } from './TournamentsDirectory';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const sampleResponse: DirectoryResponse = {
  upcoming: [
    {
      slug: 'island-open-2027',
      name: 'Island Open 2027',
      edition: '10th Annual',
      year: 2027,
      status: 'open',
      event_date: 'May 15, 2027',
      location_name: 'Lagoon Golf Club',
      format_name: '4-Person Scramble',
      tournament_format: 'scramble',
      team_size: 4,
      entry_fee_display: '$150/player',
      registration_open: true,
      can_register: true,
      availability: 'open',
      public_url: 'https://club.example.test/island-open-2027',
      register_url: 'https://club.example.test/island-open-2027/register',
      leaderboard_url: 'https://club.example.test/island-open-2027/leaderboard',
      organization: {
        name: 'Island Golf Club',
        slug: 'island-golf-club',
        primary_color: '#1e3a5f',
        logo_url: null,
        primary_host: 'club.example.test',
      },
    },
  ],
  past: [
    {
      slug: 'island-open-2026',
      name: 'Island Open 2026',
      edition: '9th Annual',
      year: 2026,
      status: 'completed',
      event_date: 'May 10, 2026',
      location_name: 'Lagoon Golf Club',
      format_name: '4-Person Scramble',
      tournament_format: 'scramble',
      team_size: 4,
      entry_fee_display: '$140/player',
      registration_open: false,
      can_register: false,
      availability: 'completed',
      public_url: 'https://club.example.test/island-open-2026',
      register_url: null,
      leaderboard_url: null,
      organization: {
        name: 'Island Golf Club',
        slug: 'island-golf-club',
        primary_color: '#1e3a5f',
        logo_url: null,
        primary_host: 'club.example.test',
      },
    },
  ],
};

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TournamentsDirectory', () => {
  it('renders active tournaments and toggles to past tournaments', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(sampleResponse), { status: 200 })
    );
    const onChange = vi.fn();

    act(() => {
      root.render(<TournamentsDirectory onHasTournamentsChange={onChange} />);
    });
    await flush();

    expect(onChange).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain('Island Open 2027');
    expect(container.textContent).toContain('Registration Open');
    const registerLink = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('Register'));
    expect(registerLink?.getAttribute('href')).toBe('https://club.example.test/island-open-2027/register');

    const pastBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Past'));
    act(() => pastBtn?.click());
    expect(container.textContent).toContain('Island Open 2026');
    expect(container.textContent).toContain('Completed');
  });

  it('defaults to past tournaments when no upcoming tournaments exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ upcoming: [], past: sampleResponse.past }), { status: 200 })
    );

    act(() => {
      root.render(<TournamentsDirectory />);
    });
    await flush();

    expect(container.textContent).toContain('Recent tournaments');
    expect(container.textContent).toContain('Island Open 2026');
  });

  it('hides cleanly when the API fails or returns no tournaments', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const onChange = vi.fn();

    act(() => {
      root.render(<TournamentsDirectory onHasTournamentsChange={onChange} />);
    });
    await flush();

    expect(onChange).toHaveBeenCalledWith(false);
    expect(container.innerHTML).toBe('');
  });
});
