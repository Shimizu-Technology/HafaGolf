// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from './AdminLayout';

const mockAdminState = {
  isVolunteer: true,
  isAdmin: false,
  isSuperAdmin: false,
  isStationOnly: true,
  stationMode: 'checkin' as 'checkin' | 'raffle' | 'scoring' | null,
  orgRoleLabel: 'Check-In Volunteer',
  can: (cap: string) => cap === 'check_in' || cap === 'verify_door_payment',
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
    // Must not expose full admin sidebar links
    expect(mount.textContent).not.toContain('Payments');
    expect(mount.textContent).not.toContain('Settings');
    expect(mount.textContent).not.toContain('Reports');
  });
});
