// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloneTournamentModal } from '../CloneTournamentModal';
import { api, type CloneTournamentResponse, type Organization, type Tournament } from '../../services/api';
import {
  buildDefaultCloneForm,
  incrementEdition,
  isCrossOrgClone,
} from '../../utils/tournamentClone';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 42,
    name: 'Pacific Classic',
    slug: 'pacific-classic-2026',
    year: 2026,
    edition: '5th Annual',
    event_type: 'golf_tournament',
    status: 'open',
    event_date: 'May 2, 2026',
    registration_time: '06:30',
    start_time: '08:00',
    location_name: 'Ocean Course',
    location_address: '123 Fairway Rd',
    max_capacity: 72,
    reserved_slots: 8,
    entry_fee: 30000,
    entry_fee_dollars: 300,
    organization_id: 'org-alpha',
    organization_slug: 'alpha-golf',
    format_name: 'Scramble',
    fee_includes: 'Green fee',
    checks_payable_to: 'Alpha Golf',
    contact_name: 'Organizer',
    contact_phone: '671-555-0100',
    registration_open: true,
    can_register: true,
    confirmed_count: 10,
    public_confirmed_count: 8,
    sponsor_confirmed_count: 2,
    sponsor_reserved_teams: 2,
    waitlist_count: 0,
    capacity_remaining: 62,
    at_capacity: false,
    public_capacity: 64,
    public_capacity_remaining: 56,
    public_at_capacity: false,
    checked_in_count: 0,
    paid_count: 10,
    pending_payment_count: 0,
    display_name: '5th Annual Pacific Classic (2026)',
    short_name: 'Pacific Classic',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    swipe_simple_url: 'https://swipesimple.com/links/stale-2026',
    ...overrides,
  };
}

function setNativeInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('tournamentClone helpers', () => {
  it('increments ordinal editions accurately including teen ordinals', () => {
    expect(incrementEdition('5th Annual')).toBe('6th Annual');
    expect(incrementEdition('1st')).toBe('2nd');
    expect(incrementEdition('2nd Annual Classic')).toBe('3rd Annual Classic');
    expect(incrementEdition('11th Annual')).toBe('12th Annual');
    expect(incrementEdition('12th')).toBe('13th');
    expect(incrementEdition('20th Annual')).toBe('21st Annual');
    expect(incrementEdition('Spring Edition')).toBe('Spring Edition');
    expect(incrementEdition(null)).toBe('');
    expect(incrementEdition('')).toBe('');
  });

  it('builds default clone form with incremented year and cleared event date', () => {
    const form = buildDefaultCloneForm(makeTournament());
    expect(form.name).toBe('Pacific Classic');
    expect(form.year).toBe('2027');
    expect(form.edition).toBe('6th Annual');
    expect(form.event_date).toBe('');
    expect(form.copy_raffle_prizes).toBe(false);
    expect(form.copy_sponsor_shells).toBe(false);
    expect(form.target_organization_id).toBe('');
  });

  it('detects cross-org target selection', () => {
    expect(isCrossOrgClone('org-alpha', '')).toBe(false);
    expect(isCrossOrgClone('org-alpha', 'org-alpha')).toBe(false);
    expect(isCrossOrgClone('org-alpha', 'org-beta')).toBe(true);
  });
});

describe('CloneTournamentModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  const orgs: Organization[] = [
    { id: 'org-alpha', name: 'Alpha Golf', slug: 'alpha-golf' },
    { id: 'org-beta', name: 'Beta Golf', slug: 'beta-golf' },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('prefills defaults for org admin, hides org selector, and submits same-org clone payload', async () => {
    const tournament = makeTournament();
    const mockResponse: CloneTournamentResponse = {
      tournament: makeTournament({ id: 99, year: 2027, edition: '6th Annual', status: 'draft', slug: 'pacific-classic-2027' }),
      clone_warnings: ['External payment URLs were cleared from the cloned tournament.'],
      clone_metadata: {
        mode: 'same_org',
        source_tournament_id: 42,
        source_organization_id: 'org-alpha',
        target_organization_id: 'org-alpha',
        requires_payment_url_review: true,
        copied_sponsor_shells_count: 1,
        copied_raffle_prizes_count: 1,
      },
    };
    const cloneSpy = vi.spyOn(api, 'cloneTournament').mockResolvedValue(mockResponse);
    const onCloned = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <CloneTournamentModal
          tournament={tournament}
          currentOrganizationId="org-alpha"
          isSuperAdmin={false}
          organizations={orgs}
          onClose={onClose}
          onCloned={onCloned}
        />
      );
    });

    // Org selector MUST NOT be visible for non-super-admins
    expect(container.querySelector('#clone-target-org')).toBeNull();

    const nameInput = container.querySelector('#clone-name') as HTMLInputElement;
    const yearInput = container.querySelector('#clone-year') as HTMLInputElement;
    const editionInput = container.querySelector('#clone-edition') as HTMLInputElement;
    expect(nameInput.value).toBe('Pacific Classic');
    expect(yearInput.value).toBe('2027');
    expect(editionInput.value).toBe('6th Annual');

    // Both checkboxes present
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);

    act(() => {
      (checkboxes[0] as HTMLInputElement).click(); // copy_raffle_prizes
      (checkboxes[1] as HTMLInputElement).click(); // copy_sponsor_shells
    });

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(cloneSpy).toHaveBeenCalledWith(42, {
      name: 'Pacific Classic',
      year: 2027,
      edition: '6th Annual',
      event_date: null,
      copy_raffle_prizes: true,
      copy_sponsor_shells: true,
    });
    expect(onCloned).toHaveBeenCalledWith(mockResponse, undefined);
  });

  it('shows cross-org selector for super_admin, hides sponsor shells, displays strip notice, and submits target_organization_id', async () => {
    const tournament = makeTournament();
    const mockResponse: CloneTournamentResponse = {
      tournament: makeTournament({
        id: 100,
        organization_id: 'org-beta',
        year: 2027,
        status: 'draft',
        slug: 'pacific-classic-2027',
      }),
      clone_warnings: ['Source organization branding overrides were stripped.'],
      clone_metadata: {
        mode: 'cross_org_template',
        source_tournament_id: 42,
        source_organization_id: 'org-alpha',
        target_organization_id: 'org-beta',
        requires_payment_url_review: true,
        copied_sponsor_shells_count: 0,
        copied_raffle_prizes_count: 0,
      },
    };
    const cloneSpy = vi.spyOn(api, 'cloneTournament').mockResolvedValue(mockResponse);
    const onCloned = vi.fn();

    act(() => {
      root.render(
        <CloneTournamentModal
          tournament={tournament}
          currentOrganizationId="org-alpha"
          isSuperAdmin={true}
          organizations={orgs}
          onClose={vi.fn()}
          onCloned={onCloned}
        />
      );
    });

    // Check sponsor shells initially checked, then switch to Beta Golf
    const initialCheckboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(initialCheckboxes.length).toBe(2);
    act(() => {
      (initialCheckboxes[1] as HTMLInputElement).click();
    });

    const orgSelect = container.querySelector('#clone-target-org') as HTMLSelectElement;
    expect(orgSelect).not.toBeNull();
    expect(container.querySelector('[data-testid="cross-org-strip-notice"]')).toBeNull();

    act(() => {
      setNativeInputValue(orgSelect, 'org-beta');
    });

    // Sponsor shells checkbox hidden and notice visible
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(1);
    const notice = container.querySelector('[data-testid="cross-org-strip-notice"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('Beta Golf');

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(cloneSpy).toHaveBeenCalledWith(42, {
      name: 'Pacific Classic',
      year: 2027,
      edition: '6th Annual',
      event_date: null,
      copy_raffle_prizes: false,
      copy_sponsor_shells: false,
      target_organization_id: 'org-beta',
    });
    expect(onCloned).toHaveBeenCalledWith(mockResponse, orgs[1]);
  });

  it('displays API error alert when cloning fails', async () => {
    vi.spyOn(api, 'cloneTournament').mockRejectedValue(
      new Error('Forbidden: Super admin access required')
    );

    act(() => {
      root.render(
        <CloneTournamentModal
          tournament={makeTournament()}
          currentOrganizationId="org-alpha"
          isSuperAdmin={false}
          organizations={orgs}
          onClose={vi.fn()}
          onCloned={vi.fn()}
        />
      );
    });

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Forbidden: Super admin access required');
  });
});
