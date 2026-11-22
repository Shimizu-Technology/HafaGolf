import type { Tournament } from '../services/api';

export interface CloneFormState {
  name: string;
  year: string;
  edition: string;
  event_date: string;
  copy_raffle_prizes: boolean;
  copy_sponsor_shells: boolean;
  target_organization_id: string;
}

export function ordinalizeNumber(num: number): string {
  const abs = Math.abs(Math.trunc(num));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${num}th`;
  }

  switch (abs % 10) {
    case 1:
      return `${num}st`;
    case 2:
      return `${num}nd`;
    case 3:
      return `${num}rd`;
    default:
      return `${num}th`;
  }
}

export function incrementEdition(edition?: string | null): string {
  if (!edition || !edition.trim()) return '';

  const trimmed = edition.trim();
  const match = trimmed.match(/\b(\d+)(st|nd|rd|th)?\b/i);
  if (!match) return trimmed;

  const nextNumber = parseInt(match[1], 10) + 1;
  if (Number.isNaN(nextNumber)) return trimmed;

  return trimmed.replace(match[0], ordinalizeNumber(nextNumber));
}

export function isCrossOrgClone(
  sourceOrganizationId: string | undefined | null,
  targetOrganizationId: string | undefined | null
): boolean {
  const target = (targetOrganizationId || '').trim();
  if (!target) return false;
  if (!sourceOrganizationId) return true;
  return target !== sourceOrganizationId;
}

export function buildDefaultCloneForm(tournament: Tournament): CloneFormState {
  const baseYear =
    typeof tournament.year === 'number' && Number.isFinite(tournament.year) && tournament.year > 0
      ? tournament.year
      : new Date().getFullYear();

  return {
    name: tournament.name || '',
    year: String(baseYear + 1),
    edition: incrementEdition(tournament.edition),
    event_date: '',
    copy_raffle_prizes: false,
    copy_sponsor_shells: false,
    target_organization_id: '',
  };
}
