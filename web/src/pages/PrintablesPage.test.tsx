// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintablesPage } from './PrintablesPage';

const mockGetToken = async () => 'tok_print';
vi.mock('../hooks/useAuthToken', () => ({
  useAuthToken: () => ({ getToken: mockGetToken }),
}));
vi.mock('../components/OrganizationProvider', () => ({
  useOrganization: () => ({
    organization: {
      id: 'org-1',
      name: 'Island Charity Golf',
      slug: 'island-charity',
      logo_url: 'https://example.com/org.png',
      features: { sponsors: true },
    },
  }),
}));

let mount: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PrintablesPage', () => {
  it('fetches exact API routes, renders all 4 printable day-of sheets with accurate waiver status, and invokes window.print()', async () => {
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/v1/admin/organizations/island-charity/tournaments/spring-2026') {
        return {
          ok: true,
          json: async () => ({
            tournament: {
              id: 55,
              name: 'Spring Charity Classic 2026',
              slug: 'spring-2026',
              event_date: '2026-05-02',
              location_name: 'Country Club of the Pacific',
              shotgun_time: '7:30 AM',
              features: { sponsors: true },
            },
            golfers: [
              {
                id: 1,
                name: 'Zoe Taitano',
                partner_name: 'Carlos Borja',
                registration_status: 'confirmed',
                payment_status: 'paid',
                waiver_signed: true,
                waiver_accepted_at: '2026-05-01T00:00:00Z',
                raffle_tickets_requested: 5,
                hole_position_label: '7A',
              },
              {
                id: 2,
                name: 'Ben Aguon',
                registration_status: 'confirmed',
                payment_status: 'unpaid',
                waiver_signed: false,
                waiver_accepted_at: null,
                hole_position_label: '1A',
              },
            ],
          }),
        };
      }
      if (url === '/api/v1/groups?tournament_id=55') {
        return {
          ok: true,
          json: async () => [
            {
              id: 101,
              group_number: 4,
              hole_number: 7,
              hole_position_label: '7A',
              golfers: [
                {
                  id: 1,
                  name: 'Zoe Taitano',
                  partner_name: 'Carlos Borja',
                  team_name: 'Ocean Eagles',
                  registration_status: 'confirmed',
                  payment_status: 'paid',
                  waiver_signed: true,
                  waiver_accepted_at: '2026-05-01T00:00:00Z',
                },
              ],
            },
          ],
        };
      }
      if (url === '/api/v1/tournaments/55/sponsors/manage') {
        return {
          ok: true,
          json: async () => ({
            sponsors: [
              { id: 1, name: 'Pacific Bank', tier: 'gold', tier_display: 'Gold Sponsor', hole_number: 7, slot_count: 4, active: true },
            ],
            tier_definitions: [{ key: 'gold', label: 'Gold Sponsor', position: 0 }],
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/spring-2026/printables']}>
          <Routes>
            <Route path="/admin/events/:tournamentSlug/printables" element={<PrintablesPage />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // 1. Cart Signs default tab
    expect(mount.querySelector('[data-testid="sheet-cart-signs"]')).toBeTruthy();
    expect(mount.textContent).toContain('HOLE 7A');
    expect(mount.textContent).toContain('Zoe Taitano');
    expect(mount.textContent).toContain('Pacific Bank');
    expect(mount.querySelector('[data-testid="printables-warning-banner"]')).toBeNull();

    // 2. Pro Shop Shotgun Sheet
    const tabs = Array.from(mount.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    await act(async () => tabs[1].click());
    expect(mount.querySelector('[data-testid="sheet-shotgun"]')).toBeTruthy();
    expect(mount.textContent).toContain('Ocean Eagles');

    // 3. Alphabetical Check-In Backup Sheet: Ben Aguon -> Carlos Borja (partner!) -> Zoe Taitano, with YES waiver & raffle add-on
    await act(async () => tabs[2].click());
    const alphaSheet = mount.querySelector('[data-testid="sheet-alpha-checkin"]')!;
    const text = alphaSheet.textContent || '';
    expect(text.indexOf('Ben Aguon')).toBeLessThan(text.indexOf('Carlos Borja'));
    expect(text.indexOf('Carlos Borja')).toBeLessThan(text.indexOf('Zoe Taitano'));
    expect(text).toContain('YES');
    expect(text).toContain('5× Raffle');

    // 4. Sponsor Signage Checklist
    await act(async () => tabs[3].click());
    expect(mount.querySelector('[data-testid="sheet-sponsor-signage"]')).toBeTruthy();
    expect(mount.textContent).toContain('Pacific Bank');
    expect(mount.textContent).toContain('Hole 7');
    expect(mount.textContent).toContain('4 player slots');

    const printBtn = Array.from(mount.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Print / Save as PDF')
    )!;
    await act(async () => printBtn.click());
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces an explicit warning banner when groups or sponsors endpoints fail instead of silently hiding errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/v1/admin/organizations/island-charity/tournaments/spring-2026') {
          return {
            ok: true,
            json: async () => ({
              tournament: { id: 55, name: 'Spring Charity Classic 2026', slug: 'spring-2026', features: { sponsors: true } },
              golfers: [],
            }),
          };
        }
        return { ok: false, status: 500, json: async () => ({ error: 'Boom' }) };
      })
    );

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/spring-2026/printables']}>
          <Routes>
            <Route path="/admin/events/:tournamentSlug/printables" element={<PrintablesPage />} />
          </Routes>
        </MemoryRouter>
      );
    });

    const banner = mount.querySelector('[data-testid="printables-warning-banner"]');
    expect(banner?.textContent).toContain('Could not load tournament hole assignments');
    expect(banner?.textContent).toContain('Could not load sponsors');
  });
});
