import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
  isDedicatedAdminHost,
} from './utils/adminHost';

// Import public pages directly (NOT via ./pages barrel) so admin pages and @clerk/clerk-react
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
import { LeaderboardPage } from './pages/LeaderboardPage';
import { RaffleBoardPage } from './pages/RaffleBoardPage';
import { SponsorCheckoutPage } from './pages/SponsorCheckoutPage';
import { DonationsPage } from './pages/DonationsPage';

const LazyAdminRoutesApp = lazy(() => import('./admin/AdminRoutesApp'));

function TenantPublicWrapper({ children }: { children: React.ReactNode }) {
  return (
    <OrganizationProvider isPublicRoute fallbackPath="">
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
        <div className="min-h-screen flex items-center justify-center bg-neutral-50">
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

function RootRoute() {
  if (isDedicatedAdminHost()) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <TenantPublicWrapper>
      <OrganizationLandingPage />
    </TenantPublicWrapper>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <PostHogPageView />
        <div className="min-h-screen flex flex-col">
          <Toaster position="top-right" />
          <Routes>
            <Route path="/" element={<RootRoute />} />

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
            <Route path="/:tournamentSlug/leaderboard" element={<TenantPublicWrapper><LeaderboardPage /></TenantPublicWrapper>} />
            <Route path="/:tournamentSlug/raffle" element={<TenantPublicWrapper><RaffleBoardPage /></TenantPublicWrapper>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="py-4 text-center border-t border-gray-100 bg-white mt-auto">
            <a
              href="https://shimizu-technology.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors duration-200"
            >
              Built by <span className="font-medium">Shimizu Technology</span>
            </a>
          </footer>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
