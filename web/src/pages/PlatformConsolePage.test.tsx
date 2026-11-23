// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformConsolePage } from './PlatformConsolePage';
import { mockDialog } from '../test/mockDialog';

mockDialog();

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
    estimated_pending_payouts_cents: 1245000,
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
      domains: [{ id: 'dom-1', hostname: 'island-memorial.example.com', is_primary: true }],
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
      settlement_status: 'finalized',
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
let fetchMock: ReturnType<typeof vi.fn>;

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mockAdmin.isSuperAdmin = true;
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return { ok: true, json: async () => ({ organization: { id: '2', name: 'Rotary Cup', slug: 'rotary-cup' } }) };
    }
    return { ok: true, json: async () => overviewFixture };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PlatformConsolePage', () => {
  it('blocks non-super-admin users without fetching platform overview', async () => {
    mockAdmin.isSuperAdmin = false;
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PlatformConsolePage />
        </MemoryRouter>
      );
    });
    expect(mount.textContent).toContain('Super Admin Access Required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders KPI summary, sends PATCH payloads from Per-Org Control Panel, verifies links, and displays settlements', async () => {
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

    const studioLink = Array.from(mount.querySelectorAll('a')).find((a) => a.textContent?.includes('Homepage Studio'));
    expect(studioLink?.getAttribute('href')).toBe('/admin/settings?org=island-memorial&tab=look');

    const panelBtn = Array.from(mount.querySelectorAll('button')).find((b) => b.textContent?.includes('Control Panel'));
    await act(async () => panelBtn!.click());
    expect(mount.querySelector('[data-testid="org-control-panel"]')).toBeTruthy();

    // Toggle status -> offseason sends expected PATCH payload
    const offseasonBtn = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-testid="org-control-panel"] button')).find(
      (b) => b.textContent?.trim() === 'offseason'
    );
    await act(async () => offseasonBtn!.click());
    const statusPatch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(statusPatch?.[0]).toBe('/api/v1/admin/platform/organizations/island-memorial');
    expect(JSON.parse(String(statusPatch?.[1]?.body))).toEqual({ organization: { status: 'offseason' } });

    // Archive requires confirmation dialog
    const archiveBtn = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-testid="org-control-panel"] button')).find(
      (b) => b.textContent?.trim() === 'archived'
    );
    await act(async () => archiveBtn!.click());
    const confirmDialog = document.querySelector('dialog[role="alertdialog"]');
    expect(confirmDialog?.textContent).toContain('Archive Island Memorial Classic?');

    const settlementsTab = Array.from(mount.querySelectorAll('[role="tab"]')).find((b) =>
      b.textContent?.includes('Settlements')
    ) as HTMLButtonElement;
    await act(async () => settlementsTab.click());
    expect(mount.textContent).toContain('Platform Collect Settlements & Payouts');
    expect(mount.textContent).toContain('$13,550.00');
  });

  it('completes the 5-step New Organization Wizard and sends only non-default feature overrides', async () => {
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

    const nameInput = mount.querySelector<HTMLInputElement>('input[placeholder="Rotary Club of Tumon Bay"]')!;
    await act(async () => setInputValue(nameInput, 'Rotary Cup'));

    const clickNext = async () => {
      const nextBtn = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-testid="new-org-wizard"] button')).find((b) =>
        b.textContent?.includes('Next')
      );
      await act(async () => nextBtn!.click());
    };

    await clickNext(); // Step 2: Theme
    await clickNext(); // Step 3: Modules

    // Toggle only 'donations' (default false -> true); leave 'raffle' at default true
    const checkboxes = Array.from(mount.querySelectorAll<HTMLInputElement>('[data-testid="new-org-wizard"] input[type="checkbox"]'));
    await act(async () => checkboxes[1].click());

    await clickNext(); // Step 4: Payments
    await clickNext(); // Step 5: Org Admins

    const finishBtn = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-testid="new-org-wizard"] button')).find((b) =>
      b.textContent?.includes('Launch Organization')
    );
    await act(async () => finishBtn!.click());

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall?.[0]).toBe('/api/v1/admin/platform/organizations');
    const submitted = JSON.parse(String(postCall?.[1]?.body)).organization;
    expect(submitted.name).toBe('Rotary Cup');
    // Only the non-default override should be sent
    expect(submitted.features).toEqual({ donations: true });
  });
});
