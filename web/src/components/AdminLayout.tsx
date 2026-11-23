import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/react';
import {
  BadgeCheck,
  BarChart3,
  Building2,
  Calendar,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Clock,
  CreditCard,
  Flag,
  HandCoins,
  Home,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  Ticket,
  X,
} from 'lucide-react';
import { useOrganization } from './OrganizationProvider';
import { useTournament, useAdmin } from '../contexts';
import { adminEventPath, adminOrgRoutes, getAdminEventSection, getAdminEventSlug } from '../utils/adminRoutes';
import { useApplyBranding } from '../utils/branding';
import { isFeatureEnabled } from '../utils/features';

interface AdminLayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (pathname: string) => boolean;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { organization, accessibleOrganizations } = useOrganization();
  const { tournaments, currentTournament, setCurrentTournament, isLoading } = useTournament();
  const { isVolunteer, isSuperAdmin, isStationOnly, stationMode, orgRoleLabel, can } = useAdmin();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const showOrgSwitcher = accessibleOrganizations.length > 1 || (isSuperAdmin && accessibleOrganizations.length > 0);

  const handleOrganizationSelect = (orgSlugValue: string) => {
    const nextOrg = accessibleOrganizations.find((org) => org.slug === orgSlugValue);
    if (!nextOrg || nextOrg.slug === organization?.slug) return;

    navigate({
      pathname: isEventWorkspaceRoute ? adminOrgRoutes.dashboard : location.pathname,
      search: new URLSearchParams({ org: nextOrg.slug }).toString(),
    });
    setMobileMenuOpen(false);
  };

  const handleOpenPublicSite = () => {
    if (organization?.primary_host && window.location.hostname !== organization.primary_host) {
      window.open(`https://${organization.primary_host}`, '_blank', 'noopener,noreferrer');
      setMobileMenuOpen(false);
      return;
    }
    handleNavigate('/');
  };

  const routeTournamentSlug = getAdminEventSlug(location.pathname);
  const routeSection = getAdminEventSection(location.pathname) ?? 'overview';
  const isEventWorkspaceRoute = Boolean(routeTournamentSlug);

  const activeTournament = useMemo(() => {
    if (routeTournamentSlug) {
      return tournaments.find((tournament) => tournament.slug === routeTournamentSlug) ?? null;
    }

    return currentTournament;
  }, [currentTournament, routeTournamentSlug, tournaments]);

  const branding = useApplyBranding(organization, activeTournament);
  const organizationDisplayName = organization?.name || 'HafaGolf';

  useEffect(() => {
    if (!routeTournamentSlug || isLoading) return;
    if (activeTournament) {
      if (activeTournament.id !== currentTournament?.id) setCurrentTournament(activeTournament);
      return;
    }

    const fallbackTournament = currentTournament || tournaments[0] || null;
    if (!fallbackTournament) {
      navigate(adminOrgRoutes.events, { replace: true });
      return;
    }

    navigate(adminEventPath(fallbackTournament.slug, routeSection), { replace: true });
  }, [
    activeTournament,
    currentTournament,
    isLoading,
    navigate,
    routeSection,
    routeTournamentSlug,
    setCurrentTournament,
    tournaments,
  ]);

  const openTournaments = tournaments.filter((tournament) => tournament.status !== 'archived');
  const archivedTournaments = tournaments.filter((tournament) => tournament.status === 'archived');

  const orgSponsorsEnabled = isFeatureEnabled(organization?.features, 'sponsors', true);
  const eventFeatures = activeTournament?.features ?? organization?.features;
  const eventRaffleEnabled = isFeatureEnabled(eventFeatures, 'raffle', true);
  const eventSponsorsEnabled = isFeatureEnabled(eventFeatures, 'sponsors', true);
  const eventEmployeePricingEnabled = isFeatureEnabled(eventFeatures, 'employee_pricing', false);

  const allOrganizationNav: NavItem[] = [
    {
      label: 'Dashboard',
      path: adminOrgRoutes.dashboard,
      icon: LayoutDashboard,
      match: (pathname) => pathname === adminOrgRoutes.dashboard,
    },
    {
      label: 'Events',
      path: adminOrgRoutes.events,
      icon: Calendar,
      match: (pathname) => {
        if (pathname === adminOrgRoutes.events) return true;
        if (pathname === adminOrgRoutes.createEvent) return true;
        return pathname.startsWith('/admin/events/') && !isEventWorkspaceRoute;
      },
    },
    ...(orgSponsorsEnabled
      ? [
          {
            label: 'Sponsors',
            path: adminOrgRoutes.sponsors,
            icon: Building2,
            match: (pathname: string) => pathname === adminOrgRoutes.sponsors,
          },
        ]
      : []),
    {
      label: 'Activity Log',
      path: '/admin/activity',
      icon: Clock,
      match: (pathname) => pathname === '/admin/activity',
    },
    ...(isSuperAdmin
      ? [
          {
            label: 'Platform',
            path: '/admin/platform',
            icon: ShieldCheck,
            match: (pathname: string) => pathname === '/admin/platform' || pathname === '/admin/organizations',
          },
        ]
      : []),
    {
      label: 'Settings',
      path: adminOrgRoutes.settings,
      icon: Settings,
      match: (pathname) => pathname === adminOrgRoutes.settings || pathname.startsWith(`${adminOrgRoutes.settings}/`),
    },
  ];

  const organizationNav = useMemo(() => {
    if (isVolunteer) {
      return allOrganizationNav.filter((item) => item.label === 'Dashboard');
    }
    return allOrganizationNav.filter((item) => {
      if (item.label === 'Settings') return can('manage_settings');
      if (item.label === 'Sponsors') return can('manage_sponsors');
      if (item.label === 'Activity Log') return can('view_reports') || can('manage_settings') || can('manage_golfers');
      return true;
    });
  }, [allOrganizationNav, can, isVolunteer]);

  const allEventNav: NavItem[] = useMemo(
    () =>
      activeTournament
        ? [
            {
              label: 'Registrations',
              path: adminEventPath(activeTournament.slug),
              icon: ClipboardList,
              match: (pathname) => pathname === adminEventPath(activeTournament.slug) || routeSection === 'registrations',
            },
            {
              label: 'Payments',
              path: adminEventPath(activeTournament.slug, 'payments'),
              icon: CreditCard,
              match: () => routeSection === 'payments',
            },
            {
              label: 'Check-In',
              path: adminEventPath(activeTournament.slug, 'checkin'),
              icon: ShieldCheck,
              match: () => routeSection === 'checkin',
            },
            {
              label: 'Hole Assignment',
              path: adminEventPath(activeTournament.slug, 'groups'),
              icon: Flag,
              match: () => routeSection === 'groups',
            },
            {
              label: 'Scoring',
              path: adminEventPath(activeTournament.slug, 'scoring'),
              icon: ClipboardList,
              match: () => routeSection === 'scoring',
            },
            ...(eventRaffleEnabled
              ? [
                  {
                    label: 'Raffle',
                    path: adminEventPath(activeTournament.slug, 'raffle'),
                    icon: Ticket,
                    match: () => routeSection === 'raffle',
                  },
                ]
              : []),
            ...(eventSponsorsEnabled
              ? [
                  {
                    label: 'Sponsors',
                    path: adminEventPath(activeTournament.slug, 'sponsors'),
                    icon: HandCoins,
                    match: () => routeSection === 'sponsors',
                  },
                ]
              : []),
            ...(eventEmployeePricingEnabled
              ? [
                  {
                    label: 'Employee Numbers',
                    path: adminEventPath(activeTournament.slug, 'employee-numbers'),
                    icon: BadgeCheck,
                    match: () => routeSection === 'employee-numbers',
                  },
                ]
              : []),
            {
              label: 'Reports',
              path: adminEventPath(activeTournament.slug, 'reports'),
              icon: BarChart3,
              match: () => routeSection === 'reports',
            },
          ]
        : [],
    [activeTournament, eventEmployeePricingEnabled, eventRaffleEnabled, eventSponsorsEnabled, routeSection]
  );

  const eventNav = useMemo(() => {
    return allEventNav.filter((item) => {
      switch (item.label) {
        case 'Registrations':
        case 'Employee Numbers':
          return can('manage_golfers');
        case 'Payments':
        case 'Reports':
          return can('view_reports') || can('manage_finances');
        case 'Check-In':
          return can('check_in');
        case 'Hole Assignment':
          return can('manage_groups');
        case 'Scoring':
          return can('enter_scores');
        case 'Raffle':
          return can('raffle_sell') || can('raffle_draw') || can('manage_raffle_prizes');
        case 'Sponsors':
          return can('manage_sponsors');
        default:
          return true;
      }
    });
  }, [allEventNav, can]);

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  const handleTournamentSelect = (tournamentId: string) => {
    const nextTournament = tournaments.find((tournament) => tournament.id === Number(tournamentId));
    if (!nextTournament) return;

    if (isEventWorkspaceRoute || location.pathname === adminOrgRoutes.settings) {
      navigate(adminEventPath(nextTournament.slug, isEventWorkspaceRoute ? routeSection : 'settings'));
    } else {
      setCurrentTournament(nextTournament);
    }

    setMobileMenuOpen(false);
  };

  const renderNavSection = (title: string, items: NavItem[]) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-2">
        <p className="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">{title}</p>
        <div className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.match ? item.match(location.pathname) : location.pathname === item.path;

            return (
              <button
                key={item.path}
                onClick={() => handleNavigate(item.path)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-all ${
                  isActive
                    ? 'bg-brand-600 text-brand-foreground shadow-sm'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (isStationOnly) {
    const stationTabs = activeTournament
      ? [
          ...(can('check_in') ? [{ key: 'checkin', label: 'Check-In', path: adminEventPath(activeTournament.slug, 'checkin') }] : []),
          ...(can('raffle_sell') && eventRaffleEnabled
            ? [{ key: 'raffle', label: 'Raffle', path: adminEventPath(activeTournament.slug, 'raffle') }]
            : []),
          ...(can('enter_scores')
            ? [{ key: 'scoring', label: 'Scoring', path: adminEventPath(activeTournament.slug, 'scoring') }]
            : []),
        ]
      : [];
    const canSwitchDesks = stationTabs.length > 1;
    const stationTitle =
      stationMode === 'raffle'
        ? 'Raffle POS Station'
        : stationMode === 'scoring'
        ? 'Scoring Station'
        : 'Check-In Station';

    return (
      <div data-static-flow data-admin-ui data-testid="volunteer-station-shell" className="min-h-screen bg-neutral-100">
        <header
          data-testid="volunteer-station-bar"
          className="sticky top-0 z-40 border-b border-brand-800/15 bg-brand-600 text-brand-foreground shadow-sm"
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={organizationDisplayName}
                  className="h-9 w-9 shrink-0 rounded-xl bg-white/10 object-contain p-1"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <Flag className="h-4 w-4 text-brand-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">
                    {activeTournament?.name || organizationDisplayName}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    <ShieldCheck className="h-3 w-3" />
                    {orgRoleLabel || stationTitle}
                  </span>
                </div>
                <p className="truncate text-[11px] text-brand-200">{organizationDisplayName} · {stationTitle}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {openTournaments.length > 1 && (
                <select
                  value={activeTournament?.id ?? ''}
                  aria-label="Choose event"
                  onChange={(event) => handleTournamentSelect(event.target.value)}
                  className="hidden max-w-[200px] rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium text-white outline-none sm:block"
                >
                  {openTournaments.map((t) => (
                    <option key={t.id} value={t.id} className="text-neutral-900">
                      {t.short_name}
                    </option>
                  ))}
                </select>
              )}

              {canSwitchDesks && (
                <div className="inline-flex rounded-xl bg-white/10 p-0.5 text-xs font-semibold">
                  {stationTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleNavigate(tab.path)}
                      className={`rounded-lg px-2.5 py-1.5 transition ${
                        routeSection === tab.key ? 'bg-white text-brand-700' : 'text-white/90 hover:bg-white/10'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              <UserButton />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
      </div>
    );
  }

  return (
    <div data-static-flow data-admin-ui className="min-h-screen bg-neutral-100">
      <header className="sticky top-0 z-40 border-b border-brand-800/10 bg-brand-600 text-brand-foreground shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex rounded-xl p-2 text-brand-foreground/90 transition hover:bg-white/10 lg:hidden"
              aria-label="Toggle admin navigation"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <button
              onClick={() => navigate(adminOrgRoutes.dashboard)}
              className="flex items-center gap-3 text-left transition hover:opacity-90"
            >
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={organizationDisplayName}
                  className="h-10 w-10 rounded-xl bg-white/10 object-contain p-1.5"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                  <Flag className="h-5 w-5 text-brand-foreground" />
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-200">{organizationDisplayName}</p>
                <h1 className="text-base font-semibold tracking-tight lg:text-lg">Admin Console</h1>
              </div>
            </button>
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-center lg:flex">
            <div className="flex min-w-[320px] max-w-[440px] items-center gap-3 rounded-2xl bg-white/10 px-4 py-2.5">
              <Calendar className="h-4 w-4 text-brand-200" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-brand-200">Current event</p>
                <select
                  value={activeTournament?.id ?? ''}
                  aria-label="Choose event"
                  onChange={(event) => handleTournamentSelect(event.target.value)}
                  className="w-full bg-transparent text-sm font-medium text-white outline-none"
                >
                  {isLoading ? (
                    <option value="">Loading events...</option>
                  ) : openTournaments.length > 0 ? (
                    <>
                      {openTournaments.map((tournament) => (
                        <option key={tournament.id} value={tournament.id} className="text-neutral-900">
                          {tournament.short_name}
                        </option>
                      ))}
                      {archivedTournaments.map((tournament) => (
                        <option key={tournament.id} value={tournament.id} className="text-neutral-900">
                          {tournament.short_name} (Archived)
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value="">No events yet</option>
                  )}
                </select>
              </div>
              {activeTournament && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium capitalize text-white/90">
                  {activeTournament.status.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenPublicSite}
              className="hidden items-center gap-2 rounded-xl px-3 py-2 text-sm text-brand-100 transition hover:bg-white/10 lg:inline-flex"
            >
              <Home className="h-4 w-4" />
              Public site
            </button>
            {user && (
              <div className="hidden text-right lg:block">
                <p className="max-w-[180px] truncate text-sm font-medium text-white">
                  {user.firstName || user.emailAddresses[0]?.emailAddress}
                </p>
                <p className="text-xs text-brand-200">
                  {isVolunteer ? 'Volunteer' : organization?.name || 'Organization admin'}
                </p>
              </div>
            )}
            <UserButton
              appearance={{
                elements: {
                  avatarBox: 'h-9 w-9',
                },
              }}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-4 lg:px-6 lg:py-6">
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileMenuOpen(false)} />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 w-[88vw] max-w-sm transform border-r border-neutral-200 bg-white px-4 py-4 shadow-xl transition-all duration-200 overflow-y-auto lg:sticky lg:top-[73px] lg:z-auto lg:max-w-none lg:translate-x-0 lg:rounded-3xl lg:border lg:shadow-sm lg:overflow-visible lg:self-start ${
            sidebarCollapsed ? 'lg:w-16 lg:px-2' : 'lg:w-72'
          } ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          {/* Mobile header */}
          <div className="flex items-center justify-between border-b border-neutral-200 pb-4 lg:hidden">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Admin navigation</p>
              <p className="text-sm font-medium text-neutral-900">{organizationDisplayName}</p>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-xl p-2 text-neutral-500 transition hover:bg-neutral-100"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Desktop collapse toggle */}
          <div className={`hidden lg:flex mb-2 ${sidebarCollapsed ? 'justify-center' : 'justify-end'}`}>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </button>
          </div>

          {/* Public site link - mobile only */}
          <button
            onClick={handleOpenPublicSite}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-brand-50 px-3 py-3 text-left text-sm text-brand-700 transition hover:bg-brand-100 lg:hidden"
          >
            <Home className="h-5 w-5" />
            <span className="font-medium">Public site</span>
          </button>

          {sidebarCollapsed ? (
            /* Collapsed view: icons only */
            <div className="hidden lg:block space-y-2 mt-2">
              {[...organizationNav, ...eventNav].map((item) => {
                const Icon = item.icon;
                const isActive = item.match ? item.match(location.pathname) : location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavigate(item.path)}
                    className={`flex w-full items-center justify-center rounded-2xl p-3 transition-all ${
                      isActive
                        ? 'bg-brand-600 text-brand-foreground shadow-sm'
                        : 'text-neutral-700 hover:bg-neutral-100'
                    }`}
                    title={item.label}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
          ) : (
            /* Expanded view: full sidebar */
            <div className="mt-4 space-y-6 lg:mt-0">
              {showOrgSwitcher && (
                <div className="rounded-3xl border border-neutral-200 bg-neutral-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>Organization</span>
                  </div>
                  <div className="mt-2">
                    <select
                      aria-label="Active organization"
                      value={organization?.slug ?? ''}
                      onChange={(event) => handleOrganizationSelect(event.target.value)}
                      className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium text-neutral-900 shadow-sm outline-none transition focus:border-brand-400"
                    >
                      {accessibleOrganizations.map((org) => (
                        <option key={org.id} value={org.slug}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="rounded-3xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Current event</p>
                <p className="mt-1 text-sm font-semibold text-neutral-900">
                  {activeTournament?.name || 'Select an event'}
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  {activeTournament
                    ? 'Use the event workspace below to manage registrations, payments, check-in, sponsors, and raffle operations.'
                    : 'Create your first event to unlock the event workspace.'}
                </p>
                <div className="mt-3">
                  <select
                    value={activeTournament?.id ?? ''}
                    aria-label="Choose event"
                    onChange={(event) => handleTournamentSelect(event.target.value)}
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-brand-400"
                  >
                    <option value="">{isLoading ? 'Loading events...' : 'Select event'}</option>
                    {openTournaments.map((tournament) => (
                      <option key={tournament.id} value={tournament.id}>
                        {tournament.short_name}
                      </option>
                    ))}
                    {archivedTournaments.map((tournament) => (
                      <option key={tournament.id} value={tournament.id}>
                        {tournament.short_name} (Archived)
                      </option>
                    ))}
                  </select>
                </div>
                {activeTournament && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium capitalize text-brand-700">
                      {activeTournament.status.replace('_', ' ')}
                    </span>
                    {activeTournament.max_capacity ? (
                      <span className="rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600">
                        {activeTournament.confirmed_count ?? 0} / {activeTournament.max_capacity} teams
                      </span>
                    ) : (
                      <span className="rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600">
                        {activeTournament.paid_count ?? activeTournament.confirmed_count ?? 0} confirmed
                      </span>
                    )}
                  </div>
                )}
              </div>

              {renderNavSection('Organization', organizationNav)}
              {renderNavSection('Current event', eventNav)}
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-x-clip">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur lg:hidden">
        {(() => {
          const mobileItems = organizationNav.filter((item) => item.label !== 'Activity Log');
          const gridColsClass =
            mobileItems.length <= 1
              ? 'grid-cols-1'
              : mobileItems.length === 2
              ? 'grid-cols-2'
              : mobileItems.length === 3
              ? 'grid-cols-3'
              : mobileItems.length === 4
              ? 'grid-cols-4'
              : 'grid-cols-5';
          return (
            <div className={`grid h-16 ${gridColsClass}`}>
              {mobileItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.match ? item.match(location.pathname) : location.pathname === item.path;

                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavigate(item.path)}
                    className={`flex flex-col items-center justify-center gap-1 text-[11px] transition ${
                      isActive ? 'text-brand-600' : 'text-neutral-500'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
      </nav>
    </div>
  );
};
