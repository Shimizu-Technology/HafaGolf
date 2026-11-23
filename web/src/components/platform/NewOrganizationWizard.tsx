import { useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  Globe,
  Palette,
  Sliders,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  HOMEPAGE_ARCHETYPE_LIST,
  HOMEPAGE_ARCHETYPES_BY_ID,
  type HomepageArchetype,
  type LandingMode,
} from '../../utils/homepageConfig';

export interface PlatformFeatureCatalogItem {
  key: string;
  label: string;
  description: string;
  category: string;
  category_label: string;
  default: boolean;
}

export interface WizardOrganizationPayload {
  name: string;
  slug?: string;
  primary_domain?: string;
  primary_color: string;
  accent_color: string;
  logo_url?: string;
  reversed_logo_url?: string;
  theme_preset: string;
  homepage_config: {
    archetype: HomepageArchetype;
    landing_mode: LandingMode;
    hero_surface: string;
    artwork_display: string;
    logo_display: string;
  };
  features: Record<string, boolean>;
  payment_config: {
    payment_mode: 'platform_collect' | 'client_processor' | 'external_link' | 'offline';
    processor_provider: 'stripe' | 'swipesimple' | 'none';
    platform_fee_per_registrant_cents?: number;
    payout_payee_name?: string;
  };
  admin_emails: string[];
}

const STEPS = [
  { id: 1, title: 'Identity & Domain', icon: Globe },
  { id: 2, title: 'Theme & Brand', icon: Palette },
  { id: 3, title: 'Modules', icon: Sliders },
  { id: 4, title: 'Payments', icon: CreditCard },
  { id: 5, title: 'Org Admins', icon: Users },
] as const;

export function NewOrganizationWizard({
  featureCatalog,
  onCancel,
  onSubmit,
}: {
  featureCatalog: PlatformFeatureCatalogItem[];
  onCancel: () => void;
  onSubmit: (payload: WizardOrganizationPayload) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [landingMode, setLandingMode] = useState<LandingMode>('org_hub');

  // Step 2
  const [archetype, setArchetype] = useState<HomepageArchetype>('charity-showcase');
  const [primaryColor, setPrimaryColor] = useState('#1E3A5F');
  const [accentColor, setAccentColor] = useState('#C5A059');
  const [logoUrl, setLogoUrl] = useState('');
  const [reversedLogoUrl, setReversedLogoUrl] = useState('');

  // Step 3
  const [features, setFeatures] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of featureCatalog) {
      initial[item.key] = item.default;
    }
    return initial;
  });

  // Step 4
  const [paymentMode, setPaymentMode] = useState<'platform_collect' | 'client_processor' | 'external_link' | 'offline'>(
    'platform_collect'
  );
  const [feePerRegistrantDollars, setFeePerRegistrantDollars] = useState('4.00');
  const [payoutPayeeName, setPayoutPayeeName] = useState('');

  // Step 5
  const [adminEmailsText, setAdminEmailsText] = useState('');

  const selectedArchetypeMeta = HOMEPAGE_ARCHETYPES_BY_ID[archetype];
  const dnsTarget = import.meta.env.VITE_CUSTOM_DOMAIN_CNAME || 'hafagolf.netlify.app';
  const normalizedHost = primaryDomain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const isApexDomain = normalizedHost.length > 0 && normalizedHost.split('.').length === 2;
  const dnsRecordType = isApexDomain ? 'ALIAS / ANAME' : 'CNAME';

  const handleCopyDns = async () => {
    const hostLabel = normalizedHost || 'events.yourorg.org';
    const record = `${hostLabel} ${isApexDomain ? 'ALIAS' : 'CNAME'} ${dnsTarget}`;
    try {
      await navigator.clipboard.writeText(record);
      toast.success(`Copied DNS ${dnsRecordType} record`);
    } catch {
      toast.error('Copy failed — select the DNS record manually');
    }
  };

  const canProceed = () => {
    if (step === 1) return name.trim().length > 0;
    return true;
  };

  const handleFinish = async () => {
    if (!name.trim()) {
      toast.error('Organization name is required');
      setStep(1);
      return;
    }
    const provider: 'stripe' | 'swipesimple' | 'none' =
      paymentMode === 'platform_collect' || paymentMode === 'client_processor'
        ? 'stripe'
        : paymentMode === 'external_link'
        ? 'swipesimple'
        : 'none';

    const adminEmails = adminEmailsText
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // Send only overrides that differ from catalog defaults so future catalog updates flow through
    const featureOverrides: Record<string, boolean> = {};
    for (const item of featureCatalog) {
      if (features[item.key] !== item.default) {
        featureOverrides[item.key] = Boolean(features[item.key]);
      }
    }

    const payload: WizardOrganizationPayload = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      primary_domain: normalizedHost || undefined,
      primary_color: primaryColor,
      accent_color: accentColor,
      logo_url: logoUrl.trim() || undefined,
      reversed_logo_url: reversedLogoUrl.trim() || undefined,
      theme_preset: selectedArchetypeMeta.themePreset,
      homepage_config: {
        archetype,
        landing_mode: landingMode,
        hero_surface: selectedArchetypeMeta.defaults.hero_surface,
        artwork_display: selectedArchetypeMeta.defaults.artwork_display,
        logo_display: 'auto',
      },
      features: featureOverrides,
      payment_config: {
        payment_mode: paymentMode,
        processor_provider: provider,
        ...(paymentMode === 'platform_collect'
          ? { platform_fee_per_registrant_cents: Math.max(0, Math.round((parseFloat(feePerRegistrantDollars) || 0) * 100)) }
          : {}),
        payout_payee_name: payoutPayeeName.trim() || undefined,
      },
      admin_emails: adminEmails,
    };

    try {
      setSubmitting(true);
      await onSubmit(payload);
    } catch {
      // Error toast is already displayed by onSubmit handler; avoid unhandled rejection
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="new-org-wizard"
      className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Launch New Organization</h2>
          <p className="text-xs text-slate-500">
            Step {step} of {STEPS.length} · {STEPS[step - 1].title}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close wizard"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Stepper bar */}
      <div className="grid grid-cols-5 border-b border-slate-100 bg-white px-4 py-3">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const active = s.id === step;
          const done = s.id < step;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => (s.id < step || canProceed()) && setStep(s.id)}
              className={`flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                active
                  ? 'bg-brand-50 text-brand-800'
                  : done
                  ? 'text-emerald-700 hover:bg-slate-50'
                  : 'text-slate-400'
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                  active
                    ? 'bg-brand-700 text-white'
                    : done
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </span>
              <span className="hidden sm:inline">{s.title}</span>
            </button>
          );
        })}
      </div>

      <div className="p-6">
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Organization Name *</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Rotary Club of Tumon Bay"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">URL Slug (optional)</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="rotary-tumon-bay"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Custom Domain (optional)</span>
                <input
                  type="text"
                  value={primaryDomain}
                  onChange={(e) => setPrimaryDomain(e.target.value)}
                  placeholder="golf.rotarytumon.org"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Public Landing Mode</span>
                <select
                  value={landingMode}
                  onChange={(e) => setLandingMode(e.target.value as LandingMode)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="org_hub">Multi-Event Org Hub (org hero + event cards)</option>
                  <option value="direct_to_active_event">Direct to Active Event (skip hub)</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <div>
                <p className="font-semibold text-slate-800">
                  DNS Setup Instructions {isApexDomain ? '(Apex Domain)' : '(Subdomain)'}
                </p>
                <p className="mt-0.5 font-mono">
                  {normalizedHost || 'events.yourorg.org'} → {dnsRecordType} → {dnsTarget}
                </p>
                {isApexDomain && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Apex domains require ALIAS/ANAME (or CNAME flattening) — or use a subdomain like <span className="font-mono">golf.{normalizedHost}</span>.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleCopyDns}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy DNS
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="grid gap-2.5 sm:grid-cols-3">
              {HOMEPAGE_ARCHETYPE_LIST.map((item) => {
                const selected = archetype === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setArchetype(item.id)}
                    className={`rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-brand-600 bg-brand-50/70 ring-2 ring-brand-600/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.tagline}</p>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Primary Brand Color</span>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-slate-300"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Accent Color</span>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-slate-300"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Logo URL (optional)</span>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Reversed Light Logo URL (optional)</span>
                <input
                  type="url"
                  value={reversedLogoUrl}
                  onChange={(e) => setReversedLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            {/* Live mini preview strip */}
            <div
              className="rounded-xl p-4"
              style={
                selectedArchetypeMeta.defaults.hero_surface === 'light_airy'
                  ? { background: 'linear-gradient(180deg,#f8fbff,#f2faf6)', color: '#1e3553', border: '1px solid #cbd5e1' }
                  : { background: `linear-gradient(135deg, ${primaryColor}, #0f172a)`, color: '#ffffff' }
              }
            >
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accentColor }}>
                Live Starter Preview · {selectedArchetypeMeta.label}
              </p>
              <p className="mt-1 text-lg font-extrabold">{name.trim() || 'Your Organization Name'}</p>
              <p className="text-xs opacity-80">
                {landingMode === 'direct_to_active_event' ? 'Direct-to-event landing' : 'Multi-event hub'} ·{' '}
                {selectedArchetypeMeta.defaults.artwork_display.replace('_', ' ')}
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {featureCatalog.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={Boolean(features[item.key])}
                  onChange={(e) => setFeatures((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                  <span className="block text-xs text-slate-500">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  id: 'platform_collect' as const,
                  title: 'Platform Collect (Shimizu Stripe)',
                  desc: 'Shimizu Technology processes cards and remits net proceeds by check/settlement statement.',
                },
                {
                  id: 'client_processor' as const,
                  title: 'Client Stripe Account',
                  desc: 'Client connects their own Stripe keys directly in Payments & Payouts settings.',
                },
                {
                  id: 'external_link' as const,
                  title: 'External Link (SwipeSimple)',
                  desc: 'Redirect registrants to the client’s existing SwipeSimple payment link.',
                },
                {
                  id: 'offline' as const,
                  title: 'Offline Only (Check / Cash)',
                  desc: 'Collect entry fees via check or tournament-day cash desk.',
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPaymentMode(opt.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    paymentMode === opt.id
                      ? 'border-brand-600 bg-brand-50/70 ring-2 ring-brand-600/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">{opt.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{opt.desc}</p>
                </button>
              ))}
            </div>
            {paymentMode === 'platform_collect' && (
              <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-slate-800">Platform Fee per Registrant (USD)</span>
                  <input
                    type="number"
                    step="0.50"
                    min="0"
                    value={feePerRegistrantDollars}
                    onChange={(e) => setFeePerRegistrantDollars(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-800">Payout Payee Name (optional)</span>
                  <input
                    type="text"
                    value={payoutPayeeName}
                    onChange={(e) => setPayoutPayeeName(e.target.value)}
                    placeholder="Payable to organization legal name"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Initial Org Admin Email(s)</span>
              <textarea
                rows={3}
                value={adminEmailsText}
                onChange={(e) => setAdminEmailsText(e.target.value)}
                placeholder="chair@example.org, treasurer@example.org"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Separate multiple addresses with commas or new lines. Each receives Org Admin access on sign-in.
              </span>
            </label>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-1">
              <p className="font-semibold text-slate-900">Ready to provision:</p>
              <p>
                <strong>{name.trim() || '(Unnamed)'}</strong> · {selectedArchetypeMeta.label} ·{' '}
                {landingMode === 'direct_to_active_event' ? 'Direct to active event' : 'Org hub'}
              </p>
              <p>
                Payment mode: <strong>{paymentMode}</strong> · Enabled modules:{' '}
                <strong>{Object.values(features).filter(Boolean).length}</strong>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
        <button
          type="button"
          onClick={() => (step > 1 ? setStep(step - 1) : onCancel())}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          <ChevronLeft className="h-4 w-4" />
          {step === 1 ? 'Cancel' : 'Back'}
        </button>

        {step < STEPS.length ? (
          <button
            type="button"
            disabled={!canProceed()}
            onClick={() => setStep(step + 1)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={handleFinish}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {submitting ? 'Creating…' : 'Launch Organization'}
          </button>
        )}
      </div>
    </div>
  );
}
