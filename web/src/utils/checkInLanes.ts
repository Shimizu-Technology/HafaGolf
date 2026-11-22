export type AlphaLane = 'all' | 'a_j' | 'k_z';

export interface AlphaLaneConfig {
  key: AlphaLane;
  label: string;
  rangeLabel: string;
}

export const ALPHA_LANES: AlphaLaneConfig[] = [
  { key: 'all', label: 'All', rangeLabel: 'All Names' },
  { key: 'a_j', label: 'A–J', rangeLabel: 'Last Name A–J' },
  { key: 'k_z', label: 'K–Z', rangeLabel: 'Last Name K–Z' },
];

export interface AlphaLaneTarget {
  name: string;
  last_name?: string | null;
}

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

/**
 * Extracts the surname (or primary single-word name) used for alphabetical check-in lanes.
 * Strips common generational suffixes like Jr., Sr., II, III so "John Cruz Jr." sorts under "Cruz".
 */
export function extractLaneLookupName(target: AlphaLaneTarget): string {
  const explicitLastName = target.last_name?.trim();
  const fullName = target.name?.trim() || '';

  if (explicitLastName && !NAME_SUFFIXES.has(explicitLastName.toLowerCase())) {
    return explicitLastName;
  }

  if (!fullName) {
    return explicitLastName || '';
  }

  const tokens = fullName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';

  if (tokens.length >= 2 && NAME_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    return tokens[tokens.length - 2];
  }

  return tokens[tokens.length - 1];
}

/**
 * Classifies a golfer into either the A–J lane or the K–Z lane by last name.
 */
export function getAlphaLane(target: AlphaLaneTarget): Exclude<AlphaLane, 'all'> {
  const lookup = extractLaneLookupName(target)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const match = lookup.match(/[A-Za-z]/);
  if (!match) return 'k_z';

  const letter = match[0].toUpperCase();
  return letter >= 'A' && letter <= 'J' ? 'a_j' : 'k_z';
}

export function matchesAlphaLane(target: AlphaLaneTarget, lane: AlphaLane): boolean {
  if (lane === 'all') return true;
  return getAlphaLane(target) === lane;
}

export function filterByAlphaLane<T extends AlphaLaneTarget>(items: T[], lane: AlphaLane): T[] {
  if (lane === 'all') return items;
  return items.filter((item) => matchesAlphaLane(item, lane));
}

export function countByAlphaLane<T extends AlphaLaneTarget>(items: T[]): Record<AlphaLane, number> {
  let aJ = 0;
  let kZ = 0;

  for (const item of items) {
    if (getAlphaLane(item) === 'a_j') {
      aJ += 1;
    } else {
      kZ += 1;
    }
  }

  return {
    all: items.length,
    a_j: aJ,
    k_z: kZ,
  };
}

export function compareByLastName(a: AlphaLaneTarget, b: AlphaLaneTarget): number {
  const lastA = extractLaneLookupName(a).toLowerCase();
  const lastB = extractLaneLookupName(b).toLowerCase();
  const byLast = lastA.localeCompare(lastB);
  if (byLast !== 0) return byLast;
  return (a.name || '').localeCompare(b.name || '');
}
