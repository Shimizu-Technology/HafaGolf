import React, { useEffect, useMemo, useRef } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react';
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
import { SuperAdminDashboard } from '../pages/SuperAdminDashboard';
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
  return <TournamentProvider orgSlug={organization?.slug}>{children}</TournamentProvider>;
}

function AdminShellPage({ children }: { children: React.ReactNode }) {
  const [searchParams] = useSearchParams();
  const requestedOrgSlug = searchParams.get('org') || undefined;

  return (
    <AdminProvider>
      <ProtectedRoute>
        <OrganizationProvider mode="admin" orgSlug={requestedOrgSlug} fallbackPath="">
          <AdminTournamentShell>
            <AdminLayout>{children}</AdminLayout>
          </AdminTournamentShell>
        </OrganizationProvider>
      </ProtectedRoute>
    </AdminProvider>
  );
}

function LegacyTournamentRedirect({ suffix = '' }: { suffix?: string }) {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  return <Navigate to={tournamentSlug ? `/admin/events/${tournamentSlug}${suffix}` : '/admin/events'} replace />;
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
          <Route index element={<AdminShellPage><OrgAdminDashboard /></AdminShellPage>} />
          <Route path="organizations" element={<AdminShellPage><AdminOnlyRoute><SuperAdminDashboard /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events" element={<AdminShellPage><AdminOnlyRoute><EventsManagementPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/new" element={<AdminShellPage><AdminOnlyRoute><CreateTournamentPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug" element={<AdminShellPage><AdminOnlyRoute><OrgTournamentAdmin /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug/registrations" element={<AdminShellPage><AdminOnlyRoute><OrgTournamentAdmin /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug/payments" element={<AdminShellPage><AdminOnlyRoute><PaymentReconciliationPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug/checkin" element={<AdminShellPage><OrgCheckInPage /></AdminShellPage>} />
          <Route path="events/:tournamentSlug/groups" element={<AdminShellPage><AdminOnlyRoute><GroupManagementPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug/raffle" element={<AdminShellPage><RaffleManagementPage /></AdminShellPage>} />
          <Route path="events/:tournamentSlug/sponsors" element={<AdminShellPage><AdminOnlyRoute><SponsorManagementPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug/employee-numbers" element={<AdminShellPage><AdminOnlyRoute><EmployeeNumbersPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug/settings" element={<AdminShellPage><AdminOnlyRoute><OrgSettingsPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="events/:tournamentSlug/reports" element={<AdminShellPage><AdminOnlyRoute><ReportsPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="sponsors" element={<AdminShellPage><AdminOnlyRoute><SponsorsOverviewPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="settings" element={<AdminShellPage><AdminOnlyRoute><OrgSettingsPage /></AdminOnlyRoute></AdminShellPage>} />
          <Route path="activity" element={<AdminShellPage><AdminOnlyRoute><ActivityLogPage /></AdminOnlyRoute></AdminShellPage>} />

          <Route path="tournaments/new" element={<Navigate to="/admin/events/new" replace />} />
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
