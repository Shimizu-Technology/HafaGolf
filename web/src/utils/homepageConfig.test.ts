import { describe, expect, it } from 'vitest';
import {
  resolveHeroLogo,
  resolveHomepageConfig,
  isSectionEnabled,
} from './homepageConfig';

describe('homepageConfig', () => {
  it('maps theme_preset to sensible v3 archetype defaults', () => {
    const memorial = resolveHomepageConfig(null, null, 'memorial-formal');
    expect(memorial.archetype).toBe('ceremonial-light');
    expect(memorial.hero_surface).toBe('light_airy');
    expect(memorial.artwork_display).toBe('emblem_lockup');

    const charity = resolveHomepageConfig(null, null, 'charity-bright');
    expect(charity.archetype).toBe('charity-showcase');
    expect(charity.hero_surface).toBe('brand_gradient');
    expect(charity.artwork_display).toBe('showcase_split');

    const crest = resolveHomepageConfig(null, null, 'crest-classic');
    expect(crest.archetype).toBe('varsity-crest');
    expect(crest.hero_surface).toBe('dark_editorial');
  });

  it('merges org and tournament overrides with tournament winning', () => {
    const resolved = resolveHomepageConfig(
      { landing_mode: 'direct_to_active_event', eyebrow_label: 'Org Series' },
      { artwork_display: 'full_bleed_bg', sections: [{ key: 'sponsor_wall', enabled: false }] },
      'charity-bright'
    );
    expect(resolved.landing_mode).toBe('direct_to_active_event');
    expect(resolved.eyebrow_label).toBe('Org Series');
    expect(resolved.artwork_display).toBe('full_bleed_bg');
    expect(isSectionEnabled(resolved, 'sponsor_wall')).toBe(false);
    expect(isSectionEnabled(resolved, 'event_details_card')).toBe(true);
  });

  it('deduplicates hero logos and picks reversed logo on dark surfaces', () => {
    const memorialLogo = resolveHeroLogo({
      logoDisplay: 'auto',
      isDarkSurface: false,
      commemorativeBannerUrl: 'https://example.com/50th.png',
      logoUrl: 'https://example.com/org.png',
    });
    expect(memorialLogo).toEqual({ url: 'https://example.com/50th.png', kind: 'commemorative' });

    const darkLogo = resolveHeroLogo({
      logoDisplay: 'auto',
      isDarkSurface: true,
      logoUrl: 'https://example.com/org.png',
      reversedLogoUrl: 'https://example.com/org-rev.png',
    });
    expect(darkLogo).toEqual({ url: 'https://example.com/org-rev.png', kind: 'reversed' });

    const hidden = resolveHeroLogo({
      logoDisplay: 'none',
      isDarkSurface: false,
      logoUrl: 'https://example.com/org.png',
    });
    expect(hidden).toEqual({ url: null, kind: null });
  });
});
