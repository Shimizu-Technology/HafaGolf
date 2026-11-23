// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { OrganizationProvider } from '../components/OrganizationProvider';
import { OrgCheckInPage } from './OrgCheckInPage';
import { api, type Golfer, type TeamMember } from '../services/api';
import { useOrganizationStore } from '../stores/organizationStore';

const mocks = vi.hoisted(() => ({ getToken: async () => 'test-session' }));
vi.mock('../hooks/useAuthToken', () => ({ useAuthToken: () => mocks }));
vi.mock('../hooks/useGolferChannel', () => ({ useGolferChannel: () => ({ isConnected: false }) }));

const savedOrg = { id: '1', name: 'Organization A', slug: 'org-a' };
const linkedOrg = { id: '2', name: 'Organization B', slug: 'org-b' };
const eventPath = '/admin/events/spring-open/checkin';
const stamp = '2027-04-15T02:00:00Z';

const golfer = {
  id: 1, name: 'Player One', partner_name: 'Player Two', email: '', phone: '',
  tournament_id: 21, registration_status: 'confirmed', payment_status: 'paid',
  waiver_accepted_at: null, partner_waiver_accepted_at: null, waiver_signed: false,
} as Golfer;
const member = { id: 14, name: 'Player Three', position: 1, waiver_accepted_at: null, waiver_signed: false } as TeamMember;

function detail(name = 'Spring Open', golfers: Golfer[] = []) {
  return Response.json({ tournament: { id: 21, name, waiver_enabled: true }, golfers });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('admin check-in organization and refresh', () => {
  let root: ReturnType<typeof createRoot>;
  let mount: HTMLDivElement;
  let router: ReturnType<typeof createMemoryRouter>;
  let toastError: ReturnType<typeof vi.fn<typeof toast.error>>;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.setItem('hafagolf-organization', JSON.stringify({ version: 0, state: { organization: savedOrg } }));
    await useOrganizationStore.persist.rehydrate();
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
    toastError = vi.spyOn(toast, 'error').mockReturnValue('toast-id');
  });

  afterEach(() => {
    act(() => root.unmount());
    router?.dispose();
    mount.remove();
    useOrganizationStore.getState().clearOrganization();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(org = 'org-b') {
    router = createMemoryRouter([{
      path: '/admin/events/:tournamentSlug/checkin',
      element: <OrganizationProvider mode="admin"><OrgCheckInPage /></OrganizationProvider>,
    }], { initialEntries: [`${eventPath}?org=${org}`] });
    await act(async () => root.render(<RouterProvider router={router} />));
  }

  it('waits for the organization from the link, without requesting the saved organization or showing an error', async () => {
    const organizations = deferred<typeof savedOrg[]>();
    vi.spyOn(api, 'getAdminOrganizations').mockReturnValue(organizations.promise);
    const fetchMock = vi.fn(async (url: string) => url.includes('/registrations?')
      ? Response.json({ registrations: [] }) : detail('Linked event'));
    vi.stubGlobal('fetch', fetchMock);

    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mount.textContent).toContain('Loading');
    await act(async () => organizations.resolve([savedOrg, linkedOrg]));

    expect(fetchMock.mock.calls[0][0]).toContain('/organizations/org-b/tournaments/spring-open');
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/organizations/org-a/'))).toBe(false);
    expect(mount.textContent).toContain('Linked event');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('ignores an old refresh failure after switching organizations', async () => {
    vi.spyOn(api, 'getAdminOrganizations').mockResolvedValue([savedOrg, linkedOrg]);
    const stale = deferred<Response>();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/organizations/org-a/')) return stale.promise;
      return url.includes('/registrations?') ? Response.json({ registrations: [] }) : detail('Linked event');
    });
    vi.stubGlobal('fetch', fetchMock);

    await render('org-a');
    expect(fetchMock.mock.calls[0][0]).toContain('/organizations/org-a/');
    await act(async () => { await router.navigate(`${eventPath}?org=org-b`); });
    expect(mount.textContent).toContain('Linked event');
    await act(async () => stale.resolve(new Response(null, { status: 500 })));

    expect(mount.textContent).toContain('Linked event');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does not fall back to another organization when the linked one is inaccessible', async () => {
    vi.spyOn(api, 'getAdminOrganizations').mockResolvedValue([savedOrg]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await render();

    expect(mount.textContent).toContain('You do not have access to the organization in this link');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('preserves confirmed golfer, partner, and team member signatures when an older refresh finishes', async () => {
    vi.spyOn(api, 'getAdminOrganizations').mockResolvedValue([savedOrg, linkedOrg]);
    vi.spyOn(api, 'markGolferWaiverSigned').mockImplementation(async (_id, partner) => partner
      ? { ...golfer, partner_waiver_accepted_at: stamp }
      : { ...golfer, waiver_accepted_at: stamp, waiver_signed: true });
    vi.spyOn(api, 'markTeamMemberWaiverSigned').mockResolvedValue({
      team_member: { ...member, waiver_accepted_at: stamp, waiver_signed: true },
    });

    const staleGolfers = deferred<Response>();
    const staleTeam = deferred<Response>();
    const refreshRequests = { golfer: 0, registration: 0 };
    const teamSnapshot = () => Response.json({ registrations: [{
      id: 8, display_team_name: 'Morning Team', payment_status: 'paid', player_count: 1, team_members: [member],
    }] });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/registrations?')) {
        return refreshRequests.registration++ ? staleTeam.promise : teamSnapshot();
      }
      return refreshRequests.golfer++ ? staleGolfers.promise : detail('Spring Open', [golfer]);
    });
    vi.stubGlobal('fetch', fetchMock);

    await render();
    const button = (name: string) => mount.querySelector<HTMLButtonElement>(`button[aria-label="Mark Waiver Signed for ${name}"]`);
    const refresh = [...mount.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Refresh')!;
    await act(async () => refresh.click());
    expect(refreshRequests.golfer).toBe(2);
    for (const name of ['Player One', 'Player Two', 'Player Three']) {
      expect(button(name)).toBeTruthy();
      await act(async () => button(name)!.click());
      expect(button(name)).toBeNull();
    }
    await act(async () => staleGolfers.resolve(detail('Spring Open', [golfer])));
    expect(refreshRequests.registration).toBe(2);
    await act(async () => staleTeam.resolve(teamSnapshot()));

    for (const name of ['Player One', 'Player Two', 'Player Three']) {
      expect(button(name)).toBeNull();
      expect(mount.textContent).toContain(`signed for ${name}`);
    }
    expect(toastError).not.toHaveBeenCalled();
  });
});
