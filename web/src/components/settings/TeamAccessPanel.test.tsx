// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamAccessPanel } from './TeamAccessPanel';
import { mockDialog } from '../../test/mockDialog';

mockDialog();

const fixture = {
  members: [
    {
      id: '1',
      name: 'Org Chair',
      email: 'chair@example.com',
      role: 'org_admin',
      canonical_role: 'org_admin',
      role_label: 'Org Admin',
      permissions: {},
      effective_capabilities: { check_in: true, manage_team: true },
      scoped_tournament_ids: [],
    },
    {
      id: '2',
      name: 'Desk Volunteer',
      email: 'desk@example.com',
      role: 'checkin_volunteer',
      canonical_role: 'checkin_volunteer',
      role_label: 'Check-In Volunteer',
      permissions: {},
      effective_capabilities: { check_in: true, verify_door_payment: true, raffle_sell: false },
      scoped_tournament_ids: [],
    },
  ],
  role_catalog: [
    { key: 'org_admin', label: 'Org Admin', description: 'Full access', default_capabilities: ['check_in', 'verify_door_payment', 'raffle_sell', 'manage_team'] },
    { key: 'coordinator', label: 'Tournament Coordinator', description: 'Event ops', default_capabilities: ['check_in', 'verify_door_payment', 'raffle_sell'] },
    { key: 'checkin_volunteer', label: 'Check-In Volunteer', description: 'Check-in desk', default_capabilities: ['check_in', 'verify_door_payment'] },
    { key: 'raffle_volunteer', label: 'Raffle Volunteer', description: 'Raffle POS', default_capabilities: ['raffle_sell'] },
    { key: 'scoring_marshal', label: 'Scoring Marshal', description: 'Course scoring', default_capabilities: ['enter_scores'] },
  ],
  capability_catalog: [
    { key: 'check_in', label: 'Player Check-In', category: 'Day-Of Ops', description: 'Check in players' },
    { key: 'verify_door_payment', label: 'Verify Door Payments', category: 'Day-Of Ops', description: 'Verify door payments' },
    { key: 'raffle_sell', label: 'Sell Raffle Tickets', category: 'Raffle', description: 'Sell tickets' },
  ],
  tournaments: [{ id: 42, name: 'Spring Classic 2026', slug: 'spring-classic-2026' }],
};

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

describe('TeamAccessPanel (5-role RBAC)', () => {
  it('renders all 5 role presets and saves capability overrides & tournament scope via PATCH', async () => {
    const requestMock = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return {
          member: {
            ...fixture.members[1],
            permissions: { raffle_sell: true },
            scoped_tournament_ids: [42],
          },
        };
      }
      return fixture;
    });

    await act(async () => {
      root.render(<TeamAccessPanel request={requestMock} organizationSlug="island-golf" />);
    });

    const roleSelect = mount.querySelector<HTMLSelectElement>('select')!;
    const options = Array.from(roleSelect.options).map((o) => o.value);
    expect(options).toEqual([
      'org_admin',
      'coordinator',
      'checkin_volunteer',
      'raffle_volunteer',
      'scoring_marshal',
    ]);

    // Open Permissions editor for Desk Volunteer
    const permButtons = Array.from(mount.querySelectorAll<HTMLButtonElement>('button')).filter((b) =>
      b.textContent?.includes('Permissions')
    );
    await act(async () => permButtons[1].click());

    const editor = mount.querySelector('[data-testid="member-permissions-editor-2"]')!;
    expect(editor).toBeTruthy();

    // Check 'Sell Raffle Tickets' override & 'Spring Classic 2026' scope
    const checkboxes = Array.from(editor.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    await act(async () => checkboxes[2].click()); // raffle_sell override
    await act(async () => checkboxes[3].click()); // tournament 42 scope

    const saveBtn = Array.from(editor.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Save permissions')
    )!;
    await act(async () => saveBtn.click());

    const patchCall = requestMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall?.[0]).toBe('/api/v1/admin/organizations/island-golf/members/2');
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      role: 'checkin_volunteer',
      permissions: { raffle_sell: true },
      scoped_tournament_ids: [42],
    });
  });
});
