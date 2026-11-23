// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tournament } from '../services/api';
import { THEME_PACKS } from '../utils/themePacks';
import { PublicSponsors } from './PublicSponsors';

const baseTournament = {
  id: 7,
  slug: 'spring-open',
  name: 'Spring Open',
  sponsors: [
    { id: 1, name: 'Fairway Supplies', tier: 'title', major: true, logo_url: null, website_url: 'https://fairway.example.test' },
    { id: 2, name: 'Bank of the Pacific', tier: 'title', major: true, logo_url: '/images/bank.png', website_url: 'javascript:alert(1)' },
    { id: 3, name: 'Coastal Grill', tier: 'silver', major: false, logo_url: null },
    { id: 4, name: 'Island Print', tier: 'silver', major: false, logo_url: null },
  ],
} as unknown as Tournament;

describe('PublicSponsors', () => {
  let mount: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
    vi.unstubAllGlobals();
  });

  function render(tournament: Tournament, featuredOnly = false) {
    act(() => {
      root.render(<PublicSponsors tournament={tournament} pack={THEME_PACKS['default-clean']} featuredOnly={featuredOnly} />);
    });
  }

  it('uses the default title and shows a monogram for sponsors without a logo', () => {
    render(baseTournament);

    expect(mount.querySelector('h2')?.textContent).toBe('Our Sponsors');
    const monograms = Array.from(mount.querySelectorAll('[data-testid="sponsor-monogram"]'));
    expect(monograms.map((m) => m.textContent)).toEqual(['FS', 'CG', 'IP']);
    expect(mount.querySelector('img[alt="Bank of the Pacific"]')?.getAttribute('src')).toBe('/images/bank.png');
  });

  it('keeps unsafe website URLs from becoming links', () => {
    render(baseTournament);

    const hrefs = Array.from(mount.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://fairway.example.test/']);
  });

  it('respects a custom wall title, the hidden toggle, and the featured-only showcase', () => {
    render({ ...baseTournament, sponsor_wall_title: 'Event Partners' } as Tournament, true);
    expect(mount.querySelector('h2')?.textContent).toBe('Event Partners');
    expect(mount.textContent).toContain('Fairway Supplies');
    expect(mount.textContent).not.toContain('Island Print');

    render({ ...baseTournament, show_public_sponsors: false } as Tournament);
    expect(mount.innerHTML).toBe('');
  });
});
