import { describe, expect, it } from 'vitest';
import {
  buildAlphaCheckInRows,
  buildCartSigns,
  chunkCartSigns,
  groupSponsorsForSignage,
  sortGroupsForShotgun,
  type PrintableGolfer,
  type PrintableGroup,
  type PrintableSponsor,
} from './printables';

describe('printables helpers', () => {
  it('sorts multi-course shotgun groups by course prefix, numeric hole, and letter, placing unassigned last', () => {
    const groups: PrintableGroup[] = [
      { id: 1, group_number: 10, starting_course_key: 'ocean', hole_number: 10, hole_position_label: 'Ocean 10A' },
      { id: 2, group_number: 2, starting_course_key: 'hibiscus', hole_number: 7, hole_position_label: 'Hibiscus 7A' },
      { id: 3, group_number: 99, hole_number: null, hole_position_label: 'Unassigned' },
      { id: 4, group_number: 1, starting_course_key: 'ocean', hole_number: 7, hole_position_label: 'Ocean 7A' },
      { id: 5, group_number: 3, starting_course_key: 'hibiscus', hole_number: 1, hole_position_label: 'Hibiscus 1A' },
    ];

    expect(sortGroupsForShotgun(groups, true).map((g) => g.hole_position_label)).toEqual([
      'Hibiscus 1A',
      'Hibiscus 7A',
      'Ocean 7A',
      'Ocean 10A',
      'Unassigned',
    ]);
    expect(sortGroupsForShotgun(groups, false).map((g) => g.hole_position_label)).toEqual([
      'Hibiscus 1A',
      'Hibiscus 7A',
      'Ocean 7A',
      'Ocean 10A',
    ]);
  });

  it('matches multi-course cart signs by course_key:hole_number without colliding across courses and chunks 2 per page', () => {
    const sponsors: PrintableSponsor[] = [
      { id: 10, name: 'Ocean Bank', tier: 'hole', course_key: 'ocean', hole_number: 7, logo_url: 'https://example.com/ocean.png', active: true },
      { id: 11, name: 'Hibiscus Motors', tier: 'hole', course_key: 'hibiscus', hole_number: 7, logo_url: 'https://example.com/hibiscus.png', active: true },
    ];
    const groups: PrintableGroup[] = [
      {
        id: 1,
        group_number: 1,
        starting_course_key: 'ocean',
        hole_number: 7,
        hole_position_label: 'Ocean 7A',
        golfers: [
          { id: 1, name: 'Maria Santos', partner_name: 'Elena Cruz', team_name: 'Island Aces', registration_status: 'confirmed', payment_status: 'paid' },
        ],
      },
      {
        id: 2,
        group_number: 2,
        starting_course_key: 'hibiscus',
        hole_number: 7,
        hole_position_label: 'Hibiscus 7A',
        golfers: [],
      },
      { id: 3, group_number: 3, starting_course_key: 'ocean', hole_number: 9, hole_position_label: 'Ocean 9A', golfers: [] },
    ];

    const cards = buildCartSigns(groups, sponsors, false);
    expect(cards).toHaveLength(3);
    // Hibiscus 7A sorts before Ocean 7A
    expect(cards[0].holeLabel).toBe('Hibiscus 7A');
    expect(cards[0].sponsorName).toBe('Hibiscus Motors');
    expect(cards[1].holeLabel).toBe('Ocean 7A');
    expect(cards[1].sponsorName).toBe('Ocean Bank');
    expect(cards[1].players).toEqual(['Maria Santos', 'Elena Cruz']);

    const pages = chunkCartSigns(cards, 2);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(1);
  });

  it('builds A-Z check-in backup rows strictly for confirmed registrations, indexing partners and stripping suffixes', () => {
    const golfers: PrintableGolfer[] = [
      { id: 1, name: 'John Taitano Jr.', partner_name: 'Elena Borja', registration_status: 'confirmed', payment_status: 'paid', waiver_signed: true, hole_position_label: '7A' },
      { id: 2, name: 'Waitlist Player', registration_status: 'waitlist', payment_status: 'unpaid' },
      { id: 3, name: 'Cancelled Player', registration_status: 'cancelled', payment_status: 'unpaid' },
      { id: 4, name: 'Ben Aguon', registration_status: 'confirmed', payment_status: 'unpaid', waiver_signed: false, hole_position_label: '1A' },
    ];

    const rows = buildAlphaCheckInRows(golfers);
    expect(rows.map((r) => r.displayName)).toEqual([
      'Ben Aguon',
      'Elena Borja',
      'John Taitano Jr.',
    ]);
    expect(rows[1].isPartner).toBe(true);
    expect(rows[1].subLabel).toContain('Partner of John Taitano Jr.');
    expect(rows[2].waiverOk).toBe(true);
  });

  it('groups active sponsors using custom tier_definitions priority and sorts by course then hole', () => {
    const tierDefs = [
      { key: 'island_hero', label: 'Island Hero', position: 0 },
      { key: 'hole', label: 'Hole Sponsor', position: 1 },
    ];
    const sponsors: PrintableSponsor[] = [
      { id: 1, name: 'Ocean Hole 12', tier: 'hole', course_key: 'ocean', hole_number: 12, active: true },
      { id: 2, name: 'Custom Top Sponsor', tier: 'island_hero', active: true },
      { id: 3, name: 'Inactive Co', tier: 'gold', active: false },
      { id: 4, name: 'Hibiscus Hole 3', tier: 'hole', course_key: 'hibiscus', hole_number: 3, active: true },
    ];

    const grouped = groupSponsorsForSignage(sponsors, tierDefs);
    expect(grouped.map((g) => g.tierKey)).toEqual(['island_hero', 'hole']);
    expect(grouped[0].tierLabel).toBe('Island Hero');
    expect(grouped[1].sponsors.map((s) => s.name)).toEqual(['Hibiscus Hole 3', 'Ocean Hole 12']);
  });
});
