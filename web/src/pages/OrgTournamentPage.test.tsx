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

  it('uses ceremonial-light with single deduplicated commemorative logo, tribute silhouette, and structured Event Details card', async () => {
    await renderTournament('memorial-formal');

    const header = mount.querySelector('[data-hero-variant="ceremonial"]')!;
    // Single-logo deduplication: commemorative banner wins without duplicating the org logo
    expect(header.querySelector('img[alt="Commemorative banner"]')?.getAttribute('src')).toBe('/images/anniversary.png');
    expect(header.querySelector('img[alt="Highland Golf Club"]')).toBeNull();
    expect(header.querySelector('img[alt="Tribute emblem"]')?.getAttribute('src')).toBe('/images/emblem.png');
    expect(header.querySelector('[data-status-pill="open"]')).toBeTruthy();
    expect(header.textContent).toContain('5th Annual');
    expect(header.textContent).toContain(tournament.tribute_title);
    expect(header.textContent).toContain(tournament.tribute_subtitle);
    expect(mount.textContent).toContain('Event Details');
    expect(mount.textContent).not.toContain('Story & Impact');
  });

  it('uses charity-showcase 2-column framed flyer (object-contain) by default, with story strip, support actions, and early sponsor wall', async () => {
    await renderTournament('charity-bright');

    const header = mount.querySelector('[data-hero-variant="celebratory"]')!;
    expect(header.getAttribute('data-artwork-display')).toBe('showcase_split');
    expect(header.querySelector('img[src="/images/event.jpg"]')?.classList).toContain('object-contain');
    expect(header.querySelector('[data-status-pill="open"]')).toBeTruthy();
    expect(mount.querySelectorAll('figure')).toHaveLength(3);
    expect(mount.textContent).toContain('Third story');
    expect(mount.textContent).toContain('Support the Cause');
    expect(mount.textContent).toContain('View Raffle Board');
    expect(mount.textContent).toContain('Donate Now');
    const partnersIndex = mount.textContent!.indexOf('Community Partners');
    const detailsIndex = mount.textContent!.indexOf('Tournament Details');
    expect(partnersIndex).toBeGreaterThanOrEqual(0);
    expect(detailsIndex).toBeGreaterThanOrEqual(0);
    expect(partnersIndex).toBeLessThan(detailsIndex);
  });

  it('supports scenic-photo full-bleed background photography with reversed logo when explicitly configured', async () => {
    await renderTournament('charity-bright', {
      homepage_config: { archetype: 'scenic-photo', hero_surface: 'photo_scrim', artwork_display: 'full_bleed_bg' },
    });

    const header = mount.querySelector('[data-hero-variant="celebratory"]')!;
    expect(header.querySelector('img[src="/images/event.jpg"]')?.classList).toContain('object-cover');
    expect(header.querySelector('img[alt="Highland Golf Club"]')?.getAttribute('src')).toBe('/images/reversed.png');
  });

  it('shows crest artwork, registration progress, uniform action cards, and collapses gracefully without artwork', async () => {
    await renderTournament('crest-classic');

    const header = mount.querySelector('[data-hero-variant="crest"]')!;
    expect(header.querySelector('img[alt="Tournament crest"]')?.getAttribute('src')).toBe('/images/emblem.png');
    expect(header.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(mount.querySelectorAll('[data-action-card="true"]').length).toBeGreaterThanOrEqual(3);
    expect(mount.textContent).toContain('Enter a Foursome');
    expect(mount.textContent).toContain('View Sponsor Tiers');
    expect(mount.textContent).toContain('Donate Now');
  });

  it('keeps a hero Register CTA on ceremonial-light when event_details_card is hidden', async () => {
    await renderTournament('memorial-formal', {
      homepage_config: {
        archetype: 'ceremonial-light',
        sections: [{ key: 'event_details_card', enabled: false }],
      },
    });

    const header = mount.querySelector('[data-hero-variant="ceremonial"]')!;
    expect(header.querySelector('a[href="/spring-open/register"]')).toBeTruthy();
  });

  it('shows explicit reversed logo in charity showcase_split mode when selected', async () => {
    await renderTournament('charity-bright', {
      homepage_config: {
        archetype: 'charity-showcase',
        artwork_display: 'showcase_split',
        logo_display: 'reversed_logo',
      },
    });

    const header = mount.querySelector('[data-hero-variant="celebratory"]')!;
    expect(header.querySelector('img[alt="Highland Golf Club"]')?.getAttribute('src')).toBe('/images/reversed.png');
    expect(header.querySelector('img[src="/images/event.jpg"]')?.classList).toContain('object-contain');
  });

  it('collapses crest-classic visual frame when all crest, logo, and photo sources are absent', async () => {
    await renderTournament('crest-classic', {
      banner_url_override: null,
      signature_image_url_override: null,
      logo_url_override: null,
      homepage_config: { archetype: 'varsity-crest', logo_display: 'none', artwork_display: 'emblem_lockup' },
    });

    const header = mount.querySelector('[data-hero-variant="crest"]')!;
    expect(header.querySelector('img')).toBeNull();
    expect(header.querySelector('svg.lucide-shield')).toBeNull();
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
