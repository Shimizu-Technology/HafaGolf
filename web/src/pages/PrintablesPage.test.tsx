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
    organization: { id: 'org-1', name: 'Island Charity Golf', slug: 'island-charity', logo_url: 'https://example.com/org.png' },
  }),
}));

let mount: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/admin/organizations/island-charity/tournaments/spring-2026')) {
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
            },
            golfers: [
              {
                id: 1,
                name: 'Zoe Taitano',
                registration_status: 'confirmed',
                payment_status: 'paid',
                waiver_accepted_at: '2026-05-01T00:00:00Z',
                hole_position_label: '7A',
              },
              {
                id: 2,
                name: 'Ben Aguon',
                registration_status: 'confirmed',
                payment_status: 'unpaid',
                hole_position_label: '1A',
              },
            ],
          }),
        };
      }
      if (url.includes('/api/v1/groups?tournament_id=55')) {
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
                  team_name: 'Ocean Eagles',
                  registration_status: 'confirmed',
                  payment_status: 'paid',
                  waiver_accepted_at: '2026-05-01T00:00:00Z',
                },
              ],
            },
          ],
        };
      }
      if (url.includes('/sponsors')) {
        return {
          ok: true,
          json: async () => ({
            sponsors: [
              { id: 1, name: 'Pacific Bank', tier: 'gold', hole_number: 7, active: true },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PrintablesPage', () => {
  it('renders all 4 printable day-of sheets from live tournament data and invokes window.print()', async () => {
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);

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

    // 2. Pro Shop Shotgun Sheet
    const tabs = Array.from(mount.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    await act(async () => tabs[1].click());
    expect(mount.querySelector('[data-testid="sheet-shotgun"]')).toBeTruthy();
    expect(mount.textContent).toContain('Pro Shop Shotgun / Tee Sheet');
    expect(mount.textContent).toContain('Ocean Eagles');

    // 3. Alphabetical Check-In Backup Sheet (Ben Aguon before Zoe Taitano)
    await act(async () => tabs[2].click());
    const alphaSheet = mount.querySelector('[data-testid="sheet-alpha-checkin"]')!;
    expect(alphaSheet).toBeTruthy();
    const text = alphaSheet.textContent || '';
    expect(text.indexOf('Ben Aguon')).toBeLessThan(text.indexOf('Zoe Taitano'));

    // 4. Sponsor Signage Checklist
    await act(async () => tabs[3].click());
    expect(mount.querySelector('[data-testid="sheet-sponsor-signage"]')).toBeTruthy();
    expect(mount.textContent).toContain('Pacific Bank');
    expect(mount.textContent).toContain('Hole 7');

    // Print button invokes window.print
    const printBtn = Array.from(mount.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Print / Save as PDF')
    )!;
    await act(async () => printBtn.click());
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
