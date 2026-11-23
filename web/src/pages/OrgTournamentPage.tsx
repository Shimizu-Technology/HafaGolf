import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOrganization } from '../components/OrganizationProvider';
import { PublicTournamentHero } from '../components/PublicHero';
import { CharityStoryStrip } from '../components/themes/CharityStoryStrip';
import { PublicSponsors } from '../components/PublicSponsors';
import { ActionButton, ActionCard, StatusPill, type StatusTone } from '../components/ui/PublicPrimitives';
import { api, Tournament } from '../services/api';
import {
  Calendar,
  MapPin,
  Users,
  DollarSign,
  Clock,
  Trophy,
  AlertCircle,
  Check,
  Flag,
  Gift,
  Ticket,
  Award,
  Heart,
  Phone,
  Mail,
} from 'lucide-react';
import { formatDate, formatEventDate } from '../utils/dates';
import { SignedInAdminBar } from '../components/SignedInAdminBar';
import { getPublicFacingCapacitySummary, getRegistrationStatusLabel } from '../utils/capacity';
import { resolvePublicImageUrl, useApplyBranding } from '../utils/branding';
import { getDefaultOrgSlug } from '../utils/tenant';
import { formatEntryFeeDisplay } from '../utils/teamRegistration';
import {
  isDarkHeroSurface,
  resolveHomepageConfig,
  type HomepageSectionKey,
} from '../utils/homepageConfig';

function getTournamentStatus(tournament: Tournament): { label: string; tone: StatusTone } {
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

function splitFeeIncludes(feeIncludes?: string | null): string[] {
  if (!feeIncludes) return [];
  return feeIncludes
    .split(/[•·,\n]+/)
    .map((item) => item.replace(/^and\s+/i, '').trim())
    .filter(Boolean);
}

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
          <div className="mt-6">
            <ActionButton to="/" variant="primary" pack={pack} showArrow={false}>
              Back to Tournaments
            </ActionButton>
          </div>
        </div>
      </div>
    );
  }

  const homepageConfig = resolveHomepageConfig(
    organization?.homepage_config,
    tournament.homepage_config,
    tournament.theme_preset
  );
  const status = getTournamentStatus(tournament);
  const capacitySummary = getPublicFacingCapacitySummary(tournament);
  const isCeremonial = homepageConfig.archetype === 'ceremonial-light';
  const isCrest = homepageConfig.archetype === 'varsity-crest' || pack.id === 'crest-classic';
  const isDarkHero = isDarkHeroSurface(homepageConfig.hero_surface);
  const isWaitlistOnly = Boolean((tournament.at_capacity || tournament.public_at_capacity) && tournament.waitlist_enabled);
  const canJoinFoursome = isCrest && tournament.team_size === 4 && tournament.can_register && !isWaitlistOnly;
  const registrationHref = `/${tournamentSlug}/register`;
  const sponsorHref = `/${orgSlug}/tournaments/${tournament.slug}/sponsor`;
  const donateHref = `/${orgSlug}/tournaments/${tournament.slug}/donate`;
  const raffleHref = `/${tournamentSlug}/raffle`;

  const registerCtaLabel = isWaitlistOnly
    ? 'Join Waitlist'
    : isCrest && tournament.team_size === 4
    ? 'Register a Foursome'
    : 'Register Now';

  const heroActions = (
    <>
      {tournament.can_register && !isCeremonial && (
        <ActionButton
          to={registrationHref}
          pack={pack}
          variant={isWaitlistOnly ? 'amber' : isDarkHero ? 'on-dark-primary' : 'primary'}
        >
          {registerCtaLabel}
        </ActionButton>
      )}
      {tournament.raffle_enabled && !isCeremonial && (
        <ActionButton
          to={raffleHref}
          pack={pack}
          variant={isDarkHero ? 'on-dark-secondary' : 'secondary'}
        >
          View Raffle Board
        </ActionButton>
      )}
    </>
  );

  const hasHeroAction = Boolean((tournament.can_register || tournament.raffle_enabled) && !isCeremonial);

  const actionCardItems: ReactNode[] = [];
  if (canJoinFoursome) {
    actionCardItems.push(
      <ActionCard
        key="foursome"
        to={registrationHref}
        pack={pack}
        icon={Users}
        iconTone="brand"
        title="Enter a Foursome"
        description="Reserve four places and register your team together."
        ctaLabel="Register a Foursome"
      />
    );
  }
  if (tournament.raffle_enabled) {
    actionCardItems.push(
      <ActionCard
        key="raffle"
        to={raffleHref}
        pack={pack}
        icon={Gift}
        iconTone="accent"
        title="Raffle Prizes"
        description={tournament.raffle_description || 'View prizes, draw schedule, and check your tickets.'}
        ctaLabel="View Raffle Board"
        ctaIcon={Ticket}
      />
    );
  }
  if (tournament.features?.sponsor_checkout) {
    actionCardItems.push(
      <ActionCard
        key="sponsor"
        to={sponsorHref}
        pack={pack}
        icon={Award}
        iconTone="brand"
        title="Become a Sponsor"
        description="View sponsorship tiers, included player slots, and reserve your package online."
        ctaLabel="View Sponsor Tiers"
      />
    );
  }
  if (tournament.features?.donations) {
    actionCardItems.push(
      <ActionCard
        key="donate"
        to={donateHref}
        pack={pack}
        icon={Heart}
        iconTone="accent"
        title="Make a Donation"
        description="Can't play this year? Support the cause directly with an online donation."
        ctaLabel="Donate Now"
      />
    );
  }

  const feeIncludeItems = splitFeeIncludes(tournament.fee_includes);
  const contactName = tournament.contact_name || organization?.name;
  const contactPhone = tournament.contact_phone || organization?.contact_phone;
  const contactEmail = tournament.contact_email || organization?.contact_email;

  const renderSection = (key: HomepageSectionKey): ReactNode => {
    switch (key) {
      case 'key_stats_bar':
        return (
          <div key={key} className={pack.surfaces.keyStatsBarClass}>
            <div className="mx-auto max-w-5xl px-6 py-4 lg:px-8">
              <div className="flex flex-col flex-wrap items-start gap-3 text-sm sm:flex-row sm:items-center sm:gap-8">
                {tournament.event_date && (
                  <div className="flex items-center gap-2 text-neutral-600">
                    <Calendar className="h-4 w-4 text-brand-600" strokeWidth={1.5} />
                    <span>{formatEventDate(tournament.event_date)}</span>
                  </div>
                )}
                {tournament.location_name && (
                  <div className="flex items-center gap-2 text-neutral-600">
                    <MapPin className="h-4 w-4 text-brand-600" strokeWidth={1.5} />
                    <span>{tournament.location_name}</span>
                  </div>
                )}
                {tournament.format_name && (
                  <div className="flex items-center gap-2 text-neutral-600">
                    <Flag className="h-4 w-4 text-brand-600" strokeWidth={1.5} />
                    <span>{tournament.format_name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-neutral-600">
                  <DollarSign className="h-4 w-4 text-brand-600" strokeWidth={1.5} />
                  <span>{formatEntryFeeDisplay(tournament)}</span>
                </div>
                {capacitySummary.label && (
                  <div className="flex items-center gap-2 text-neutral-600">
                    <Users className="h-4 w-4 text-brand-600" strokeWidth={1.5} />
                    <span>{capacitySummary.label}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'story_strip':
        return tournament.story_photos && tournament.story_photos.length > 0 ? (
          <CharityStoryStrip key={key} photos={tournament.story_photos} />
        ) : null;

      case 'action_cards':
        return actionCardItems.length > 0 ? (
          <section key={key} className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8" aria-labelledby="fundraising-actions">
            <h2 id="fundraising-actions" className={`mb-5 ${pack.typography.sectionTitleClass}`}>
              {isCrest ? 'Play & Support' : 'Support the Cause'}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{actionCardItems}</div>
          </section>
        ) : null;

      case 'sponsor_wall':
        return <PublicSponsors key={key} tournament={tournament} pack={pack} />;

      case 'raffle_spotlight':
        return tournament.raffle_enabled && isCeremonial ? (
          <section key={key} className="mx-auto max-w-4xl px-4 pb-8 sm:px-6">
            <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-brand-200 bg-brand-50/70 p-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600/12 text-brand-700">
                  <Ticket className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Tournament Raffle</h2>
                  <p className="text-sm text-slate-600">
                    {tournament.raffle_description || 'Browse raffle prizes and check your ticket status.'}
                  </p>
                </div>
              </div>
              <ActionButton to={raffleHref} pack={pack} variant="primary">
                View Raffle Board
              </ActionButton>
            </div>
          </section>
        ) : null;

      case 'event_details_card':
        if (isCeremonial) {
          return (
            <main key={key} className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
              <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_12px_36px_rgba(15,34,61,0.08)]">
                <div className="bg-[#23416e] px-6 py-3.5 text-center">
                  <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white">Event Details</h2>
                </div>

                <div className="p-6 sm:p-8">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200/80 bg-[#f7fafd] p-4">
                      <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-[#1e3553]">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1e3553] text-white">
                          <Calendar className="h-3.5 w-3.5" />
                        </span>
                        Date
                      </div>
                      <p className="font-semibold text-slate-900">{formatEventDate(tournament.event_date) || 'Date TBA'}</p>
                      {(tournament.check_in_time || tournament.registration_time) && (
                        <p className="mt-1.5 text-xs text-slate-600">
                          Showtime/Registration: {tournament.check_in_time || tournament.registration_time}
                        </p>
                      )}
                      {tournament.start_time && (
                        <p className="mt-1 text-xs text-slate-600">Shotgun Start: {tournament.start_time}</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200/80 bg-[#f7fafd] p-4">
                      <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-[#1e3553]">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1e3553] text-white">
                          <MapPin className="h-3.5 w-3.5" />
                        </span>
                        Location
                      </div>
                      <p className="font-semibold text-slate-900">{tournament.location_name || 'Venue TBA'}</p>
                      {tournament.location_address && (
                        <p className="mt-1.5 text-xs text-slate-600">{tournament.location_address}</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200/80 bg-[#f7fafd] p-4">
                      <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-[#1e3553]">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1e3553] text-white">
                          <Users className="h-3.5 w-3.5" />
                        </span>
                        Format
                      </div>
                      <p className="font-semibold text-slate-900">{tournament.format_name || 'Tournament Play'}</p>
                      {capacitySummary.label && (
                        <p className="mt-1.5 text-xs text-slate-600">{capacitySummary.label}</p>
                      )}
                    </div>
                  </div>

                  {/* Green-accent Entry Fee bar matching ceremonial reference */}
                  <div className="mt-5 flex flex-col justify-between gap-4 rounded-xl border border-emerald-200/90 border-l-4 border-l-emerald-600 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:px-5">
                    <div>
                      <p className="text-lg font-bold text-slate-900">
                        Entry Fee:{' '}
                        <span className="text-emerald-700">{formatEntryFeeDisplay(tournament)}</span>
                      </p>
                      {feeIncludeItems.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-700">
                          {feeIncludeItems.map((item) => (
                            <span key={item} className="inline-flex items-center gap-1">
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {(tournament.checks_payable_to || tournament.tournament_info) && (
                      <div className="text-xs text-slate-600 sm:text-right">
                        {tournament.checks_payable_to && (
                          <p>
                            Make checks payable to:{' '}
                            <strong className="font-semibold text-slate-800">{tournament.checks_payable_to}</strong>
                          </p>
                        )}
                        {tournament.registration_deadline && (
                          <p className="mt-1">Deadline: {formatDate(tournament.registration_deadline)}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {tournament.tournament_info && (
                    <p className="mt-4 text-center text-sm leading-relaxed text-slate-600 whitespace-pre-line">
                      {tournament.tournament_info}
                    </p>
                  )}

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {tournament.can_register ? (
                      <ActionButton
                        to={registrationHref}
                        pack={pack}
                        variant={isWaitlistOnly ? 'amber' : 'primary'}
                        className="min-w-[190px]"
                      >
                        {registerCtaLabel}
                      </ActionButton>
                    ) : (
                      <span className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-neutral-100 px-6 text-sm font-semibold text-neutral-500">
                        {status.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </main>
          );
        }

        // Standard 2-column Event Details + Registration Sidebar
        return (
          <main key={key} className="mx-auto max-w-5xl px-6 py-12 sm:py-16 lg:px-8">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className={`${pack.surfaces.cardClass} overflow-hidden`}>
                  <div className={pack.surfaces.cardAccentBarClass} />
                  <div className={pack.surfaces.cardHeaderSpacingClass}>
                    <h2 className={`${pack.typography.cardTitleClass} mb-6`}>Tournament Details</h2>

                    <div className="space-y-5">
                      {tournament.location_name && (
                        <div className="flex items-start gap-3">
                          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" strokeWidth={1.5} />
                          <div>
                            <p className="font-medium text-neutral-900">{tournament.location_name}</p>
                            {tournament.location_address && (
                              <p className="text-sm text-neutral-500">{tournament.location_address}</p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" strokeWidth={1.5} />
                        <div>
                          <p className="font-medium text-neutral-900">{formatEventDate(tournament.event_date) || 'Date TBA'}</p>
                          {(tournament.check_in_time || tournament.registration_time) && (
                            <p className="text-sm text-neutral-500">
                              Check-in: {tournament.check_in_time || tournament.registration_time}
                            </p>
                          )}
                          {tournament.start_time && (
                            <p className="text-sm text-neutral-500">Start: {tournament.start_time}</p>
                          )}
                        </div>
                      </div>

                      {tournament.format_name && (
                        <div className="flex items-start gap-3">
                          <Trophy className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" strokeWidth={1.5} />
                          <div>
                            <p className="font-medium text-neutral-900">Format: {tournament.format_name}</p>
                            {tournament.tournament_format && (
                              <p className="text-sm capitalize text-neutral-500">
                                {tournament.tournament_format.replace('_', ' ')}
                                {tournament.team_size && tournament.team_size > 1 && ` (${tournament.team_size}-person teams)`}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {tournament.fee_includes && (
                        <div className={`mt-6 ${pack.surfaces.insetBoxClass}`}>
                          <p className="mb-1 font-medium text-neutral-900">Entry Fee Includes:</p>
                          <p className="text-sm leading-relaxed text-neutral-600">{tournament.fee_includes}</p>
                        </div>
                      )}

                      {tournament.tournament_info && (
                        <div className={`mt-6 ${pack.surfaces.insetBoxClass}`}>
                          <p className="mb-1 font-medium text-neutral-900">Tournament Info</p>
                          <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-600">
                            {tournament.tournament_info}
                          </p>
                        </div>
                      )}

                      {(tournament.contact_name || tournament.contact_phone || tournament.contact_email) && (
                        <div className="mt-6 border-t border-neutral-100 pt-5">
                          {tournament.contact_name && (
                            <p className="font-medium text-neutral-900">{tournament.contact_name}</p>
                          )}
                          {tournament.contact_phone && (
                            <p className="text-sm text-neutral-500">{tournament.contact_phone}</p>
                          )}
                          {tournament.contact_email && (
                            <a href={`mailto:${tournament.contact_email}`} className="text-sm text-brand-600 hover:underline">
                              {tournament.contact_email}
                            </a>
                          )}
                        </div>
                      )}

                      {(tournament.event_schedule || tournament.check_in_time || tournament.start_time) && (
                        <div className={`mt-6 ${pack.surfaces.insetBoxClass}`}>
                          <div className="mb-3 flex items-center gap-2">
                            <Clock className="h-5 w-5 text-brand-600" strokeWidth={1.5} />
                            <p className="font-medium text-neutral-900">Event Schedule</p>
                          </div>
                          <ul className="space-y-1.5 text-sm text-neutral-600">
                            {tournament.event_schedule
                              ? tournament.event_schedule
                                  .split('\n')
                                  .filter(Boolean)
                                  .map((line: string, i: number) => <li key={i}>{line}</li>)
                              : (
                                <>
                                  {tournament.check_in_time && <li>{tournament.check_in_time} — Check-in</li>}
                                  {tournament.start_time && <li>{tournament.start_time}</li>}
                                </>
                              )}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className={`${pack.surfaces.cardClass} p-6`}>
                  <h3 className={`${pack.typography.cardTitleClass} mb-4 text-lg`}>Registration</h3>

                  <div className="mb-6 space-y-4">
                    <div className={pack.surfaces.insetBoxClass}>
                      <p className={pack.typography.eyebrowClass}>Entry Fee</p>
                      <p className="mt-2 break-words text-2xl font-bold tracking-tight text-neutral-900">
                        {formatEntryFeeDisplay(tournament)}
                      </p>
                    </div>

                    {tournament.early_bird_active && tournament.early_bird_deadline && (
                      <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 p-2.5 text-sm text-emerald-700">
                        <Check className="h-4 w-4" />
                        Early bird pricing active until {formatDate(tournament.early_bird_deadline)}
                      </div>
                    )}

                    <div className={pack.surfaces.insetBoxClass}>
                      <div className="flex items-center gap-2 text-neutral-500">
                        <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
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
                      <div className="text-sm text-amber-600">{tournament.waitlist_count} on waitlist</div>
                    )}
                  </div>

                  {tournament.can_register ? (
                    <ActionButton
                      to={registrationHref}
                      pack={pack}
                      variant={isWaitlistOnly ? 'amber' : 'primary'}
                      fullWidth
                    >
                      {registerCtaLabel}
                    </ActionButton>
                  ) : (
                    <div className="w-full cursor-not-allowed rounded-full bg-neutral-100 px-5 py-3 text-center text-sm font-semibold text-neutral-500">
                      {status.label}
                    </div>
                  )}

                  {tournament.registration_deadline && (
                    <p className="mt-3 text-center text-xs text-neutral-400">
                      Registration deadline: {formatDate(tournament.registration_deadline)}
                    </p>
                  )}
                </div>

                {(tournament.payment_instructions || tournament.allow_card || tournament.allow_cash || tournament.allow_check) && (
                  <div className={`${pack.surfaces.cardClass} p-6`}>
                    <h3 className={`${pack.typography.cardTitleClass} mb-4 text-lg`}>Payment Options</h3>
                    {tournament.payment_instructions ? (
                      <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-600">
                        {tournament.payment_instructions}
                      </p>
                    ) : (
                      <ul className="space-y-2.5 text-sm text-neutral-600">
                        {tournament.allow_card && (
                          <li className="flex items-center gap-2.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-600/10">
                              <Check className="h-3 w-3 text-brand-600" />
                            </div>
                            Credit/Debit Card
                          </li>
                        )}
                        {tournament.allow_cash && (
                          <li className="flex items-center gap-2.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-600/10">
                              <Check className="h-3 w-3 text-brand-600" />
                            </div>
                            Cash (on tournament day)
                          </li>
                        )}
                        {tournament.allow_check && (
                          <li className="flex items-center gap-2.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-600/10">
                              <Check className="h-3 w-3 text-brand-600" />
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
              </div>
            </div>
          </main>
        );

      case 'contact_bar':
        return contactName || contactPhone || contactEmail ? (
          <div key={key} className="mx-auto max-w-4xl px-4 pb-10 text-center sm:px-6">
            <div className="inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-600 shadow-xs">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-4 w-4 text-brand-700" />
                <span>For more information:</span>
                {contactName && <strong className="font-semibold text-slate-900">{contactName}</strong>}
              </span>
              {contactPhone && (
                <a href={`tel:${contactPhone}`} className="font-semibold text-[#b38928] hover:underline">
                  {contactPhone}
                </a>
              )}
              {contactEmail && (
                <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  <Mail className="h-3.5 w-3.5" />
                  {contactEmail}
                </a>
              )}
            </div>
          </div>
        ) : null;

      default:
        return null;
    }
  };

  const showBackLink = homepageConfig.landing_mode !== 'direct_to_active_event';

  return (
    <div
      className={`min-h-screen ${isCeremonial ? 'bg-[#f4f8fb] text-slate-900' : pack.surfaces.pageClass}`}
      data-theme-pack={pack.id}
      data-homepage-archetype={homepageConfig.archetype}
    >
      <SignedInAdminBar />

      <PublicTournamentHero
        pack={pack}
        homepageConfig={homepageConfig}
        title={tournament.name}
        organizerName={organization?.name}
        edition={tournament.edition}
        eventLine={[formatEventDate(tournament.event_date), tournament.location_name].filter(Boolean).join(' · ')}
        status={<StatusPill label={status.label} tone={status.tone} onDark={isDarkHero} />}
        action={hasHeroAction ? heroActions : undefined}
        showBackLink={showBackLink}
        backLinkTo={homepageConfig.landing_mode === 'direct_to_active_event' ? '/?view=hub' : '/'}
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

      {homepageConfig.sections
        .filter((section) => section.enabled)
        .map((section) => renderSection(section.key))}

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-neutral-400 sm:flex-row lg:px-8">
          <p>
            Powered by <span className="font-medium text-neutral-600">Shimizu Technology</span>
          </p>
          <div className="flex items-center gap-4">
            {organization?.settings?.homepage_tagline && (
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
