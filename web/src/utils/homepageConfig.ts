import type { ThemePackId } from './themePacks';

export const HOMEPAGE_ARCHETYPES = [
  'ceremonial-light',
  'charity-showcase',
  'scenic-photo',
  'varsity-crest',
  'clean-editorial',
] as const;

export type HomepageArchetype = (typeof HOMEPAGE_ARCHETYPES)[number];

export type LandingMode = 'direct_to_active_event' | 'org_hub';

export type HeroSurface = 'light_airy' | 'brand_gradient' | 'dark_editorial' | 'photo_scrim';

export type ArtworkDisplay = 'showcase_split' | 'full_bleed_bg' | 'emblem_lockup' | 'none';

export type LogoDisplay = 'auto' | 'commemorative_banner' | 'org_logo' | 'reversed_logo' | 'none';

export const HOMEPAGE_SECTION_KEYS = [
  'key_stats_bar',
  'event_details_card',
  'action_cards',
  'story_strip',
  'sponsor_wall',
  'raffle_spotlight',
  'contact_bar',
] as const;

export type HomepageSectionKey = (typeof HOMEPAGE_SECTION_KEYS)[number];

export interface HomepageSectionConfig {
  key: HomepageSectionKey;
  enabled: boolean;
}

export interface HomepageConfig {
  archetype?: HomepageArchetype | '';
  landing_mode?: LandingMode | '';
  hero_surface?: HeroSurface | '';
  artwork_display?: ArtworkDisplay | '';
  logo_display?: LogoDisplay | '';
  eyebrow_label?: string | null;
  sections?: HomepageSectionConfig[];
}

export interface ResolvedHomepageConfig {
  archetype: HomepageArchetype;
  landing_mode: LandingMode;
  hero_surface: HeroSurface;
  artwork_display: ArtworkDisplay;
  logo_display: LogoDisplay;
  eyebrow_label: string;
  sections: HomepageSectionConfig[];
}

export interface ArchetypeMeta {
  id: HomepageArchetype;
  label: string;
  tagline: string;
  description: string;
  themePreset: ThemePackId;
  defaults: Omit<ResolvedHomepageConfig, 'eyebrow_label'>;
}

export const SECTION_LABELS: Record<HomepageSectionKey, { label: string; description: string }> = {
  key_stats_bar: {
    label: 'Key Stats Strip',
    description: 'Compact bar showing date, venue, format, entry fee, and spots.',
  },
  event_details_card: {
    label: 'Event Details & Registration',
    description: 'Schedule, course info, entry fee includes, and registration card.',
  },
  action_cards: {
    label: 'Play & Support Cards',
    description: 'Uniform action cards for registration, raffle, sponsors, and donations.',
  },
  story_strip: {
    label: 'Impact Story Strip',
    description: 'Up to three captioned photos showcasing past events or mission impact.',
  },
  sponsor_wall: {
    label: 'Public Sponsor Wall',
    description: 'Tiered sponsor logos and acknowledgments.',
  },
  raffle_spotlight: {
    label: 'Raffle Spotlight',
    description: 'Direct banner and Check My Ticket shortcut when raffle is active.',
  },
  contact_bar: {
    label: 'Organizer Contact Bar',
    description: 'Clean bottom contact pill with organizer name, phone, and email.',
  },
};

const defaultSections = (order: HomepageSectionKey[], disabled: HomepageSectionKey[] = []): HomepageSectionConfig[] =>
  order.map((key) => ({ key, enabled: !disabled.includes(key) }));

export const HOMEPAGE_ARCHETYPE_LIST: ArchetypeMeta[] = [
  {
    id: 'ceremonial-light',
    label: 'Ceremonial Light',
    tagline: 'Airy light header & classic Event Details card',
    description: 'Light slate/sky wash so dark-ink logos pop, single centered logo or crest, tribute lockup, and structured white Event Details card.',
    themePreset: 'memorial-formal',
    defaults: {
      archetype: 'ceremonial-light',
      landing_mode: 'org_hub',
      hero_surface: 'light_airy',
      artwork_display: 'emblem_lockup',
      logo_display: 'auto',
      sections: defaultSections(
        ['event_details_card', 'action_cards', 'sponsor_wall', 'raffle_spotlight', 'contact_bar', 'key_stats_bar', 'story_strip'],
        ['key_stats_bar', 'story_strip']
      ),
    },
  },
  {
    id: 'charity-showcase',
    label: 'Charity Showcase',
    tagline: 'Rich brand gradient & 2-column framed flyer showcase',
    description: 'Keeps designed event flyers 100% legible in a framed card beside title and CTAs — never stretching text-heavy artwork behind headlines.',
    themePreset: 'charity-bright',
    defaults: {
      archetype: 'charity-showcase',
      landing_mode: 'org_hub',
      hero_surface: 'brand_gradient',
      artwork_display: 'showcase_split',
      logo_display: 'auto',
      sections: defaultSections(
        ['key_stats_bar', 'story_strip', 'action_cards', 'sponsor_wall', 'event_details_card', 'raffle_spotlight', 'contact_bar'],
        ['contact_bar']
      ),
    },
  },
  {
    id: 'scenic-photo',
    label: 'Scenic Photo',
    tagline: 'Full-bleed golf course photo with dark contrast scrim',
    description: 'For text-free course and scenic photography only. Full-width hero photo behind crisp white typography and a smooth dark scrim.',
    themePreset: 'charity-bright',
    defaults: {
      archetype: 'scenic-photo',
      landing_mode: 'org_hub',
      hero_surface: 'photo_scrim',
      artwork_display: 'full_bleed_bg',
      logo_display: 'auto',
      sections: defaultSections(
        ['key_stats_bar', 'action_cards', 'event_details_card', 'story_strip', 'sponsor_wall', 'raffle_spotlight', 'contact_bar'],
        ['contact_bar']
      ),
    },
  },
  {
    id: 'varsity-crest',
    label: 'Varsity Crest',
    tagline: 'Dark collegiate editorial header & registration meter',
    description: 'Deep institutional palette with gold hairline rules, progress meter, and clean layout that collapses gracefully when no emblem is uploaded.',
    themePreset: 'crest-classic',
    defaults: {
      archetype: 'varsity-crest',
      landing_mode: 'org_hub',
      hero_surface: 'dark_editorial',
      artwork_display: 'emblem_lockup',
      logo_display: 'auto',
      sections: defaultSections(
        ['key_stats_bar', 'action_cards', 'event_details_card', 'sponsor_wall', 'raffle_spotlight', 'story_strip', 'contact_bar'],
        ['story_strip', 'contact_bar']
      ),
    },
  },
  {
    id: 'clean-editorial',
    label: 'Clean Editorial',
    tagline: 'Minimalist white corporate & club classic',
    description: 'Crisp white surface, restrained editorial serif headings, balanced split artwork card, and straightforward registration.',
    themePreset: 'default-clean',
    defaults: {
      archetype: 'clean-editorial',
      landing_mode: 'org_hub',
      hero_surface: 'light_airy',
      artwork_display: 'showcase_split',
      logo_display: 'auto',
      sections: defaultSections(
        ['key_stats_bar', 'event_details_card', 'action_cards', 'sponsor_wall', 'raffle_spotlight', 'story_strip', 'contact_bar'],
        ['story_strip', 'contact_bar']
      ),
    },
  },
];

export const HOMEPAGE_ARCHETYPES_BY_ID: Record<HomepageArchetype, ArchetypeMeta> =
  HOMEPAGE_ARCHETYPE_LIST.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {} as Record<HomepageArchetype, ArchetypeMeta>);

export function archetypeForThemePreset(themePreset?: string | null): HomepageArchetype {
  switch ((themePreset || '').trim().toLowerCase()) {
    case 'memorial-formal':
      return 'ceremonial-light';
    case 'charity-bright':
      return 'charity-showcase';
    case 'crest-classic':
      return 'varsity-crest';
    default:
      return 'clean-editorial';
  }
}

function normalizeSections(
  configured: HomepageSectionConfig[] | undefined,
  fallback: HomepageSectionConfig[]
): HomepageSectionConfig[] {
  if (!Array.isArray(configured) || configured.length === 0) return fallback.map((s) => ({ ...s }));
  const seen = new Set<HomepageSectionKey>();
  const out: HomepageSectionConfig[] = [];
  for (const item of configured) {
    if (item && (HOMEPAGE_SECTION_KEYS as readonly string[]).includes(item.key) && !seen.has(item.key)) {
      seen.add(item.key);
      out.push({ key: item.key, enabled: Boolean(item.enabled) });
    }
  }
  // Ensure every canonical section exists in the list so none vanish in Studio
  for (const fb of fallback) {
    if (!seen.has(fb.key)) {
      seen.add(fb.key);
      out.push({ ...fb });
    }
  }
  return out;
}

export function resolveHomepageConfig(
  orgConfig?: HomepageConfig | null,
  tournamentConfig?: HomepageConfig | null,
  themePreset?: string | null
): ResolvedHomepageConfig {
  const archetypeCandidate =
    tournamentConfig?.archetype ||
    orgConfig?.archetype ||
    archetypeForThemePreset(themePreset);

  const archetype: HomepageArchetype =
    archetypeCandidate && archetypeCandidate in HOMEPAGE_ARCHETYPES_BY_ID
      ? (archetypeCandidate as HomepageArchetype)
      : archetypeForThemePreset(themePreset);

  const base = HOMEPAGE_ARCHETYPES_BY_ID[archetype].defaults;

  // Organization owns landing_mode so featured event changes cannot alter root `/` routing
  const landing_mode = (orgConfig?.landing_mode || base.landing_mode) as LandingMode;
  const hero_surface = (tournamentConfig?.hero_surface || orgConfig?.hero_surface || base.hero_surface) as HeroSurface;
  const artwork_display = (tournamentConfig?.artwork_display || orgConfig?.artwork_display || base.artwork_display) as ArtworkDisplay;
  const logo_display = (tournamentConfig?.logo_display || orgConfig?.logo_display || base.logo_display) as LogoDisplay;
  const eyebrow_label = (tournamentConfig?.eyebrow_label ?? orgConfig?.eyebrow_label ?? '').trim();
  const sections = normalizeSections(
    tournamentConfig?.sections?.length ? tournamentConfig.sections : orgConfig?.sections,
    base.sections
  );

  return {
    archetype,
    landing_mode,
    hero_surface,
    artwork_display,
    logo_display,
    eyebrow_label,
    sections,
  };
}

export function isSectionEnabled(config: ResolvedHomepageConfig, key: HomepageSectionKey): boolean {
  const found = config.sections.find((s) => s.key === key);
  return found ? found.enabled : true;
}

export function isDarkHeroSurface(surface: HeroSurface): boolean {
  return surface === 'brand_gradient' || surface === 'dark_editorial' || surface === 'photo_scrim';
}

/**
 * Resolves the exact surface and artwork mode rendered by BOTH public heroes and Studio Live Preview
 * so preview, rendered surfaces, and CTA/pill contrast never diverge.
 */
export function resolveEffectiveHeroRender(
  config: ResolvedHomepageConfig,
  hasPhoto: boolean
): {
  surface: HeroSurface;
  isDark: boolean;
  showFullBleedPhoto: boolean;
  showSplitPhoto: boolean;
  showEmblem: boolean;
} {
  const artwork = config.artwork_display;
  const showFullBleedPhoto =
    hasPhoto && artwork !== 'none' && (artwork === 'full_bleed_bg' || (config.hero_surface === 'photo_scrim' && artwork !== 'showcase_split' && artwork !== 'emblem_lockup'));
  const showSplitPhoto = hasPhoto && !showFullBleedPhoto && artwork === 'showcase_split';
  const showEmblem = artwork !== 'none';
  const surface: HeroSurface = showFullBleedPhoto
    ? 'photo_scrim'
    : config.hero_surface === 'photo_scrim'
    ? 'brand_gradient'
    : config.hero_surface;

  return {
    surface,
    isDark: isDarkHeroSurface(surface),
    showFullBleedPhoto,
    showSplitPhoto,
    showEmblem,
  };
}

/**
 * Preserves local `?org=` tenant override on internal public navigation links.
 */
export function withPreservedOrgParam(path: string, currentSearch: string): string {
  const org = new URLSearchParams(currentSearch).get('org')?.trim();
  if (!org) return path;

  const [pathname, existingQuery = ''] = path.split('?');
  const params = new URLSearchParams(existingQuery);
  if (!params.has('org')) {
    params.set('org', org);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Smart single-logo deduplication rule:
 * Never stack both commemorative banner AND org logo, and match light vs dark hero contrast.
 */
export function resolveHeroLogo(options: {
  logoDisplay: LogoDisplay;
  isDarkSurface: boolean;
  commemorativeBannerUrl?: string | null;
  logoUrl?: string | null;
  organizationLogoUrl?: string | null;
  reversedLogoUrl?: string | null;
}): { url: string | null; kind: 'commemorative' | 'reversed' | 'standard' | null } {
  const effectiveLogo = options.logoUrl || options.organizationLogoUrl || null;
  const orgLogo = options.organizationLogoUrl || options.logoUrl || null;
  const banner = options.commemorativeBannerUrl || null;
  const reversed = options.reversedLogoUrl || null;

  switch (options.logoDisplay) {
    case 'none':
      return { url: null, kind: null };
    case 'commemorative_banner':
      return banner ? { url: banner, kind: 'commemorative' } : effectiveLogo ? { url: effectiveLogo, kind: 'standard' } : { url: null, kind: null };
    case 'org_logo':
      return orgLogo ? { url: orgLogo, kind: 'standard' } : { url: null, kind: null };
    case 'reversed_logo':
      return reversed ? { url: reversed, kind: 'reversed' } : effectiveLogo ? { url: effectiveLogo, kind: 'standard' } : { url: null, kind: null };
    case 'auto':
    default:
      if (banner) return { url: banner, kind: 'commemorative' };
      if (options.isDarkSurface && reversed) return { url: reversed, kind: 'reversed' };
      if (effectiveLogo) return { url: effectiveLogo, kind: 'standard' };
      return { url: null, kind: null };
  }
}
