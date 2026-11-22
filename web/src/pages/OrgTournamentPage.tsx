import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOrganization } from '../components/OrganizationProvider';
import { PublicTournamentHero } from '../components/PublicHero';
import { CharityStoryStrip } from '../components/themes/CharityStoryStrip';
import { PublicSponsors } from '../components/PublicSponsors';
import { api, Tournament } from '../services/api';
import {
  Calendar, MapPin, Users, DollarSign, Clock,
  Trophy, AlertCircle, ChevronRight, Check, Flag, Gift, Ticket, Award, Heart
} from 'lucide-react';
import { formatDate, formatEventDate } from '../utils/dates';
import { SignedInAdminBar } from '../components/SignedInAdminBar';
import { getPublicFacingCapacitySummary, getRegistrationStatusLabel } from '../utils/capacity';
import { resolvePublicImageUrl, useApplyBranding } from '../utils/branding';
import { getDefaultOrgSlug } from '../utils/tenant';
import { formatEntryFeeDisplay } from '../utils/teamRegistration';

export function OrgTournamentPage() {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { organization, isLoading: orgLoading } = useOrganization();
  const orgSlug = organization?.slug || (!orgLoading ? getDefaultOrgSlug() : '');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const branding = useApplyBranding(organization, tournament);
  const pack = branding.themePack;

  useEffect(() => {
    if (orgLoading) return;
    if (!orgSlug || !tournamentSlug) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchTournament() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.getOrganizationTournament(orgSlug, tournamentSlug!);
        if (!cancelled) setTournament(data);
      } catch (err: unknown) {
        if (!cancelled) {
          console.error('Failed to fetch tournament:', err);
          setError(err instanceof Error ? err.message : 'Failed to load tournament');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchTournament();
    return () => {
      cancelled = true;
    };
  }, [orgLoading, orgSlug, tournamentSlug]);

  if (orgLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-600/20 border-t-brand-600 mx-auto" />
          <p className="mt-5 text-sm text-neutral-500 tracking-wide uppercase">Loading tournament</p>
        </div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-6">
          <AlertCircle className="w-12 h-12 text-neutral-300 mx-auto mb-6" strokeWidth={1.5} />
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Tournament Not Found</h1>
          <p className="mt-3 text-neutral-500 leading-relaxed">{error || 'The tournament does not exist.'}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 mt-6 px-6 py-2.5 text-sm font-semibold text-brand-foreground bg-brand-600 rounded-full transition-colors hover:bg-brand-700"
          >
            Back to Tournaments
          </Link>
        </div>
      </div>
    );
  }

  const getStatusBadge = () => {
    if (tournament.status === 'in_progress') return { label: 'In Progress', bg: 'bg-amber-100', text: 'text-amber-950' };
    if (tournament.status === 'completed') return { label: 'Completed', bg: 'bg-neutral-200', text: 'text-neutral-600' };
    if (tournament.status === 'archived') return { label: 'Archived', bg: 'bg-neutral-200', text: 'text-neutral-600' };
    if (tournament.status === 'draft') return { label: 'Coming Soon', bg: 'bg-brand-600', text: 'text-brand-foreground' };
    if (!tournament.registration_open) return { label: 'Registration Closed', bg: 'bg-neutral-200', text: 'text-neutral-600' };
    const statusLabel = getRegistrationStatusLabel(tournament);
    if (statusLabel === 'Waitlist Open') return { label: 'Waitlist Open', bg: 'bg-amber-100', text: 'text-amber-950' };
    if (statusLabel === 'At Capacity') return { label: 'At Capacity', bg: 'bg-neutral-200', text: 'text-neutral-600' };
    if (statusLabel === 'Public Registration Full') return { label: 'Public Registration Full', bg: 'bg-neutral-200', text: 'text-neutral-600' };
    return { label: 'Registration Open', bg: 'bg-accent-600', text: 'text-accent-foreground' };
  };

  const status = getStatusBadge();
  const capacitySummary = getPublicFacingCapacitySummary(tournament);
  const isCharity = pack.id === 'charity-bright';
  const isCrest = pack.id === 'crest-classic';
  const featuredActions = isCharity || isCrest;
  const canJoinFoursome = isCrest && tournament.team_size === 4 && tournament.can_register;
  const sponsorShowcase = <PublicSponsors tournament={tournament} pack={pack} />;
  const registrationHref = `/${tournamentSlug}/register`;

  const fundraisingCards = (
    <>
      {canJoinFoursome && (
        <Link to={registrationHref} className={`block ${pack.surfaces.cardClass} p-6`}>
          <Users className="mb-3 h-6 w-6 text-brand-700" aria-hidden="true" />
          <h3 className={`${pack.typography.cardTitleClass} mb-2`}>Enter a Foursome</h3>
          <p className="text-sm text-neutral-600">Reserve four places and register your team together.</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
            Register a Foursome <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>
      )}
      {/* Raffle CTA — only when raffle is enabled */}
      {tournament.raffle_enabled && (
        <Link
          to={`/${tournamentSlug}/raffle`}
          className={`block ${pack.surfaces.cardClass} p-6 group`}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-accent-500/10 flex items-center justify-center">
              <Gift className="w-5 h-5 text-accent-500" strokeWidth={1.5} />
            </div>
            <h3 className={`${pack.typography.cardTitleClass} text-lg`}>Raffle Prizes</h3>
          </div>
          {tournament.raffle_description ? (
            <p className="text-neutral-500 text-sm mb-4 line-clamp-2">{tournament.raffle_description}</p>
          ) : (
            <p className="text-neutral-500 text-sm mb-4">View prizes and check your tickets</p>
          )}
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 group-hover:text-brand-700 transition-colors">
            <Ticket className="w-4 h-4" strokeWidth={1.5} />
            View Raffle Board
            <ChevronRight className="w-4 h-4" />
          </span>
        </Link>
      )}

      {/* Sponsor Checkout CTA — only when sponsor_checkout feature is enabled */}
      {tournament.features?.sponsor_checkout && (
        <Link
          to={`/${orgSlug}/tournaments/${tournament.slug}/sponsor`}
          className={`block ${pack.surfaces.cardClass} p-6 group`}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600/10 flex items-center justify-center">
              <Award className="w-5 h-5 text-brand-600" strokeWidth={1.5} />
            </div>
            <h3 className={`${pack.typography.cardTitleClass} text-lg`}>Become a Sponsor</h3>
          </div>
          <p className="text-neutral-500 text-sm mb-4">
            View sponsorship tiers, included player slots, and reserve your package online.
          </p>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 group-hover:text-brand-700 transition-colors">
            View Sponsor Tiers
            <ChevronRight className="w-4 h-4" />
          </span>
        </Link>
      )}

      {/* Donations CTA — only when donations feature is enabled */}
      {tournament.features?.donations && (
        <Link
          to={`/${orgSlug}/tournaments/${tournament.slug}/donate`}
          className={`block ${pack.surfaces.cardClass} p-6 group`}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-accent-500/10 flex items-center justify-center">
              <Heart className="w-5 h-5 text-accent-600" strokeWidth={1.5} />
            </div>
            <h3 className={`${pack.typography.cardTitleClass} text-lg`}>Make a Donation</h3>
          </div>
          <p className="text-neutral-500 text-sm mb-4">
            Can&apos;t play this year? Support the cause directly with an online donation.
          </p>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 group-hover:text-brand-700 transition-colors">
            Donate Now
            <ChevronRight className="w-4 h-4" />
          </span>
        </Link>
      )}
    </>
  );

  return (
    <div className={`min-h-screen ${pack.surfaces.pageClass}`} data-theme-pack={pack.id}>
      <SignedInAdminBar />

      <PublicTournamentHero
        pack={pack}
        title={tournament.name}
        organizerName={organization?.name}
        edition={tournament.edition}
        eventLine={[formatEventDate(tournament.event_date), tournament.location_name].filter(Boolean).join(' · ')}
        status={<span className={`${pack.surfaces.badgeClass} py-1.5 text-sm ${status.bg} ${status.text}`}>{status.label}</span>}
        action={tournament.can_register && (
          <Link to={registrationHref} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-brand-foreground ring-1 ring-white/50 hover:bg-brand-700">
            {isCrest && tournament.team_size === 4 ? 'Register a Foursome' : 'Register to Play'}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
        logoUrl={resolvePublicImageUrl(branding.logoUrl)}
        organizationLogoUrl={branding.organizationLogoUrl}
        reversedLogoUrl={branding.reversedLogoUrl}
        photoUrl={branding.eventPhotoUrl}
        emblemUrl={branding.eventEmblemUrl}
        commemorativeBannerUrl={resolvePublicImageUrl(tournament.commemorative_banner_url)}
        tributeTitle={tournament.tribute_title}
        tributeSubtitle={tournament.tribute_subtitle}
        progress={capacitySummary}
      />

      {/* ================================================================= */}
      {/* KEY STATS BAR                                                      */}
      {/* ================================================================= */}
      <div className={pack.surfaces.keyStatsBarClass}>
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3 sm:gap-8 text-sm">
            {tournament.event_date && (
              <div className="flex items-center gap-2 text-neutral-600">
                <Calendar className="w-4 h-4 text-brand-600" strokeWidth={1.5} />
                <span>{formatEventDate(tournament.event_date)}</span>
              </div>
            )}
            {tournament.location_name && (
              <div className="flex items-center gap-2 text-neutral-600">
                <MapPin className="w-4 h-4 text-brand-600" strokeWidth={1.5} />
                <span>{tournament.location_name}</span>
              </div>
            )}
            {tournament.format_name && (
              <div className="flex items-center gap-2 text-neutral-600">
                <Flag className="w-4 h-4 text-brand-600" strokeWidth={1.5} />
                <span>{tournament.format_name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-neutral-600">
              <DollarSign className="w-4 h-4 text-brand-600" strokeWidth={1.5} />
              <span>{formatEntryFeeDisplay(tournament)}</span>
            </div>
            {capacitySummary.label && (
              <div className="flex items-center gap-2 text-neutral-600">
                <Users className="w-4 h-4 text-brand-600" strokeWidth={1.5} />
                <span>{capacitySummary.label}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {isCharity && <CharityStoryStrip photos={tournament.story_photos} />}

      {featuredActions && (canJoinFoursome || tournament.raffle_enabled || tournament.features?.sponsor_checkout || tournament.features?.donations) && (
        <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8" aria-labelledby="fundraising-actions">
          <h2 id="fundraising-actions" className={`mb-5 ${pack.typography.sectionTitleClass}`}>
            {isCrest ? 'Play & Support' : 'Support the Cause'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fundraisingCards}</div>
        </section>
      )}

      {isCharity && sponsorShowcase}

      {/* ================================================================= */}
      {/* MAIN CONTENT — Two columns (quiet, no scroll-reveal spam)         */}
      {/* ================================================================= */}
      <main className="max-w-5xl mx-auto px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Details Column */}
          <div className="lg:col-span-2">
            <div className={`${pack.surfaces.cardClass} overflow-hidden`}>
              <div className={pack.surfaces.cardAccentBarClass} />
              <div className={pack.surfaces.cardHeaderSpacingClass}>
                <h2 className={`${pack.typography.cardTitleClass} mb-6`}>Tournament Details</h2>

                <div className="space-y-5">
                  {tournament.location_name && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-5 h-5 mt-0.5 shrink-0 text-brand-600" strokeWidth={1.5} />
                      <div>
                        <p className="font-medium text-neutral-900">{tournament.location_name}</p>
                        {tournament.location_address && (
                          <p className="text-neutral-500 text-sm">{tournament.location_address}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 mt-0.5 shrink-0 text-brand-600" strokeWidth={1.5} />
                    <div>
                      <p className="font-medium text-neutral-900">{formatEventDate(tournament.event_date) || 'Date TBA'}</p>
                      {(tournament.check_in_time || tournament.registration_time) && (
                        <p className="text-neutral-500 text-sm">Check-in: {tournament.check_in_time || tournament.registration_time}</p>
                      )}
                      {tournament.start_time && (
                        <p className="text-neutral-500 text-sm">Start: {tournament.start_time}</p>
                      )}
                    </div>
                  </div>

                  {tournament.format_name && (
                    <div className="flex items-start gap-3">
                      <Trophy className="w-5 h-5 mt-0.5 shrink-0 text-brand-600" strokeWidth={1.5} />
                      <div>
                        <p className="font-medium text-neutral-900">Format: {tournament.format_name}</p>
                        {tournament.tournament_format && (
                          <p className="text-neutral-500 text-sm capitalize">
                            {tournament.tournament_format.replace('_', ' ')}
                            {tournament.team_size && tournament.team_size > 1 && ` (${tournament.team_size}-person teams)`}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {tournament.fee_includes && (
                    <div className={`mt-6 ${pack.surfaces.insetBoxClass}`}>
                      <p className="font-medium text-neutral-900 mb-1">Entry Fee Includes:</p>
                      <p className="text-neutral-600 text-sm leading-relaxed">{tournament.fee_includes}</p>
                    </div>
                  )}

                  {tournament.tournament_info && (
                    <div className={`mt-6 ${pack.surfaces.insetBoxClass}`}>
                      <p className="font-medium text-neutral-900 mb-1">Tournament Info</p>
                      <p className="text-neutral-600 text-sm leading-relaxed whitespace-pre-line">{tournament.tournament_info}</p>
                    </div>
                  )}

                  {(tournament.contact_name || tournament.contact_phone || tournament.contact_email) && (
                    <div className="mt-6 pt-5 border-t border-neutral-100">
                      {tournament.contact_name && (
                        <p className="font-medium text-neutral-900">{tournament.contact_name}</p>
                      )}
                      {tournament.contact_phone && (
                        <p className="text-neutral-500 text-sm">{tournament.contact_phone}</p>
                      )}
                      {tournament.contact_email && (
                        <a href={`mailto:${tournament.contact_email}`} className="text-brand-600 hover:underline text-sm">{tournament.contact_email}</a>
                      )}
                    </div>
                  )}

                  {(tournament.event_schedule || tournament.check_in_time || tournament.start_time) && (
                    <div className={`mt-6 ${pack.surfaces.insetBoxClass}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="w-5 h-5 text-brand-600" strokeWidth={1.5} />
                        <p className="font-medium text-neutral-900">Event Schedule</p>
                      </div>
                      <ul className="space-y-1.5 text-sm text-neutral-600">
                        {tournament.event_schedule
                          ? tournament.event_schedule.split('\n').filter(Boolean).map((line: string, i: number) => (
                              <li key={i}>{line}</li>
                            ))
                          : (
                            <>
                              {tournament.check_in_time && <li>{tournament.check_in_time} — Check-in</li>}
                              {tournament.start_time && <li>{tournament.start_time}</li>}
                            </>
                          )
                        }
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Registration CTA Card */}
            <div className={`${pack.surfaces.cardClass} p-6`}>
              <h3 className={`${pack.typography.cardTitleClass} mb-4 text-lg`}>Registration</h3>

              <div className="space-y-4 mb-6">
                <div className={pack.surfaces.insetBoxClass}>
                  <p className={pack.typography.eyebrowClass}>Entry Fee</p>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-neutral-900 break-words">
                    {formatEntryFeeDisplay(tournament)}
                  </p>
                </div>

                {tournament.early_bird_active && tournament.early_bird_deadline && (
                  <div className="text-sm p-2.5 rounded-xl bg-emerald-50 text-emerald-700 flex items-center gap-1.5">
                    <Check className="w-4 h-4" />
                    Early bird pricing active until {formatDate(tournament.early_bird_deadline)}
                  </div>
                )}

                <div className={pack.surfaces.insetBoxClass}>
                  <div className="flex items-center gap-2 text-neutral-500">
                    <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className={pack.typography.eyebrowClass}>Capacity</span>
                  </div>
                  <p className="mt-2 text-base font-semibold leading-tight text-neutral-800 sm:text-lg">
                    {capacitySummary.label}
                  </p>
                  {capacitySummary.secondaryLabel && (
                    <p className="mt-2 text-sm leading-relaxed text-neutral-500">
                      {capacitySummary.secondaryLabel}
                    </p>
                  )}
                </div>

                {tournament.waitlist_count > 0 && (
                  <div className="text-sm text-amber-600">
                    {tournament.waitlist_count} on waitlist
                  </div>
                )}
              </div>

              {tournament.can_register ? (
                (tournament.at_capacity || tournament.public_at_capacity) && tournament.waitlist_enabled ? (
                  <Link
                    to={`/${tournamentSlug}/register`}
                    className="flex items-center justify-center gap-2 w-full text-center px-5 py-3 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-full transition-colors duration-200"
                  >
                    Join Waitlist
                    <ChevronRight className="w-4 h-4" strokeWidth={2} />
                  </Link>
                ) : (
                  <Link
                    to={`/${tournamentSlug}/register`}
                    className={`${pack.surfaces.ctaPrimaryClass} w-full py-3 text-center`}
                  >
                    Register Now
                    <ChevronRight className="w-4 h-4" strokeWidth={2} />
                  </Link>
                )
              ) : tournament.at_capacity ? (
                <div className="w-full text-center px-5 py-3 text-sm font-semibold text-neutral-400 bg-neutral-100 rounded-full cursor-not-allowed">
                  At Capacity
                </div>
              ) : tournament.public_at_capacity ? (
                <div className="w-full text-center px-5 py-3 text-sm font-semibold text-neutral-400 bg-neutral-100 rounded-full cursor-not-allowed">
                  Public Registration Full
                </div>
              ) : !tournament.registration_open ? (
                <div className="w-full text-center px-5 py-3 text-sm font-semibold text-neutral-400 bg-neutral-100 rounded-full cursor-not-allowed">
                  Registration Closed
                </div>
              ) : (
                <div className="w-full text-center px-5 py-3 text-sm font-semibold text-neutral-400 bg-neutral-100 rounded-full cursor-not-allowed">
                  Registration Closed
                </div>
              )}

              {tournament.registration_deadline && (
                <p className="text-xs text-neutral-400 mt-3 text-center">
                  Registration deadline: {formatDate(tournament.registration_deadline)}
                </p>
              )}
            </div>

            {/* Payment Options */}
            {(tournament.payment_instructions || tournament.allow_card || tournament.allow_cash || tournament.allow_check) && (
              <div className={`${pack.surfaces.cardClass} p-6`}>
                <h3 className={`${pack.typography.cardTitleClass} mb-4 text-lg`}>Payment Options</h3>
                {tournament.payment_instructions ? (
                  <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-line">{tournament.payment_instructions}</p>
                ) : (
                  <ul className="space-y-2.5 text-sm text-neutral-600">
                    {tournament.allow_card && (
                      <li className="flex items-center gap-2.5">
                        <div className="w-5 h-5 rounded-md flex items-center justify-center bg-brand-600/10">
                          <Check className="w-3 h-3 text-brand-600" />
                        </div>
                        Credit/Debit Card
                      </li>
                    )}
                    {tournament.allow_cash && (
                      <li className="flex items-center gap-2.5">
                        <div className="w-5 h-5 rounded-md flex items-center justify-center bg-brand-600/10">
                          <Check className="w-3 h-3 text-brand-600" />
                        </div>
                        Cash (on tournament day)
                      </li>
                    )}
                    {tournament.allow_check && (
                      <li className="flex items-center gap-2.5">
                        <div className="w-5 h-5 rounded-md flex items-center justify-center bg-brand-600/10">
                          <Check className="w-3 h-3 text-brand-600" />
                        </div>
                        <span>
                          Check
                          {tournament.checks_payable_to && (
                            <span className="text-neutral-400"> (payable to {tournament.checks_payable_to})</span>
                          )}
                        </span>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}

            {!featuredActions && fundraisingCards}
          </div>
        </div>
      </main>

      {!isCharity && sponsorShowcase}

      {/* ================================================================= */}
      {/* FOOTER                                                             */}
      {/* ================================================================= */}
      <footer className="border-t border-neutral-200">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-neutral-400">
          <p>
            Powered by{' '}
            <span className="font-medium text-neutral-600">Shimizu Technology</span>
          </p>
          <div className="flex items-center gap-4">
            {organization?.settings?.homepage_tagline && (
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
