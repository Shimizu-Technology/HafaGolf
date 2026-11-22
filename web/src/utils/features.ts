export const FEATURE_KEYS = [
  'raffle',
  'live_scoring',
  'sponsors',
  'donations',
  'employee_pricing',
  'checkin_alpha_lanes',
  'walkin_registration',
  'waitlist',
  'sponsor_checkout',
  'tax_receipts',
  'offseason_mode',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureCategory = 'fundraising' | 'event_day' | 'registration' | 'site';

export type FeatureScope = 'organization' | 'tournament';

export type FeatureMap = Partial<Record<FeatureKey, boolean>> & {
  [key: string]: boolean | undefined;
};

export interface FeatureCatalogItem {
  key: FeatureKey;
  label: string;
  description: string;
  category: FeatureCategory;
  category_label: string;
  default: boolean;
  scope: FeatureScope;
  tournament_overridable: boolean;
  requires: FeatureKey[];
}

export interface OrganizationFeaturesSnapshot {
  id: string;
  name: string;
  slug: string;
  offseason_enabled: boolean;
  features: FeatureMap;
  feature_overrides: FeatureMap;
}

export interface TournamentFeaturesSnapshot {
  id: number;
  name: string;
  slug: string;
  year: number;
  status: string;
  raffle_enabled: boolean;
  features: FeatureMap;
  feature_overrides: FeatureMap;
}

export interface OrganizationFeaturesResponse {
  catalog: FeatureCatalogItem[];
  organization: OrganizationFeaturesSnapshot;
  tournaments: TournamentFeaturesSnapshot[];
}

export interface FeatureCategoryGroup {
  category: FeatureCategory;
  label: string;
  items: FeatureCatalogItem[];
}

const CATEGORY_ORDER: FeatureCategory[] = ['fundraising', 'event_day', 'registration', 'site'];

/**
 * Safely checks whether a platform feature is enabled in a resolved FeatureMap.
 * Falls back to `defaultValue` when the feature map or key is not present.
 */
export function isFeatureEnabled(
  features: FeatureMap | null | undefined,
  key: FeatureKey,
  defaultValue = false
): boolean {
  if (!features) return defaultValue;
  const value = features[key];
  if (typeof value === 'boolean') return value;
  return defaultValue;
}

/**
 * Groups catalog feature items by category in canonical display order.
 */
export function groupCatalogByCategory(catalog: FeatureCatalogItem[]): FeatureCategoryGroup[] {
  const byCategory = new Map<FeatureCategory, FeatureCategoryGroup>();

  for (const item of catalog) {
    const existing = byCategory.get(item.category);
    if (existing) {
      existing.items.push(item);
    } else {
      byCategory.set(item.category, {
        category: item.category,
        label: item.category_label,
        items: [item],
      });
    }
  }

  return CATEGORY_ORDER.map((category) => byCategory.get(category)).filter(
    (group): group is FeatureCategoryGroup => Boolean(group)
  );
}

/**
 * Returns required dependency keys that are currently disabled in the resolved feature map.
 */
export function getUnmetDependencies(
  feature: Pick<FeatureCatalogItem, 'requires'>,
  effectiveFeatures: FeatureMap | null | undefined
): FeatureKey[] {
  if (!feature.requires || feature.requires.length === 0) return [];
  return feature.requires.filter((dep) => !isFeatureEnabled(effectiveFeatures, dep, false));
}
