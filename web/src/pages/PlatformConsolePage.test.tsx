// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformConsolePage } from './PlatformConsolePage';

const mockAdmin = { isSuperAdmin: true };
vi.mock('../contexts', () => ({ useAdmin: () => mockAdmin }));
vi.mock('../hooks/useAuthToken', () => ({ useAuthToken: () => ({ getToken: async () => 'tok_test' }) }));
vi.mock('../services/api', () => ({
  api: {
    getAdminOrganizations: vi.fn().mockResolvedValue([]),
    createOrganizationDomain: vi.fn(),
    updateOrganizationDomain: vi.fn(),
    deleteOrganizationDomain: vi.fn(),
  },
}));

const overviewFixture = {
  summary: {
    total_orgs: 2,
    active_orgs: 2,
    offseason_orgs: 0,
    archived_orgs: 0,
    active_tournaments: 2,
    total_confirmed_golfers: 197,
    pending_payouts_cents: 1245000,
    platform_collect_org_count: 1,
  },
  feature_catalog: [
    { key: 'raffle', label: 'Raffle & Live Draw', description: 'Raffle tickets and board', category: 'fundraising', category_label: 'Fundraising', default: true },
    { key: 'donations', label: 'Online Donations', description: 'Online donations', category: 'fundraising', category_label: 'Fundraising', default: false },
  ],
  organizations: [
    {
      id: '1',
      name: 'Island Memorial Classic',
      slug: 'island-memorial',
      status: 'active',
      subscription_status: 'active',
      offseason_enabled: false,
      primary_color: '#1E3A5F',
      primary_host: 'island-memorial.example.com',
      domains: [{ id: '1', hostname: 'island-memorial.example.com', is_primary: true }],
      features: { raffle: false, donations: false },
      payment_mode: 'platform_collect',
      processor_provider: 'stripe',
      platform_fee_per_registrant_cents: 400,
      tournament_count: 1,
      active_tournament_count: 1,
      confirmed_golfers_count: 143,
      latest_tournament_slug: 'memorial-2026',
      admins: [{ id: 10, user_id: 10, email: 'chair@island-memorial.example.com', role: 'admin' }],
    },
  ],
  settlements: [
    {
      organization_id: '1',
      organization_name: 'Island Memorial Classic',
      organization_slug: 'island-memorial',
      tournament_id: 1,
      tournament_name: 'Memorial 2026',
      tournament_slug: 'memorial-2026',
      tournament_status: 'open',
      settlement_status: 'draft',
      gross_cents: 1355000,
      processing_fee_cents: 40000,
      platform_fee_cents: 70000,
      net_cents: 1245000,
      organizer_proceeds_cents: 1245000,
      paid_cents: 0,
      balance_due_cents: 1245000,
    },
  ],
};

let mount: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mockAdmin.isSuperAdmin = true;
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => overviewFixture,
    })
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PlatformConsolePage', () => {
  it('blocks non-super-admin users', async () => {
    mockAdmin.isSuperAdmin = false;
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlatformConsolePage />
        </MemoryRouter>
      );
    });
    expect(mount.textContent).toContain('Super Admin Access Required');
  });

  it('renders KPI summary, opens Per-Org Control Panel, and displays cross-org settlements', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlatformConsolePage />
        </MemoryRouter>
      );
    });

    expect(mount.textContent).toContain('Platform Super Admin Console');
    expect(mount.textContent).toContain('$12,450.00');
    expect(mount.textContent).toContain('Island Memorial Classic');

    const panelBtn = Array.from(mount.querySelectorAll('button')).find((b) => b.textContent?.includes('Control Panel'));
    await act(async () => panelBtn!.click());
    expect(mount.querySelector('[data-testid="org-control-panel"]')).toBeTruthy();

    const settlementsTab = Array.from(mount.querySelectorAll('[role="tab"]')).find((b) =>
      b.textContent?.includes('Settlements')
    ) as HTMLButtonElement;
    await act(async () => settlementsTab.click());
    expect(mount.textContent).toContain('Platform Collect Settlements & Payouts');
    expect(mount.textContent).toContain('$13,550.00');
  });

  it('opens the 5-step New Organization Wizard', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlatformConsolePage />
        </MemoryRouter>
      );
    });

    const newOrgBtn = Array.from(mount.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('New Organization')
    );
    await act(async () => newOrgBtn!.click());
    expect(mount.querySelector('[data-testid="new-org-wizard"]')).toBeTruthy();
    expect(mount.textContent).toContain('Step 1 of 5');
  });
});
