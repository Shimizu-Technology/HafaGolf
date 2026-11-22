import { useEffect, useMemo } from 'react';

export const DEFAULT_PRIMARY_COLOR = '#0f766e';
export const DEFAULT_ACCENT_COLOR = '#b45309';
export const LIGHT_FOREGROUND = '#ffffff';
export const DARK_FOREGROUND = '#020617';

export type ThemePreset = 'classic' | 'premium' | 'minimal' | 'event';

export const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ShadeStep = (typeof SHADE_STEPS)[number];
export type ColorScale = Record<ShadeStep, string>;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface BrandKitConfig {
  primary_color?: string | null;
  secondary_color?: string | null;
  accent_color?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
}

export interface BrandingOrganizationInput {
  name?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  accent_color?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  brand_kit?: BrandKitConfig | null;
  settings?: {
    primary_color?: string | null;
    secondary_color?: string | null;
    accent_color?: string | null;
  } | null;
}

export interface BrandingTournamentInput {
  theme_preset?: string | null;
  use_org_branding?: boolean | null;
  brand_primary_color?: string | null;
  brand_accent_color?: string | null;
  primary_color_override?: string | null;
  accent_color_override?: string | null;
  logo_url_override?: string | null;
  banner_url_override?: string | null;
  signature_image_url_override?: string | null;
}

export interface ResolvedTournamentBranding {
  themePreset: ThemePreset;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  signatureImageUrl: string | null;
  primaryScale: ColorScale;
  accentScale: ColorScale;
  brandForeground: string;
  accentForeground: string;
}

const HEX_6_RE = /^#[0-9a-f]{6}$/;
const HEX_3_RE = /^#[0-9a-f]{3}$/;

const LIGHT_MIX_WEIGHTS: Record<50 | 100 | 200 | 300 | 400 | 500, number> = {
  50: 0.92,
  100: 0.82,
  200: 0.65,
  300: 0.45,
  400: 0.25,
  500: 0.1,
};

const DARK_MIX_WEIGHTS: Record<700 | 800 | 900 | 950, number> = {
  700: 0.16,
  800: 0.32,
  900: 0.48,
  950: 0.66,
};

export function normalizeHexColor(value: string | null | undefined, fallback: string = DEFAULT_PRIMARY_COLOR): string {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;

  if (HEX_6_RE.test(prefixed)) {
    return prefixed;
  }

  if (HEX_3_RE.test(prefixed)) {
    const [, r, g, b] = prefixed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return fallback;
}

export function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeHexColor(hex, DEFAULT_PRIMARY_COLOR);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)));
  const toHex = (channel: number) => clamp(channel).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgbChannels(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

function mixRgb(base: RgbColor, target: RgbColor, targetWeight: number): RgbColor {
  const weight = Math.max(0, Math.min(1, targetWeight));
  const baseWeight = 1 - weight;
  return {
    r: base.r * baseWeight + target.r * weight,
    g: base.g * baseWeight + target.g * weight,
    b: base.b * baseWeight + target.b * weight,
  };
}

export function generateColorScale(
  baseHex: string | null | undefined,
  fallback: string = DEFAULT_PRIMARY_COLOR
): ColorScale {
  const normalized = normalizeHexColor(baseHex, fallback);
  const baseRgb = hexToRgb(normalized);
  const white: RgbColor = { r: 255, g: 255, b: 255 };
  const black: RgbColor = { r: 0, g: 0, b: 0 };

  return {
    50: rgbToHex(mixRgb(baseRgb, white, LIGHT_MIX_WEIGHTS[50])),
    100: rgbToHex(mixRgb(baseRgb, white, LIGHT_MIX_WEIGHTS[100])),
    200: rgbToHex(mixRgb(baseRgb, white, LIGHT_MIX_WEIGHTS[200])),
    300: rgbToHex(mixRgb(baseRgb, white, LIGHT_MIX_WEIGHTS[300])),
    400: rgbToHex(mixRgb(baseRgb, white, LIGHT_MIX_WEIGHTS[400])),
    500: rgbToHex(mixRgb(baseRgb, white, LIGHT_MIX_WEIGHTS[500])),
    600: normalized,
    700: rgbToHex(mixRgb(baseRgb, black, DARK_MIX_WEIGHTS[700])),
    800: rgbToHex(mixRgb(baseRgb, black, DARK_MIX_WEIGHTS[800])),
    900: rgbToHex(mixRgb(baseRgb, black, DARK_MIX_WEIGHTS[900])),
    950: rgbToHex(mixRgb(baseRgb, black, DARK_MIX_WEIGHTS[950])),
  };
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const linearize = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks a WCAG AA-compliant foreground color (#ffffff or #020617)
 * maximizing contrast against the given background hex color.
 */
export function getContrastingForeground(backgroundHex: string): string {
  const lightContrast = contrastRatio(backgroundHex, LIGHT_FOREGROUND);
  const darkContrast = contrastRatio(backgroundHex, DARK_FOREGROUND);
  return lightContrast >= darkContrast ? LIGHT_FOREGROUND : DARK_FOREGROUND;
}

function normalizePreset(value: string | undefined | null): ThemePreset {
  if (value === 'premium' || value === 'minimal' || value === 'event') return value;
  return 'classic';
}

function firstValidHex(candidates: Array<string | null | undefined>, fallback: string): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeHexColor(candidate, '');
    if (normalized) return normalized;
  }
  return fallback;
}

export function resolveTournamentBranding(
  organization?: BrandingOrganizationInput | null,
  tournament?: BrandingTournamentInput | null
): ResolvedTournamentBranding {
  const useOrgBranding = tournament?.use_org_branding ?? true;

  const orgPrimary = firstValidHex(
    [
      organization?.brand_kit?.primary_color,
      organization?.primary_color,
      organization?.settings?.primary_color,
    ],
    DEFAULT_PRIMARY_COLOR
  );

  const primaryColor = useOrgBranding
    ? firstValidHex([orgPrimary, tournament?.brand_primary_color], DEFAULT_PRIMARY_COLOR)
    : firstValidHex(
        [tournament?.primary_color_override, tournament?.brand_primary_color, orgPrimary],
        DEFAULT_PRIMARY_COLOR
      );

  const orgAccent = firstValidHex(
    [
      organization?.brand_kit?.accent_color,
      organization?.brand_kit?.secondary_color,
      organization?.accent_color,
      organization?.secondary_color,
      organization?.settings?.accent_color,
      organization?.settings?.secondary_color,
    ],
    DEFAULT_ACCENT_COLOR
  );

  const accentColor = useOrgBranding
    ? firstValidHex([orgAccent, tournament?.brand_accent_color], DEFAULT_ACCENT_COLOR)
    : firstValidHex(
        [tournament?.accent_color_override, tournament?.brand_accent_color, orgAccent],
        DEFAULT_ACCENT_COLOR
      );

  const orgLogoUrl = organization?.brand_kit?.logo_url || organization?.logo_url || null;
  const orgBannerUrl = organization?.brand_kit?.banner_url || organization?.banner_url || null;

  const logoUrl = useOrgBranding ? orgLogoUrl : tournament?.logo_url_override || orgLogoUrl;
  const bannerUrl = useOrgBranding ? orgBannerUrl : tournament?.banner_url_override || orgBannerUrl;
  const signatureImageUrl = useOrgBranding ? null : tournament?.signature_image_url_override || null;

  const primaryScale = generateColorScale(primaryColor, DEFAULT_PRIMARY_COLOR);
  const accentScale = generateColorScale(accentColor, DEFAULT_ACCENT_COLOR);

  return {
    themePreset: normalizePreset(tournament?.theme_preset),
    primaryColor,
    accentColor,
    logoUrl,
    bannerUrl,
    signatureImageUrl,
    primaryScale,
    accentScale,
    brandForeground: getContrastingForeground(primaryColor),
    accentForeground: getContrastingForeground(accentColor),
  };
}

export function buildBrandingCssVariables(branding: ResolvedTournamentBranding): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const step of SHADE_STEPS) {
    const brandHex = branding.primaryScale[step];
    const accentHex = branding.accentScale[step];

    vars[`--brand-${step}`] = brandHex;
    vars[`--brand-${step}-rgb`] = hexToRgbChannels(brandHex);

    vars[`--accent-${step}`] = accentHex;
    vars[`--accent-${step}-rgb`] = hexToRgbChannels(accentHex);
  }

  vars['--brand-DEFAULT'] = branding.primaryColor;
  vars['--brand-DEFAULT-rgb'] = hexToRgbChannels(branding.primaryColor);
  vars['--brand-foreground'] = branding.brandForeground;
  vars['--brand-foreground-rgb'] = hexToRgbChannels(branding.brandForeground);

  vars['--accent-DEFAULT'] = branding.accentColor;
  vars['--accent-DEFAULT-rgb'] = hexToRgbChannels(branding.accentColor);
  vars['--accent-foreground'] = branding.accentForeground;
  vars['--accent-foreground-rgb'] = hexToRgbChannels(branding.accentForeground);

  return vars;
}

export function applyBrandingToDocument(
  branding: ResolvedTournamentBranding,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): void {
  if (!doc?.documentElement) return;

  const root = doc.documentElement;
  const cssVars = buildBrandingCssVariables(branding);
  for (const [name, value] of Object.entries(cssVars)) {
    root.style.setProperty(name, value);
  }

  root.dataset.themePreset = branding.themePreset;

  const themeColorMeta = doc.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', branding.primaryColor);
  }
}

export function resetBrandingOnDocument(
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): ResolvedTournamentBranding {
  const defaultBranding = resolveTournamentBranding(null, null);
  applyBrandingToDocument(defaultBranding, doc);
  return defaultBranding;
}

export function useApplyBranding(
  organization?: BrandingOrganizationInput | null,
  tournament?: BrandingTournamentInput | null
): ResolvedTournamentBranding {
  const branding = useMemo(
    () => resolveTournamentBranding(organization, tournament),
    [
      organization?.primary_color,
      organization?.secondary_color,
      organization?.accent_color,
      organization?.logo_url,
      organization?.banner_url,
      organization?.brand_kit?.primary_color,
      organization?.brand_kit?.secondary_color,
      organization?.brand_kit?.accent_color,
      organization?.brand_kit?.logo_url,
      organization?.brand_kit?.banner_url,
      organization?.settings?.primary_color,
      organization?.settings?.secondary_color,
      organization?.settings?.accent_color,
      tournament?.theme_preset,
      tournament?.use_org_branding,
      tournament?.brand_primary_color,
      tournament?.brand_accent_color,
      tournament?.primary_color_override,
      tournament?.accent_color_override,
      tournament?.logo_url_override,
      tournament?.banner_url_override,
      tournament?.signature_image_url_override,
    ]
  );

  useEffect(() => {
    applyBrandingToDocument(branding);
  }, [branding]);

  useEffect(() => {
    if (!tournament) return;
    return () => {
      applyBrandingToDocument(resolveTournamentBranding(organization, null));
    };
  }, [organization, tournament]);

  return branding;
}
