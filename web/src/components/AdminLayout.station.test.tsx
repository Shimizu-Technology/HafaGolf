// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';
import { AdminOnlyRoute } from './AdminRouteGuard';

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

  it('allows Scoring Marshal to land on /scoring station while blocking /checkin', async () => {
    mockAdminState.stationMode = 'scoring';
    mockAdminState.orgRoleLabel = 'Scoring Marshal';
    mockAdminState.can = (cap: string) => cap === 'enter_scores';

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/spring-classic/scoring']}>
          <AdminLayout>
            <Routes>
              <Route
                path="/admin/events/:tournamentSlug/scoring"
                element={
                  <AdminOnlyRoute capability="enter_scores">
                    <div>Scoring Marshal Station Active</div>
                  </AdminOnlyRoute>
                }
              />
              <Route path="/admin" element={<div>Redirected Home</div>} />
            </Routes>
          </AdminLayout>
        </MemoryRouter>
      );
    });

    expect(mount.querySelector('[data-testid="volunteer-station-bar"]')).toBeTruthy();
    expect(mount.textContent).toContain('Scoring Station');
    expect(mount.textContent).toContain('Scoring Marshal Station Active');
  });
});
