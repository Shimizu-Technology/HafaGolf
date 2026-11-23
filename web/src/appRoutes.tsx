import { Suspense, lazy, useEffect, useState } from 'react';
import { createRoutesFromElements, Navigate, Outlet, Route, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ExternalLink } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OrganizationProvider } from './components/OrganizationProvider';
import { GolferAuthProvider } from './contexts/GolferAuthContext';
import { PostHogPageView } from './providers/PostHogProvider';
import { api } from './services/api';
import { useOrganizationStore } from './stores/organizationStore';
import {
  buildAdminRedirectUrl,
  isAdminHost,
  isLocalDevHost,
  shouldRenderPlatformHome,
} from './utils/adminHost';

// Import public pages directly (NOT via ./pages barrel) so admin pages and @clerk/react
// are completely excluded from the public client domain bundle.
import { OrganizationLandingPage } from './pages/OrganizationLandingPage';
import { SponsorPortalPage } from './pages/SponsorPortalPage';
import { PaymentSuccessPage } from './pages/PaymentSuccessPage';
import { PaymentCancelPage } from './pages/PaymentCancelPage';
import { GolferLoginPage } from './pages/GolferLoginPage';
import { GolferVerifyPage } from './pages/GolferVerifyPage';
import { GolferDashboardPage } from './pages/GolferDashboardPage';
import { ScorecardPage } from './pages/ScorecardPage';
import { OrgTournamentPage } from './pages/OrgTournamentPage';
import { OrgRegistrationPage } from './pages/OrgRegistrationPage';
import { OrgRegistrationSuccessPage } from './pages/OrgRegistrationSuccessPage';
import { RaffleBoardPage } from './pages/RaffleBoardPage';
import { SponsorCheckoutPage } from './pages/SponsorCheckoutPage';
import { DonationsPage } from './pages/DonationsPage';

const LazyAdminRoutesApp = lazy(() => import('./admin/AdminRoutesApp'));
const LazyLeaderboardPage = lazy(() =>
  import('./pages/LeaderboardPage').then((module) => ({ default: module.LeaderboardPage }))
);
// The platform homepage (and its editorial motion) loads only where it renders, so tenant sites never fetch it.
const LazyPlatformHomePage = lazy(() =>
  import('./pages/PlatformHomePage').then((module) => ({ default: module.PlatformHomePage }))
);
const LazyPrivacyPolicyPage = lazy(() =>
  import('./pages/PrivacyPolicyPage').then((module) => ({ default: module.PrivacyPolicyPage }))
);
const LazyTermsOfServicePage = lazy(() =>
  import('./pages/TermsOfServicePage').then((module) => ({ default: module.TermsOfServicePage }))
);
const LazyContactPage = lazy(() =>
  import('./pages/ContactPage').then((module) => ({ default: module.ContactPage }))
);

function TenantPublicWrapper({ children }: { children: React.ReactNode }) {
  const { search } = useLocation();
  const localOrgOverride = isLocalDevHost(window.location.hostname)
    ? (new URLSearchParams(search).get('org')?.trim() ||
        (import.meta.env.VITE_DEFAULT_ORG_SLUG as string | undefined)?.trim() ||
        undefined)
    : undefined;

  return (
    <OrganizationProvider isPublicRoute fallbackPath="" orgSlug={localOrgOverride}>
      {children}
    </OrganizationProvider>
  );
}

function AdminOriginRedirect() {
  const location = useLocation();
  const storedOrgSlug = useOrganizationStore((state) => state.organization?.slug);
  const existingOrgParam = new URLSearchParams(location.search).get('org');
  const [resolvedSlug, setResolvedSlug] = useState<string | undefined>(storedOrgSlug);
  const [readyToRedirect, setReadyToRedirect] = useState<boolean>(Boolean(storedOrgSlug || existingOrgParam));

  useEffect(() => {
    if (storedOrgSlug || existingOrgParam) {
      setResolvedSlug(storedOrgSlug);
      setReadyToRedirect(true);
      return;
    }

    let cancelled = false;
    api
      .resolveTenant()
      .then((res) => {
        if (!cancelled && res.organization?.slug) {
          setResolvedSlug(res.organization.slug);
        }
      })
      .catch(() => {
        // Proceed with redirect even if host lookup fails
      })
      .finally(() => {
        if (!cancelled) {
          setReadyToRedirect(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storedOrgSlug, existingOrgParam]);

  const targetUrl = buildAdminRedirectUrl(
    location.pathname,
    location.search,
    location.hash,
    undefined,
    resolvedSlug
  );

  useEffect(() => {
    if (!readyToRedirect) return;
    window.location.replace(targetUrl);
  }, [readyToRedirect, targetUrl]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
        <h1 className="mt-4 text-lg font-semibold text-neutral-900">Redirecting to Admin Console…</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Tournament administration is hosted on the HafaGolf admin portal.
        </p>
        <a
          href={targetUrl}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <span>Continue to Admin Console</span>
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </main>
  );
}

function AdminBoundaryRoute() {
  if (!isAdminHost()) {
    return <AdminOriginRedirect />;
  }

  return (
    <Suspense
      fallback={
        <div data-static-flow className="min-h-screen flex items-center justify-center bg-neutral-50">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
            <p className="mt-4 text-sm text-neutral-600">Loading Admin Console…</p>
          </div>
        </div>
      }
    >
      <LazyAdminRoutesApp />
    </Suspense>
  );
}

function PlatformHomeRoute() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#faf8f3]" />}>
      <LazyPlatformHomePage />
    </Suspense>
  );
}

function RootRoute() {
  const { search } = useLocation();
  if (shouldRenderPlatformHome(window.location.hostname, search)) {
    return <PlatformHomeRoute />;
  }

  return (
    <TenantPublicWrapper>
      <OrganizationLandingPage />
    </TenantPublicWrapper>
  );
}

function AppLayout() {
  const { pathname } = useLocation();
  const normalizedPath = pathname.toLowerCase();
  const isStaticFlow =
    normalizedPath === '/admin' ||
    normalizedPath.startsWith('/admin/') ||
    normalizedPath === '/sponsor-portal' ||
    normalizedPath.startsWith('/sponsor-portal/');
  return (
    <ErrorBoundary>
      <PostHogPageView />
      <div data-static-flow={isStaticFlow || undefined} className="min-h-screen flex flex-col">
        <Toaster position="top-right" />
        <Outlet />
      <footer className="py-4 text-center border-t border-gray-100 bg-white mt-auto">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
          <a
            href="https://shimizu-technology.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 transition-colors duration-200"
          >
            Built by <span className="font-medium">Shimizu Technology</span>
          </a>
          <span aria-hidden="true">·</span>
          <a href="/privacy" className="hover:text-gray-600 transition-colors duration-200">
            Privacy
          </a>
          <span aria-hidden="true">·</span>
          <a href="/terms" className="hover:text-gray-600 transition-colors duration-200">
            Terms
          </a>
        </div>
      </footer>
      </div>
    </ErrorBoundary>
  );
}

export const appRoutes = createRoutesFromElements(
  <Route element={<AppLayout />}>
    <Route path="/" element={<RootRoute />} />
    <Route path="/platform" element={<PlatformHomeRoute />} />
    <Route path="/about" element={<PlatformHomeRoute />} />
    <Route
      path="/privacy"
      element={
        <Suspense fallback={<div className="min-h-screen bg-[#faf8f3]" />}>
          <LazyPrivacyPolicyPage />
        </Suspense>
      }
    />
    <Route
      path="/terms"
      element={
        <Suspense fallback={<div className="min-h-screen bg-[#faf8f3]" />}>
          <LazyTermsOfServicePage />
        </Suspense>
      }
    />
    <Route
      path="/contact"
      element={
        <Suspense fallback={<div className="min-h-screen bg-[#faf8f3]" />}>
          <LazyContactPage />
        </Suspense>
      }
    />

    <Route path="/sponsor-portal" element={<TenantPublicWrapper><SponsorPortalPage /></TenantPublicWrapper>} />
    <Route path="/sponsor-portal/login" element={<TenantPublicWrapper><SponsorPortalPage /></TenantPublicWrapper>} />

    <Route path="/admin/*" element={<AdminBoundaryRoute />} />

    <Route path="/payment/success" element={<PaymentSuccessPage />} />
    <Route path="/payment/cancel" element={<PaymentCancelPage />} />

    <Route path="/score" element={<GolferAuthProvider><GolferLoginPage /></GolferAuthProvider>} />
    <Route path="/score/verify" element={<GolferAuthProvider><GolferVerifyPage /></GolferAuthProvider>} />
    <Route path="/golfer/dashboard" element={<GolferAuthProvider><GolferDashboardPage /></GolferAuthProvider>} />
    <Route path="/golfer/scorecard" element={<GolferAuthProvider><ScorecardPage /></GolferAuthProvider>} />

    <Route path="/:orgSlug/tournaments/:tournamentSlug/sponsor" element={<TenantPublicWrapper><SponsorCheckoutPage /></TenantPublicWrapper>} />
    <Route path="/:orgSlug/sponsor" element={<TenantPublicWrapper><SponsorCheckoutPage /></TenantPublicWrapper>} />
    <Route path="/:orgSlug/tournaments/:tournamentSlug/donate" element={<TenantPublicWrapper><DonationsPage /></TenantPublicWrapper>} />
    <Route path="/:orgSlug/donate" element={<TenantPublicWrapper><DonationsPage /></TenantPublicWrapper>} />

    <Route path="/:tournamentSlug" element={<TenantPublicWrapper><OrgTournamentPage /></TenantPublicWrapper>} />
    <Route path="/:tournamentSlug/register" element={<TenantPublicWrapper><OrgRegistrationPage /></TenantPublicWrapper>} />
    <Route path="/:tournamentSlug/success" element={<TenantPublicWrapper><OrgRegistrationSuccessPage /></TenantPublicWrapper>} />
    <Route
      path="/:tournamentSlug/leaderboard"
      element={
        <TenantPublicWrapper>
          <Suspense fallback={<div className="min-h-screen bg-neutral-50" />}>
            <LazyLeaderboardPage />
          </Suspense>
        </TenantPublicWrapper>
      }
    />
    <Route path="/:tournamentSlug/raffle" element={<TenantPublicWrapper><RaffleBoardPage /></TenantPublicWrapper>} />

    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>
);
