import type { ThemePackId } from '../../utils/themePacks';

// Every tournament, person, and business on the platform homepage is fictional sample data.
// People and businesses follow the shared demo-data rules: distinctive names, "(demo)" markers.

export type SampleStyleId = 'memorial' | 'charity' | 'alumni';

export interface SampleStylePalette {
  surface: string;
  headerBackground: string;
  headerInk: string;
  headerMuted: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  rule: string;
  track: string;
  headingFont: string;
  radius: string;
  buttonRadius: string;
}

export interface SampleTournamentStyle {
  id: SampleStyleId;
  label: string;
  packId: ThemePackId;
  eyebrow: string;
  tournamentName: string;
  dateLabel: string;
  formatLabel: string;
  teamsRegistered: number;
  teamCapacity: number;
  sponsorTier: string;
  sponsorName: string;
  raffleHighlight: string;
  ctaLabel: string;
  uppercaseTitle: boolean;
  palette: SampleStylePalette;
}

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const DISPLAY_SANS = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

export const SAMPLE_STYLES: SampleTournamentStyle[] = [
  {
    id: 'memorial',
    label: 'Memorial',
    packId: 'memorial-formal',
    eyebrow: '12th annual · In loving memory',
    tournamentName: 'Pacific Links Memorial Classic',
    dateLabel: 'Saturday, March 13',
    formatLabel: 'Shotgun start 7:00 AM · Teams of four',
    teamsRegistered: 31,
    teamCapacity: 36,
    sponsorTier: 'Tribute hole sponsor',
    sponsorName: 'Bluefin Ledger Co. (demo)',
    raffleHighlight: 'Scholarship raffle at the banquet',
    ctaLabel: 'Register a team',
    uppercaseTitle: false,
    palette: {
      surface: '#fffdf8',
      headerBackground: '#f4efe3',
      headerInk: '#1e3553',
      headerMuted: '#5b6b80',
      ink: '#1e293b',
      muted: '#5b6472',
      accent: '#1e3553',
      accentInk: '#ffffff',
      rule: '#b68b3a',
      track: '#e9e2d2',
      headingFont: SERIF,
      radius: '12px',
      buttonRadius: '8px',
    },
  },
  {
    id: 'charity',
    label: 'Charity',
    packId: 'charity-bright',
    eyebrow: 'Raising funds for youth sports',
    tournamentName: 'Island Youth Charity Cup',
    dateLabel: 'Sunday, May 2',
    formatLabel: 'Scramble · 8:00 AM tee times',
    teamsRegistered: 22,
    teamCapacity: 30,
    sponsorTier: 'Eagle sponsor',
    sponsorName: 'Coral Lantern Studio (demo)',
    raffleHighlight: '$5 tickets · 6 for $25 · drawn live',
    ctaLabel: 'Join the cup',
    uppercaseTitle: false,
    palette: {
      surface: '#ffffff',
      headerBackground: 'linear-gradient(135deg, #0f766e 0%, #0b5d57 100%)',
      headerInk: '#ffffff',
      headerMuted: 'rgba(255, 255, 255, 0.82)',
      ink: '#0f172a',
      muted: '#475569',
      accent: '#c2410c',
      accentInk: '#ffffff',
      rule: '#fb923c',
      track: '#e2e8f0',
      headingFont: DISPLAY_SANS,
      radius: '24px',
      buttonRadius: '999px',
    },
  },
  {
    id: 'alumni',
    label: 'Alumni',
    packId: 'crest-classic',
    eyebrow: 'Class reunion weekend',
    tournamentName: 'Heritage Alumni Invitational',
    dateLabel: 'Saturday, August 21',
    formatLabel: 'Best ball · Alumni and friends',
    teamsRegistered: 18,
    teamCapacity: 24,
    sponsorTier: 'Crest sponsor',
    sponsorName: 'Tidepool Logistics (demo)',
    raffleHighlight: 'Class gift raffle and putting contest',
    ctaLabel: 'Reserve a foursome',
    uppercaseTitle: true,
    palette: {
      surface: '#ffffff',
      headerBackground: '#5b1a24',
      headerInk: '#ffffff',
      headerMuted: 'rgba(255, 255, 255, 0.8)',
      ink: '#111827',
      muted: '#4b5563',
      accent: '#5b1a24',
      accentInk: '#ffffff',
      rule: '#c9a24a',
      track: '#e5e7eb',
      headingFont: SERIF,
      radius: '10px',
      buttonRadius: '6px',
    },
  },
];

export interface SampleGolfer {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
}

export const SAMPLE_GOLFERS: SampleGolfer[] = [
  { id: 'abara', firstName: 'Fenwick', lastName: 'Abara', team: 'Team 4 · Hole 7' },
  { id: 'halvorsen', firstName: 'Greer', lastName: 'Halvorsen', team: 'Team 9 · Hole 12' },
  { id: 'lindqvist', firstName: 'Avery', lastName: 'Lindqvist', team: 'Team 4 · Hole 7' },
  { id: 'tarrant', firstName: 'Milo', lastName: 'Tarrant', team: 'Team 15 · Hole 2' },
];

export type CheckInLane = 'A–J' | 'K–Z';

export function laneFor(lastName: string): CheckInLane {
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial >= 'A' && initial <= 'J' ? 'A–J' : 'K–Z';
}

export interface SamplePayoutLine {
  label: string;
  amount: number;
}

export const SAMPLE_PAYOUT_LINES: SamplePayoutLine[] = [
  { label: 'Team registrations', amount: 14400 },
  { label: 'Sponsorships', amount: 9750 },
  { label: 'Raffle sales', amount: 3125 },
];

export function payoutTotal(lines: SamplePayoutLine[] = SAMPLE_PAYOUT_LINES): number {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

export const SAMPLE_RAFFLE_DRAW = {
  ticketNumber: '0427',
  prize: 'Dinner for four',
  donor: 'Starfruit Lane Café (demo)',
};

export const formatUsd = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
