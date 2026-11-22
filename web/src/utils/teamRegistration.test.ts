import { describe, expect, it } from 'vitest';
import {
  getPublicFacingCapacitySummary,
  getRegistrationStatusLabel,
  isAtCapacity,
  isPublicAtCapacity,
} from './capacity';
import {
  buildInitialPlayers,
  buildRegistrationPayload,
  canAddPlayer,
  canRemovePlayer,
  formatCapacityUnitName,
  formatEntryUnitSubtitle,
  getDisplayTeamName,
  getStepNames,
  hasValidationErrors,
  normalizeTeamSize,
  validateCaptainStep,
  validateTeammatesStep,
  validateWaiverStep,
  type TeamPlayerDraft,
} from './teamRegistration';

describe('teamRegistration helpers (1/2/4 players + partial teams)', () => {
  it('normalizes team sizes cleanly between 1 and 4', () => {
    expect(normalizeTeamSize(1)).toBe(1);
    expect(normalizeTeamSize(2)).toBe(2);
    expect(normalizeTeamSize(4)).toBe(4);
    expect(normalizeTeamSize(undefined)).toBe(2);
    expect(normalizeTeamSize(6)).toBe(4);
    expect(normalizeTeamSize(0)).toBe(2);
  });

  it('builds the right initial players for sizes 1, 2, 4, and partial foursomes', () => {
    expect(buildInitialPlayers(1, false)).toHaveLength(1);
    expect(buildInitialPlayers(2, false)).toHaveLength(2);
    expect(buildInitialPlayers(4, false)).toHaveLength(4);
    expect(buildInitialPlayers(4, true)).toHaveLength(2);
  });

  it('computes add/remove player eligibility for partial vs full teams', () => {
    expect(canAddPlayer(2, 4, true)).toBe(true);
    expect(canAddPlayer(4, 4, true)).toBe(false);
    expect(canAddPlayer(2, 4, false)).toBe(false);

    expect(canRemovePlayer(2, 4, true)).toBe(true);
    expect(canRemovePlayer(1, 4, true)).toBe(false);
    expect(canRemovePlayer(2, 4, false)).toBe(false);
    expect(canRemovePlayer(1, 1, true)).toBe(false);
  });

  it('returns 3 steps for individual tournaments and 4 steps for multi-player teams', () => {
    expect(getStepNames(1)).toEqual(['Player Info', 'Waiver', 'Review & Pay']);
    expect(getStepNames(2)).toEqual(['Team Captain', 'Partner', 'Waiver', 'Review & Pay']);
    expect(getStepNames(4)).toEqual(['Team Captain', 'Teammates', 'Waiver', 'Review & Pay']);
  });

  it('validates captain step and requires category only when configured', () => {
    const validCaptain: TeamPlayerDraft[] = [
      {
        name: 'Alex Rivera',
        email: 'alex@example.com',
        phone: '+16715551234',
        tshirt_size: 'L',
        handicap: '12',
        waiver_accepted: true,
      },
    ];

    expect(hasValidationErrors(validateCaptainStep(validCaptain, { teamSize: 1 }))).toBe(false);

    const missingCategoryErrors = validateCaptainStep(validCaptain, {
      teamSize: 1,
      teamCategories: ['Open', 'Senior'],
      teamCategory: '',
    });
    expect(missingCategoryErrors.teamCategory).toBe('Category is required');

    const invalidCaptain: TeamPlayerDraft[] = [
      { name: '', email: 'bad-email', phone: '+1671', tshirt_size: '', handicap: '', waiver_accepted: false },
    ];
    const errors = validateCaptainStep(invalidCaptain, { handicapRequired: true });
    expect(errors.players[0]?.name).toBeDefined();
    expect(errors.players[0]?.email).toBeDefined();
    expect(errors.players[0]?.phone).toBeDefined();
    expect(errors.players[0]?.handicap).toBeDefined();
  });

  it('rejects duplicate player emails and missing names on teammates step', () => {
    const players: TeamPlayerDraft[] = [
      { name: 'Captain One', email: 'same@example.com', phone: '+16715550001', tshirt_size: '', handicap: '', waiver_accepted: true },
      { name: 'Teammate Two', email: 'SAME@example.com', phone: '', tshirt_size: '', handicap: '', waiver_accepted: true },
      { name: '', email: 'p3@example.com', phone: '', tshirt_size: '', handicap: '', waiver_accepted: true },
      { name: 'Teammate Four', email: 'p4@example.com', phone: '', tshirt_size: '', handicap: '', waiver_accepted: true },
    ];

    const errors = validateTeammatesStep(players, { teamSize: 4, allowPartialTeams: false });
    expect(errors.players[1]?.email).toContain('already listed');
    expect(errors.players[2]?.name).toBe('Full name is required');
    expect(errors.teamCategory).toBeUndefined();
  });

  it('requires every player to accept the waiver', () => {
    const players: TeamPlayerDraft[] = [
      { name: 'P1', email: 'p1@example.com', phone: '+16715550001', tshirt_size: '', handicap: '', waiver_accepted: true },
      { name: 'P2', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: false },
      { name: 'P3', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: true },
    ];

    const errors = validateWaiverStep(players);
    expect(errors.players[0]).toBeUndefined();
    expect(errors.players[1]?.waiver_accepted).toContain('Player 2');
    expect(errors.players[2]).toBeUndefined();
  });

  it('builds a clean registration payload for a 4-player foursome and strips bare +1671 on teammates', () => {
    const players: TeamPlayerDraft[] = [
      { name: '  Captain One ', email: 'CAP@Example.com', phone: '+16715550101', tshirt_size: 'L', handicap: '8.5', waiver_accepted: true },
      { name: 'Player Two', email: 'p2@example.com', phone: '+1671', tshirt_size: 'M', handicap: '', waiver_accepted: true },
      { name: 'Player Three', email: '', phone: '+16715550103', tshirt_size: 'XL', handicap: '14', waiver_accepted: true },
      { name: 'Player Four', email: 'p4@example.com', phone: '', tshirt_size: '', handicap: '', waiver_accepted: true },
    ];

    const payload = buildRegistrationPayload(
      {
        players,
        teamName: 'Island Foursome',
        teamCategory: '',
      },
      { paymentType: 'swipe_simple', organizationSlug: 'island-golf' }
    );

    expect(payload.organization_slug).toBe('island-golf');
    expect(payload.waiver_accepted).toBe(true);
    expect(payload.registration.team_name).toBe('Island Foursome');
    expect(payload.registration.team_category).toBeUndefined();
    expect(payload.registration.contact_email).toBe('cap@example.com');
    expect(payload.registration.team_members).toHaveLength(4);
    expect(payload.registration.team_members[0]).toMatchObject({
      position: 1,
      is_captain: true,
      name: 'Captain One',
      email: 'cap@example.com',
      phone: '+16715550101',
      tshirt_size: 'L',
      handicap: 8.5,
      waiver_accepted: true,
    });
    expect(payload.registration.team_members[1].phone).toBeUndefined();
    expect(payload.registration.team_members[2]).toMatchObject({
      position: 3,
      is_captain: false,
      phone: '+16715550103',
      handicap: 14,
    });
  });

  it('formats display names and unit labels properly', () => {
    expect(getDisplayTeamName('', [
      { name: 'Alice', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: false },
    ])).toBe('Alice');
    expect(getDisplayTeamName('', [
      { name: 'Alice', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: false },
      { name: 'Bob', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: false },
    ])).toBe('Alice & Bob');
    expect(getDisplayTeamName('', [
      { name: 'Alice', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: false },
      { name: 'Bob', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: false },
      { name: 'Cara', email: '', phone: '', tshirt_size: '', handicap: '', waiver_accepted: false },
    ])).toBe('Alice + 2 teammates');

    expect(formatEntryUnitSubtitle(1, false)).toBe('per player (individual entry)');
    expect(formatEntryUnitSubtitle(2, false)).toBe('per team (2 players)');
    expect(formatEntryUnitSubtitle(4, true)).toBe('per team (up to 4 players)');
    expect(formatCapacityUnitName('players', 1)).toBe('player');
    expect(formatCapacityUnitName('players', 10)).toBe('players');
    expect(formatCapacityUnitName('teams', 2)).toBe('teams');
  });

  it('rejects out-of-range handicap values outside -10..54 on captain and teammates', () => {
    const outOfRange: TeamPlayerDraft[] = [
      { name: 'Captain One', email: 'c@example.com', phone: '+16715550001', tshirt_size: '', handicap: '60', waiver_accepted: true },
      { name: 'Player Two', email: 'p2@example.com', phone: '', tshirt_size: '', handicap: '-12', waiver_accepted: true },
    ];

    const capErrors = validateCaptainStep(outOfRange, { handicapRequired: false });
    expect(capErrors.players[0]?.handicap).toContain('between -10 and 54');

    const teamErrors = validateTeammatesStep(outOfRange, { teamSize: 2, handicapRequired: false });
    expect(teamErrors.players[1]?.handicap).toContain('between -10 and 54');
  });

  it('reads player-unit counts from capacity_summary when capacity_unit is players', () => {
    const summary = getPublicFacingCapacitySummary({
      capacity_unit: 'players',
      max_capacity: 20,
      confirmed_count: 1,
      public_confirmed_count: 1,
      sponsor_reserved_teams: 1,
      capacity_summary: {
        capacity_unit: 'players',
        team_size: 4,
        allow_partial_teams: true,
        max_capacity: 20,
        reserved_slots: 0,
        sponsor_reserved_slots: 4,
        sponsor_reserved: 4,
        effective_reserved: 4,
        public_capacity: 16,
        confirmed_units: 6,
        public_confirmed_units: 6,
        sponsor_confirmed_units: 0,
        waitlist_units: 0,
        confirmed_registrations_count: 2,
        confirmed_players_count: 6,
        waitlist_registrations_count: 0,
        waitlist_players_count: 0,
        remaining: 14,
        public_remaining: 10,
        at_capacity: false,
        public_at_capacity: false,
      },
    });

    expect(summary.label).toBe('6 / 16 public spots claimed');
    expect(summary.secondaryLabel).toBe('0 / 4 sponsor-reserved spots used');
  });

  it('reads capacity_summary for BOTH teams and players modes even when legacy confirmed_count is 0', () => {
    const teamsRecord = {
      capacity_unit: 'teams' as const,
      max_capacity: 10,
      confirmed_count: 0,
      public_confirmed_count: 0,
      at_capacity: false,
      public_at_capacity: false,
      waitlist_enabled: true,
      capacity_summary: {
        capacity_unit: 'teams' as const,
        team_size: 2,
        allow_partial_teams: false,
        max_capacity: 10,
        reserved_slots: 0,
        sponsor_reserved_slots: 4,
        sponsor_reserved: 2,
        effective_reserved: 2,
        public_capacity: 8,
        confirmed_units: 8,
        public_confirmed_units: 8,
        sponsor_confirmed_units: 0,
        waitlist_units: 1,
        confirmed_registrations_count: 8,
        confirmed_players_count: 16,
        waitlist_registrations_count: 1,
        waitlist_players_count: 2,
        remaining: 2,
        public_remaining: 0,
        at_capacity: false,
        public_at_capacity: true,
      },
    };

    const summary = getPublicFacingCapacitySummary(teamsRecord);
    expect(summary.label).toBe('8 / 8 public spots claimed');
    expect(summary.secondaryLabel).toBe('0 / 2 sponsor-reserved spots used');
    expect(isAtCapacity(teamsRecord)).toBe(false);
    expect(isPublicAtCapacity(teamsRecord)).toBe(true);
    expect(getRegistrationStatusLabel(teamsRecord)).toBe('Waitlist Open');
  });
});
