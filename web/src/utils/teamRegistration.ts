import type { CapacityUnit, CreateRegistrationPayload } from '../services/api';

export interface TeamPlayerDraft {
  name: string;
  email: string;
  phone: string;
  tshirt_size: string;
  handicap: string;
  waiver_accepted: boolean;
}

export interface TeamRegistrationFormState {
  players: TeamPlayerDraft[];
  teamName: string;
  teamCategory: string;
}

export interface TeamRegistrationValidationErrors {
  teamCategory?: string;
  players: Record<
    number,
    Partial<Record<'name' | 'email' | 'phone' | 'handicap' | 'waiver_accepted', string>>
  >;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_PHONE_PREFIX = '+1671';

export function normalizeTeamSize(teamSize?: number | null): number {
  if (!teamSize || !Number.isFinite(teamSize)) return 2;
  return Math.min(4, Math.max(1, Math.round(teamSize)));
}

export function createEmptyPlayerDraft(isCaptain = false): TeamPlayerDraft {
  return {
    name: '',
    email: '',
    phone: isCaptain ? DEFAULT_PHONE_PREFIX : '',
    tshirt_size: '',
    handicap: '',
    waiver_accepted: false,
  };
}

export function buildInitialPlayers(teamSize?: number | null, allowPartialTeams = false): TeamPlayerDraft[] {
  const normalized = normalizeTeamSize(teamSize);
  // Keep full team count by default for non-partial and 2-player pairs;
  // for 4-player partial tournaments, start with 2 players so registrants can remove to 1 or add up to 4.
  const initialCount = allowPartialTeams && normalized > 2 ? 2 : normalized;
  return Array.from({ length: initialCount }, (_, index) => createEmptyPlayerDraft(index === 0));
}

export function canAddPlayer(currentCount: number, teamSize?: number | null, allowPartialTeams = false): boolean {
  const normalized = normalizeTeamSize(teamSize);
  return allowPartialTeams && currentCount < normalized;
}

export function canRemovePlayer(currentCount: number, teamSize?: number | null, allowPartialTeams = false): boolean {
  const normalized = normalizeTeamSize(teamSize);
  return allowPartialTeams && normalized > 1 && currentCount > 1;
}

export function getStepNames(teamSize?: number | null): string[] {
  const normalized = normalizeTeamSize(teamSize);
  if (normalized === 1) {
    return ['Player Info', 'Waiver', 'Review & Pay'];
  }
  if (normalized === 2) {
    return ['Team Captain', 'Partner', 'Waiver', 'Review & Pay'];
  }
  return ['Team Captain', 'Teammates', 'Waiver', 'Review & Pay'];
}

export function getDisplayTeamName(teamName: string, players: TeamPlayerDraft[]): string {
  const trimmed = teamName.trim();
  if (trimmed) return trimmed;

  const names = players.map((player) => player.name.trim()).filter(Boolean);
  if (names.length === 0) return 'TBD';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} + ${names.length - 1} teammates`;
}

export function formatEntryUnitSubtitle(
  teamSize?: number | null,
  allowPartialTeams = false,
  capacityUnit?: CapacityUnit
): string {
  const normalized = normalizeTeamSize(teamSize);
  if (normalized === 1) return 'per player (individual entry)';
  if (capacityUnit === 'players') {
    if (allowPartialTeams) return `per player (teams up to ${normalized} players)`;
    return `per player (${normalized}-player teams)`;
  }
  if (allowPartialTeams) return `per team (up to ${normalized} players)`;
  return `per team (${normalized} players)`;
}

export function formatEntryFeeDisplay(tournament: {
  entry_fee_display?: string | null;
  entry_fee?: number | null;
  team_size?: number | null;
  capacity_unit?: CapacityUnit;
}): string {
  if (tournament.entry_fee_display) return tournament.entry_fee_display;
  const cents = tournament.entry_fee || 0;
  const dollars = cents % 100 === 0 ? (cents / 100).toFixed(0) : (cents / 100).toFixed(2);
  const unit = tournament.capacity_unit === 'players' || normalizeTeamSize(tournament.team_size) === 1 ? 'player' : 'team';
  return `$${dollars}/${unit}`;
}

export function calculateRegistrationTotalCents(params: {
  entryFeeCents?: number | null;
  captainEffectiveFeeCents: number;
  playerCount: number;
  teamSize?: number | null;
  capacityUnit?: CapacityUnit;
}): number {
  const normalized = normalizeTeamSize(params.teamSize);
  const count = Math.max(1, params.playerCount);
  if (params.capacityUnit === 'players' && normalized > 1) {
    const baseFee = Math.max(0, params.entryFeeCents || 0);
    return params.captainEffectiveFeeCents + (count - 1) * baseFee;
  }
  return params.captainEffectiveFeeCents;
}

export function formatCapacityUnitName(unit: CapacityUnit | undefined, count: number): string {
  const resolved = unit === 'teams' ? 'team' : 'player';
  return count === 1 ? resolved : `${resolved}s`;
}

const MIN_HANDICAP = -10;
const MAX_HANDICAP = 54;

function validateHandicapValue(raw: string, required: boolean): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return required ? 'Handicap is required' : undefined;
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return 'Handicap must be a valid number';
  }
  if (parsed < MIN_HANDICAP || parsed > MAX_HANDICAP) {
    return `Handicap must be between ${MIN_HANDICAP} and ${MAX_HANDICAP}`;
  }
  return undefined;
}

export function validateCaptainStep(
  players: TeamPlayerDraft[],
  options?: { handicapRequired?: boolean; teamCategories?: string[]; teamCategory?: string; teamSize?: number }
): TeamRegistrationValidationErrors {
  const errors: TeamRegistrationValidationErrors = { players: {} };
  const captain = players[0];
  const captainErrors: Partial<Record<'name' | 'email' | 'phone' | 'handicap', string>> = {};

  if (!captain || !captain.name.trim()) {
    captainErrors.name = 'Full name is required';
  }
  if (!captain || !captain.email.trim()) {
    captainErrors.email = 'Email is required';
  } else if (!EMAIL_REGEX.test(captain.email.trim())) {
    captainErrors.email = 'Please enter a valid email address';
  }
  if (
    !captain ||
    !captain.phone.trim() ||
    !captain.phone.trim().startsWith('+') ||
    captain.phone.replace(/\D/g, '').length < 10
  ) {
    captainErrors.phone = 'Phone number must start with + and have at least 10 digits';
  }
  const captainHandicapError = validateHandicapValue(captain?.handicap ?? '', Boolean(options?.handicapRequired));
  if (captainHandicapError) {
    captainErrors.handicap = captainHandicapError;
  }

  if (Object.keys(captainErrors).length > 0) {
    errors.players[0] = captainErrors;
  }

  // For 1-player individual events, validate category (if configured) on step 1
  if (normalizeTeamSize(options?.teamSize) === 1 && options?.teamCategories && options.teamCategories.length > 0) {
    if (!options.teamCategory) {
      errors.teamCategory = 'Category is required';
    }
  }

  return errors;
}

export function validateTeammatesStep(
  players: TeamPlayerDraft[],
  options?: {
    teamSize?: number;
    allowPartialTeams?: boolean;
    handicapRequired?: boolean;
    teamCategories?: string[];
    teamCategory?: string;
  }
): TeamRegistrationValidationErrors {
  const errors: TeamRegistrationValidationErrors = { players: {} };
  const normalizedSize = normalizeTeamSize(options?.teamSize);
  const seenEmails = new Set<string>();
  const captainEmail = players[0]?.email.trim().toLowerCase();
  if (captainEmail) seenEmails.add(captainEmail);

  for (let index = 1; index < players.length; index += 1) {
    const player = players[index];
    const playerErrors: Partial<Record<'name' | 'email' | 'phone' | 'handicap', string>> = {};

    if (!player.name.trim()) {
      playerErrors.name = 'Full name is required';
    }

    const email = player.email.trim();
    if (email) {
      if (!EMAIL_REGEX.test(email)) {
        playerErrors.email = 'Please enter a valid email address';
      } else if (seenEmails.has(email.toLowerCase())) {
        playerErrors.email = 'This email is already listed on this team';
      } else {
        seenEmails.add(email.toLowerCase());
      }
    }

    const handicapError = validateHandicapValue(player.handicap, Boolean(options?.handicapRequired));
    if (handicapError) {
      playerErrors.handicap = handicapError;
    }

    if (Object.keys(playerErrors).length > 0) {
      errors.players[index] = playerErrors;
    }
  }

  if (!options?.allowPartialTeams && players.length < normalizedSize) {
    errors.players[players.length] = { name: `All ${normalizedSize} players are required` };
  }

  if (options?.teamCategories && options.teamCategories.length > 0 && !options.teamCategory) {
    errors.teamCategory = 'Team category is required';
  }

  return errors;
}

export function validateWaiverStep(players: TeamPlayerDraft[]): TeamRegistrationValidationErrors {
  const errors: TeamRegistrationValidationErrors = { players: {} };

  players.forEach((player, index) => {
    if (!player.waiver_accepted) {
      errors.players[index] = {
        waiver_accepted: `Player ${index + 1} must accept the waiver`,
      };
    }
  });

  return errors;
}

export function hasValidationErrors(errors: TeamRegistrationValidationErrors): boolean {
  return Boolean(errors.teamCategory) || Object.keys(errors.players).length > 0;
}

export function buildRegistrationPayload(
  state: TeamRegistrationFormState,
  options?: {
    paymentType?: 'stripe' | 'pay_on_day' | 'swipe_simple' | 'walk_in' | 'offline';
    organizationSlug?: string;
    isEmployee?: boolean;
    employeeNumber?: string;
  }
): CreateRegistrationPayload {
  const captain = state.players[0];

  const cleanPhone = (raw: string): string | undefined => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === DEFAULT_PHONE_PREFIX) return undefined;
    return trimmed;
  };

  return {
    registration: {
      team_name: state.teamName.trim() || undefined,
      team_category: state.teamCategory.trim() || undefined,
      contact_name: captain?.name.trim() || undefined,
      contact_email: captain?.email.trim().toLowerCase() || undefined,
      contact_phone: captain?.phone.trim() || undefined,
      payment_type: options?.paymentType || 'swipe_simple',
      team_members: state.players.map((player, index) => ({
        position: index + 1,
        is_captain: index === 0,
        name: player.name.trim(),
        email: player.email.trim().toLowerCase() || undefined,
        phone: index === 0 ? player.phone.trim() : cleanPhone(player.phone),
        tshirt_size: player.tshirt_size.trim() || undefined,
        handicap: player.handicap.trim() !== '' && !Number.isNaN(Number(player.handicap))
          ? Number(player.handicap)
          : undefined,
        waiver_accepted: player.waiver_accepted,
      })),
    },
    waiver_accepted: state.players.every((player) => player.waiver_accepted),
    ...(options?.isEmployee && options?.employeeNumber
      ? { is_employee: true, employee_number: options.employeeNumber }
      : {}),
    organization_slug: options?.organizationSlug,
  };
}
