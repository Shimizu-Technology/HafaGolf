// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SponsorPortalDashboard } from './SponsorPortalDashboard';
import type { PortalSlot, TournamentInfo } from './sponsorPortalTypes';

vi.mock('../OrganizationProvider', () => ({
  useOrganization: () => ({ organization: { name: 'Highland Golf Club', slug: 'highland' }, isLoading: false }),
}));

const sponsor = {
  id: 5, name: 'Harbor Bank', tier: 'gold', tier_display: 'Gold', slot_count: 4,
  tournament_id: 9, logo_url: null, website_url: null,
};
const org = { name: 'Highland Golf Club', primary_color: '#0f766e' };
const baseTournament: TournamentInfo = {
  name: 'Spring Open', year: 2027, event_date: '2027-04-15', team_size: 2, handicap_required: false,
  waiver_enabled: true, sponsor_edit_deadline: '2099-12-04T07:00:00Z', edit_deadline_passed: false,
  contact_name: 'Event Desk', contact_email: 'desk@example.test', contact_phone: null,
};

const slots: PortalSlot[] = [
  { id: 101, slot_number: 1, player_name: 'Ana Cruz', player_email: 'ana@example.test', player_phone: null, tshirt_size: 'M', handicap: null },
  { id: 102, slot_number: 2, player_name: 'Ben Santos', player_email: null, player_phone: null, tshirt_size: null, handicap: null },
  { id: 103, slot_number: 3, player_name: null, player_email: null, player_phone: null, tshirt_size: null, handicap: null },
  { id: 104, slot_number: 4, player_name: null, player_email: null, player_phone: null, tshirt_size: null, handicap: null },
];

const sponsorships = [
  { sponsor_id: 5, sponsor_name: 'Harbor Bank', tier_display: 'Gold', slot_count: 4, filled_count: 2, tournament_name: 'Spring Open', tournament_year: 2027, event_date: null, current: true },
  { sponsor_id: 6, sponsor_name: 'Harbor Bank', tier_display: 'Gold', slot_count: 2, filled_count: 0, tournament_name: 'Spring Open', tournament_year: 2026, event_date: null, current: false },
];

function setValue(field: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = Object.getPrototypeOf(field);
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('SponsorPortalDashboard', () => {
  let mount: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(tournament: Partial<TournamentInfo> = {}, onSwitch = vi.fn()) {
    const portalTournament = { ...baseTournament, ...tournament };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/sponsor_slots')) return Response.json({ slots, tournament: portalTournament });
      if (url.endsWith('/api/v1/sponsor_access/sponsorships')) return Response.json({ sponsorships });
      if (url.endsWith('/api/v1/sponsor_slots/batch')) {
        const body = JSON.parse(String(init?.body));
        return Response.json({
          slots: body.slots.map((s: PortalSlot) => ({ ...slots.find((slot) => slot.id === s.id), ...s })),
          filled_count: 3,
          slot_count: 4,
        });
      }
      if (url.endsWith('/api/v1/sponsor_access/switch')) {
        return Response.json({ sponsor: { ...sponsor, id: 6 }, tournament: portalTournament, organization: org, session_token: 'next-session' });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(
        <SponsorPortalDashboard
          sessionToken="session-1"
          initialSponsor={sponsor}
          initialTournament={portalTournament}
          initialOrg={org}
          onSessionExpired={vi.fn()}
          onSwitchSponsorship={onSwitch}
        />
      );
    });
    return onSwitch;
  }

  it('groups players into team cards with progress, a Guam-time deadline, and the waiver note', async () => {
    await render();

    const headings = Array.from(mount.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Team 1 — Players 1–2', 'Team 2 — Players 3–4']);
    expect(mount.textContent).toContain('2 of 4 players saved');
    expect(mount.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
    expect(mount.textContent).toContain('Please finish by Friday, December 4, 2099 at 5:00 PM ChST');
    expect(mount.textContent).toContain('added to the tournament check-in list automatically');
    expect(mount.textContent).toContain('confirm the tournament waiver');
    expect(mount.querySelector('#slot-101-handicap')).toBeNull();
    expect(Array.from(mount.querySelectorAll('button')).filter((b) => b.textContent?.includes('Save Team'))).toHaveLength(2);
    expect(mount.querySelector('.animate-spin, [class*="transition"]')).toBeNull();
  });

  it('saves a whole team in one batch request and updates the progress bar', async () => {
    await render({ handicap_required: true });

    const name = mount.querySelector<HTMLInputElement>('#slot-103-name')!;
    const shirt = mount.querySelector<HTMLSelectElement>('#slot-103-shirt')!;
    const handicap = mount.querySelector<HTMLInputElement>('#slot-103-handicap')!;
    expect(name.className).toContain('text-base');
    expect(name.className).toContain('min-h-[48px]');
    await act(async () => { setValue(name, 'Cora Reyes'); setValue(shirt, 'L'); });

    const saveTeam2 = Array.from(mount.querySelectorAll('button')).filter((b) => b.textContent?.includes('Save Team'))[1];
    await act(async () => { click(saveTeam2); });
    expect(mount.textContent).toContain('This event needs a handicap for each player.');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/batch'))).toBe(false);

    await act(async () => { setValue(handicap, '12.5'); });
    await act(async () => { click(saveTeam2); });

    const batchCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/v1/sponsor_slots/batch'))!;
    expect(batchCall[1]?.method).toBe('PATCH');
    expect((batchCall[1]?.headers as Record<string, string>)['X-Sponsor-Session']).toBe('session-1');
    expect(JSON.parse(String(batchCall[1]?.body)).slots).toEqual([
      { id: 103, player_name: 'Cora Reyes', player_email: null, player_phone: null, tshirt_size: 'L', handicap: 12.5 },
      { id: 104, player_name: null, player_email: null, player_phone: null, tshirt_size: null, handicap: null },
    ]);
    expect(mount.textContent).toContain('3 of 4 players saved');
  });

  it('locks the player list after the deadline', async () => {
    await render({ sponsor_edit_deadline: '2020-01-01T00:00:00Z', edit_deadline_passed: true });

    expect(mount.textContent).toContain('Player list is locked');
    expect(mount.textContent).toContain('ChST');
    expect(Array.from(mount.querySelectorAll('button')).some((b) => b.textContent?.includes('Save Team'))).toBe(false);
    expect(Array.from(mount.querySelectorAll('input')).every((input) => input.disabled)).toBe(true);
  });

  it('labels single-player events as individual players', async () => {
    await render({ team_size: 1 });

    expect(mount.textContent).toContain('Individual Players');
    expect(Array.from(mount.querySelectorAll('h3')).map((h) => h.textContent?.trim())[0]).toBe('Player 1');
    expect(Array.from(mount.querySelectorAll('button')).filter((b) => b.textContent?.includes('Save Player'))).toHaveLength(4);
  });

  it('switches to another sponsorship in the same organization', async () => {
    const onSwitch = await render();

    expect(mount.textContent).toContain('You sponsor more than one event');
    const other = Array.from(mount.querySelectorAll('button')).find((b) => b.textContent?.includes('Spring Open 2026'))!;
    await act(async () => { click(other); });

    const switchCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/v1/sponsor_access/switch'))!;
    expect(JSON.parse(String(switchCall[1]?.body))).toEqual({ sponsor_id: 6 });
    expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: 'next-session', sponsor: expect.objectContaining({ id: 6 }) }));
  });
});
