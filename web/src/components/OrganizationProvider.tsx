import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useOrganizationStore } from '../stores/organizationStore';
import { api } from '../services/api';
import type { Organization } from '../stores/organizationStore';
import { OffseasonPage } from '../pages/OffseasonPage';
import { AlertTriangle } from 'lucide-react';
import { useApplyBranding } from '../utils/branding';

interface OrganizationProviderProps {
  children: React.ReactNode;
  fallbackPath?: string;
  orgSlug?: string;
  isPublicRoute?: boolean;
  mode?: 'public' | 'admin';
}

/**
 * Selects the active organization for an authenticated admin session.
 * Never depends on hostname so admin routes work on ADMIN_ORIGIN.
 */
export function selectAdminOrganization(
  accessible: Organization[],
  currentSlug?: string | null,
  preferredSlug?: string | null
): Organization | null {
  if (accessible.length === 0) return null;

  if (preferredSlug) {
    const preferred = accessible.find((org) => org.slug === preferredSlug);
    if (preferred) return preferred;
  }

  if (currentSlug) {
    const current = accessible.find((org) => org.slug === currentSlug);
    if (current) return current;
  }

  return accessible[0];
}

/**
 * Determines whether a public OrganizationProvider should hold rendering children
 * until host-based or explicit-slug tenant resolution completes, preventing child
 * pages from firing premature `/organizations/default/...` requests on first paint.
 */
export function shouldShowPublicOrganizationLoading(
  organization: Organization | null,
  explicitSlug: string | null,
  isLoading: boolean,
  error: string | null
): boolean {
  const slugMismatch = Boolean(explicitSlug && organization && organization.slug !== explicitSlug);
  const missingTargetOrg = !organization || slugMismatch;
  if (!missingTargetOrg) return false;
  if (isLoading) return true;
  return !error;
}

/**
 * OrganizationProvider resolves organization context from:
 * - mode="admin": authenticated GET /api/v1/admin/organizations (never host-based)
 * - mode="public":
 *   1. Explicit orgSlug prop or URL :orgSlug parameter
 *   2. Current host via GET /api/v1/tenant (custom domain routing via X-Tenant-Host)
 */
export function OrganizationProvider({
  children,
  fallbackPath = '/admin/login',
  orgSlug: propOrgSlug,
  isPublicRoute = false,
  mode = 'public',
}: OrganizationProviderProps) {
  const { orgSlug: paramOrgSlug } = useParams<{ orgSlug: string }>();
  const [searchParams] = useSearchParams();
  const explicitSlug = propOrgSlug || (mode === 'admin' ? searchParams.get('org') : paramOrgSlug) || null;
  const navigate = useNavigate();
  const {
    organization,
    setOrganization,
    setAccessibleOrganizations,
    setLoading,
    setError,
    isLoading,
    error,
  } = useOrganizationStore();

  const [adminResolution, setAdminResolution] = useState<{
    requestedSlug: string | null;
    error: string | null;
  } | null>(null);
  const adminResolutionMatches = Boolean(adminResolution && (
    adminResolution.requestedSlug === explicitSlug || (!explicitSlug && !adminResolution.error)
  ));
  const adminLoading = !adminResolutionMatches;
  const adminError = adminResolutionMatches ? adminResolution?.error : null;

  useApplyBranding(mode === 'admin' && (adminLoading || adminError) ? null : organization);

  useEffect(() => {
    if (mode !== 'admin' || adminResolutionMatches) return;
    let cancelled = false;

    async function loadAdminOrganization() {
      try {
        const accessible = (await api.getAdminOrganizations()) as Organization[];
        if (cancelled) return;

        const storedSlug = useOrganizationStore.getState().organization?.slug;
        const selected = selectAdminOrganization(accessible, storedSlug, explicitSlug);
        setAccessibleOrganizations(accessible);
        if (explicitSlug && selected?.slug !== explicitSlug) {
          setAdminResolution({ requestedSlug: explicitSlug, error: 'You do not have access to the organization in this link.' });
          return;
        }

        setOrganization(selected);
        setAdminResolution({ requestedSlug: explicitSlug, error: null });
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Failed to load accessible organizations:', err);
        setAdminResolution({
          requestedSlug: explicitSlug,
          error: err instanceof Error ? err.message : 'Failed to load organizations',
        });
      }
    }

    void loadAdminOrganization();
    return () => { cancelled = true; };
  }, [adminResolutionMatches, explicitSlug, mode, setAccessibleOrganizations, setOrganization]);

  useEffect(() => {
    if (mode !== 'public') return;
    let cancelled = false;

    async function fetchOrganization() {
      const storedOrg = useOrganizationStore.getState().organization;

      const needsLoad = !storedOrg || (explicitSlug && storedOrg.slug !== explicitSlug);
      if (needsLoad) {
        setError(null);
        setLoading(true);
      }

      try {
        if (explicitSlug) {
          const response = await api.get<Organization>(`/organizations/${explicitSlug}`);
          if (!cancelled) setOrganization(response.data);
        } else {
          const tenant = await api.resolveTenant();
          if (!cancelled) setOrganization(tenant.organization as Organization);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Failed to fetch organization:', err);
        const message = err instanceof Error ? err.message : 'Failed to load organization';
        if (message.includes('not found') || message.includes('404')) {
          setError('Organization not found');
          if (fallbackPath) {
            navigate(fallbackPath, { replace: true });
          }
        } else {
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchOrganization();

    return () => {
      cancelled = true;
    };
  }, [explicitSlug, fallbackPath, mode, navigate, setError, setLoading, setOrganization]);

  const publicLoading = shouldShowPublicOrganizationLoading(organization, explicitSlug, isLoading, error);
  const publicError = error && (!organization || Boolean(explicitSlug && organization.slug !== explicitSlug));

  if (mode === 'admin' ? adminLoading : publicLoading) {
    return (
      <div data-static-flow={mode === 'admin' ? true : undefined} role="status" className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (mode === 'admin' ? adminError : publicError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            {mode === 'admin' ? 'Unable to Load Organizations' : 'Organization Not Found'}
          </h1>
          <p className="text-gray-500 mb-8 leading-relaxed">
            {mode === 'admin'
              ? adminError
              : 'We could not find an organization configured for this address. Check the URL or contact your event organizer.'}
          </p>
          <button
            onClick={() => {
              if (mode === 'public') {
                navigate('/');
              } else if (explicitSlug) {
                navigate('/admin');
              } else {
                setAdminResolution(null);
              }
            }}
            className="min-h-[48px] rounded-xl bg-brand-600 px-6 py-3 font-semibold text-brand-foreground shadow-lg hover:bg-brand-700"
          >
            {mode === 'admin' ? (explicitSlug ? 'Back to dashboard' : 'Try again') : 'Go home'}
          </button>
        </div>
      </div>
    );
  }

  if (isPublicRoute && organization?.offseason_enabled) {
    return <OffseasonPage organization={organization} />;
  }

  return <>{children}</>;
}

/**
 * Hook to get current organization and admin switcher state from context
 */
export function useOrganization() {
  const { organization, accessibleOrganizations, setOrganization, setAccessibleOrganizations, isLoading, error } =
    useOrganizationStore();
  return { organization, accessibleOrganizations, setOrganization, setAccessibleOrganizations, isLoading, error };
}
