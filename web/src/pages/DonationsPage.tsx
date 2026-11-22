import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  DollarSign,
  Heart,
  Loader2,
  MessageSquareHeart,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useOrganization } from '../components/OrganizationProvider';
import { PublicHero } from '../components/PublicHero';
import { api, DonationSummaryResponse, Tournament } from '../services/api';
import { useApplyBranding } from '../utils/branding';
import { formatDate, formatEventDate } from '../utils/dates';
import { getDefaultOrgSlug } from '../utils/tenant';

const PRESET_AMOUNTS_CENTS = [2500, 5000, 10000, 25000, 50000];

function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function DonationsPage() {
  const { orgSlug: paramOrgSlug, tournamentSlug } = useParams<{
    orgSlug?: string;
    tournamentSlug?: string;
  }>();
  const [searchParams] = useSearchParams();
  const { organization, isLoading: orgLoading } = useOrganization();
  const orgSlug = paramOrgSlug || organization?.slug || getDefaultOrgSlug();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [summary, setSummary] = useState<DonationSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPresetCents, setSelectedPresetCents] = useState<number | null>(10000);
  const [customDollars, setCustomDollars] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorPhone, setDonorPhone] = useState('');
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const checkoutState = searchParams.get('checkout');
  const branding = useApplyBranding(organization, tournament);
  const pack = branding.themePack;

  const loadData = useCallback(async () => {
    if (!orgSlug) return;
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

      if (!resolvedTournament) {
        setError('No active tournament found for donations.');
        setLoading(false);
        return;
      }

      setTournament(resolvedTournament);

      if (resolvedTournament.features && resolvedTournament.features.donations === false) {
        setFeatureDisabled(true);
        setLoading(false);
        return;
      }

      try {
        const res = await api.getDonationsSummary(resolvedTournament.id);
        setSummary(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to load donations';
        if (msg.toLowerCase().includes('disabled') || msg.includes('403')) {
          setFeatureDisabled(true);
        } else {
          setError(msg);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tournament');
    } finally {
      setLoading(false);
    }
  }, [orgSlug, tournamentSlug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const effectiveAmountCents =
    selectedPresetCents !== null
      ? selectedPresetCents
      : Math.round((Number.parseFloat(customDollars) || 0) * 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament) return;

    if (!donorName.trim()) {
      setSubmitError('Please enter your name.');
      return;
    }
    if (effectiveAmountCents < 100) {
      setSubmitError('Please choose or enter a donation of at least $1.00.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.checkoutDonation(tournament.id, {
        donor_name: donorName.trim(),
        donor_email: donorEmail.trim() || undefined,
        donor_phone: donorPhone.trim() || undefined,
        amount_cents: effectiveAmountCents,
        anonymous,
        message: message.trim() || undefined,
      });

      if (res.checkout_url) {
        window.location.href = res.checkout_url;
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to start donation checkout');
    } finally {
      setSubmitting(false);
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" />
          <p className="mt-4 text-sm text-neutral-500">Loading donations...</p>
        </div>
      </div>
    );
  }

  const backHref = tournament ? `/${tournament.slug}` : '/';

  if (featureDisabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <Heart className="w-10 h-10 text-neutral-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-neutral-900">Donations Unavailable</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Online donations are not currently enabled for this event.
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

  if (error || !tournament || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <AlertCircle className="w-10 h-10 text-neutral-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-neutral-900">Unable to Load Donations</h1>
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

  return (
    <div className={`min-h-screen ${pack.surfaces.pageClass}`} data-theme-pack={pack.id}>
      <PublicHero
        imageUrl={branding.bannerUrl}
        imageAlt={`${tournament.name} donations banner`}
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
          <h1 className={`mt-3 ${pack.typography.heroTitleClass}`}>Support the Cause</h1>
          <p className={pack.typography.heroSubtitleClass}>
            Make a direct donation to {organization?.name || tournament.name}
            {tournament.event_date ? ` · ${formatEventDate(tournament.event_date)}` : ''}
          </p>
        </div>
      </PublicHero>

      <main className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        {checkoutState === 'success' && (
          <div className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-900">
              <p className="font-semibold">Thank you for your generous donation!</p>
              <p className="mt-1 text-emerald-800">
                Your contribution is being processed and will appear on the donor wall shortly.
              </p>
            </div>
          </div>
        )}

        {checkoutState === 'cancelled' && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 flex items-start gap-3 text-sm text-amber-900">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Donation checkout cancelled</p>
              <p className="mt-1 text-amber-800">No charge was made. You can try again below.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Donation Form */}
          <div className="lg:col-span-3">
            <div className={`${pack.surfaces.cardClass} overflow-hidden`}>
              <div className={pack.surfaces.cardAccentBarClass} />
              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-2.5 mb-6">
                  <div className="w-9 h-9 rounded-xl bg-brand-600/10 flex items-center justify-center">
                    <Heart className="w-5 h-5 text-brand-600" />
                  </div>
                  <h2 className="text-xl font-bold text-neutral-900">Make a Donation</h2>
                </div>

                {submitError && (
                  <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {submitError}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Select an Amount
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                      {PRESET_AMOUNTS_CENTS.map((cents) => {
                        const active = selectedPresetCents === cents;
                        return (
                          <button
                            key={cents}
                            type="button"
                            onClick={() => {
                              setSelectedPresetCents(cents);
                              setCustomDollars('');
                            }}
                            className={`py-2.5 px-3 rounded-xl text-sm font-semibold border transition-colors ${
                              active
                                ? 'bg-brand-600 text-brand-foreground border-brand-600'
                                : 'bg-white text-neutral-700 border-neutral-200 hover:border-brand-400'
                            }`}
                          >
                            {formatCurrency(cents)}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 relative">
                      <DollarSign className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={customDollars}
                        onChange={(e) => {
                          setCustomDollars(e.target.value);
                          setSelectedPresetCents(null);
                        }}
                        placeholder="Or enter a custom amount (e.g. 75.00)"
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-neutral-300 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Your Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={donorName}
                      onChange={(e) => setDonorName(e.target.value)}
                      placeholder="Full name or family name"
                      className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 mb-1">
                        Email <span className="text-xs font-normal text-neutral-400">(for receipt)</span>
                      </label>
                      <input
                        type="email"
                        value={donorEmail}
                        onChange={(e) => setDonorEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 mb-1">
                        Phone <span className="text-xs font-normal text-neutral-400">(optional)</span>
                      </label>
                      <input
                        type="tel"
                        value={donorPhone}
                        onChange={(e) => setDonorPhone(e.target.value)}
                        placeholder="(671) 555-0100"
                        className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Message of Support <span className="text-xs font-normal text-neutral-400">(optional)</span>
                    </label>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Leave an encouraging note for the donor wall..."
                      className="w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 text-sm text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={anonymous}
                      onChange={(e) => setAnonymous(e.target.checked)}
                      className="rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span>Display my donation as Anonymous on the public donor wall</span>
                  </label>

                  {summary.tax_receipt_enabled && (
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-xs text-neutral-600 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-neutral-800">
                        <ShieldCheck className="w-4 h-4 text-brand-600" />
                        Charitable Contribution Receipt
                      </div>
                      <p>
                        No goods or services are provided in exchange for a standalone donation to{' '}
                        <span className="font-medium text-neutral-900">
                          {summary.tax_org_name || organization?.name}
                        </span>
                        {summary.tax_org_ein ? ` (EIN: ${summary.tax_org_ein})` : ''}.
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || effectiveAmountCents < 100}
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-brand-600 text-brand-foreground font-semibold text-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Redirecting to Checkout...
                      </>
                    ) : (
                      <>
                        <Heart className="w-4 h-4" />
                        Donate {effectiveAmountCents >= 100 ? formatCurrency(effectiveAmountCents) : ''}
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Fundraising Summary & Live Donor Wall */}
          <div className="lg:col-span-2 space-y-6">
            <div className={`${pack.surfaces.cardClass} p-6`}>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Donations Raised
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-brand-700">
                {formatCurrency(summary.total_raised_cents)}
              </p>
              <div className="mt-3 flex items-center gap-2 text-sm text-neutral-600">
                <Users className="w-4 h-4 text-brand-600" />
                <span>
                  {summary.donor_count} {summary.donor_count === 1 ? 'supporter' : 'supporters'}
                </span>
              </div>
            </div>

            <div className={`${pack.surfaces.cardClass} p-6`}>
              <div className="flex items-center gap-2 mb-4">
                <MessageSquareHeart className="w-5 h-5 text-brand-600" />
                <h3 className="text-base font-bold text-neutral-900">Recent Supporters</h3>
              </div>

              {summary.recent_donations.length === 0 ? (
                <p className="text-sm text-neutral-500 py-4 text-center">
                  Be the first to support this event with a donation!
                </p>
              ) : (
                <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                  {summary.recent_donations.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-neutral-100 bg-neutral-50/70 p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm text-neutral-900 truncate">
                          {item.display_name}
                        </p>
                        <span className="text-sm font-bold text-brand-700 shrink-0">
                          {formatCurrency(item.amount_cents)}
                        </span>
                      </div>
                      {item.message && (
                        <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed">
                          &ldquo;{item.message}&rdquo;
                        </p>
                      )}
                      {item.paid_at && (
                        <p className="mt-1.5 text-[11px] text-neutral-400">
                          {formatDate(item.paid_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
