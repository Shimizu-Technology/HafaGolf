import { createStoryPhotoId } from '../../utils/storyPhotoDraft';
import type { OrganizationMedia, TournamentMedia } from '../BrandingMediaPanel';
import type { Tournament } from '../../services/api';
import type { Organization } from '../../stores/organizationStore';
import type { HomepageConfig } from '../../utils/homepageConfig';
import { resolveThemePackId } from '../../utils/themePacks';

interface HomepageStat {
  value: string;
  label: string;
}

export interface OrganizationDraft extends OrganizationMedia {
  show_homepage_sponsors: boolean;
  name: string;
  slug: string;
  primary_color: string;
  accent_color: string;
  offseason_title: string;
  offseason_message: string;
  offseason_cta_label: string;
  offseason_cta_url: string;
  contact_email: string;
  contact_phone: string;
  website_url: string;
  homepage_tagline: string;
  homepage_mission: string;
  homepage_stats: HomepageStat[];
  homepage_config: HomepageConfig;
}

export type RegistrationMode = 'regular' | 'walkin' | 'closed';

export interface SponsorTierDef {
  key: string;
  label: string;
  sort_order: number;
}

export interface RaffleBundleDef {
  quantity: number;
  price_cents: number;
  label: string;
}

export interface CourseConfigDef {
  key: string;
  name: string;
  hole_count: number;
}

interface AdminTournamentListItem {
  slug: string;
  status?: string;
}

interface AdminTournamentListResponse {
  tournaments?: AdminTournamentListItem[];
}

export const MAX_COURSE_HOLES = 18;

const DEFAULT_RAFFLE_BUNDLES: RaffleBundleDef[] = [
  { quantity: 4,  price_cents: 2000,  label: '$20 for 4 tickets' },
  { quantity: 12, price_cents: 5000,  label: '$50 for 12 tickets' },
  { quantity: 25, price_cents: 10000, label: '$100 for 25 tickets' },
];

const DEFAULT_COURSE_CONFIGS: CourseConfigDef[] = [
  { key: 'course-1', name: 'Course', hole_count: 18 },
];

export function createCourseConfig(seed?: number): CourseConfigDef {
  const suffix = seed ?? Date.now();
  return {
    key: `course-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'New Course',
    hole_count: 9,
  };
}

export function clampCourseHoleCount(value: number): number {
  return Math.min(MAX_COURSE_HOLES, Math.max(1, value));
}

export interface TournamentSettings extends TournamentMedia {
  id: number;
  slug: string;
  name: string;
  event_date: string;
  location_name: string;
  location_address: string;
  format_name: string;
  tournament_format: string;
  team_size: string;
  capacity_unit: 'players' | 'teams';
  allow_partial_teams: boolean;
  teams_per_start_position: string;
  start_positions_per_hole: string;
  registration_mode: RegistrationMode;
  registration_deadline: string;
  entry_fee_display: string;
  entry_fee_dollars: string;
  employee_entry_fee_dollars: string;
  walkin_fee: string;
  max_capacity: string;
  swipe_simple_url: string;
  walkin_swipe_simple_url: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  waitlist_enabled: boolean;
  waitlist_max: string;
  waiver_enabled: boolean;
  waiver_text: string;
  show_public_sponsors: boolean;
  sponsor_wall_title: string;
  directory_listed: boolean;
  theme_preset: string;
  use_org_branding: boolean;
  homepage_config: HomepageConfig;
  primary_color_override: string;
  accent_color_override: string;
  raffle_enabled: boolean;
  raffle_hold_winner_on_screen: boolean;
  raffle_description: string;
  raffle_draw_time: string;
  raffle_ticket_price_dollars: string;
  raffle_include_with_registration: boolean;
  raffle_bundles: RaffleBundleDef[];
  course_configs: CourseConfigDef[];
  sponsor_edit_deadline: string;
  sponsor_tiers: SponsorTierDef[];
  allow_sponsor_check_invoice: boolean;
  event_schedule: string;
  payment_instructions: string;
  check_in_time: string;
  start_time: string;
  fee_includes: string;
  tournament_info: string;
  tax_receipt_enabled: boolean;
  tax_org_name: string;
  tax_org_ein: string;
  fmv_per_player_dollars: string;
  tax_receipt_disclaimer: string;
}

function deriveRegistrationMode(registration_open: boolean, walkin_registration_open: boolean): RegistrationMode {
  if (registration_open) return 'regular';
  if (walkin_registration_open) return 'walkin';
  return 'closed';
}


export type ChangeTournament = <K extends keyof TournamentSettings>(field: K, value: TournamentSettings[K]) => void;

export interface TournamentDraftProps {
  tournamentSettings: TournamentSettings;
  handleTournamentChange: ChangeTournament;
}

export type UpdateOrganization = (patch: Partial<OrganizationDraft>) => void;

const asDollars = (cents?: number | null) => cents == null ? '' : (cents / 100).toFixed(2);
export const asCents = (dollars: string) => dollars.trim() ? Math.round(Number(dollars) * 100) : null;

export function organizationDraft(organization: Organization): OrganizationDraft {
  const settings = organization.settings;
  return {
    name: organization.name || '',
    slug: organization.slug || '',
    contact_email: organization.contact_email || '',
    contact_phone: organization.contact_phone || '',
    website_url: organization.website_url || '',
    primary_color: organization.primary_color || settings?.primary_color || '',
    accent_color: organization.accent_color || settings?.accent_color || '',
    logo_url: organization.logo_url || '',
    reversed_logo_url: organization.reversed_logo_url || '',
    show_homepage_sponsors: organization.show_homepage_sponsors ?? false,
    offseason_title: organization.offseason_title || '',
    offseason_message: organization.offseason_message || '',
    offseason_cta_label: organization.offseason_cta_label || '',
    offseason_cta_url: organization.offseason_cta_url || '',
    homepage_tagline: settings?.homepage_tagline || '',
    homepage_mission: settings?.homepage_mission || '',
    homepage_stats: settings?.homepage_stats || [{ value: '', label: '' }],
    homepage_config: organization.homepage_config || {},
  };
}

export function organizationPayload(draft: OrganizationDraft) {
  const { accent_color, homepage_tagline, homepage_mission, homepage_stats, homepage_config, ...fields } = draft;
  return {
    ...fields,
    primary_color: fields.primary_color.trim(),
    logo_url: fields.logo_url.trim() || null,
    reversed_logo_url: fields.reversed_logo_url.trim() || null,
    homepage_config,
    settings: {
      accent_color: accent_color.trim() || null,
      homepage_tagline,
      homepage_mission,
      homepage_stats: homepage_stats.filter((stat) => stat.value || stat.label),
    },
  };
}

export function changedFields<T extends object>(next: T, previous: T): Partial<T> {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(previous[key as keyof T])
  )) as Partial<T>;
}

export function tournamentDraft(t: Tournament): TournamentSettings {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name || '',
    event_date: t.event_date || '',
    location_name: t.location_name || '',
    location_address: t.location_address || '',
    format_name: t.format_name || '',
    tournament_format: t.tournament_format || '',
    team_size: t.team_size?.toString() || '2',
    capacity_unit: t.capacity_unit === 'players' ? 'players' : 'teams',
    allow_partial_teams: t.allow_partial_teams ?? false,
    teams_per_start_position: t.teams_per_start_position?.toString() || '1',
    start_positions_per_hole: t.start_positions_per_hole?.toString() || '',
    registration_mode: deriveRegistrationMode(t.registration_open ?? false, t.walkin_registration_open ?? false),
    registration_deadline: t.registration_deadline || '',
    entry_fee_display: t.entry_fee_display || '',
    entry_fee_dollars: asDollars(t.entry_fee),
    employee_entry_fee_dollars: asDollars(t.employee_entry_fee),
    walkin_fee: t.walkin_fee != null ? (t.walkin_fee / 100).toString() : '',
    max_capacity: t.max_capacity?.toString() || '',
    waitlist_enabled: t.waitlist_enabled ?? false,
    waitlist_max: t.waitlist_max?.toString() || '',
    banner_url_override: t.banner_url_override || '',
    signature_image_url_override: t.signature_image_url_override || '',
    commemorative_banner_url: t.commemorative_banner_url || '',
    tribute_title: t.tribute_title || '',
    tribute_subtitle: t.tribute_subtitle || '',
    story_photos: (t.story_photos || []).map((photo) => ({ ...photo, draftId: createStoryPhotoId() })),
    waiver_enabled: t.waiver_enabled ?? true,
    waiver_text: t.waiver_text || '',
    show_public_sponsors: t.show_public_sponsors ?? true,
    sponsor_wall_title: t.sponsor_wall_title || '',
    directory_listed: t.directory_listed ?? false,
    theme_preset: t.theme_preset || 'default-clean',
    use_org_branding: t.use_org_branding ?? true,
    homepage_config: t.homepage_config || {},
    primary_color_override: t.primary_color_override || '',
    accent_color_override: t.accent_color_override || '',
    swipe_simple_url: t.swipe_simple_url || '',
    walkin_swipe_simple_url: t.walkin_swipe_simple_url || '',
    contact_name: t.contact_name || '',
    contact_phone: t.contact_phone || '',
    contact_email: t.contact_email || '',
    raffle_enabled: t.raffle_enabled ?? false,
    raffle_hold_winner_on_screen: t.raffle_hold_winner_on_screen ?? true,
    raffle_description: t.raffle_description || '',
    raffle_draw_time: t.raffle_draw_time || '',
    raffle_ticket_price_dollars: asDollars(t.raffle_ticket_price_cents ?? 500),
    raffle_include_with_registration: t.raffle_include_with_registration ?? false,
    raffle_bundles: t.raffle_bundles || DEFAULT_RAFFLE_BUNDLES,
    course_configs: t.course_configs?.length ? t.course_configs : DEFAULT_COURSE_CONFIGS,
    sponsor_edit_deadline: t.sponsor_edit_deadline || '',
    sponsor_tiers: t.sponsor_tiers || [
      { key: 'title', label: 'Title Sponsor', sort_order: 0 },
      { key: 'platinum', label: 'Platinum', sort_order: 1 },
      { key: 'gold', label: 'Gold', sort_order: 2 },
      { key: 'silver', label: 'Silver', sort_order: 3 },
      { key: 'bronze', label: 'Bronze', sort_order: 4 },
      { key: 'hole', label: 'Hole Sponsor', sort_order: 5 },
    ],
    allow_sponsor_check_invoice: t.allow_sponsor_check_invoice ?? true,
    event_schedule: t.event_schedule || '',
    tournament_info: t.tournament_info || '',
    payment_instructions: t.payment_instructions || '',
    check_in_time: t.check_in_time || '',
    start_time: t.start_time || '',
    fee_includes: t.fee_includes || '',
    tax_receipt_enabled: t.tax_receipt_enabled ?? false,
    tax_org_name: t.tax_org_name || '',
    tax_org_ein: t.tax_org_ein || '',
    fmv_per_player_dollars:
      t.fmv_per_player_cents != null ? (t.fmv_per_player_cents / 100).toFixed(2) : '0.00',
    tax_receipt_disclaimer: t.tax_receipt_disclaimer || '',
  };
}

export function tournamentPayload(tournamentSettings: TournamentSettings) {
  const isRegular = tournamentSettings.registration_mode === 'regular';
  const isWalkin = tournamentSettings.registration_mode === 'walkin';

  return {
    name: tournamentSettings.name.trim(),
    event_date: tournamentSettings.event_date || null,
    location_name: tournamentSettings.location_name || null,
    location_address: tournamentSettings.location_address || null,
    format_name: tournamentSettings.format_name || null,
    team_size: tournamentSettings.team_size ? parseInt(tournamentSettings.team_size, 10) : 2,
    capacity_unit: tournamentSettings.capacity_unit,
    allow_partial_teams: tournamentSettings.allow_partial_teams,
    teams_per_start_position: tournamentSettings.teams_per_start_position ? parseInt(tournamentSettings.teams_per_start_position) : 1,
    start_positions_per_hole: tournamentSettings.start_positions_per_hole ? parseInt(tournamentSettings.start_positions_per_hole) : null,
    registration_open: isRegular,
    walkin_registration_open: isWalkin,
    registration_deadline: tournamentSettings.registration_deadline || null,
    entry_fee_display: tournamentSettings.entry_fee_display || null,
    entry_fee: asCents(tournamentSettings.entry_fee_dollars),
    employee_entry_fee: asCents(tournamentSettings.employee_entry_fee_dollars),
    walkin_fee: asCents(tournamentSettings.walkin_fee),
    max_capacity: tournamentSettings.max_capacity ? parseInt(tournamentSettings.max_capacity) : null,
    waitlist_enabled: tournamentSettings.waitlist_enabled,
    waitlist_max: tournamentSettings.waitlist_max ? parseInt(tournamentSettings.waitlist_max) : null,
    banner_url_override: tournamentSettings.banner_url_override.trim() || null,
    signature_image_url_override: tournamentSettings.signature_image_url_override.trim() || null,
    commemorative_banner_url: tournamentSettings.commemorative_banner_url.trim() || null,
    tribute_title: tournamentSettings.tribute_title.trim() || null,
    tribute_subtitle: tournamentSettings.tribute_subtitle.trim() || null,
    story_photos: tournamentSettings.story_photos
      .filter((photo) => photo.url.trim())
      .map(({ url, caption }) => ({ url: url.trim(), caption: caption?.trim() || null })),
    waiver_enabled: tournamentSettings.waiver_enabled,
    waiver_text: tournamentSettings.waiver_text.trim() || null,
    show_public_sponsors: tournamentSettings.show_public_sponsors,
    sponsor_wall_title: tournamentSettings.sponsor_wall_title.trim() || null,
    directory_listed: tournamentSettings.directory_listed,
    theme_preset: resolveThemePackId(tournamentSettings.theme_preset),
    use_org_branding: tournamentSettings.use_org_branding,
    homepage_config: tournamentSettings.homepage_config,
    primary_color_override: tournamentSettings.primary_color_override.trim() || null,
    accent_color_override: tournamentSettings.accent_color_override.trim() || null,
    swipe_simple_url: tournamentSettings.swipe_simple_url || null,
    walkin_swipe_simple_url: tournamentSettings.walkin_swipe_simple_url || null,
    contact_name: tournamentSettings.contact_name || null,
    contact_phone: tournamentSettings.contact_phone || null,
    contact_email: tournamentSettings.contact_email || null,
    raffle_enabled: tournamentSettings.raffle_enabled,
    raffle_hold_winner_on_screen: tournamentSettings.raffle_hold_winner_on_screen,
    raffle_description: tournamentSettings.raffle_description || null,
    raffle_draw_time: tournamentSettings.raffle_draw_time || null,
    raffle_ticket_price_cents: asCents(tournamentSettings.raffle_ticket_price_dollars) ?? 500,
    raffle_include_with_registration: tournamentSettings.raffle_include_with_registration,
    raffle_bundles: tournamentSettings.raffle_bundles,
    course_configs: tournamentSettings.course_configs.map((course) => ({
      ...course,
      hole_count: clampCourseHoleCount(course.hole_count),
    })),
    sponsor_edit_deadline: tournamentSettings.sponsor_edit_deadline || null,
    sponsor_tiers: tournamentSettings.sponsor_tiers,
    allow_sponsor_check_invoice: tournamentSettings.allow_sponsor_check_invoice,
    event_schedule: tournamentSettings.event_schedule || null,
    tournament_info: tournamentSettings.tournament_info || null,
    payment_instructions: tournamentSettings.payment_instructions || null,
    check_in_time: tournamentSettings.check_in_time || null,
    start_time: tournamentSettings.start_time || null,
    fee_includes: tournamentSettings.fee_includes || null,
    tax_receipt_enabled: tournamentSettings.tax_receipt_enabled,
    tax_org_name: tournamentSettings.tax_org_name || null,
    tax_org_ein: tournamentSettings.tax_org_ein || null,
    fmv_per_player_cents: tournamentSettings.fmv_per_player_dollars
      ? Math.max(0, Math.round(parseFloat(tournamentSettings.fmv_per_player_dollars) * 100) || 0)
      : 0,
    tax_receipt_disclaimer: tournamentSettings.tax_receipt_disclaimer || null,
  };
}

export type SettingsRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function loadEventSettings(request: SettingsRequest, organizationSlug: string, eventSlug?: string) {
  const base = `/api/v1/admin/organizations/${organizationSlug}/tournaments`;
  let slug = eventSlug;
  if (!slug) {
    const { tournaments = [] } = await request<AdminTournamentListResponse>(base);
    slug = (tournaments.find((event) => event.status !== 'archived') || tournaments[0])?.slug;
  }

  if (!slug) return null;
  const detail = await request<{ tournament: Tournament } | Tournament>(`${base}/${slug}`);
  const event = 'tournament' in detail ? detail.tournament : detail;
  return {
    draft: tournamentDraft(event),
    sponsorReservedTeams: event.sponsor_reserved_teams ?? 0,
    sponsorReservedSlots: event.capacity_summary?.sponsor_reserved_slots ?? ((event.sponsor_reserved_teams ?? 0) * (event.team_size ?? 2)),
  };
}
