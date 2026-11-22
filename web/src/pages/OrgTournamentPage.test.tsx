// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Tournament } from '../services/api';
import { OrgTournamentPage } from './OrgTournamentPage';

vi.mock('../components/OrganizationProvider', () => ({
  useOrganization: () => ({
    organization: {
      name: 'Highland Golf Club',
      slug: 'highland',
      logo_url: '/images/organizer.png',
      reversed_logo_url: '/images/reversed.png',
    },
    isLoading: false,
  }),
}));
vi.mock('../components/SignedInAdminBar', () => ({ SignedInAdminBar: () => null }));

const tournament = {
  id: 13,
  slug: 'spring-open',
  name: 'Spring Open',
  edition: '5th',
  status: 'open',
  event_date: '2027-04-15',
  registration_open: true,
  can_register: true,
  max_capacity: 20,
  confirmed_count: 8,
  capacity_unit: 'teams',
  team_size: 4,
  use_org_branding: true,
  banner_url_override: '/images/event.jpg',
  signature_image_url_override: '/images/emblem.png',
  commemorative_banner_url: '/images/anniversary.png',
  tribute_title: 'A tournament in remembrance',
  tribute_subtitle: 'Celebrating those who brought us together',
  story_photos: [
    { url: '/images/first.jpg', caption: 'First story' },
    { url: '/images/second.jpg' },
    { url: '/images/third.jpg', caption: 'Third story' },
  ],
  raffle_enabled: true,
  features: { sponsor_checkout: true, donations: true },
  sponsors: [{ id: 1, name: 'Fairway Supplies', tier: 'gold', major: true }],
  sponsor_wall_title: 'Community Partners',
} as Tournament;

describe('public theme pack layouts', () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderTournament(theme: Tournament['theme_preset'], overrides?: Partial<Tournament>) {
    vi.spyOn(api, 'getOrganizationTournament').mockResolvedValue({ ...tournament, theme_preset: theme, ...overrides });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/spring-open']}>
          <Routes>
            <Route path="/:tournamentSlug" element={<OrgTournamentPage />} />
          </Routes>
        </MemoryRouter>
      );
    });
  }

  it('uses a ceremonial header with the official logo, commemoration, and full-size emblem', async () => {
    await renderTournament('memorial-formal');

    const header = mount.querySelector('[data-hero-variant="ceremonial"]')!;
    expect(header.querySelector('img[alt="Highland Golf Club"]')?.getAttribute('src')).toBe('/images/organizer.png');
    expect(header.querySelector('img[alt="Commemorative banner"]')?.getAttribute('src')).toBe('/images/anniversary.png');
    expect(header.querySelector('img[alt="Tribute emblem"]')?.classList).toContain('md:h-24');
    expect(header.querySelector('.memorial-hairline')).toBeTruthy();
    expect(header.textContent).toContain('5th Annual');
    expect(header.textContent).toContain(tournament.tribute_title);
    expect(header.textContent).toContain(tournament.tribute_subtitle);
    expect(mount.textContent).not.toContain('Story & Impact');
  });

  it('uses full-bleed photography with the reversed logo, story strip, support actions, and early sponsor wall', async () => {
    await renderTournament('charity-bright');

    const header = mount.querySelector('[data-hero-variant="celebratory"]')!;
    expect(header.querySelector('img[src="/images/event.jpg"]')?.classList).toContain('object-cover');
    expect(header.querySelector('img[alt="Highland Golf Club"]')?.getAttribute('src')).toBe('/images/reversed.png');
    expect(mount.querySelectorAll('figure')).toHaveLength(3);
    expect(mount.textContent).toContain('Third story');
    expect(mount.textContent).toContain('Support the Cause');
    expect(mount.textContent).toContain('View Raffle Board');
    expect(mount.textContent).toContain('Donate Now');
    expect(mount.textContent!.indexOf('Community Partners')).toBeLessThan(mount.textContent!.indexOf('Tournament Details'));
  });

  it('shows crest artwork, registration progress and foursome, tier, and donation actions', async () => {
    await renderTournament('crest-classic');

    const header = mount.querySelector('[data-hero-variant="crest"]')!;
    expect(header.querySelector('img[alt="Tournament crest"]')?.getAttribute('src')).toBe('/images/emblem.png');
    expect(header.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(mount.textContent).toContain('Enter a Foursome');
    expect(mount.textContent).toContain('View Sponsor Tiers');
    expect(mount.textContent).toContain('Donate Now');
  });

  it('uses the editorial layout without a tribute, story strip, or meter and honors a hidden sponsor wall', async () => {
    await renderTournament('default-clean', { show_public_sponsors: false });

    const header = mount.querySelector('[data-hero-variant="editorial"]')!;
    expect(header.querySelector('h1')?.textContent).toBe('Spring Open');
    expect(header.querySelector('img[src="/images/event.jpg"]')?.classList).toContain('object-contain');
    expect(header.querySelector('[role="meter"], .memorial-hairline')).toBeNull();
    expect(mount.querySelector('figure')).toBeNull();
    expect(mount.textContent).not.toContain('Community Partners');
  });
});
