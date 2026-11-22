// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DARK_FOREGROUND,
  LIGHT_FOREGROUND,
  SHADE_STEPS,
  applyBrandingToDocument,
  buildBrandingCssVariables,
  contrastRatio,
  generateColorScale,
  getContrastingForeground,
  hexToRgbChannels,
  normalizeHexColor,
  relativeLuminance,
  resetBrandingOnDocument,
  resolveTournamentBranding,
} from './branding';

describe('normalizeHexColor', () => {
  it('normalizes 6-digit and 3-digit hex values with or without leading #', () => {
    expect(normalizeHexColor('#0F766E')).toBe('#0f766e');
    expect(normalizeHexColor('0f766e')).toBe('#0f766e');
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor('  #f50  ')).toBe('#ff5500');
  });

  it('falls back safely on invalid or empty input', () => {
    expect(normalizeHexColor('')).toBe(DEFAULT_PRIMARY_COLOR);
    expect(normalizeHexColor(null)).toBe(DEFAULT_PRIMARY_COLOR);
    expect(normalizeHexColor(undefined, '#1e293b')).toBe('#1e293b');
    expect(normalizeHexColor('not-a-color', '#1e293b')).toBe('#1e293b');
    expect(normalizeHexColor('#12345', '#1e293b')).toBe('#1e293b');
  });
});

describe('generateColorScale', () => {
  it('sets shade 600 to the exact normalized base hex and maintains monotonic luminance', () => {
    const scale = generateColorScale('#0f766e');
    expect(scale[600]).toBe('#0f766e');

    for (const step of SHADE_STEPS) {
      expect(scale[step]).toMatch(/^#[0-9a-f]{6}$/);
    }

    for (let i = 0; i < SHADE_STEPS.length - 1; i++) {
      const lighter = relativeLuminance(scale[SHADE_STEPS[i]]);
      const darker = relativeLuminance(scale[SHADE_STEPS[i + 1]]);
      expect(lighter).toBeGreaterThanOrEqual(darker);
    }
  });

  it('falls back when base hex is invalid', () => {
    const scale = generateColorScale('invalid', '#0284c7');
    expect(scale[600]).toBe('#0284c7');
  });
});

describe('WCAG contrast foreground calculation', () => {
  it('picks white text for dark brand colors and dark text for light/bright colors', () => {
    expect(getContrastingForeground('#0f172a')).toBe(LIGHT_FOREGROUND);
    expect(getContrastingForeground('#0f766e')).toBe(LIGHT_FOREGROUND);
    expect(getContrastingForeground('#7f1d1d')).toBe(LIGHT_FOREGROUND);
    expect(getContrastingForeground('#facc15')).toBe(DARK_FOREGROUND);
    expect(getContrastingForeground('#f8fafc')).toBe(DARK_FOREGROUND);
    expect(getContrastingForeground('#38bdf8')).toBe(DARK_FOREGROUND);
  });

  it('achieves at least 4.5:1 WCAG AA contrast across the spectrum', () => {
    const samples = [
      '#000000',
      '#ffffff',
      '#0f172a',
      '#0f766e',
      '#0284c7',
      '#16a34a',
      '#800000',
      '#b45309',
      '#d97706',
      '#f59e0b',
      '#facc15',
      '#ec4899',
      '#7c3aed',
      '#64748b',
      '#94a3b8',
    ];

    for (const hex of samples) {
      const fg = getContrastingForeground(hex);
      expect(contrastRatio(hex, fg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('resolveTournamentBranding', () => {
  it('returns neutral HafaGolf defaults when organization and tournament are absent', () => {
    const resolved = resolveTournamentBranding(null, null);
    expect(resolved.primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
    expect(resolved.accentColor).toBe(DEFAULT_ACCENT_COLOR);
    expect(resolved.themePreset).toBe('classic');
    expect(resolved.logoUrl).toBeNull();
    expect(resolved.bannerUrl).toBeNull();
    expect(resolved.signatureImageUrl).toBeNull();
    expect(resolved.brandForeground).toBe(LIGHT_FOREGROUND);
    expect(resolved.accentForeground).toBe(LIGHT_FOREGROUND);
  });

  it('uses organization branding when use_org_branding is true or omitted', () => {
    const resolved = resolveTournamentBranding(
      {
        primary_color: '#1e3a5f',
        accent_color: '#c29a3b',
        logo_url: 'https://cdn.example.com/org-logo.png',
        banner_url: 'https://cdn.example.com/org-banner.jpg',
      },
      {
        use_org_branding: true,
        theme_preset: 'premium',
        primary_color_override: '#991b1b',
        accent_color_override: '#facc15',
        logo_url_override: 'https://cdn.example.com/override-logo.png',
        banner_url_override: 'https://cdn.example.com/override-banner.jpg',
        signature_image_url_override: 'https://cdn.example.com/sig.png',
      }
    );

    expect(resolved.themePreset).toBe('premium');
    expect(resolved.primaryColor).toBe('#1e3a5f');
    expect(resolved.accentColor).toBe('#c29a3b');
    expect(resolved.logoUrl).toBe('https://cdn.example.com/org-logo.png');
    expect(resolved.bannerUrl).toBe('https://cdn.example.com/org-banner.jpg');
    expect(resolved.signatureImageUrl).toBeNull();
  });

  it('applies tournament overrides when use_org_branding is false and falls back to org for unset fields', () => {
    const resolved = resolveTournamentBranding(
      {
        primary_color: '#1e3a5f',
        secondary_color: '#d97706',
        logo_url: 'https://cdn.example.com/org-logo.png',
        banner_url: 'https://cdn.example.com/org-banner.jpg',
      },
      {
        use_org_branding: false,
        theme_preset: 'event',
        primary_color_override: '#7f1d1d',
        accent_color_override: '#eab308',
        logo_url_override: null,
        banner_url_override: 'https://cdn.example.com/event-banner.jpg',
        signature_image_url_override: 'https://cdn.example.com/honoree.png',
      }
    );

    expect(resolved.themePreset).toBe('event');
    expect(resolved.primaryColor).toBe('#7f1d1d');
    expect(resolved.accentColor).toBe('#eab308');
    expect(resolved.brandForeground).toBe(LIGHT_FOREGROUND);
    expect(resolved.accentForeground).toBe(DARK_FOREGROUND);
    expect(resolved.logoUrl).toBe('https://cdn.example.com/org-logo.png');
    expect(resolved.bannerUrl).toBe('https://cdn.example.com/event-banner.jpg');
    expect(resolved.signatureImageUrl).toBe('https://cdn.example.com/honoree.png');
  });

  it('supports brand_kit and tournament brand_primary_color fallbacks', () => {
    const resolved = resolveTournamentBranding(
      {
        brand_kit: {
          primary_color: '#0284c7',
          accent_color: '#0d9488',
          logo_url: 'https://cdn.example.com/kit-logo.png',
        },
      },
      {
        theme_preset: 'unknown-value',
      }
    );

    expect(resolved.themePreset).toBe('classic');
    expect(resolved.primaryColor).toBe('#0284c7');
    expect(resolved.accentColor).toBe('#0d9488');
    expect(resolved.logoUrl).toBe('https://cdn.example.com/kit-logo.png');
  });
});

describe('CSS variable generation and DOM application', () => {
  it('builds complete hex and RGB channel CSS custom properties', () => {
    const branding = resolveTournamentBranding({ primary_color: '#0369a1', accent_color: '#facc15' }, null);
    const vars = buildBrandingCssVariables(branding);

    expect(vars['--brand-600']).toBe('#0369a1');
    expect(vars['--brand-600-rgb']).toBe(hexToRgbChannels('#0369a1'));
    expect(vars['--brand-DEFAULT']).toBe('#0369a1');
    expect(vars['--brand-DEFAULT-rgb']).toBe('3 105 161');
    expect(vars['--brand-foreground']).toBe(LIGHT_FOREGROUND);
    expect(vars['--brand-foreground-rgb']).toBe('255 255 255');

    expect(vars['--accent-600']).toBe('#facc15');
    expect(vars['--accent-600-rgb']).toBe('250 204 21');
    expect(vars['--accent-foreground']).toBe(DARK_FOREGROUND);
    expect(vars['--accent-foreground-rgb']).toBe('2 6 23');

    for (const step of SHADE_STEPS) {
      expect(vars[`--brand-${step}`]).toMatch(/^#[0-9a-f]{6}$/);
      expect(vars[`--brand-${step}-rgb`]).toMatch(/^\d+ \d+ \d+$/);
      expect(vars[`--accent-${step}`]).toMatch(/^#[0-9a-f]{6}$/);
      expect(vars[`--accent-${step}-rgb`]).toMatch(/^\d+ \d+ \d+$/);
    }
  });

  it('applies CSS variables, theme preset, and theme-color meta tag on document and resets cleanly', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#000000');
    document.head.appendChild(meta);

    const custom = resolveTournamentBranding(
      { primary_color: '#7f1d1d', accent_color: '#f59e0b' },
      { theme_preset: 'minimal' }
    );
    applyBrandingToDocument(custom, document);

    expect(document.documentElement.style.getPropertyValue('--brand-600')).toBe('#7f1d1d');
    expect(document.documentElement.style.getPropertyValue('--brand-600-rgb')).toBe('127 29 29');
    expect(document.documentElement.style.getPropertyValue('--brand-foreground')).toBe('#ffffff');
    expect(document.documentElement.style.getPropertyValue('--accent-600')).toBe('#f59e0b');
    expect(document.documentElement.style.getPropertyValue('--accent-foreground')).toBe('#020617');
    expect(document.documentElement.dataset.themePreset).toBe('minimal');
    expect(document.documentElement.dataset.themePack).toBe('default-clean');
    expect(meta.getAttribute('content')).toBe('#7f1d1d');

    const packBranding = resolveTournamentBranding(
      { primary_color: '#1e3a5f', accent_color: '#c29a3b' },
      { theme_preset: 'memorial-formal' }
    );
    expect(packBranding.themePreset).toBe('memorial-formal');
    expect(packBranding.themePackId).toBe('memorial-formal');
    applyBrandingToDocument(packBranding, document);
    expect(document.documentElement.dataset.themePreset).toBe('memorial-formal');
    expect(document.documentElement.dataset.themePack).toBe('memorial-formal');
    expect(document.documentElement.style.getPropertyValue('--theme-pack-heading-font')).toContain('Playfair Display');

    resetBrandingOnDocument(document);
    expect(document.documentElement.style.getPropertyValue('--brand-600')).toBe(DEFAULT_PRIMARY_COLOR);
    expect(document.documentElement.dataset.themePreset).toBe('classic');
    expect(document.documentElement.dataset.themePack).toBe('default-clean');
    expect(meta.getAttribute('content')).toBe(DEFAULT_PRIMARY_COLOR);

    meta.remove();
  });
});
