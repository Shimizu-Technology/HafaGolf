export interface PrintableGolfer {
  id: number;
  name: string;
  last_name?: string | null;
  partner_name?: string | null;
  team_name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  registration_status: string;
  payment_status: string;
  payment_type?: string | null;
  waiver_signed?: boolean;
  waiver_accepted_at?: string | null;
  checked_in_at?: string | null;
  hole_position_label?: string | null;
  starting_hole_description?: string | null;
  group_id?: number | null;
  sponsor_id?: number | null;
  sponsor_display_name?: string | null;
  add_ons_summary?: string | null;
  raffle_tickets_requested?: number | null;
}

export interface PrintableGroup {
  id: number;
  group_number: number;
  hole_number?: number | null;
  starting_course_key?: string | null;
  hole_position?: string | null;
  hole_position_label?: string | null;
  starting_hole_description?: string | null;
  golfers?: PrintableGolfer[];
}

export interface PrintableSponsor {
  id: number;
  name: string;
  tier: string;
  tier_display?: string | null;
  logo_url?: string | null;
  hole_number?: number | null;
  slot_count?: number | null;
  active?: boolean;
  position?: number | null;
}

export interface CartSignCard {
  groupId: number;
  groupNumber: number;
  holeLabel: string;
  courseDescription: string | null;
  teamName: string | null;
  players: string[];
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
}

const TIER_ORDER = ['title', 'presenting', 'platinum', 'gold', 'silver', 'bronze', 'hole', 'cart', 'beverage', 'custom'];

function parseHolePosition(label?: string | null, fallbackHole?: number | null): {
  unassigned: number;
  coursePrefix: string;
  holeNumber: number;
  letter: string;
} {
  const raw = (label || '').trim();
  if (!raw || raw.toLowerCase() === 'unassigned') {
    if (fallbackHole && fallbackHole > 0) {
      return { unassigned: 0, coursePrefix: '', holeNumber: fallbackHole, letter: 'A' };
    }
    return { unassigned: 1, coursePrefix: 'ZZZ', holeNumber: 999, letter: 'Z' };
  }

  // Matches "1A", "18B", "Ocean 7A", "Hibiscus 12B"
  const match = raw.match(/^(?:(.+?)\s+)?(\d+)([A-Za-z]?)$/);
  if (match) {
    return {
      unassigned: 0,
      coursePrefix: (match[1] || '').toUpperCase(),
      holeNumber: parseInt(match[2], 10),
      letter: (match[3] || 'A').toUpperCase(),
    };
  }

  return {
    unassigned: 0,
    coursePrefix: raw.toUpperCase(),
    holeNumber: fallbackHole || 999,
    letter: 'A',
  };
}

export function getGroupHoleLabel(group: PrintableGroup): string {
  const label = (group.hole_position_label || group.hole_position || '').trim();
  if (label && label.toLowerCase() !== 'unassigned') return label;
  if (group.hole_number && group.hole_number > 0) return String(group.hole_number);
  return 'Unassigned';
}

export function sortGroupsForShotgun(groups: PrintableGroup[], includeUnassigned = true): PrintableGroup[] {
  const filtered = includeUnassigned
    ? [...groups]
    : groups.filter((g) => getGroupHoleLabel(g) !== 'Unassigned');

  return filtered.sort((a, b) => {
    const pa = parseHolePosition(getGroupHoleLabel(a), a.hole_number);
    const pb = parseHolePosition(getGroupHoleLabel(b), b.hole_number);
    if (pa.unassigned !== pb.unassigned) return pa.unassigned - pb.unassigned;
    if (pa.coursePrefix !== pb.coursePrefix) return pa.coursePrefix.localeCompare(pb.coursePrefix);
    if (pa.holeNumber !== pb.holeNumber) return pa.holeNumber - pb.holeNumber;
    if (pa.letter !== pb.letter) return pa.letter.localeCompare(pb.letter);
    return a.group_number - b.group_number;
  });
}

export function buildCartSigns(
  groups: PrintableGroup[],
  sponsors: PrintableSponsor[],
  includeUnassigned = false
): CartSignCard[] {
  const sorted = sortGroupsForShotgun(groups, includeUnassigned);
  const sponsorsById = new Map<number, PrintableSponsor>();
  const sponsorsByHole = new Map<number, PrintableSponsor>();

  for (const s of sponsors) {
    if (s.active === false) continue;
    sponsorsById.set(s.id, s);
    if (s.hole_number && s.hole_number > 0 && !sponsorsByHole.has(s.hole_number)) {
      sponsorsByHole.set(s.hole_number, s);
    }
  }

  return sorted.map((group) => {
    const activePlayers = (group.golfers || []).filter((g) => g.registration_status !== 'cancelled');
    const names: string[] = [];
    for (const g of activePlayers) {
      if (g.name?.trim()) names.push(g.name.trim());
      if (g.partner_name?.trim()) names.push(g.partner_name.trim());
    }
    const teamName = activePlayers.find((g) => g.team_name?.trim())?.team_name?.trim() || null;

    // Resolve optional sponsor: golfer's sponsor first, then hole sponsor
    const golferSponsorId = activePlayers.find((g) => g.sponsor_id)?.sponsor_id ?? null;
    const matchedSponsor =
      (golferSponsorId ? sponsorsById.get(golferSponsorId) : undefined) ||
      (group.hole_number ? sponsorsByHole.get(group.hole_number) : undefined) ||
      null;
    const fallbackSponsorName = activePlayers.find((g) => g.sponsor_display_name)?.sponsor_display_name || null;

    return {
      groupId: group.id,
      groupNumber: group.group_number,
      holeLabel: getGroupHoleLabel(group),
      courseDescription: group.starting_hole_description || null,
      teamName,
      players: names,
      sponsorName: matchedSponsor?.name || fallbackSponsorName,
      sponsorLogoUrl: matchedSponsor?.logo_url || null,
    };
  });
}

export function chunkCartSigns(cards: CartSignCard[], perPage = 2): CartSignCard[][] {
  const pages: CartSignCard[][] = [];
  for (let i = 0; i < cards.length; i += perPage) {
    pages.push(cards.slice(i, i + perPage));
  }
  return pages;
}

function extractLastName(golfer: PrintableGolfer): string {
  if (golfer.last_name?.trim()) return golfer.last_name.trim().toLowerCase();
  const parts = (golfer.name || '').trim().split(/\s+/);
  return (parts[parts.length - 1] || '').toLowerCase();
}

export function sortGolfersAlphabetically(golfers: PrintableGolfer[]): PrintableGolfer[] {
  return golfers
    .filter((g) => g.registration_status !== 'cancelled')
    .slice()
    .sort((a, b) => {
      const la = extractLastName(a);
      const lb = extractLastName(b);
      if (la !== lb) return la.localeCompare(lb);
      return (a.name || '').localeCompare(b.name || '');
    });
}

export function groupSponsorsForSignage(sponsors: PrintableSponsor[]): Array<{
  tierKey: string;
  tierLabel: string;
  sponsors: PrintableSponsor[];
}> {
  const active = sponsors.filter((s) => s.active !== false);
  const buckets = new Map<string, { tierLabel: string; sponsors: PrintableSponsor[] }>();

  for (const s of active) {
    const key = (s.tier || 'custom').toLowerCase();
    const label = s.tier_display || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (!buckets.has(key)) buckets.set(key, { tierLabel: label, sponsors: [] });
    buckets.get(key)!.sponsors.push(s);
  }

  return Array.from(buckets.entries())
    .sort(([ka], [kb]) => {
      const ia = TIER_ORDER.indexOf(ka);
      const ib = TIER_ORDER.indexOf(kb);
      const ra = ia === -1 ? 999 : ia;
      const rb = ib === -1 ? 999 : ib;
      if (ra !== rb) return ra - rb;
      return ka.localeCompare(kb);
    })
    .map(([tierKey, group]) => ({
      tierKey,
      tierLabel: group.tierLabel,
      sponsors: group.sponsors.sort((a, b) => {
        const ha = a.hole_number || 999;
        const hb = b.hole_number || 999;
        if (ha !== hb) return ha - hb;
        return (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name);
      }),
    }));
}
