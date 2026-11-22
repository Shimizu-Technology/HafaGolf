import type { CapacitySummary, CapacityUnit } from '../services/api';

type CapacityRecord = {
  max_capacity?: number | null;
  confirmed_count?: number | null;
  paid_count?: number | null;
  public_confirmed_count?: number | null;
  sponsor_confirmed_count?: number | null;
  sponsor_reserved_teams?: number | null;
  public_capacity?: number | null;
  at_capacity?: boolean;
  public_at_capacity?: boolean;
  waitlist_enabled?: boolean;
  capacity_unit?: CapacityUnit;
  capacity_summary?: CapacitySummary;
};

export function getTotalConfirmed(record: CapacityRecord) {
  if (record.capacity_unit === 'players' && record.capacity_summary) {
    return record.capacity_summary.confirmed_players_count ?? record.capacity_summary.confirmed_units ?? 0;
  }
  return record.confirmed_count ?? 0;
}

export function getPublicConfirmed(record: CapacityRecord) {
  if (record.capacity_unit === 'players' && record.capacity_summary) {
    return record.capacity_summary.public_confirmed_units ?? getTotalConfirmed(record);
  }
  return record.public_confirmed_count ?? getTotalConfirmed(record);
}

export function getSponsorConfirmed(record: CapacityRecord) {
  if (record.capacity_unit === 'players' && record.capacity_summary) {
    return record.capacity_summary.sponsor_confirmed_units ?? 0;
  }
  return record.sponsor_confirmed_count ?? 0;
}

export function getSponsorReservedTeams(record: CapacityRecord) {
  if (record.capacity_unit === 'players' && record.capacity_summary) {
    return record.capacity_summary.sponsor_reserved_slots ?? record.capacity_summary.sponsor_reserved ?? 0;
  }
  return record.sponsor_reserved_teams ?? 0;
}

export function getPublicCapacity(record: CapacityRecord) {
  if (record.capacity_unit === 'players' && record.capacity_summary) {
    return record.capacity_summary.public_capacity ?? record.capacity_summary.max_capacity ?? record.max_capacity ?? null;
  }
  return record.public_capacity ?? record.max_capacity ?? null;
}

export function usesReservedPublicCapacity(record: CapacityRecord) {
  const publicCapacity = getPublicCapacity(record);
  const maxCapacity = record.max_capacity ?? null;
  return publicCapacity != null && maxCapacity != null && publicCapacity < maxCapacity;
}

export function getPublicFacingCapacitySummary(record: CapacityRecord) {
  const unitLabel = record.capacity_unit === 'players' ? 'players' : 'teams';
  const publicCapacity = getPublicCapacity(record);
  const publicConfirmed = getPublicConfirmed(record);
  const sponsorReserved = getSponsorReservedTeams(record);
  const sponsorConfirmed = getSponsorConfirmed(record);
  const usesReservedCapacity = usesReservedPublicCapacity(record);

  if (publicCapacity == null) {
    return {
      label: `${publicConfirmed} ${unitLabel} registered`,
      secondaryLabel: sponsorReserved > 0 ? `${sponsorConfirmed} / ${sponsorReserved} sponsor-reserved spots used` : null,
      percent: null as number | null,
    };
  }

  const denominator = usesReservedCapacity ? publicCapacity : (record.max_capacity ?? publicCapacity);
  const numerator = usesReservedCapacity ? publicConfirmed : getTotalConfirmed(record);
  const label = usesReservedCapacity
    ? `${numerator} / ${denominator} public spots claimed`
    : `${numerator} / ${denominator} ${unitLabel} registered`;

  const secondaryLabel = usesReservedCapacity && sponsorReserved > 0
    ? `${sponsorConfirmed} / ${sponsorReserved} sponsor-reserved spots used`
    : null;

  const percent = denominator > 0 ? Math.min(100, Math.round((numerator / denominator) * 100)) : null;

  return { label, secondaryLabel, percent };
}

export function getRegistrationStatusLabel(record: CapacityRecord) {
  const totalFull = record.at_capacity === true;
  const publicFull = record.public_at_capacity === true;
  const waitlistEnabled = record.waitlist_enabled === true;

  if (totalFull) {
    return waitlistEnabled ? 'Waitlist Open' : 'At Capacity';
  }

  if (publicFull) {
    return waitlistEnabled ? 'Waitlist Open' : 'Public Registration Full';
  }

  return 'Registration Open';
}
