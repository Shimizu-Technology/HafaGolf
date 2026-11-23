import React, { useEffect, useMemo, useRef } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ClerkProvider, useAuth, useUser } from '@clerk/react';
import { usePostHog } from 'posthog-js/react';
import { AlertTriangle } from 'lucide-react';
import { ClerkAuthBridgeContext } from '../contexts/ClerkAuthBridge';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { AdminLayout } from '../components/AdminLayout';
import { AdminOnlyRoute } from '../components/AdminRouteGuard';
import { OrganizationProvider, useOrganization } from '../components/OrganizationProvider';
import { AdminProvider, TournamentProvider } from '../contexts';
import { usePostHogReady } from '../providers/PostHogProvider';
import { AdminLoginPage } from '../pages/AdminLoginPage';
import { OrgAdminDashboard } from '../pages/OrgAdminDashboard';
import { PlatformConsolePage } from '../pages/PlatformConsolePage';
import { EventsManagementPage } from '../pages/EventsManagementPage';
import { CreateTournamentPage } from '../pages/CreateTournamentPage';
import { OrgTournamentAdmin } from '../pages/OrgTournamentAdmin';
import { PaymentReconciliationPage } from '../pages/PaymentReconciliationPage';
import { OrgCheckInPage } from '../pages/OrgCheckInPage';
import { GroupManagementPage } from '../pages/GroupManagementPage';
import { RaffleManagementPage } from '../pages/RaffleManagementPage';
import { SponsorManagementPage } from '../pages/SponsorManagementPage';
import { EmployeeNumbersPage } from '../pages/EmployeeNumbersPage';
import { OrgSettingsPage } from '../pages/OrgSettingsPage';
import { ReportsPage } from '../pages/ReportsPage';
import { ScorecardPage } from '../pages/ScorecardPage';
import { PrintablesPage } from '../pages/PrintablesPage';
import { BroadcastsPage } from '../pages/BroadcastsPage';
import { SponsorsOverviewPage } from '../pages/SponsorsOverviewPage';
import { ActivityLogPage } from '../pages/ActivityLogPage';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function ClerkAuthBridgeProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const value = useMemo(
    () => ({
      isClerkAvailable: true,
      isSignedIn: Boolean(isSignedIn),
      isLoaded: Boolean(isLoaded),
      getToken: async () => getToken(),
    }),
    [getToken, isLoaded, isSignedIn]
  );

  return <ClerkAuthBridgeContext.Provider value={value}>{children}</ClerkAuthBridgeContext.Provider>;
}

function PostHogClerkIdentitySync() {
  const posthogClient = usePostHog();
  const isReady = usePostHogReady();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const previouslySignedInRef = useRef(false);

  useEffect(() => {
    if (!posthogClient || !isReady || !isLoaded) return;

    if (isSignedIn && user) {
      posthogClient.identify(`clerk:${user.id}`, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName,
      });
      previouslySignedInRef.current = true;
      return;
    }

    if (previouslySignedInRef.current) {
      posthogClient.reset();
      previouslySignedInRef.current = false;
    }
  }, [posthogClient, isReady, isLoaded, isSignedIn, user]);

  useEffect(() => {
    return () => {
      if (posthogClient && previouslySignedInRef.current) {
        posthogClient.reset();
        previouslySignedInRef.current = false;
      }
    };
  }, [posthogClient]);

  return null;
}

function AdminTournamentShell({ children }: { children: React.ReactNode }) {
  const { organization } = useOrganization();
  return <TournamentProvider key={organization?.id} orgSlug={organization?.slug}>{children}</TournamentProvider>;
}

function AdminShellPage() {
  const { pathname } = useLocation();

  return (
    <AdminProvider>
      <ProtectedRoute>
        <OrganizationProvider mode="admin" fallbackPath="">
          <AdminTournamentShell>
            <AdminLayout><Outlet key={pathname} /></AdminLayout>
          </AdminTournamentShell>
        </OrganizationProvider>
      </ProtectedRoute>
    </AdminProvider>
  );
}

function LegacyTournamentRedirect({ suffix = '', fallbackPath = '/admin/events' }: { suffix?: string; fallbackPath?: string }) {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { search } = useLocation();
  return <Navigate to={{ pathname: tournamentSlug ? `/admin/events/${tournamentSlug}${suffix}` : fallbackPath, search }} replace />;
}

export default function AdminRoutesApp() {
  if (!PUBLISHABLE_KEY) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          </div>
          <h1 className="text-lg font-semibold text-neutral-900">Admin Authentication Not Configured</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Set <code className="font-mono text-xs">VITE_CLERK_PUBLISHABLE_KEY</code> on the admin host to sign in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/admin/login">
      <ClerkAuthBridgeProvider>
        <PostHogClerkIdentitySync />
        <Routes>
          <Route path="login" element={<AdminLoginPage />} />
          <Route element={<AdminShellPage />}>
            <Route index element={<OrgAdminDashboard />} />
            <Route path="platform" element={<AdminOnlyRoute superAdminOnly><PlatformConsolePage /></AdminOnlyRoute>} />
            <Route path="organizations" element={<Navigate to="/admin/platform" replace />} />
            <Route path="events" element={<AdminOnlyRoute anyOf={['manage_golfers', 'manage_groups', 'view_reports', 'manage_settings']}><EventsManagementPage /></AdminOnlyRoute>} />
            <Route path="events/new" element={<AdminOnlyRoute capability="manage_settings"><CreateTournamentPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug" element={<AdminOnlyRoute capability="manage_golfers"><OrgTournamentAdmin /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/registrations" element={<AdminOnlyRoute capability="manage_golfers"><OrgTournamentAdmin /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/payments" element={<AdminOnlyRoute anyOf={['view_reports', 'manage_finances']}><PaymentReconciliationPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/checkin" element={<AdminOnlyRoute capability="check_in"><OrgCheckInPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/groups" element={<AdminOnlyRoute capability="manage_groups"><GroupManagementPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/scoring" element={<AdminOnlyRoute capability="enter_scores"><ScorecardPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/printables" element={<AdminOnlyRoute anyOf={['manage_groups', 'view_reports', 'check_in']}><PrintablesPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/announcements" element={<AdminOnlyRoute capability="send_broadcasts"><BroadcastsPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/raffle" element={<AdminOnlyRoute anyOf={['raffle_sell', 'raffle_draw', 'manage_raffle_prizes']}><RaffleManagementPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/sponsors" element={<AdminOnlyRoute capability="manage_sponsors"><SponsorManagementPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/employee-numbers" element={<AdminOnlyRoute capability="manage_golfers"><EmployeeNumbersPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/settings" element={<AdminOnlyRoute capability="manage_settings"><OrgSettingsPage /></AdminOnlyRoute>} />
            <Route path="events/:tournamentSlug/reports" element={<AdminOnlyRoute anyOf={['view_reports', 'manage_finances']}><ReportsPage /></AdminOnlyRoute>} />
            <Route path="sponsors" element={<AdminOnlyRoute capability="manage_sponsors"><SponsorsOverviewPage /></AdminOnlyRoute>} />
            <Route path="settings" element={<AdminOnlyRoute capability="manage_settings"><OrgSettingsPage /></AdminOnlyRoute>} />
            <Route path="activity" element={<AdminOnlyRoute anyOf={['view_reports', 'manage_settings', 'manage_golfers']}><ActivityLogPage /></AdminOnlyRoute>} />
          </Route>

          <Route path="tournaments/new" element={<LegacyTournamentRedirect fallbackPath="/admin/events/new" />} />
          <Route path="tournaments/:tournamentSlug" element={<LegacyTournamentRedirect />} />
          <Route path="tournaments/:tournamentSlug/checkin" element={<LegacyTournamentRedirect suffix="/checkin" />} />
          <Route path="tournaments/:tournamentSlug/payments" element={<LegacyTournamentRedirect suffix="/payments" />} />
          <Route path="tournaments/:tournamentSlug/scorecard" element={<LegacyTournamentRedirect suffix="/groups" />} />
          <Route path="tournaments/:tournamentSlug/raffle" element={<LegacyTournamentRedirect suffix="/raffle" />} />
          <Route path="tournaments/:tournamentSlug/sponsors" element={<LegacyTournamentRedirect suffix="/sponsors" />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </ClerkAuthBridgeProvider>
    </ClerkProvider>
  );
}
