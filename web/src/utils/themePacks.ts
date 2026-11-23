export const THEME_PACK_IDS = [
  'default-clean',
  'charity-bright',
  'memorial-formal',
  'crest-classic',
] as const;

export type ThemePackId = (typeof THEME_PACK_IDS)[number];

export const DEFAULT_THEME_PACK_ID: ThemePackId = 'default-clean';

export type ThemePackHeroVariant = 'editorial' | 'celebratory' | 'ceremonial' | 'crest';

export type ThemePackMotionVariant = 'fade-up' | 'warm-rise' | 'calm-fade' | 'crest-reveal';

export type ThemePackIconKey = 'layout' | 'sparkles' | 'award' | 'shield';

export interface ThemePackSignatureMotion {
  variant: ThemePackMotionVariant;
  label: string;
  description: string;
  distancePx: number;
  durationMs: number;
}

export interface ThemePackTypography {
  headingFontFamily: string;
  bodyFontFamily: string;
  headingTracking: string;
  heroTitleClass: string;
  tournamentTitleClass: string;
  heroSubtitleClass: string;
  sectionTitleClass: string;
  cardTitleClass: string;
  eyebrowClass: string;
}

export interface ThemePackHeroStyles {
  variant: ThemePackHeroVariant;
  gradientClass: string;
  overlayClass: string;
  accentRuleClass: string;
  logoFrameClass: string;
  showcaseFrameClass: string;
  contentWrapperClass: string;
  statsDividerClass: string;
}

export interface ThemePackSurfaceStyles {
  pageClass: string;
  mutedSectionClass: string;
  keyStatsBarClass: string;
  cardClass: string;
  cardAccentBarClass: string;
  cardHeaderSpacingClass: string;
  insetBoxClass: string;
  badgeClass: string;
  ctaPrimaryClass: string;
  ctaSecondaryClass: string;
}

export interface ThemePackDefinition {
  id: ThemePackId;
  name: string;
  shortTagline: string;
  description: string;
  idealFor: string;
  icon: ThemePackIconKey;
  typography: ThemePackTypography;
  hero: ThemePackHeroStyles;
  surfaces: ThemePackSurfaceStyles;
  signatureMotion: ThemePackSignatureMotion;
  cssVars: Record<string, string>;
}

const EDITORIAL_SERIF_STACK = "'Lora', Georgia, 'Times New Roman', serif";
const FORMAL_SERIF_STACK = "'Playfair Display', Georgia, 'Times New Roman', serif";
const DISPLAY_SANS_STACK = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
const BODY_SANS_STACK = "'DM Sans', system-ui, -apple-system, sans-serif";

export const THEME_PACKS: Record<ThemePackId, ThemePackDefinition> = {
  'default-clean': {
    id: 'default-clean',
    name: 'Default Clean',
    shortTagline: 'Crisp editorial pairing with balanced spacing',
    description:
      'Refined editorial serif headlines paired with clean sans-serif body copy, balanced spacing, and neutral surface contrast.',
    idealFor: 'Standard club classics, corporate outings, and multi-event organizations',
    icon: 'layout',
    typography: {
      headingFontFamily: EDITORIAL_SERIF_STACK,
      bodyFontFamily: BODY_SANS_STACK,
      headingTracking: '-0.02em',
      heroTitleClass: 'font-theme-heading text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl',
      tournamentTitleClass: 'break-words font-theme-heading text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl',
      heroSubtitleClass: 'mt-3 max-w-2xl text-base text-white/85 sm:text-lg leading-relaxed',
      sectionTitleClass: 'font-theme-heading text-2xl font-semibold tracking-tight text-neutral-900',
      cardTitleClass: 'font-theme-heading text-xl font-semibold tracking-tight text-neutral-900',
      eyebrowClass: 'text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500',
    },
    hero: {
      variant: 'editorial',
      gradientClass: 'bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950',
      overlayClass:
        'bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.06),transparent_30%)]',
      accentRuleClass: 'h-0.5 w-12 bg-accent-400/90 rounded-full',
      logoFrameClass: 'inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20',
      showcaseFrameClass:
        'overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.26)] backdrop-blur-sm',
      contentWrapperClass: 'max-w-3xl',
      statsDividerClass: 'border-t border-white/20',
    },
    surfaces: {
      pageClass: 'bg-white text-neutral-900',
      mutedSectionClass: 'bg-neutral-50 border-y border-neutral-200/80',
      keyStatsBarClass: 'bg-white border-b border-neutral-200',
      cardClass: 'bg-white rounded-2xl border border-neutral-200 shadow-sm hover:shadow-md transition-shadow duration-200',
      cardAccentBarClass: 'h-1 bg-gradient-to-r from-brand-600 to-accent-500',
      cardHeaderSpacingClass: 'p-6 sm:p-8',
      insetBoxClass: 'rounded-xl border border-neutral-200/80 bg-neutral-50/80 p-4',
      badgeClass: 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide',
      ctaPrimaryClass:
        'inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 hover:bg-brand-700 text-brand-foreground font-semibold text-sm px-6 py-2.5 transition-colors duration-200',
      ctaSecondaryClass:
        'inline-flex items-center justify-center gap-2 rounded-full border border-brand-600 text-brand-700 hover:bg-brand-50 font-medium text-sm px-6 py-2.5 transition-colors duration-200',
    },
    signatureMotion: {
      variant: 'fade-up',
      label: 'Editorial intro rise',
      description: 'Subtle single-pass hero headline fade and 14px rise on first view.',
      distancePx: 14,
      durationMs: 460,
    },
    cssVars: {
      '--theme-pack-heading-font': EDITORIAL_SERIF_STACK,
      '--theme-pack-body-font': BODY_SANS_STACK,
      '--theme-pack-heading-tracking': '-0.02em',
      '--theme-pack-surface': '#ffffff',
      '--theme-pack-surface-muted': '#f8fafc',
      '--theme-pack-card-radius': '1rem',
      '--theme-pack-border-width': '1px',
    },
  },

  'charity-bright': {
    id: 'charity-bright',
    name: 'Charity Bright',
    shortTagline: 'Full-width photography & a community spotlight',
    description:
      'A photo-led header, a story strip, and prominent ways to support the event.',
    idealFor: 'Charity fundraisers, raffle-forward outings, and community tournaments',
    icon: 'sparkles',
    typography: {
      headingFontFamily: DISPLAY_SANS_STACK,
      bodyFontFamily: BODY_SANS_STACK,
      headingTracking: '-0.025em',
      heroTitleClass: 'font-theme-heading text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl',
      tournamentTitleClass: 'break-words font-theme-heading text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl',
      heroSubtitleClass: 'mt-3 max-w-2xl text-base text-white/90 sm:text-lg leading-relaxed',
      sectionTitleClass: 'font-theme-heading text-2xl font-bold tracking-tight text-neutral-900',
      cardTitleClass: 'font-theme-heading text-xl font-bold tracking-tight text-neutral-900',
      eyebrowClass: 'text-xs font-bold uppercase tracking-[0.12em] text-accent-700',
    },
    hero: {
      variant: 'celebratory',
      gradientClass: 'bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900',
      overlayClass:
        'bg-[radial-gradient(circle_at_top_right,rgb(var(--accent-400-rgb)/0.32),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.14),transparent_32%)]',
      accentRuleClass: 'h-1.5 w-16 bg-accent-400 rounded-full',
      logoFrameClass: 'inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-400/20 ring-2 ring-accent-300/40',
      showcaseFrameClass:
        'overflow-hidden rounded-[28px] border-2 border-white/25 bg-white/15 shadow-[0_28px_72px_rgba(0,0,0,0.28)] backdrop-blur-sm',
      contentWrapperClass: 'max-w-3xl',
      statsDividerClass: 'border-t border-accent-300/35',
    },
    surfaces: {
      pageClass: 'bg-neutral-50/60 text-neutral-900',
      mutedSectionClass: 'bg-brand-50/55 border-y border-brand-100',
      keyStatsBarClass: 'bg-white border-b border-brand-100 shadow-sm',
      cardClass: 'bg-white rounded-3xl border border-neutral-200/90 shadow-soft hover:shadow-elevated transition-shadow duration-200',
      cardAccentBarClass: 'h-1.5 bg-gradient-to-r from-accent-400 via-accent-500 to-brand-600',
      cardHeaderSpacingClass: 'p-7 sm:p-9',
      insetBoxClass: 'rounded-2xl border border-accent-200/70 bg-accent-50/55 p-4',
      badgeClass: 'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold tracking-wide shadow-sm',
      ctaPrimaryClass:
        'inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 hover:bg-brand-700 text-brand-foreground font-bold text-sm px-6 py-3 shadow-brand transition-colors duration-200',
      ctaSecondaryClass:
        'inline-flex items-center justify-center gap-2 rounded-full border-2 border-brand-600 text-brand-700 hover:bg-brand-50 font-semibold text-sm px-6 py-2.5 transition-colors duration-200',
    },
    signatureMotion: {
      variant: 'warm-rise',
      label: 'Celebratory lift',
      description: 'Warm, upbeat single-pass hero entrance with 18px lift on first view.',
      distancePx: 18,
      durationMs: 520,
    },
    cssVars: {
      '--theme-pack-heading-font': DISPLAY_SANS_STACK,
      '--theme-pack-body-font': BODY_SANS_STACK,
      '--theme-pack-heading-tracking': '-0.025em',
      '--theme-pack-surface': '#f8fafc',
      '--theme-pack-surface-muted': 'rgb(var(--brand-50-rgb))',
      '--theme-pack-card-radius': '1.5rem',
      '--theme-pack-border-width': '1px',
    },
  },

  'memorial-formal': {
    id: 'memorial-formal',
    name: 'Memorial Formal',
    shortTagline: 'Dignified serif headings & light ceremonial framing',
    description:
      'A light ceremonial header, formal serif typography, and gold rules for tributes and memorial events.',
    idealFor: 'Annual memorial tournaments, tribute classics, and formal civic events',
    icon: 'award',
    typography: {
      headingFontFamily: FORMAL_SERIF_STACK,
      bodyFontFamily: BODY_SANS_STACK,
      headingTracking: '-0.01em',
      heroTitleClass: 'font-theme-heading text-3xl font-bold tracking-normal text-white sm:text-4xl lg:text-5xl',
      tournamentTitleClass: 'break-words font-theme-heading text-3xl font-bold leading-tight text-[#1e3553] sm:text-4xl lg:text-5xl',
      heroSubtitleClass: 'mt-4 max-w-2xl text-base text-white/80 sm:text-lg leading-relaxed',
      sectionTitleClass: 'font-theme-heading text-2xl font-bold tracking-normal text-neutral-900',
      cardTitleClass: 'font-theme-heading text-xl font-bold tracking-normal text-neutral-900',
      eyebrowClass: 'text-xs font-semibold uppercase tracking-[0.18em] text-brand-700',
    },
    hero: {
      variant: 'ceremonial',
      gradientClass: 'bg-gradient-to-b from-brand-950 via-brand-900 to-brand-800',
      overlayClass:
        'bg-[radial-gradient(circle_at_top_center,rgb(var(--accent-500-rgb)/0.16),transparent_48%),linear-gradient(180deg,rgba(2,6,23,0.18)_0%,rgba(2,6,23,0.42)_100%)]',
      accentRuleClass: 'h-px w-20 bg-accent-400/80',
      logoFrameClass: 'inline-flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 border border-accent-300/40',
      showcaseFrameClass:
        'overflow-hidden rounded-xl border border-accent-300/35 bg-brand-950/40 shadow-[0_24px_64px_rgba(2,6,23,0.45)] backdrop-blur-sm',
      contentWrapperClass: 'max-w-3xl',
      statsDividerClass: 'border-t border-accent-300/30',
    },
    surfaces: {
      pageClass: 'bg-neutral-50 text-neutral-900',
      mutedSectionClass: 'bg-neutral-100/90 border-y border-neutral-200',
      keyStatsBarClass: 'bg-white border-b border-neutral-200',
      cardClass: 'bg-white rounded-xl border border-neutral-200/90 shadow-sm',
      cardAccentBarClass: 'h-0.5 bg-gradient-to-r from-brand-900 via-accent-500 to-brand-900',
      cardHeaderSpacingClass: 'p-7 sm:p-9',
      insetBoxClass: 'rounded-lg border border-neutral-200 bg-neutral-50 p-4',
      badgeClass: 'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]',
      ctaPrimaryClass:
        'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-800 hover:bg-brand-900 text-brand-foreground font-semibold text-sm px-6 py-2.5 tracking-wide transition-colors duration-200',
      ctaSecondaryClass:
        'inline-flex items-center justify-center gap-2 rounded-lg border border-brand-800 text-brand-800 hover:bg-brand-50 font-medium text-sm px-6 py-2.5 transition-colors duration-200',
    },
    signatureMotion: {
      variant: 'calm-fade',
      label: 'Ceremonial stillness fade',
      description: 'Unhurried pure-opacity hero dissolve with zero vertical displacement.',
      distancePx: 0,
      durationMs: 620,
    },
    cssVars: {
      '--theme-pack-heading-font': FORMAL_SERIF_STACK,
      '--theme-pack-body-font': BODY_SANS_STACK,
      '--theme-pack-heading-tracking': '-0.01em',
      '--theme-pack-surface': '#f8fafc',
      '--theme-pack-surface-muted': '#f1f5f9',
      '--theme-pack-card-radius': '0.75rem',
      '--theme-pack-border-width': '1px',
    },
  },

  'crest-classic': {
    id: 'crest-classic',
    name: 'Crest Classic',
    shortTagline: 'Collegiate crest framing & high-contrast borders',
    description:
      'Structured institutional hierarchy, crest-framed emblems, crisp double-accent borders, and high-contrast cards for alumni and association outings.',
    idealFor: 'Alumni associations, school fundraisers, and heritage club tournaments',
    icon: 'shield',
    typography: {
      headingFontFamily: FORMAL_SERIF_STACK,
      bodyFontFamily: BODY_SANS_STACK,
      headingTracking: '-0.015em',
      heroTitleClass: 'font-theme-heading text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl',
      tournamentTitleClass: 'break-words font-theme-heading text-3xl font-extrabold uppercase tracking-tight text-white sm:text-4xl lg:text-5xl',
      heroSubtitleClass: 'mt-3 max-w-2xl text-base text-white/88 sm:text-lg leading-relaxed',
      sectionTitleClass: 'font-theme-heading text-2xl font-bold tracking-tight text-neutral-900',
      cardTitleClass: 'font-theme-heading text-xl font-bold tracking-tight text-neutral-900',
      eyebrowClass: 'text-xs font-bold uppercase tracking-[0.16em] text-brand-700',
    },
    hero: {
      variant: 'crest',
      gradientClass: 'bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950',
      overlayClass:
        'bg-[linear-gradient(135deg,rgb(var(--accent-500-rgb)/0.14)_0%,transparent_42%),radial-gradient(circle_at_bottom_right,rgb(var(--brand-500-rgb)/0.25),transparent_44%)]',
      accentRuleClass: 'h-1 w-16 bg-accent-500',
      logoFrameClass:
        'inline-flex h-14 w-14 items-center justify-center rounded-xl bg-white/12 border-2 border-accent-400/75 shadow-sm',
      showcaseFrameClass:
        'overflow-hidden rounded-xl border-2 border-accent-400/60 bg-white/10 shadow-[0_24px_64px_rgba(2,6,23,0.38)] backdrop-blur-sm',
      contentWrapperClass: 'max-w-3xl',
      statsDividerClass: 'border-t-2 border-accent-400/40',
    },
    surfaces: {
      pageClass: 'bg-white text-neutral-900',
      mutedSectionClass: 'bg-neutral-100 border-y-2 border-neutral-200',
      keyStatsBarClass: 'bg-white border-b-2 border-brand-200',
      cardClass: 'bg-white rounded-xl border-2 border-neutral-200 shadow-sm hover:border-brand-300 transition-colors duration-200',
      cardAccentBarClass: 'h-1.5 bg-gradient-to-r from-brand-800 via-brand-700 to-accent-500',
      cardHeaderSpacingClass: 'p-6 sm:p-8',
      insetBoxClass: 'rounded-lg border-l-4 border-brand-600 bg-neutral-50 p-4',
      badgeClass: 'inline-flex items-center gap-1.5 rounded-md border border-current/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.1em]',
      ctaPrimaryClass:
        'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 hover:bg-brand-800 text-brand-foreground font-bold text-sm px-6 py-2.5 border border-brand-800 transition-colors duration-200',
      ctaSecondaryClass:
        'inline-flex items-center justify-center gap-2 rounded-lg border-2 border-brand-700 text-brand-800 hover:bg-brand-50 font-semibold text-sm px-6 py-2.5 transition-colors duration-200',
    },
    signatureMotion: {
      variant: 'crest-reveal',
      label: 'Structured crest settle',
      description: 'Crisp single-pass hero reveal with restrained 10px vertical settle.',
      distancePx: 10,
      durationMs: 440,
    },
    cssVars: {
      '--theme-pack-heading-font': FORMAL_SERIF_STACK,
      '--theme-pack-body-font': BODY_SANS_STACK,
      '--theme-pack-heading-tracking': '-0.015em',
      '--theme-pack-surface': '#ffffff',
      '--theme-pack-surface-muted': '#f1f5f9',
      '--theme-pack-card-radius': '0.75rem',
      '--theme-pack-border-width': '2px',
    },
  },
};

export const THEME_PACK_LIST: ThemePackDefinition[] = THEME_PACK_IDS.map((id) => THEME_PACKS[id]);

const LEGACY_PACK_ALIASES: Record<string, ThemePackId> = {
  classic: 'default-clean',
};

export function isThemePackId(value: string | null | undefined): value is ThemePackId {
  if (!value) return false;
  return (THEME_PACK_IDS as readonly string[]).includes(value);
}

/**
 * Resolves any theme preset/pack identifier into one of the 4 canonical Theme Pack IDs.
 * Maps legacy 'classic' -> 'default-clean' and falls back safely to 'default-clean'.
 */
export function resolveThemePackId(value?: string | null): ThemePackId {
  if (!value) return DEFAULT_THEME_PACK_ID;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_THEME_PACK_ID;

  if (isThemePackId(normalized)) {
    return normalized;
  }

  if (normalized in LEGACY_PACK_ALIASES) {
    return LEGACY_PACK_ALIASES[normalized];
  }

  return DEFAULT_THEME_PACK_ID;
}

export function resolveThemePack(id?: string | null): ThemePackDefinition {
  return THEME_PACKS[resolveThemePackId(id)];
}

export function buildThemePackCssVariables(pack: ThemePackDefinition): Record<string, string> {
  return { ...pack.cssVars };
}

export function applyThemePackToDocument(
  packOrId: ThemePackDefinition | string | null | undefined,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): ThemePackDefinition {
  const pack =
    typeof packOrId === 'object' && packOrId !== null
      ? packOrId
      : resolveThemePack(packOrId);

  if (!doc?.documentElement) return pack;

  const root = doc.documentElement;
  root.dataset.themePack = pack.id;

  const cssVars = buildThemePackCssVariables(pack);
  for (const [name, value] of Object.entries(cssVars)) {
    root.style.setProperty(name, value);
  }

  return pack;
}
