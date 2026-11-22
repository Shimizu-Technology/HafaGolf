import { describe, expect, it } from 'vitest';
import {
  FEATURE_KEYS,
  getUnmetDependencies,
  groupCatalogByCategory,
  isFeatureEnabled,
  type FeatureCatalogItem,
} from './features';

describe('isFeatureEnabled', () => {
  it('returns true when feature is explicitly enabled', () => {
    expect(isFeatureEnabled({ raffle: true, donations: false }, 'raffle')).toBe(true);
  });

  it('returns false when feature is explicitly disabled even if defaultValue is true', () => {
    expect(isFeatureEnabled({ raffle: false }, 'raffle', true)).toBe(false);
    expect(isFeatureEnabled({ sponsors: false }, 'sponsors', true)).toBe(false);
    expect(isFeatureEnabled({ live_scoring: false }, 'live_scoring', true)).toBe(false);
  });

  it('falls back to defaultValue when features map is null, undefined, or missing key', () => {
    expect(isFeatureEnabled(null, 'raffle', true)).toBe(true);
    expect(isFeatureEnabled(undefined, 'raffle', true)).toBe(true);
    expect(isFeatureEnabled({}, 'raffle', true)).toBe(true);
    expect(isFeatureEnabled({}, 'donations', false)).toBe(false);
    expect(isFeatureEnabled(undefined, 'tax_receipts')).toBe(false);
  });
});

describe('groupCatalogByCategory', () => {
  const sampleCatalog: FeatureCatalogItem[] = [
    {
      key: 'offseason_mode',
      label: 'Off-Season Mode',
      description: 'Between-events landing page',
      category: 'site',
      category_label: 'Public Site',
      default: false,
      scope: 'organization',
      tournament_overridable: false,
      requires: [],
    },
    {
      key: 'raffle',
      label: 'Raffle & Live Draw',
      description: 'Raffle tickets, POS, live draw board',
      category: 'fundraising',
      category_label: 'Fundraising & Sponsors',
      default: true,
      scope: 'tournament',
      tournament_overridable: true,
      requires: [],
    },
    {
      key: 'live_scoring',
      label: 'Live Scoring & Leaderboard',
      description: 'Mobile PWA scorecards & live leaderboard',
      category: 'event_day',
      category_label: 'Event Day & Gameplay',
      default: true,
      scope: 'tournament',
      tournament_overridable: true,
      requires: [],
    },
    {
      key: 'waitlist',
      label: 'Automatic Waitlist',
      description: 'Automatic capacity waitlist & promotion',
      category: 'registration',
      category_label: 'Registration & Pricing',
      default: true,
      scope: 'tournament',
      tournament_overridable: true,
      requires: [],
    },
  ];

  it('groups catalog items in canonical category order', () => {
    const groups = groupCatalogByCategory(sampleCatalog);
    expect(groups.map((g) => g.category)).toEqual(['fundraising', 'event_day', 'registration', 'site']);
    expect(groups[0].items.map((item) => item.key)).toEqual(['raffle']);
    expect(groups[3].items.map((item) => item.key)).toEqual(['offseason_mode']);
  });
});

describe('getUnmetDependencies', () => {
  it('returns disabled dependency keys', () => {
    expect(getUnmetDependencies({ requires: ['sponsors'] }, { sponsors: false })).toEqual(['sponsors']);
    expect(getUnmetDependencies({ requires: ['sponsors'] }, { sponsors: true })).toEqual([]);
    expect(getUnmetDependencies({ requires: [] }, {})).toEqual([]);
  });
});

describe('FEATURE_KEYS', () => {
  it('contains all 11 canonical HafaGolf feature keys', () => {
    expect(FEATURE_KEYS).toHaveLength(11);
    expect(FEATURE_KEYS).toContain('raffle');
    expect(FEATURE_KEYS).toContain('live_scoring');
    expect(FEATURE_KEYS).toContain('sponsors');
    expect(FEATURE_KEYS).toContain('tax_receipts');
    expect(FEATURE_KEYS).toContain('offseason_mode');
  });
});
