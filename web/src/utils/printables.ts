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

export interface PrintableSponsorTierDefinition {
  key: string;
  label?: string;
  name?: string;
  position?: number | null;
}

export interface PrintableSponsor {
  id: number;
  name: string;
  tier: string;
  tier_display?: string | null;
  tier_priority?: number | null;
  logo_url?: string | null;
  course_key?: string | null;
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

export interface AlphaCheckInRow {
  rowKey: string;
  golferId: number;
  displayName: string;
  subLabel: string | null;
  isPartner: boolean;
  phone: string | null;
  holeLabel: string;
  isPaid: boolean;
  waiverOk: boolean;
  addOnsLabel: string;
}

const DEFAULT_TIER_ORDER = ['title', 'presenting', 'platinum', 'gold', 'silver', 'bronze', 'hole', 'cart', 'beverage', 'custom'];
const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

function normalizeCourseKey(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function parseHolePosition(
  label?: string | null,
  fallbackHole?: number | null,
  fallbackCourseKey?: string | null
): {
  unassigned: number;
  coursePrefix: string;
  holeNumber: number;
  letter: string;
} {
  const raw = (label || '').trim();
  if (!raw || raw.toLowerCase() === 'unassigned') {
    if (fallbackHole && fallbackHole > 0) {
      return {
        unassigned: 0,
        coursePrefix: normalizeCourseKey(fallbackCourseKey).toUpperCase(),
        holeNumber: fallbackHole,
        letter: 'A',
      };
    }
    return { unassigned: 1, coursePrefix: 'ZZZ', holeNumber: 999, letter: 'Z' };
  }

  // Matches "1A", "18B", "Ocean 7A", "Hibiscus 12B"
  const match = raw.match(/^(?:(.+?)\s+)?(\d+)([A-Za-z]?)$/);
  if (match) {
    return {
      unassigned: 0,
      coursePrefix: (match[1] || normalizeCourseKey(fallbackCourseKey)).toUpperCase(),
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
  if (group.hole_number && group.hole_number > 0) {
    const coursePrefix = (group.starting_course_key || '').trim();
    if (coursePrefix) {
      const prettyCourse = coursePrefix.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `${prettyCourse} ${group.hole_number}`;
    }
    return String(group.hole_number);
  }
  return 'Unassigned';
}

export function sortGroupsForShotgun(groups: PrintableGroup[], includeUnassigned = true): PrintableGroup[] {
  const filtered = includeUnassigned
    ? [...groups]
    : groups.filter((g) => getGroupHoleLabel(g) !== 'Unassigned');

  return filtered.sort((a, b) => {
    const pa = parseHolePosition(getGroupHoleLabel(a), a.hole_number, a.starting_course_key);
    const pb = parseHolePosition(getGroupHoleLabel(b), b.hole_number, b.starting_course_key);
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
  const sponsorsByCourseHole = new Map<string, PrintableSponsor>();
  const sponsorsByGlobalHole = new Map<number, PrintableSponsor>();

  for (const s of sponsors) {
    if (s.active === false) continue;
    sponsorsById.set(s.id, s);
    if (s.hole_number && s.hole_number > 0) {
      const course = normalizeCourseKey(s.course_key);
      if (course) {
        const key = `${course}:${s.hole_number}`;
        if (!sponsorsByCourseHole.has(key)) sponsorsByCourseHole.set(key, s);
      } else if (!sponsorsByGlobalHole.has(s.hole_number)) {
        sponsorsByGlobalHole.set(s.hole_number, s);
      }
    }
  }

  return sorted.map((group) => {
    const activePlayers = (group.golfers || []).filter((g) => g.registration_status === 'confirmed');
    const names: string[] = [];
    for (const g of activePlayers) {
      if (g.name?.trim()) names.push(g.name.trim());
      if (g.partner_name?.trim()) names.push(g.partner_name.trim());
    }
    const teamName = activePlayers.find((g) => g.team_name?.trim())?.team_name?.trim() || null;

    // Resolve optional sponsor: golfer's sponsor first, then exact course:hole sponsor, then global hole sponsor
    const golferSponsorId = activePlayers.find((g) => g.sponsor_id)?.sponsor_id ?? null;
    const groupCourse = normalizeCourseKey(group.starting_course_key);
    const courseHoleMatch =
      group.hole_number && groupCourse
        ? sponsorsByCourseHole.get(`${groupCourse}:${group.hole_number}`)
        : undefined;
    const globalHoleMatch = group.hole_number ? sponsorsByGlobalHole.get(group.hole_number) : undefined;

    const matchedSponsor =
      (golferSponsorId ? sponsorsById.get(golferSponsorId) : undefined) ||
      courseHoleMatch ||
      globalHoleMatch ||
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

export function extractSortLastName(fullName: string, explicitLastName?: string | null): string {
  if (explicitLastName?.trim()) return explicitLastName.trim().toLowerCase();
  const tokens = (fullName || '').trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  return (tokens[tokens.length - 1] || '').toLowerCase();
}

export function sortGolfersAlphabetically(golfers: PrintableGolfer[]): PrintableGolfer[] {
  return golfers
    .filter((g) => g.registration_status === 'confirmed')
    .slice()
    .sort((a, b) => {
      const la = extractSortLastName(a.name, a.last_name);
      const lb = extractSortLastName(b.name, b.last_name);
      if (la !== lb) return la.localeCompare(lb);
      return (a.name || '').localeCompare(b.name || '');
    });
}

/**
 * Builds A–Z check-in backup rows strictly for confirmed registrations,
 * indexing BOTH primary golfers and partners by their own last name.
 */
export function buildAlphaCheckInRows(golfers: PrintableGolfer[]): AlphaCheckInRow[] {
  const confirmed = golfers.filter((g) => g.registration_status === 'confirmed');
  const rows: Array<AlphaCheckInRow & { sortLast: string }> = [];

  for (const g of confirmed) {
    const isPaid = g.payment_status === 'paid' || g.payment_type === 'sponsor';
    const waiverOk = Boolean(g.waiver_signed || g.waiver_accepted_at);
    const holeLabel = g.hole_position_label || 'TBD';
    const addOnsLabel =
      g.add_ons_summary ||
      (g.raffle_tickets_requested && g.raffle_tickets_requested > 0
        ? `${g.raffle_tickets_requested}× Raffle`
        : '—');

    rows.push({
      rowKey: `g-${g.id}`,
      golferId: g.id,
      displayName: g.name,
      subLabel: [g.partner_name ? `Partner: ${g.partner_name}` : null, g.team_name].filter(Boolean).join(' · ') || null,
      isPartner: false,
      phone: g.phone || null,
      holeLabel,
      isPaid,
      waiverOk,
      addOnsLabel,
      sortLast: extractSortLastName(g.name, g.last_name),
    });

    if (g.partner_name?.trim()) {
      const partnerName = g.partner_name.trim();
      rows.push({
        rowKey: `g-${g.id}-partner`,
        golferId: g.id,
        displayName: partnerName,
        subLabel: [`Partner of ${g.name}`, g.team_name].filter(Boolean).join(' · '),
        isPartner: true,
        phone: null,
        holeLabel,
        isPaid,
        waiverOk,
        addOnsLabel: 'With partner',
        sortLast: extractSortLastName(partnerName),
      });
    }
  }

  return rows
    .sort((a, b) => {
      if (a.sortLast !== b.sortLast) return a.sortLast.localeCompare(b.sortLast);
      return a.displayName.localeCompare(b.displayName);
    })
    .map(({ sortLast: _sortLast, ...row }) => row);
}

export function groupSponsorsForSignage(
  sponsors: PrintableSponsor[],
  tierDefinitions: PrintableSponsorTierDefinition[] = []
): Array<{
  tierKey: string;
  tierLabel: string;
  sponsors: PrintableSponsor[];
}> {
  const active = sponsors.filter((s) => s.active !== false);
  const tierDefRank = new Map<string, number>();
  const tierDefLabel = new Map<string, string>();

  tierDefinitions.forEach((def, idx) => {
    const key = def.key.toLowerCase();
    tierDefRank.set(key, typeof def.position === 'number' ? def.position : idx);
    if (def.label || def.name) tierDefLabel.set(key, (def.label || def.name)!);
  });

  const buckets = new Map<string, { tierLabel: string; priority: number; sponsors: PrintableSponsor[] }>();

  for (const s of active) {
    const key = (s.tier || 'custom').toLowerCase();
    const label =
      s.tier_display ||
      tierDefLabel.get(key) ||
      key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const explicitPriority =
      typeof s.tier_priority === 'number'
        ? s.tier_priority
        : tierDefRank.has(key)
        ? tierDefRank.get(key)!
        : DEFAULT_TIER_ORDER.indexOf(key) !== -1
        ? 100 + DEFAULT_TIER_ORDER.indexOf(key)
        : 999;

    if (!buckets.has(key)) {
      buckets.set(key, { tierLabel: label, priority: explicitPriority, sponsors: [] });
    }
    buckets.get(key)!.sponsors.push(s);
  }

  return Array.from(buckets.entries())
    .sort(([ka, ba], [kb, bb]) => {
      if (ba.priority !== bb.priority) return ba.priority - bb.priority;
      return ka.localeCompare(kb);
    })
    .map(([tierKey, group]) => ({
      tierKey,
      tierLabel: group.tierLabel,
      sponsors: group.sponsors.sort((a, b) => {
        const ca = normalizeCourseKey(a.course_key);
        const cb = normalizeCourseKey(b.course_key);
        if (ca !== cb) return ca.localeCompare(cb);
        const ha = a.hole_number || 999;
        const hb = b.hole_number || 999;
        if (ha !== hb) return ha - hb;
        return (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name);
      }),
    }));
}
