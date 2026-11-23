// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyTextToClipboard,
  describeSponsorSlots,
  formatGuamDeadline,
  groupSlotsIntoTeams,
  portalStatus,
  sponsorInitials,
  teamHeading,
} from './sponsorTeams';

const slots = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 10, slot_number: i + 1 }));

describe('groupSlotsIntoTeams', () => {
  it('groups by the tournament team size and labels player ranges', () => {
    const pairs = groupSlotsIntoTeams(slots(4), 2);
    expect(pairs.map(teamHeading)).toEqual(['Team 1 — Players 1–2', 'Team 2 — Players 3–4']);

    const foursome = groupSlotsIntoTeams(slots(4), 4);
    expect(foursome.map(teamHeading)).toEqual(['Team 1 — Players 1–4']);

    const leftover = groupSlotsIntoTeams(slots(5), 2);
    expect(leftover.map(teamHeading)).toEqual(['Team 1 — Players 1–2', 'Team 2 — Players 3–4', 'Team 3 — Player 5']);
  });

  it('treats a missing or invalid team size as individual players', () => {
    expect(groupSlotsIntoTeams(slots(3), 0)).toHaveLength(3);
    expect(groupSlotsIntoTeams(slots(3), null)).toHaveLength(3);
  });

  it('keeps slot-number team boundaries when legacy slot numbers have a gap', () => {
    const gapped = [
      { id: 1, slot_number: 1 },
      { id: 3, slot_number: 3 },
      { id: 4, slot_number: 4 },
    ];
    const teams = groupSlotsIntoTeams(gapped, 2);
    expect(teams).toEqual([
      { teamNumber: 1, firstPlayer: 1, lastPlayer: 1, slots: [{ id: 1, slot_number: 1 }] },
      { teamNumber: 2, firstPlayer: 3, lastPlayer: 4, slots: [{ id: 3, slot_number: 3 }, { id: 4, slot_number: 4 }] },
    ]);
  });
});

describe('describeSponsorSlots', () => {
  it('describes teams, slots, and entry progress in plain English', () => {
    expect(describeSponsorSlots(4, 3, 2)).toBe('2 Teams (4 slots) · 3/4 entered');
    expect(describeSponsorSlots(4, 4, 4)).toBe('1 Team (4 slots) · 4/4 entered');
    expect(describeSponsorSlots(5, 0, 2)).toBe('2 Teams + 1 extra player (5 slots) · 0/5 entered');
    expect(describeSponsorSlots(2, 1, 4)).toBe('2 extra players (2 slots) · 1/2 entered');
    expect(describeSponsorSlots(3, 2, 1)).toBe('3 Players · 2/3 entered');
    expect(describeSponsorSlots(0, 0, 2)).toBe('No player slots');
    expect(describeSponsorSlots(2, 9, 2)).toBe('1 Team (2 slots) · 2/2 entered');
  });
});

describe('portalStatus', () => {
  it('returns the admin status pill for each fill state', () => {
    expect(portalStatus(4, 4)).toEqual({ label: 'All Entered', tone: 'complete' });
    expect(portalStatus(4, 3)).toEqual({ label: '3/4 Filled', tone: 'partial' });
    expect(portalStatus(4, 0)).toEqual({ label: 'Not Started', tone: 'empty' });
    expect(portalStatus(0, 0)).toEqual({ label: 'No Slots', tone: 'none' });
  });
});

describe('sponsorInitials', () => {
  it('derives clean monogram initials', () => {
    expect(sponsorInitials('Bank of the Pacific')).toBe('BP');
    expect(sponsorInitials('The Island Group')).toBe('IG');
    expect(sponsorInitials('Acme')).toBe('AC');
    expect(sponsorInitials('A & B Supply, Inc.')).toBe('AB');
    expect(sponsorInitials('  ')).toBe('?');
    expect(sponsorInitials(null)).toBe('?');
    expect(sponsorInitials('Éclair Bakery')).toBe('ÉB');
  });
});

describe('formatGuamDeadline', () => {
  it('formats deadlines in Guam time with a ChST label', () => {
    expect(formatGuamDeadline('2026-12-04T07:00:00Z')).toBe('Friday, December 4, 2026 at 5:00 PM ChST');
    expect(formatGuamDeadline(null)).toBe('');
    expect(formatGuamDeadline('not a date')).toBe('');
  });
});

describe('copyTextToClipboard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the async clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyTextToClipboard('https://example.test/link')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.test/link');
  });

  it('falls back to execCommand and reports failure when nothing works', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    await expect(copyTextToClipboard('https://example.test/link')).resolves.toBe(false);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
