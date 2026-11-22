import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
}

/**
 * OrganizationProvider resolves organization context from:
 * 1. Explicit orgSlug prop (admin org context)
 * 2. URL :orgSlug parameter (path-based routes)
 * 3. Current host via GET /api/v1/tenant (custom domain routing via X-Tenant-Host)
 */
export function OrganizationProvider({
  children,
  fallbackPath = '/admin/login',
  orgSlug: propOrgSlug,
  isPublicRoute = false,
}: OrganizationProviderProps) {
  const { orgSlug: paramOrgSlug } = useParams<{ orgSlug: string }>();
  const explicitSlug = propOrgSlug || paramOrgSlug || null;
  const navigate = useNavigate();
  const { organization, setOrganization, setLoading, setError, isLoading, error } = useOrganizationStore();

  useApplyBranding(organization);

  useEffect(() => {
    let cancelled = false;

    async function fetchOrganization() {
      const needsLoad = !organization || (explicitSlug && organization.slug !== explicitSlug);
      if (needsLoad) {
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
  }, [explicitSlug, fallbackPath, navigate, organization?.slug, setError, setLoading, setOrganization]);

  if (isLoading && !organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Organization Not Found</h1>
          <p className="text-gray-500 mb-8 leading-relaxed">
            We could not find an organization configured for this address. Check the URL or contact your event organizer.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-all shadow-lg"
          >
            Go Home
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
 * Hook to get current organization from context
 */
export function useOrganization() {
  const { organization, isLoading, error } = useOrganizationStore();
  return { organization, isLoading, error };
}
