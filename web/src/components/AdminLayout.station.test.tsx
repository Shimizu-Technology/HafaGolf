// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { AdminOnlyRoute } from './AdminRouteGuard';
import { ScorecardPage } from '../pages/ScorecardPage';

const mockAdminState = {
  isVolunteer: true,
  isAdmin: false,
  isSuperAdmin: false,
  isStationOnly: true,
  stationMode: 'checkin' as 'checkin' | 'raffle' | 'scoring' | null,
  orgRoleLabel: 'Check-In Volunteer',
  can: ((cap: string) => cap === 'check_in' || cap === 'verify_door_payment') as (cap: string) => boolean,
};

vi.mock('@clerk/react', () => ({
  useUser: () => ({ user: { fullName: 'Desk Volunteer', primaryEmailAddress: { emailAddress: 'vol@example.com' } } }),
  UserButton: () => <div data-testid="clerk-user-button" />,
}));
const mockGetToken = async () => 'tok_marshal';
vi.mock('../hooks/useAuthToken', () => ({
  useAuthToken: () => ({ getToken: mockGetToken, isGolferAuth: false }),
}));
vi.mock('../contexts/GolferAuthContext', () => ({
  useGolferAuth: () => ({ tournament: null }),
}));
vi.mock('./OrganizationProvider', () => ({
  useOrganization: () => ({
    organization: { id: 'org-1', name: 'Island Golf', slug: 'island-golf', features: { raffle: true, sponsors: true } },
    accessibleOrganizations: [],
  }),
}));
vi.mock('../contexts', () => ({
  useAdmin: () => mockAdminState,
  useTournament: () => ({
    tournaments: [{ id: 1, name: 'Spring Classic 2026', short_name: 'Spring Classic', slug: 'spring-classic', status: 'open' }],
    currentTournament: { id: 1, name: 'Spring Classic 2026', short_name: 'Spring Classic', slug: 'spring-classic', status: 'open' },
    setCurrentTournament: vi.fn(),
    isLoading: false,
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

describe('AdminLayout Volunteer Station Mode', () => {
  it('renders streamlined Volunteer Station Bar with zero admin sidebar links for Check-In Volunteer', async () => {
    mockAdminState.stationMode = 'checkin';
    mockAdminState.orgRoleLabel = 'Check-In Volunteer';
    mockAdminState.can = (cap: string) => cap === 'check_in' || cap === 'verify_door_payment';

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/spring-classic/checkin']}>
          <AdminLayout>
            <div>Check-In Desk Content</div>
          </AdminLayout>
        </MemoryRouter>
      );
    });

    expect(mount.querySelector('[data-testid="volunteer-station-bar"]')).toBeTruthy();
    expect(mount.textContent).toContain('Check-In Station');
    expect(mount.textContent).toContain('Check-In Desk Content');
    expect(mount.textContent).not.toContain('Payments');
    expect(mount.textContent).not.toContain('Settings');
    expect(mount.textContent).not.toContain('Reports');
  });

  it('opens the real ScorecardPage group picker for Scoring Marshal without ?group= and loads a scorecard on selection', async () => {
    mockAdminState.stationMode = 'scoring';
    mockAdminState.orgRoleLabel = 'Scoring Marshal';
    mockAdminState.can = (cap: string) => cap === 'enter_scores';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/organizations/island-golf/tournaments/spring-classic')) {
          return { ok: true, json: async () => ({ id: 99, name: 'Spring Classic 2026', total_holes: 18, total_par: 72 }) };
        }
        if (url.includes('/api/v1/groups?tournament_id=99')) {
          return {
            ok: true,
            json: async () => [
              { id: 7, group_number: 3, hole_position_label: '7A', golfers: [{ id: 1, name: 'Alex Cruz' }] },
            ],
          };
        }
        if (url.includes('/api/v1/tournaments/99/scores/scorecard?group_id=7')) {
          return {
            ok: true,
            json: async () => ({
              group: { id: 7, group_number: 3, hole_position: '7A', starting_hole_description: 'Hole 7A' },
              golfers: [{ id: 1, name: 'Alex Cruz' }],
              holes: [{ hole: 1, par: 4, scores: [{ golfer_id: 1, golfer_name: 'Alex Cruz', strokes: null, relative: null }] }],
              totals: [{ golfer_id: 1, golfer_name: 'Alex Cruz', total_strokes: 0, total_relative: 0, holes_completed: 0 }],
            }),
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/spring-classic/scoring']}>
          <AdminLayout>
            <Routes>
              <Route
                path="/admin/events/:tournamentSlug/scoring"
                element={
                  <AdminOnlyRoute capability="enter_scores">
                    <ScorecardPage />
                  </AdminOnlyRoute>
                }
              />
            </Routes>
          </AdminLayout>
        </MemoryRouter>
      );
    });

    expect(mount.querySelector('[data-testid="volunteer-station-bar"]')).toBeTruthy();
    expect(mount.querySelector('[data-testid="scoring-group-picker"]')).toBeTruthy();
    expect(mount.textContent).toContain('Group 3');
    expect(mount.textContent).toContain('Alex Cruz');

    const groupBtn = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-testid="scoring-group-picker"] button'))[0];
    await act(async () => groupBtn.click());

    expect(mount.querySelector('[data-testid="scoring-group-picker"]')).toBeNull();
    expect(mount.textContent).toContain('Group 3');
    expect(mount.textContent).toContain('Hole 7A');
  });
});
