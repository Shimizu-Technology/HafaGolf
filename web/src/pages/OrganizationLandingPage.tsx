import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrganization } from '../components/OrganizationProvider';
import { PublicHero } from '../components/PublicHero';
import { PublicSponsors } from '../components/PublicSponsors';
import { RevealOnScroll } from '../components/RevealOnScroll';
import { SignedInAdminBar } from '../components/SignedInAdminBar';
import { api, Tournament } from '../services/api';
import {
  Calendar,
  MapPin,
  Users,
  Trophy,
  ChevronRight,
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function OrganizationLandingPage() {
  const { organization, isLoading: orgLoading } = useOrganization();
  const orgSlug = organization?.slug || (!orgLoading ? getDefaultOrgSlug() : '');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [featuredSponsors, setFeaturedSponsors] = useState<Tournament | null>(null);
  const featuredTournament = tournaments.find((t) => t.status === 'open') || tournaments[0];
  const featuredThemePreset = featuredTournament?.theme_preset;
  const sponsorEventSlug = organization?.show_homepage_sponsors && featuredTournament?.show_public_sponsors !== false
    ? featuredTournament?.slug
    : null;

  useEffect(() => {
    if (!orgSlug || !sponsorEventSlug) return;
    let cancelled = false;

    api.getOrganizationTournament(orgSlug, sponsorEventSlug)
      .then((event) => { if (!cancelled) setFeaturedSponsors(event); })
      .catch(() => { if (!cancelled) setFeaturedSponsors(null); });

    return () => { cancelled = true; };
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

  // Loading state
  if (orgLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-600/20 border-t-brand-600 mx-auto" />
          <p className="mt-5 text-sm text-neutral-500 tracking-wide uppercase">Loading</p>
        </div>
      </div>
    );
  }

  // Not found
  if (!organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-6">
          <Flag className="w-12 h-12 text-neutral-300 mx-auto mb-6" strokeWidth={1.5} />
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">
            Organization Not Found
          </h1>
          <p className="mt-3 text-neutral-500 leading-relaxed">
            The requested organization does not exist or may have been removed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${pack.surfaces.pageClass}`} data-theme-pack={pack.id}>
      <SignedInAdminBar dashboardPath="/admin" />

      {/* ================================================================= */}
      {/* HERO — Organization branded header (single signature moment)       */}
      {/* ================================================================= */}
      <PublicHero
        imageUrl={branding.bannerUrl}
        imageAlt={`${organization.name} header artwork`}
        containerClassName="min-h-[280px] lg:min-h-[360px]"
        contentClassName={pack.hero.contentWrapperClass}
        themePack={pack}
      >
        <RevealOnScroll
          variant={pack.signatureMotion.variant}
          distancePx={pack.signatureMotion.distancePx}
          durationMs={pack.signatureMotion.durationMs}
        >
          <div className="mb-6">
            {branding.logoUrl ? (
              <div className={`inline-flex items-center justify-center p-1.5 ${pack.hero.variant === 'crest' ? 'rounded-xl border-2 border-accent-400/75 bg-white/10' : ''}`}>
                <img
                  src={branding.logoUrl}
                  alt={organization.name}
                  className="h-12 w-auto rounded-lg object-contain"
                />
              </div>
            ) : (
              <div className={pack.hero.logoFrameClass}>
                <Flag className="h-6 w-6 text-brand-foreground" />
              </div>
            )}
          </div>

          <div className={`mb-4 ${pack.hero.accentRuleClass}`} />

          <h1 className={pack.typography.heroTitleClass}>
            {organization.name}
          </h1>

          {(organization.settings?.homepage_tagline || organization.description) && (
            <p className={pack.typography.heroSubtitleClass}>
              {organization.settings?.homepage_tagline || organization.description}
            </p>
          )}

          {organization.settings?.homepage_mission && (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
              {organization.settings.homepage_mission}
            </p>
          )}

          {organization.settings?.homepage_stats && organization.settings.homepage_stats.length > 0 && (
            <div className={`mt-8 flex flex-wrap gap-x-8 gap-y-5 pt-8 ${pack.hero.statsDividerClass}`}>
              {organization.settings.homepage_stats.map((stat: { value: string; label: string }, i: number) => (
                <div key={i}>
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="text-sm text-white/70">{stat.label}</div>
                </div>
              ))}
            </div>
          )}
        </RevealOnScroll>
      </PublicHero>

      {/* ================================================================= */}
      {/* UPCOMING EVENTS                                                    */}
      {/* ================================================================= */}
      <main className="max-w-5xl mx-auto px-6 lg:px-8 py-16 lg:py-24">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-brand-600/10 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h2 className={pack.typography.sectionTitleClass}>Upcoming Events</h2>
            <p className="text-sm text-neutral-500">Register for {organization.name} events</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-2xl mb-8 text-sm">
            {error}
          </div>
        )}

        {tournaments.length === 0 ? (
          <div className={`text-center py-20 ${pack.surfaces.cardClass}`}>
            <Flag className="w-10 h-10 text-brand-600 mx-auto mb-5" strokeWidth={1.5} />
            <p className="text-neutral-600 font-medium">No tournaments available at this time.</p>
            <p className="text-sm text-neutral-400 mt-2">Check back soon for upcoming events.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {tournaments.map((tournament) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                pack={pack}
              />
            ))}
          </div>
        )}
      </main>

      {sponsorEventSlug && featuredSponsors?.slug === sponsorEventSlug && featuredSponsors.organization_slug === orgSlug && (
        <PublicSponsors tournament={featuredSponsors} pack={pack} featuredOnly />
      )}

      {/* ================================================================= */}
      {/* CONTACT                                                            */}
      {/* ================================================================= */}
      {(organization.contact_email || organization.contact_phone || organization.website_url) && (
        <section className={pack.surfaces.mutedSectionClass}>
          <div className="max-w-5xl mx-auto px-6 lg:px-8 py-16 lg:py-24">
            <h3 className={`${pack.typography.cardTitleClass} mb-8`}>Get in Touch</h3>

            <div className="grid sm:grid-cols-3 gap-4">
              {organization.contact_email && (
                <a
                  href={`mailto:${organization.contact_email}`}
                  className={`group flex items-start gap-4 p-5 ${pack.surfaces.cardClass}`}
                >
                  <div className="shrink-0 w-10 h-10 rounded-full bg-brand-600/10 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-brand-600" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1">
                      Email
                    </p>
                    <p className="text-sm text-neutral-700 group-hover:text-neutral-900 truncate transition-colors">
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
                  <div className="shrink-0 w-10 h-10 rounded-full bg-brand-600/10 flex items-center justify-center">
                    <Phone className="w-5 h-5 text-brand-600" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1">
                      Phone
                    </p>
                    <p className="text-sm text-neutral-700 group-hover:text-neutral-900 transition-colors">
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
                  <div className="shrink-0 w-10 h-10 rounded-full bg-brand-600/10 flex items-center justify-center">
                    <Globe className="w-5 h-5 text-brand-600" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1">
                      Website
                    </p>
                    <p className="text-sm text-neutral-700 group-hover:text-neutral-900 truncate transition-colors">
                      {organization.website_url.replace(/^https?:\/\//, '')}
                    </p>
                  </div>
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* FOOTER                                                             */}
      {/* ================================================================= */}
      <footer className="border-t border-neutral-200">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-8 flex items-center justify-between text-sm text-neutral-400">
          <p>
            Powered by{' '}
            <span className="font-medium text-neutral-600">Shimizu Technology</span>
          </p>
          <div className="flex items-center gap-4">
            {organization.settings?.homepage_tagline && (
              <p className="hidden sm:block">{organization.settings.homepage_tagline}</p>
            )}
            <Link to="/admin" className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors">
              Admin
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tournament card
// ---------------------------------------------------------------------------

interface TournamentCardProps {
  tournament: Tournament;
  pack: ThemePackDefinition;
}

function getSmartStatus(tournament: TournamentCardProps['tournament']) {
  if (tournament.status === 'in_progress') return { label: 'In Progress', bg: 'bg-amber-500', text: 'text-white' };
  if (tournament.status === 'completed') return { label: 'Completed', bg: 'bg-neutral-200', text: 'text-neutral-600' };
  if (tournament.status === 'archived') return { label: 'Archived', bg: 'bg-neutral-200', text: 'text-neutral-600' };
  if (tournament.status === 'draft') return { label: 'Coming Soon', bg: 'bg-brand-600', text: 'text-brand-foreground' };
  if (!tournament.registration_open) return { label: 'Registration Closed', bg: 'bg-neutral-200', text: 'text-neutral-600' };
  const statusLabel = getRegistrationStatusLabel(tournament);
  if (statusLabel === 'Waitlist Open') return { label: 'Waitlist Open', bg: 'bg-amber-500', text: 'text-white' };
  if (statusLabel === 'At Capacity') return { label: 'At Capacity', bg: 'bg-neutral-200', text: 'text-neutral-600' };
  if (statusLabel === 'Public Registration Full') return { label: 'Public Registration Full', bg: 'bg-neutral-200', text: 'text-neutral-600' };
  return { label: 'Registration Open', bg: 'bg-brand-600', text: 'text-brand-foreground' };
}

function TournamentCard({ tournament, pack }: TournamentCardProps) {
  const status = getSmartStatus(tournament);
  const capacitySummary = getPublicFacingCapacitySummary(tournament);

  return (
    <div className={`${pack.surfaces.cardClass} overflow-hidden`}>
      <div className={pack.surfaces.cardAccentBarClass} />
      <div className={pack.surfaces.cardHeaderSpacingClass}>
        {/* Top row: status badge + name */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <span className={`${pack.surfaces.badgeClass} mb-3 ${status.bg} ${status.text}`}>
              {status.label}
            </span>
            <h3 className={pack.typography.cardTitleClass}>
              {tournament.name}
            </h3>
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 gap-x-6 text-sm">
          {tournament.event_date && (
            <Detail icon={Calendar} label="Date" value={formatEventDate(tournament.event_date)} />
          )}
          {tournament.location_name && (
            <Detail icon={MapPin} label="Location" value={tournament.location_name} />
          )}
          {tournament.format_name && (
            <Detail icon={Flag} label="Format" value={tournament.format_name} />
          )}
          <Detail
            icon={DollarSign}
            label="Entry Fee"
            value={formatEntryFeeDisplay(tournament)}
          />
        </div>

        {/* Capacity bar */}
        {capacitySummary.percent != null && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-neutral-500 mb-1.5">
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
                {capacitySummary.label}
              </span>
              <span>{capacitySummary.percent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${capacitySummary.percent}%` }}
              />
            </div>
            {capacitySummary.secondaryLabel && (
              <p className="mt-1.5 text-xs text-neutral-400">{capacitySummary.secondaryLabel}</p>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {tournament.can_register ? (
            <>
              {(tournament.at_capacity || tournament.public_at_capacity) && tournament.waitlist_enabled ? (
                <Link
                  to={`/${tournament.slug}/register`}
                  className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm rounded-full px-6 py-2.5 transition-colors duration-200 w-full sm:w-auto min-h-[44px]"
                >
                  Join Waitlist
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </Link>
              ) : (
                <Link
                  to={`/${tournament.slug}/register`}
                  className={`${pack.surfaces.ctaPrimaryClass} w-full sm:w-auto min-h-[44px]`}
                >
                  Register Now
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </Link>
              )}
              <Link
                to={`/${tournament.slug}`}
                className={`${pack.surfaces.ctaSecondaryClass} w-full sm:w-auto min-h-[44px]`}
              >
                View Details
              </Link>
            </>
          ) : (
            <Link
              to={`/${tournament.slug}`}
              className={`${pack.surfaces.ctaSecondaryClass} w-full sm:w-auto min-h-[44px]`}
            >
              View Details
              <ChevronRight className="w-4 h-4" strokeWidth={2} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail row helper
// ---------------------------------------------------------------------------

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
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-brand-600" strokeWidth={1.5} />
      <div>
        <p className="text-xs text-neutral-400 uppercase tracking-wider leading-none mb-1">{label}</p>
        <p className="text-neutral-700 font-medium">{value}</p>
      </div>
    </div>
  );
}
