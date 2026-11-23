// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { SponsorManagementPage } from './SponsorManagementPage';

const stable = vi.hoisted(() => ({
  auth: { getToken: async () => 'admin-token' },
  org: { organization: { id: 'org-1', name: 'Highland Golf Club', slug: 'highland' }, isLoading: false },
}));
vi.mock('@clerk/react', () => ({ useAuth: () => stable.auth }));
vi.mock('../components/OrganizationProvider', () => ({ useOrganization: () => stable.org }));

const sponsorRow = (overrides: Record<string, unknown>) => ({
  id: 1, name: 'Harbor Bank', tier: 'gold', tier_display: 'Gold', logo_url: null, raw_logo_url: null,
  has_uploaded_logo: false, website_url: null, description: null, course_key: null, course_name: null,
  hole_number: null, position: 0, active: true, major: false, display_label: 'Gold', slot_count: 4,
  login_email: 'hr@harbor.example.test', slots_filled: 3, has_active_portal_link: false, portal_link_issued_at: null,
  ...overrides,
});

const manageResponse = (showPublic = true) => ({
  sponsors: [
    sponsorRow({}),
    sponsorRow({ id: 2, name: 'Coastal Grill', tier: 'silver', tier_display: 'Silver', display_label: 'Silver', slot_count: 4, slots_filled: 4, login_email: null }),
    sponsorRow({ id: 3, name: 'Quiet Partner', tier: 'silver', tier_display: 'Silver', display_label: 'Silver', slot_count: 0, slots_filled: 0, active: false }),
  ],
  tier_definitions: [
    { key: 'gold', label: 'Gold', sort_order: 0 },
    { key: 'silver', label: 'Silver', sort_order: 1 },
  ],
  tournament: {
    id: 21, name: 'Spring Open', slug: 'spring-open', team_size: 2, show_public_sponsors: showPublic,
    sponsor_wall_title: null, public_listed: true, public_page_url: 'https://events.example.test/spring-open',
    sponsor_edit_deadline: null, course_configs: [],
  },
  summary: { total_sponsors: 3, active_sponsors: 2, portal_slots_total: 8, portal_slots_filled: 7 },
});

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const buttonByText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text))!;

describe('SponsorManagementPage', () => {
  let mount: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/admin/organizations/highland/tournaments/spring-open')) return Response.json({ tournament: { id: 21 } });
      if (url.endsWith('/api/v1/tournaments/21/sponsors/manage')) return Response.json(manageResponse());
      if (url.endsWith('/api/v1/tournaments/21/sponsors/1/portal_link')) {
        return Response.json({ url: 'https://events.example.test/sponsor-portal?token=abc', expires_at: '2027-01-01T00:00:00Z' });
      }
      if (url.endsWith('/api/v1/tournaments/21') && init?.method === 'PATCH') return Response.json({ id: 21 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/spring-open/sponsors']}>
          <Routes>
            <Route path="/admin/events/:tournamentSlug/sponsors" element={<SponsorManagementPage />} />
          </Routes>
        </MemoryRouter>
      );
    });
  }

  it('shows the summary strip, tier pills, and team-aware sponsor rows', async () => {
    await render();

    const summary = mount.querySelector('[aria-label="Sponsor summary"]')!;
    expect(summary.textContent).toContain('Total Sponsors2');
    expect(summary.textContent).toContain('1 hidden');
    expect(summary.textContent).toContain('7 / 8 players');
    expect(summary.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('7');
    expect(summary.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(summary.querySelector('a')?.getAttribute('href')).toBe('https://events.example.test/spring-open');
    expect(summary.querySelector('a')?.getAttribute('target')).toBe('_blank');

    const harbor = mount.querySelector('article[aria-label="Harbor Bank"]')!;
    expect(harbor.textContent).toContain('2 Teams (4 slots) · 3/4 entered');
    expect(harbor.textContent).toContain('3/4 Filled');
    expect(harbor.textContent).toContain('hr@harbor.example.test');
    expect(harbor.querySelector('[data-testid="sponsor-monogram"]')?.textContent).toBe('HB');

    const grill = mount.querySelector('article[aria-label="Coastal Grill"]')!;
    expect(grill.textContent).toContain('All Entered');
    expect(buttonByText(grill, 'Copy Portal Link').disabled).toBe(true);
    expect(grill.textContent).toContain('Add a portal email to share the portal.');

    expect(mount.querySelector('article[aria-label="Quiet Partner"]')?.textContent).toContain('No Slots');

    const pills = Array.from(mount.querySelectorAll('nav[aria-label="Filter by tier"] button')).map((b) => b.textContent);
    expect(pills).toEqual(['All3', 'Gold1', 'Silver2']);
    await act(async () => { click(buttonByText(mount.querySelector('nav')!, 'Silver')); });
    expect(mount.querySelector('article[aria-label="Harbor Bank"]')).toBeNull();
    expect(mount.querySelector('article[aria-label="Coastal Grill"]')).not.toBeNull();
  });

  it('toggles the public sponsor wall through the tournament API', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue('id');
    await render();

    await act(async () => { click(mount.querySelector('[role="switch"]')!); });
    const patch = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/api/v1/tournaments/21') && init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ tournament: { show_public_sponsors: false } });
    expect(mount.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(success).toHaveBeenCalledWith('Sponsors are now hidden from the public page');
  });

  it('copies a direct portal link and falls back to showing it when the clipboard is unavailable', async () => {
    const success = vi.spyOn(toast, 'success').mockReturnValue('id');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await render();

    const harbor = mount.querySelector('article[aria-label="Harbor Bank"]')!;
    await act(async () => { click(buttonByText(harbor, 'Copy Portal Link')); });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/sponsors/1/portal_link'))!;
    expect(call[1]?.method).toBe('POST');
    expect((call[1]?.headers as Record<string, string>).Authorization).toBe('Bearer admin-token');
    expect(writeText).toHaveBeenCalledWith('https://events.example.test/sponsor-portal?token=abc');
    expect(success).toHaveBeenCalledWith('Link copied for WhatsApp / SMS');

    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    await act(async () => { click(buttonByText(harbor, 'Copy Portal Link')); });
    expect(harbor.querySelector<HTMLInputElement>('#portal-link-1')?.value).toBe('https://events.example.test/sponsor-portal?token=abc');
  });
});
