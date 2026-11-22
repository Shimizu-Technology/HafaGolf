import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Award,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  Loader2,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useOrganization } from '../components/OrganizationProvider';
import { PublicHero } from '../components/PublicHero';
import {
  api,
  PricedSponsorTier,
  SponsorTiersListResponse,
  Tournament,
} from '../services/api';
import { useApplyBranding } from '../utils/branding';
import { formatEventDate } from '../utils/dates';
import { getDefaultOrgSlug } from '../utils/tenant';

function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function SponsorCheckoutPage() {
  const { orgSlug: paramOrgSlug, tournamentSlug } = useParams<{
    orgSlug?: string;
    tournamentSlug?: string;
  }>();
  const [searchParams] = useSearchParams();
  const { organization, isLoading: orgLoading } = useOrganization();
  const orgSlug = paramOrgSlug || organization?.slug || (!orgLoading ? getDefaultOrgSlug() : '');

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [tiersData, setTiersData] = useState<SponsorTiersListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTier, setSelectedTier] = useState<PricedSponsorTier | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const checkoutState = searchParams.get('checkout');
  const branding = useApplyBranding(organization, tournament);
  const pack = branding.themePack;

  useEffect(() => {
    if (!paramOrgSlug && orgLoading) return;
    let cancelled = false;

    async function load() {
      if (!orgSlug) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setFeatureDisabled(false);

      try {
        let resolvedTournament: Tournament | null = null;
        if (tournamentSlug) {
          resolvedTournament = await api.getOrganizationTournament(orgSlug, tournamentSlug);
        } else {
          const list = await api.getOrganizationTournaments(orgSlug);
          resolvedTournament = list.find((t) => t.status === 'open') || list[0] || null;
        }

        if (cancelled) return;
        if (!resolvedTournament) {
          setError('No active tournament found for sponsorship checkout.');
          setLoading(false);
          return;
        }

        setTournament(resolvedTournament);

        if (resolvedTournament.features && resolvedTournament.features.sponsor_checkout === false) {
          setFeatureDisabled(true);
          setLoading(false);
          return;
        }

        try {
          const res = await api.getSponsorTiers(resolvedTournament.id);
          if (!cancelled) {
            setTiersData(res);
          }
        } catch (err) {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : 'Unable to load sponsorship tiers';
          if (message.toLowerCase().includes('disabled') || message.includes('403')) {
            setFeatureDisabled(true);
          } else {
            setError(message);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tournament');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [orgLoading, paramOrgSlug, orgSlug, tournamentSlug]);

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament || !selectedTier) return;

    setSubmitting(true);
    setCheckoutError(null);
    try {
      const res = await api.checkoutSponsorTier(tournament.id, selectedTier.id, {
        name: companyName.trim(),
        email: contactEmail.trim(),
        website_url: websiteUrl.trim() || undefined,
        description: description.trim() || undefined,
      });

      if (res.checkout_url) {
        window.location.href = res.checkout_url;
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to start sponsorship checkout');
    } finally {
      setSubmitting(false);
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" />
          <p className="mt-4 text-sm text-neutral-500">Loading sponsorship opportunities...</p>
        </div>
      </div>
    );
  }

  const backHref = tournament ? `/${tournament.slug}` : '/';

  if (featureDisabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <Award className="w-10 h-10 text-neutral-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-neutral-900">Sponsorship Checkout Unavailable</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Online sponsorship checkout is not currently enabled for this tournament.
          </p>
          <Link
            to={backHref}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-600 text-brand-foreground hover:bg-brand-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Tournament
          </Link>
        </div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <AlertCircle className="w-10 h-10 text-neutral-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-neutral-900">Unable to Load Sponsorships</h1>
          <p className="mt-2 text-sm text-neutral-600">{error || 'Tournament not found.'}</p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-600 text-brand-foreground hover:bg-brand-700 transition-colors"
          >
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  const tiers = tiersData?.sponsor_tiers || [];
  const isOfflineMode = tiersData?.payment_mode === 'offline';
  const taxEnabled = Boolean(tiersData?.tax_receipt_enabled);
  const fmvPerPlayer = tiersData?.fmv_per_player_cents ?? 0;

  return (
    <div className={`min-h-screen ${pack.surfaces.pageClass}`} data-theme-pack={pack.id}>
      <PublicHero
        imageUrl={branding.bannerUrl}
        imageAlt={`${tournament.name} sponsorship banner`}
        containerClassName="min-h-[220px]"
        contentClassName={pack.hero.contentWrapperClass}
        themePack={pack}
      >
        <div className="max-w-3xl">
          <Link
            to={backHref}
            className="inline-flex items-center gap-1 text-sm text-white/75 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to {tournament.name}
          </Link>
          <div className={`mt-4 ${pack.hero.accentRuleClass}`} />
          <h1 className={`mt-3 ${pack.typography.heroTitleClass}`}>Become a Sponsor</h1>
          <p className={pack.typography.heroSubtitleClass}>
            Support {organization?.name || tournament.name}
            {tournament.event_date ? ` · ${formatEventDate(tournament.event_date)}` : ''}
          </p>
        </div>
      </PublicHero>

      <main className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        {checkoutState === 'success' && (
          <div className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-900">
              <p className="font-semibold">Thank you for your sponsorship!</p>
              <p className="mt-1 text-emerald-800">
                Your payment is being confirmed. If your tier includes player slots, you will receive a
                Sponsor Portal access link at your contact email to enter your players.
              </p>
              <Link
                to="/sponsor-portal"
                className="mt-2 inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
              >
                Open Sponsor Portal
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}

        {checkoutState === 'cancelled' && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 flex items-start gap-3 text-sm text-amber-900">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Checkout was cancelled</p>
              <p className="mt-1 text-amber-800">
                No charge was made. Choose a sponsorship tier below whenever you are ready.
              </p>
            </div>
          </div>
        )}

        {isOfflineMode && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 flex items-start gap-3 text-sm text-amber-900">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Offline Sponsorship Reservations</p>
              <p className="mt-1 text-amber-800">
                Online checkout is not enabled for this organization. To reserve a sponsorship tier, please contact{' '}
                {tournament.contact_name || organization?.name || 'the tournament organizer'}
                {tournament.contact_email ? ` at ${tournament.contact_email}` : ''}
                {tournament.contact_phone ? ` (${tournament.contact_phone})` : ''}.
              </p>
            </div>
          </div>
        )}

        {tiers.length === 0 ? (
          <div className={`${pack.surfaces.cardClass} p-12 text-center`}>
            <Building2 className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-neutral-900">No Online Tiers Available Yet</h2>
            <p className="mt-2 text-sm text-neutral-500">
              Sponsorship packages for this event are being finalized. Please contact the organizer for details.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className={`${pack.surfaces.cardClass} flex flex-col justify-between overflow-hidden`}
              >
                <div>
                  <div className={pack.surfaces.cardAccentBarClass} />
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-lg font-bold text-neutral-900">{tier.label}</h2>
                      {tier.sold_out ? (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-neutral-200 text-neutral-600 shrink-0">
                          Sold Out
                        </span>
                      ) : tier.remaining_quantity !== null ? (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 shrink-0">
                          {tier.remaining_quantity} left
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-3 text-3xl font-bold tracking-tight text-brand-700">
                      {formatCurrency(tier.price_cents)}
                    </p>

                    {tier.included_player_slots > 0 && (
                      <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-brand-50 text-brand-700">
                        <Users className="w-3.5 h-3.5" />
                        Includes {tier.included_player_slots} player{' '}
                        {tier.included_player_slots === 1 ? 'slot' : 'slots'}
                      </div>
                    )}

                    {tier.description && (
                      <p className="mt-3 text-sm text-neutral-600 leading-relaxed">{tier.description}</p>
                    )}

                    {tier.benefits.length > 0 && (
                      <ul className="mt-5 space-y-2 text-sm text-neutral-700">
                        {tier.benefits.map((benefit, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <Check className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                            <span>{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="p-6 pt-0">
                  <button
                    type="button"
                    disabled={tier.sold_out || isOfflineMode}
                    onClick={() => {
                      setSelectedTier(tier);
                      setCheckoutError(null);
                    }}
                    className={`w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors ${
                      tier.sold_out || isOfflineMode
                        ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                        : 'bg-brand-600 text-brand-foreground hover:bg-brand-700'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    {tier.sold_out ? 'Sold Out' : isOfflineMode ? 'Contact Organizer to Sponsor' : 'Sponsor This Tier'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {selectedTier && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !submitting && setSelectedTier(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                  Sponsorship Checkout
                </p>
                <h2 className="text-xl font-bold text-neutral-900 mt-0.5">
                  {selectedTier.label} — {formatCurrency(selectedTier.price_cents)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setSelectedTier(null)}
                className="p-2 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {checkoutError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {checkoutError}
              </div>
            )}

            <form onSubmit={handleCheckoutSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Company or Sponsor Name *
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Island Builders"
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Contact Email *{' '}
                  <span className="text-xs font-normal text-neutral-400">
                    (used for receipt & Sponsor Portal access)
                  </span>
                </label>
                <input
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="sponsor@company.com"
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Website URL <span className="text-xs font-normal text-neutral-400">(optional)</span>
                </label>
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://company.com"
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Short Recognition Note{' '}
                  <span className="text-xs font-normal text-neutral-400">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional tagline or recognition message"
                  className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>

              {taxEnabled && selectedTier.price_cents > 7500 && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-xs text-neutral-600 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-800">
                    <ShieldCheck className="w-4 h-4 text-brand-600" />
                    IRS Quid-Pro-Quo Receipt Estimate
                  </div>
                  <p>
                    Estimated Fair Market Value (FMV):{' '}
                    <span className="font-medium text-neutral-900">
                      {formatCurrency(fmvPerPlayer * selectedTier.included_player_slots)}
                    </span>{' '}
                    · Estimated tax-deductible portion:{' '}
                    <span className="font-medium text-neutral-900">
                      {formatCurrency(
                        Math.max(selectedTier.price_cents - fmvPerPlayer * selectedTier.included_player_slots, 0)
                      )}
                    </span>
                    {tiersData?.tax_org_ein ? ` (EIN: ${tiersData.tax_org_ein})` : ''}.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setSelectedTier(null)}
                  className="px-4 py-2.5 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 text-brand-foreground text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Redirecting...
                    </>
                  ) : (
                    <>
                      Continue to Payment
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
