// Shared helpers for sponsor player slots: team grouping, plain-English
// progress labels, monogram initials, Guam-time deadlines, and clipboard copy.

export const TSHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'] as const;

export interface SlotTeam<T> {
  teamNumber: number;
  firstPlayer: number;
  lastPlayer: number;
  slots: T[];
}

export function normalizeTeamSize(teamSize: number | null | undefined): number {
  const size = Math.floor(Number(teamSize) || 0);
  return size >= 1 ? size : 1;
}

/** Groups slots (ordered by slot_number) into teams of `teamSize`. */
export function groupSlotsIntoTeams<T extends { slot_number: number }>(
  slots: T[],
  teamSize: number | null | undefined
): SlotTeam<T>[] {
  const size = normalizeTeamSize(teamSize);
  const ordered = [...slots].sort((a, b) => a.slot_number - b.slot_number);
  const teams: SlotTeam<T>[] = [];
  for (let i = 0; i < ordered.length; i += size) {
    const chunk = ordered.slice(i, i + size);
    teams.push({
      teamNumber: teams.length + 1,
      firstPlayer: chunk[0].slot_number,
      lastPlayer: chunk[chunk.length - 1].slot_number,
      slots: chunk,
    });
  }
  return teams;
}

/** "Team 1 — Players 1–2", or "Team 3 — Player 5" for a single leftover slot. */
export function teamHeading(team: Pick<SlotTeam<unknown>, 'teamNumber' | 'firstPlayer' | 'lastPlayer'>): string {
  const players = team.firstPlayer === team.lastPlayer
    ? `Player ${team.firstPlayer}`
    : `Players ${team.firstPlayer}–${team.lastPlayer}`;
  return `Team ${team.teamNumber} — ${players}`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Team-size label without progress, e.g. "2 Teams (4 slots)" or "4 Players". */
export function describeSlotTeams(slotCount: number, teamSize: number | null | undefined): string {
  const slots = Math.max(0, Math.floor(Number(slotCount) || 0));
  const size = normalizeTeamSize(teamSize);
  if (slots === 0) return 'No player slots';
  if (size === 1) return plural(slots, 'Player');

  const fullTeams = Math.floor(slots / size);
  const extra = slots % size;
  const teamsText = fullTeams > 0 ? plural(fullTeams, 'Team') : '';
  const extraText = extra > 0 ? plural(extra, 'extra player') : '';
  const parts = [teamsText, extraText].filter(Boolean).join(' + ');
  return `${parts} (${plural(slots, 'slot')})`;
}

/** Admin row summary, e.g. "2 Teams (4 slots) · 3/4 entered". */
export function describeSponsorSlots(
  slotCount: number,
  filled: number,
  teamSize: number | null | undefined
): string {
  const slots = Math.max(0, Math.floor(Number(slotCount) || 0));
  if (slots === 0) return 'No player slots';
  const entered = Math.min(Math.max(0, Math.floor(Number(filled) || 0)), slots);
  return `${describeSlotTeams(slots, teamSize)} · ${entered}/${slots} entered`;
}

export type PortalStatusTone = 'complete' | 'partial' | 'empty' | 'none';

export function portalStatus(slotCount: number, filled: number): { label: string; tone: PortalStatusTone } {
  const slots = Math.max(0, Math.floor(Number(slotCount) || 0));
  const entered = Math.min(Math.max(0, Math.floor(Number(filled) || 0)), slots);
  if (slots === 0) return { label: 'No Slots', tone: 'none' };
  if (entered === 0) return { label: 'Not Started', tone: 'empty' };
  if (entered >= slots) return { label: 'All Entered', tone: 'complete' };
  return { label: `${entered}/${slots} Filled`, tone: 'partial' };
}

const SKIPPED_WORDS = new Set(['the', 'of', 'and', 'inc', 'llc', 'ltd', 'co', 'corp']);

/** Up to two initials for a typographic monogram, e.g. "Bank of Island" -> "BI". */
export function sponsorInitials(name: string | null | undefined): string {
  const words = (name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !SKIPPED_WORDS.has(word.toLowerCase()));
  const source = meaningful.length > 0 ? meaningful : words;
  if (source.length === 0) return '?';
  if (source.length === 1) {
    const chars = Array.from(source[0]);
    return chars.slice(0, Math.min(2, chars.length)).join('').toUpperCase();
  }
  return (Array.from(source[0])[0] + Array.from(source[1])[0]).toUpperCase();
}

const GUAM_TZ = 'Pacific/Guam';

/** "Friday, December 4, 2026 at 5:00 PM ChST" — always shown in Guam time. */
export function formatGuamDeadline(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: GUAM_TZ,
  });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: GUAM_TZ });
  return `${day} at ${time} ChST`;
}

/**
 * Copies text to the clipboard. Falls back to a hidden textarea for older
 * browsers or non-secure contexts. Resolves false when both paths fail so the
 * caller can show the link for manual copying.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
