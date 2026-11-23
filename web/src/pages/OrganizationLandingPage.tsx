import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useOrganization } from '../components/OrganizationProvider';
import { PublicHero } from '../components/PublicHero';
import { PublicSponsors } from '../components/PublicSponsors';
import { RevealOnScroll } from '../components/RevealOnScroll';
import { SignedInAdminBar } from '../components/SignedInAdminBar';
import { ActionButton, StatusPill, type StatusTone } from '../components/ui/PublicPrimitives';
import { api, Tournament } from '../services/api';
import {
  Calendar,
  MapPin,
  Users,
  Trophy,
  Mail,
  Phone,
  Globe,
  Flag,
  DollarSign,
} from 'lucide-react';
import { getPublicFacingCapacitySummary, getRegistrationStatusLabel } from '../utils/capacity';
import { useApplyBranding } from '../utils/branding';
import type { ThemePackDefinition } from '../utils/themePacks';
import { getDefaultOrgSlug } from '../utils/tenant';
import { formatEventDate } from '../utils/dates';
import { formatEntryFeeDisplay } from '../utils/teamRegistration';
import {
  isDarkHeroSurface,
  resolveHeroLogo,
  resolveHomepageConfig,
} from '../utils/homepageConfig';

export function OrganizationLandingPage() {
  const { organization, isLoading: orgLoading } = useOrganization();
  const navigate = useNavigate();
  const location = useLocation();
  const orgSlug = organization?.slug || (!orgLoading ? getDefaultOrgSlug() : '');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [featuredSponsors, setFeaturedSponsors] = useState<Tournament | null>(null);
  const featuredTournament =
    tournaments.find((t) => t.status === 'open' || t.status === 'in_progress') || tournaments[0];
  const featuredThemePreset = featuredTournament?.theme_preset;
  const sponsorEventSlug =
    organization?.show_homepage_sponsors && featuredTournament?.show_public_sponsors !== false
      ? featuredTournament?.slug
      : null;

  const homepageConfig = useMemo(
    () => resolveHomepageConfig(organization?.homepage_config, featuredTournament?.homepage_config, featuredThemePreset),
    [organization?.homepage_config, featuredTournament?.homepage_config, featuredThemePreset]
  );

  const forceHubView = useMemo(
    () => new URLSearchParams(location.search).get('view') === 'hub',
    [location.search]
  );

  useEffect(() => {
    if (orgLoading || isLoading || forceHubView) return;
    if (homepageConfig.landing_mode === 'direct_to_active_event' && featuredTournament?.slug) {
      const search = location.search || '';
      navigate(`/${featuredTournament.slug}${search}`, { replace: true });
    }
  }, [
    orgLoading,
    isLoading,
    forceHubView,
    homepageConfig.landing_mode,
    featuredTournament?.slug,
    location.search,
    navigate,
  ]);

  useEffect(() => {
    if (!orgSlug || !sponsorEventSlug) return;
    let cancelled = false;

    api
      .getOrganizationTournament(orgSlug, sponsorEventSlug)
      .then((event) => {
        if (!cancelled) setFeaturedSponsors(event);
      })
      .catch(() => {
        if (!cancelled) setFeaturedSponsors(null);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, sponsorEventSlug]);

  const featuredTournamentBranding = useMemo(
    () => (featuredThemePreset ? { theme_preset: featuredThemePreset, use_org_branding: true } : null),
    [featuredThemePreset]
  );

  const branding = useApplyBranding(organization, featuredTournamentBranding);
  const pack = branding.themePack;

  useEffect(() => {
    document.title = organization?.name ? `${organization.name} — Events` : 'HafaGolf — Events';
  }, [organization?.name]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgSlug) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchTournaments() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.getOrganizationTournaments(orgSlug);
        if (!cancelled) setTournaments(data);
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load tournaments';
          console.error('Failed to fetch tournaments:', err);
          setError(message);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchTournaments();
    return () => {
      cancelled = true;
    };
  }, [orgLoading, orgSlug]);

  if (
    orgLoading ||
    isLoading ||
    (!forceHubView && homepageConfig.landing_mode === 'direct_to_active_event' && featuredTournament?.slug)
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-600/20 border-t-brand-600 mx-auto" />
          <p className="mt-5 text-sm text-neutral-500 tracking-wide uppercase">Loading</p>
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-6">
          <Flag className="w-12 h-12 text-neutral-300 mx-auto mb-6" strokeWidth={1.5} />
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Organization Not Found</h1>
          <p className="mt-3 text-neutral-500 leading-relaxed">
            The requested organization does not exist or may have been removed.
          </p>
        </div>
      </div>
    );
  }

  const isDarkHero = isDarkHeroSurface(homepageConfig.hero_surface);
  const heroLogo = resolveHeroLogo({
    logoDisplay: homepageConfig.logo_display,
    isDarkSurface: isDarkHero,
    logoUrl: branding.logoUrl,
    organizationLogoUrl: branding.organizationLogoUrl,
    reversedLogoUrl: branding.reversedLogoUrl,
  });

  // Org landing hero stays clean gradient or light wash unless scenic full_bleed_bg is explicitly chosen
  const orgImageDisplay =
    homepageConfig.artwork_display === 'full_bleed_bg' || homepageConfig.hero_surface === 'photo_scrim'
      ? 'background'
      : 'none';

  return (
    <div
      className={`min-h-screen ${pack.surfaces.pageClass}`}
      data-theme-pack={pack.id}
      data-homepage-archetype={homepageConfig.archetype}
    >
      <SignedInAdminBar dashboardPath="/admin" />

      <PublicHero
        imageUrl={orgImageDisplay === 'background' ? branding.bannerUrl : null}
        imageAlt={`${organization.name} header artwork`}
        imageDisplay={orgImageDisplay}
        heroSurface={homepageConfig.hero_surface}
        artworkDisplay={homepageConfig.artwork_display}
        containerClassName="min-h-[260px] lg:min-h-[320px]"
        contentClassName={pack.hero.contentWrapperClass}
        themePack={pack}
      >
        <RevealOnScroll
          variant={pack.signatureMotion.variant}
          distancePx={pack.signatureMotion.distancePx}
          durationMs={pack.signatureMotion.durationMs}
        >
          <div className="mb-5">
            {heroLogo.url ? (
              <div
                className={`inline-flex items-center justify-center ${
                  isDarkHero && heroLogo.kind === 'standard'
                    ? 'rounded-xl bg-white/95 px-3 py-2 shadow-sm'
                    : pack.hero.variant === 'crest' && isDarkHero
                    ? 'rounded-xl border-2 border-accent-400/75 bg-white/10 p-1.5'
                    : ''
                }`}
              >
                <img
                  src={heroLogo.url}
                  alt={organization.name}
                  className="h-12 w-auto max-w-[14rem] object-contain sm:h-14"
                />
              </div>
            ) : (
              <div
                className={
                  isDarkHero
                    ? pack.hero.logoFrameClass
                    : 'inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600/10 text-brand-700'
                }
              >
                <Flag className="h-6 w-6" />
              </div>
            )}
          </div>

          <div
            className={`mb-4 ${isDarkHero ? pack.hero.accentRuleClass : 'h-0.5 w-16 rounded-full bg-[#b38928]'}`}
          />

          <h1
            className={
              isDarkHero
                ? pack.typography.heroTitleClass
                : 'font-theme-heading text-3xl font-bold tracking-tight text-[#1e3553] sm:text-4xl lg:text-5xl'
            }
          >
            {organization.name}
          </h1>

          {(organization.settings?.homepage_tagline || organization.description) && (
            <p
              className={
                isDarkHero
                  ? pack.typography.heroSubtitleClass
                  : 'mt-3 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg'
              }
            >
              {organization.settings?.homepage_tagline || organization.description}
            </p>
          )}

          {organization.settings?.homepage_mission && (
            <p
              className={`mt-4 max-w-2xl text-base leading-relaxed sm:text-lg ${
                isDarkHero ? 'text-white/80' : 'text-slate-600'
              }`}
            >
              {organization.settings.homepage_mission}
            </p>
          )}

          {organization.settings?.homepage_stats && organization.settings.homepage_stats.length > 0 && (
            <div
              className={`mt-8 flex flex-wrap gap-x-8 gap-y-5 pt-7 ${
                isDarkHero ? pack.hero.statsDividerClass : 'border-t border-slate-200'
              }`}
            >
              {organization.settings.homepage_stats.map((stat: { value: string; label: string }, i: number) => (
                <div key={i}>
                  <div className={`text-2xl font-bold ${isDarkHero ? 'text-white' : 'text-[#1e3553]'}`}>
                    {stat.value}
                  </div>
                  <div className={`text-sm ${isDarkHero ? 'text-white/75' : 'text-slate-500'}`}>{stat.label}</div>
                </div>
              ))}
            </div>
          )}
        </RevealOnScroll>
      </PublicHero>

      <main className="mx-auto max-w-5xl px-6 py-16 lg:px-8 lg:py-20">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600/10">
            <Trophy className="h-5 w-5 text-brand-600" />
          </div>
          <div>
            <h2 className={pack.typography.sectionTitleClass}>Upcoming Events</h2>
            <p className="text-sm text-neutral-500">Register for {organization.name} events</p>
          </div>
        </div>

        {error && (
          <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {tournaments.length === 0 ? (
          <div className={`py-20 text-center ${pack.surfaces.cardClass}`}>
            <Flag className="mx-auto mb-5 h-10 w-10 text-brand-600" strokeWidth={1.5} />
            <p className="font-medium text-neutral-600">No tournaments available at this time.</p>
            <p className="mt-2 text-sm text-neutral-400">Check back soon for upcoming events.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {tournaments.map((tournament) => (
              <TournamentCard key={tournament.id} tournament={tournament} pack={pack} />
            ))}
          </div>
        )}
      </main>

      {sponsorEventSlug &&
        featuredSponsors?.slug === sponsorEventSlug &&
        featuredSponsors.organization_slug === orgSlug && (
          <PublicSponsors tournament={featuredSponsors} pack={pack} featuredOnly />
        )}

      {(organization.contact_email || organization.contact_phone || organization.website_url) && (
        <section className={pack.surfaces.mutedSectionClass}>
          <div className="mx-auto max-w-5xl px-6 py-16 lg:px-8 lg:py-20">
            <h3 className={`${pack.typography.cardTitleClass} mb-8`}>Get in Touch</h3>

            <div className="grid gap-4 sm:grid-cols-3">
              {organization.contact_email && (
                <a
                  href={`mailto:${organization.contact_email}`}
                  className={`group flex items-start gap-4 p-5 ${pack.surfaces.cardClass}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600/10">
                    <Mail className="h-5 w-5 text-brand-600" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400">Email</p>
                    <p className="truncate text-sm text-neutral-700 transition-colors group-hover:text-neutral-900">
                      {organization.contact_email}
                    </p>
                  </div>
                </a>
              )}
              {organization.contact_phone && (
                <a
                  href={`tel:${organization.contact_phone}`}
                  className={`group flex items-start gap-4 p-5 ${pack.surfaces.cardClass}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600/10">
                    <Phone className="h-5 w-5 text-brand-600" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400">Phone</p>
                    <p className="text-sm text-neutral-700 transition-colors group-hover:text-neutral-900">
                      {organization.contact_phone}
                    </p>
                  </div>
                </a>
              )}
              {organization.website_url && (
                <a
                  href={organization.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group flex items-start gap-4 p-5 ${pack.surfaces.cardClass}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600/10">
                    <Globe className="h-5 w-5 text-brand-600" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400">Website</p>
                    <p className="truncate text-sm text-neutral-700 transition-colors group-hover:text-neutral-900">
                      {organization.website_url.replace(/^https?:\/\//, '')}
                    </p>
                  </div>
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8 text-sm text-neutral-400 lg:px-8">
          <p>
            Powered by <span className="font-medium text-neutral-600">Shimizu Technology</span>
          </p>
          <div className="flex items-center gap-4">
            {organization.settings?.homepage_tagline && (
              <p className="hidden sm:block">{organization.settings.homepage_tagline}</p>
            )}
            <Link to="/admin" className="text-xs text-neutral-400 transition-colors hover:text-neutral-600">
              Admin
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

interface TournamentCardProps {
  tournament: Tournament;
  pack: ThemePackDefinition;
}

function getSmartStatus(tournament: Tournament): { label: string; tone: StatusTone } {
  if (tournament.status === 'in_progress') return { label: 'In Progress', tone: 'in_progress' };
  if (tournament.status === 'completed') return { label: 'Completed', tone: 'closed' };
  if (tournament.status === 'archived') return { label: 'Archived', tone: 'closed' };
  if (tournament.status === 'draft') return { label: 'Coming Soon', tone: 'coming_soon' };
  if (!tournament.registration_open) return { label: 'Registration Closed', tone: 'closed' };
  const statusLabel = getRegistrationStatusLabel(tournament);
  if (statusLabel === 'Waitlist Open') return { label: 'Waitlist Open', tone: 'waitlist' };
  if (statusLabel === 'At Capacity') return { label: 'At Capacity', tone: 'closed' };
  if (statusLabel === 'Public Registration Full') return { label: 'Public Registration Full', tone: 'closed' };
  return { label: 'Registration Open', tone: 'open' };
}

function TournamentCard({ tournament, pack }: TournamentCardProps) {
  const status = getSmartStatus(tournament);
  const capacitySummary = getPublicFacingCapacitySummary(tournament);
  const isWaitlist = Boolean((tournament.at_capacity || tournament.public_at_capacity) && tournament.waitlist_enabled);

  return (
    <div className={`${pack.surfaces.cardClass} overflow-hidden`}>
      <div className={pack.surfaces.cardAccentBarClass} />
      <div className={pack.surfaces.cardHeaderSpacingClass}>
        <div className="mb-5">
          <StatusPill label={status.label} tone={status.tone} className="mb-3" />
          <h3 className={pack.typography.cardTitleClass}>{tournament.name}</h3>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
          {tournament.event_date && (
            <Detail icon={Calendar} label="Date" value={formatEventDate(tournament.event_date)} />
          )}
          {tournament.location_name && (
            <Detail icon={MapPin} label="Location" value={tournament.location_name} />
          )}
          {tournament.format_name && (
            <Detail icon={Flag} label="Format" value={tournament.format_name} />
          )}
          <Detail icon={DollarSign} label="Entry Fee" value={formatEntryFeeDisplay(tournament)} />
        </div>

        {capacitySummary.percent != null && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-500">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                {capacitySummary.label}
              </span>
              <span>{capacitySummary.percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${capacitySummary.percent}%` }} />
            </div>
            {capacitySummary.secondaryLabel && (
              <p className="mt-1.5 text-xs text-neutral-400">{capacitySummary.secondaryLabel}</p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          {tournament.can_register ? (
            <>
              <ActionButton
                to={`/${tournament.slug}/register`}
                pack={pack}
                variant={isWaitlist ? 'amber' : 'primary'}
                className="w-full sm:w-auto"
              >
                {isWaitlist ? 'Join Waitlist' : 'Register Now'}
              </ActionButton>
              <ActionButton
                to={`/${tournament.slug}`}
                pack={pack}
                variant="secondary"
                showArrow={false}
                className="w-full sm:w-auto"
              >
                View Details
              </ActionButton>
            </>
          ) : (
            <ActionButton
              to={`/${tournament.slug}`}
              pack={pack}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              View Details
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string; style?: React.CSSProperties }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" strokeWidth={1.5} />
      <div>
        <p className="mb-1 text-xs uppercase leading-none tracking-wider text-neutral-400">{label}</p>
        <p className="font-medium text-neutral-700">{value}</p>
      </div>
    </div>
  );
}
