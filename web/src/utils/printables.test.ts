import { describe, expect, it } from 'vitest';
import {
  buildCartSigns,
  chunkCartSigns,
  groupSponsorsForSignage,
  sortGolfersAlphabetically,
  sortGroupsForShotgun,
  type PrintableGolfer,
  type PrintableGroup,
  type PrintableSponsor,
} from './printables';

describe('printables helpers', () => {
  it('sorts shotgun groups by course prefix, numeric hole (1..18), and letter (A..Z), placing unassigned last', () => {
    const groups: PrintableGroup[] = [
      { id: 1, group_number: 10, hole_number: 10, hole_position_label: '10A' },
      { id: 2, group_number: 2, hole_number: 2, hole_position_label: '2B' },
      { id: 3, group_number: 99, hole_number: null, hole_position_label: 'Unassigned' },
      { id: 4, group_number: 1, hole_number: 2, hole_position_label: '2A' },
      { id: 5, group_number: 3, hole_number: 1, hole_position_label: '1A' },
    ];

    expect(sortGroupsForShotgun(groups, true).map((g) => g.hole_position_label)).toEqual([
      '1A',
      '2A',
      '2B',
      '10A',
      'Unassigned',
    ]);
    expect(sortGroupsForShotgun(groups, false).map((g) => g.hole_position_label)).toEqual([
      '1A',
      '2A',
      '2B',
      '10A',
    ]);
  });

  it('builds cart signs matching golfer or hole sponsor and chunks 2 per landscape page', () => {
    const sponsors: PrintableSponsor[] = [
      { id: 10, name: 'Pacific Bank', tier: 'gold', hole_number: 7, logo_url: 'https://example.com/bank.png', active: true },
    ];
    const groups: PrintableGroup[] = [
      {
        id: 1,
        group_number: 1,
        hole_number: 7,
        hole_position_label: '7A',
        golfers: [
          { id: 1, name: 'Maria Santos', partner_name: 'Elena Cruz', team_name: 'Island Aces', registration_status: 'confirmed', payment_status: 'paid' },
        ],
      },
      { id: 2, group_number: 2, hole_number: 8, hole_position_label: '8A', golfers: [] },
      { id: 3, group_number: 3, hole_number: 9, hole_position_label: '9A', golfers: [] },
    ];

    const cards = buildCartSigns(groups, sponsors, false);
    expect(cards).toHaveLength(3);
    expect(cards[0].holeLabel).toBe('7A');
    expect(cards[0].players).toEqual(['Maria Santos', 'Elena Cruz']);
    expect(cards[0].sponsorName).toBe('Pacific Bank');
    expect(cards[0].sponsorLogoUrl).toBe('https://example.com/bank.png');

    const pages = chunkCartSigns(cards, 2);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(1);
  });

  it('sorts active golfers A-Z by last name and excludes cancelled registrations', () => {
    const golfers: PrintableGolfer[] = [
      { id: 1, name: 'Zoe Taitano', registration_status: 'confirmed', payment_status: 'paid' },
      { id: 2, name: 'Ben Aguon', registration_status: 'confirmed', payment_status: 'unpaid' },
      { id: 3, name: 'Cancelled Player', registration_status: 'cancelled', payment_status: 'unpaid' },
      { id: 4, name: 'Alex Cruz', last_name: 'Cruz', registration_status: 'confirmed', payment_status: 'paid' },
    ];

    expect(sortGolfersAlphabetically(golfers).map((g) => g.name)).toEqual([
      'Ben Aguon',
      'Alex Cruz',
      'Zoe Taitano',
    ]);
  });

  it('groups active sponsors by tier priority and hole number', () => {
    const sponsors: PrintableSponsor[] = [
      { id: 1, name: 'Hole 12 Sign', tier: 'hole', hole_number: 12, active: true },
      { id: 2, name: 'Title Partner', tier: 'title', active: true },
      { id: 3, name: 'Inactive Co', tier: 'gold', active: false },
      { id: 4, name: 'Hole 3 Sign', tier: 'hole', hole_number: 3, active: true },
    ];

    const grouped = groupSponsorsForSignage(sponsors);
    expect(grouped.map((g) => g.tierKey)).toEqual(['title', 'hole']);
    expect(grouped[1].sponsors.map((s) => s.name)).toEqual(['Hole 3 Sign', 'Hole 12 Sign']);
  });
});
