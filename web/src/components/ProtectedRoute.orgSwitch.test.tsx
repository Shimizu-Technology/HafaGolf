// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProvider, useAdmin } from '../contexts/AdminContext';
import { ProtectedRoute } from './ProtectedRoute';
import { api, type Admin } from '../services/api';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isSignedIn: true, isLoaded: true, getToken: async () => 'tok_test' }),
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'multi@example.com' } } }),
}));

function CapabilityProbe() {
  const { currentAdmin, can } = useAdmin();
  return (
    <div data-testid="probe">
      role={currentAdmin?.org_role ?? 'none'}|reports={String(can('view_reports'))}
    </div>
  );
}

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

describe('ProtectedRoute out-of-order org switch', () => {
  it('discards stale earlier org responses when switching ?org= rapidly', async () => {
    let resolveOrgA!: (admin: Admin) => void;
    let resolveOrgB!: (admin: Admin) => void;

    const spy = vi.spyOn(api, 'getCurrentAdmin').mockImplementation((orgSlug?: string) => {
      if (orgSlug === 'org-a') {
        return new Promise<Admin>((resolve) => {
          resolveOrgA = resolve;
        });
      }
      return new Promise<Admin>((resolve) => {
        resolveOrgB = resolve;
      });
    });

    const router = createMemoryRouter(
      [
        {
          path: '/admin',
          element: (
            <AdminProvider>
              <ProtectedRoute>
                <CapabilityProbe />
              </ProtectedRoute>
            </AdminProvider>
          ),
        },
      ],
      { initialEntries: ['/admin?org=org-a'] }
    );

    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    expect(spy).toHaveBeenCalledWith('org-a');

    // Switch to org-b BEFORE org-a responds
    await act(async () => {
      await router.navigate('/admin?org=org-b');
    });
    expect(spy).toHaveBeenCalledWith('org-b');

    // Resolve org-b first (volunteer with no view_reports)
    await act(async () => {
      resolveOrgB({
        id: 1,
        clerk_id: 'clerk_1',
        name: 'Multi User',
        email: 'multi@example.com',
        role: 'org_admin',
        is_super_admin: false,
        org_role: 'checkin_volunteer',
        capabilities: { check_in: true, view_reports: false },
        station_mode: 'checkin',
      });
    });
    expect(mount.querySelector('[data-testid="probe"]')?.textContent).toBe('role=checkin_volunteer|reports=false');

    // Now resolve stale org-a (org_admin with view_reports: true) — MUST be ignored!
    await act(async () => {
      resolveOrgA({
        id: 1,
        clerk_id: 'clerk_1',
        name: 'Multi User',
        email: 'multi@example.com',
        role: 'org_admin',
        is_super_admin: false,
        org_role: 'org_admin',
        capabilities: { check_in: true, view_reports: true },
        station_mode: null,
      });
    });
    expect(mount.querySelector('[data-testid="probe"]')?.textContent).toBe('role=checkin_volunteer|reports=false');

    router.dispose();
  });
});
