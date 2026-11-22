import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FeatureMap } from '../utils/features';

export interface HomepageStat {
  value: string;
  label: string;
}

export interface OrganizationSettings {
  homepage_tagline?: string;
  homepage_mission?: string;
  homepage_stats?: HomepageStat[];
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  features?: FeatureMap;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  banner_url?: string;
  contact_email?: string;
  contact_phone?: string;
  website_url?: string;
  brand_kit?: {
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    logo_url?: string;
    banner_url?: string;
  };
  primary_host?: string | null;
  offseason_enabled?: boolean;
  offseason_title?: string | null;
  offseason_message?: string | null;
  offseason_cta_label?: string | null;
  offseason_cta_url?: string | null;
  settings?: OrganizationSettings;
  features?: FeatureMap;
  feature_overrides?: FeatureMap;
  tournament_count?: number;
}

interface OrganizationState {
  organization: Organization | null;
  accessibleOrganizations: Organization[];
  isLoading: boolean;
  error: string | null;
  setOrganization: (org: Organization | null) => void;
  setAccessibleOrganizations: (orgs: Organization[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearOrganization: () => void;
}

export const useOrganizationStore = create<OrganizationState>()(
  persist(
    (set) => ({
      organization: null,
      accessibleOrganizations: [],
      isLoading: false,
      error: null,
      setOrganization: (org) => set({ organization: org, error: null }),
      setAccessibleOrganizations: (orgs) => set({ accessibleOrganizations: orgs }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error, isLoading: false }),
      clearOrganization: () => set({ organization: null, accessibleOrganizations: [], error: null }),
    }),
    {
      name: 'hafagolf-organization',
      partialize: (state) => ({ organization: state.organization }),
    }
  )
);

// Helper to get org slug from URL path
export function getOrgSlugFromPath(pathname: string): string | null {
  // Expected format: /:org_slug/...
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 0) {
    // Skip known non-org routes
    const nonOrgRoutes = ['admin', 'login', 'pay', 'payment', 'registration'];
    if (!nonOrgRoutes.includes(parts[0])) {
      return parts[0];
    }
  }
  return null;
}

// Helper to build org-scoped path
export function buildOrgPath(orgSlug: string, path: string): string {
  return `/${orgSlug}${path.startsWith('/') ? path : `/${path}`}`;
}
