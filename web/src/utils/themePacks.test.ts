// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PACK_ID,
  THEME_PACK_IDS,
  THEME_PACK_LIST,
  THEME_PACKS,
  applyThemePackToDocument,
  buildThemePackCssVariables,
  isThemePackId,
  resolveThemePack,
  resolveThemePackId,
} from './themePacks';

describe('Theme Pack Registry', () => {
  it('registers all four generic Theme Packs with complete typed metadata', () => {
    expect(THEME_PACK_IDS).toEqual([
      'default-clean',
      'charity-bright',
      'memorial-formal',
      'crest-classic',
    ]);
    expect(THEME_PACK_LIST).toHaveLength(4);

    const heroVariants = new Set<string>();
    const motionVariants = new Set<string>();

    for (const id of THEME_PACK_IDS) {
      const pack = THEME_PACKS[id];
      expect(pack.id).toBe(id);
      expect(pack.name.length).toBeGreaterThan(0);
      expect(pack.description.length).toBeGreaterThan(0);
      expect(pack.typography.headingFontFamily.length).toBeGreaterThan(0);
      expect(pack.typography.heroTitleClass).toContain('font-theme-heading');
      expect(pack.surfaces.cardClass.length).toBeGreaterThan(0);
      expect(pack.surfaces.badgeClass.length).toBeGreaterThan(0);
      expect(pack.signatureMotion.durationMs).toBeGreaterThan(0);
      expect(pack.cssVars['--theme-pack-heading-font']).toBe(pack.typography.headingFontFamily);

      heroVariants.add(pack.hero.variant);
      motionVariants.add(pack.signatureMotion.variant);
    }

    // Each pack provides a distinct hero variant and signature motion style
    expect(heroVariants.size).toBe(4);
    expect(motionVariants.size).toBe(4);
  });

  it('resolves all four canonical pack IDs including whitespace and case normalization', () => {
    expect(resolveThemePackId('default-clean')).toBe('default-clean');
    expect(resolveThemePackId('charity-bright')).toBe('charity-bright');
    expect(resolveThemePackId('memorial-formal')).toBe('memorial-formal');
    expect(resolveThemePackId('crest-classic')).toBe('crest-classic');
    expect(resolveThemePackId('  CHARITY-BRIGHT  ')).toBe('charity-bright');
    expect(resolveThemePack('memorial-formal')).toBe(THEME_PACKS['memorial-formal']);
    expect(isThemePackId('crest-classic')).toBe(true);
    expect(isThemePackId('classic')).toBe(false);
  });

  it('maps legacy classic preset gracefully to default-clean', () => {
    expect(resolveThemePackId('classic')).toBe('default-clean');
    expect(resolveThemePackId('  CLASSIC ')).toBe('default-clean');
    expect(resolveThemePack('classic')).toBe(THEME_PACKS['default-clean']);
  });

  it('falls back safely to default-clean on unknown, null, undefined, or empty values', () => {
    expect(resolveThemePackId(null)).toBe(DEFAULT_THEME_PACK_ID);
    expect(resolveThemePackId(undefined)).toBe(DEFAULT_THEME_PACK_ID);
    expect(resolveThemePackId('')).toBe(DEFAULT_THEME_PACK_ID);
    expect(resolveThemePackId('   ')).toBe(DEFAULT_THEME_PACK_ID);
    expect(resolveThemePackId('unknown-pack')).toBe(DEFAULT_THEME_PACK_ID);
    expect(resolveThemePackId('premium')).toBe(DEFAULT_THEME_PACK_ID);
    expect(resolveThemePack('nonexistent').id).toBe('default-clean');
  });

  it('builds CSS custom properties and applies data-theme-pack to the document root', () => {
    const vars = buildThemePackCssVariables(THEME_PACKS['crest-classic']);
    expect(vars['--theme-pack-heading-font']).toContain('Playfair Display');
    expect(vars['--theme-pack-border-width']).toBe('2px');

    const applied = applyThemePackToDocument('memorial-formal', document);
    expect(applied.id).toBe('memorial-formal');
    expect(document.documentElement.dataset.themePack).toBe('memorial-formal');
    expect(document.documentElement.style.getPropertyValue('--theme-pack-heading-font')).toContain(
      'Playfair Display'
    );

    // Legacy classic resolves to default-clean on the DOM attribute
    applyThemePackToDocument('classic', document);
    expect(document.documentElement.dataset.themePack).toBe('default-clean');
    expect(document.documentElement.style.getPropertyValue('--theme-pack-heading-font')).toContain('Lora');
  });
});
