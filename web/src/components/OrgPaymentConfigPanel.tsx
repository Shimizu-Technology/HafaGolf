import React, { useEffect, useState } from 'react';
import {
  CreditCard,
  ShieldCheck,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  Save,
  Loader2,
  Building2,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  api,
  type OrgPaymentMode,
  type OrganizationPaymentConfig,
  type PaymentProcessorProvider,
  type UpdateOrganizationPaymentConfigInput,
} from '../services/api';

interface OrgPaymentConfigPanelProps {
  organizationSlug: string;
}

const MODE_OPTIONS: Array<{ value: OrgPaymentMode; label: string; description: string }> = [
  {
    value: 'external_link',
    label: 'External Payment Link',
    description: 'Redirect golfers to SwipeSimple, PayPal, or another hosted link and verify payments manually.',
  },
  {
    value: 'platform_collect',
    label: 'Platform Collect (Shimizu Stripe)',
    description: 'Collect card payments online through the platform Stripe account and settle via payout ledger.',
  },
  {
    value: 'client_processor',
    label: 'Client Processor (Own Credentials)',
    description: 'Collect card payments using this organization’s own encrypted Stripe keys and dedicated webhook URL.',
  },
  {
    value: 'offline',
    label: 'Offline Only (Cash / Check)',
    description: 'No online card checkout; accept cash, check, or pay-on-day registrations only.',
  },
];

const PROVIDER_OPTIONS: Array<{ value: PaymentProcessorProvider; label: string }> = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'swipesimple', label: 'SwipeSimple' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'worldpay_cardpointe', label: 'Worldpay / CardPointe (Upcoming)' },
  { value: 'none', label: 'None' },
];

export const OrgPaymentConfigPanel: React.FC<OrgPaymentConfigPanelProps> = ({ organizationSlug }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [config, setConfig] = useState<OrganizationPaymentConfig | null>(null);
  const [canEditFees, setCanEditFees] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [paymentMode, setPaymentMode] = useState<OrgPaymentMode>('offline');
  const [provider, setProvider] = useState<PaymentProcessorProvider>('none');
  const [testMode, setTestMode] = useState(false);
  const [externalCheckoutUrl, setExternalCheckoutUrl] = useState('');
  const [externalWalkinUrl, setExternalWalkinUrl] = useState('');
  const [externalDonationUrl, setExternalDonationUrl] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [payoutPayeeName, setPayoutPayeeName] = useState('');
  const [payoutBankName, setPayoutBankName] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [feeFlatDollars, setFeeFlatDollars] = useState('0');
  const [feePerRegDollars, setFeePerRegDollars] = useState('0');
  const [feeCapDollars, setFeeCapDollars] = useState('');

  const hydrate = (nextConfig: OrganizationPaymentConfig, editableFees: boolean) => {
    setConfig(nextConfig);
    setCanEditFees(editableFees);
    setPaymentMode(nextConfig.payment_mode);
    setProvider(nextConfig.processor_provider);
    setTestMode(nextConfig.test_mode);
    setExternalCheckoutUrl(nextConfig.external_checkout_url || '');
    setExternalWalkinUrl(nextConfig.external_walkin_url || '');
    setExternalDonationUrl(nextConfig.external_donation_url || '');
    setPublicKey('');
    setSecretKey('');
    setWebhookSecret('');
    setPayoutPayeeName(nextConfig.payout_payee_name || '');
    setPayoutBankName(nextConfig.payout_bank_name || '');
    setPayoutNotes(nextConfig.payout_notes || '');
    setFeeFlatDollars((nextConfig.platform_fee_flat_cents / 100).toFixed(2));
    setFeePerRegDollars((nextConfig.platform_fee_per_registrant_cents / 100).toFixed(2));
    setFeeCapDollars(
      nextConfig.platform_fee_cap_cents !== null ? (nextConfig.platform_fee_cap_cents / 100).toFixed(2) : ''
    );
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api
      .getOrganizationPaymentConfig(organizationSlug)
      .then((res) => {
        if (active) hydrate(res.payment_config, res.can_edit_platform_fees);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load payment settings');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [organizationSlug]);

  const handleModeChange = (nextMode: OrgPaymentMode) => {
    setPaymentMode(nextMode);
    if (nextMode === 'platform_collect' || nextMode === 'client_processor') {
      if (provider === 'none' || provider === 'swipesimple') setProvider('stripe');
    } else if (nextMode === 'external_link') {
      if (provider === 'none' || provider === 'stripe') setProvider('swipesimple');
    } else {
      setProvider('none');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload: UpdateOrganizationPaymentConfigInput = {
        payment_mode: paymentMode,
        processor_provider: provider,
        test_mode: testMode,
        external_checkout_url: externalCheckoutUrl.trim() || null,
        external_walkin_url: externalWalkinUrl.trim() || null,
        external_donation_url: externalDonationUrl.trim() || null,
        payout_payee_name: payoutPayeeName.trim() || null,
        payout_bank_name: payoutBankName.trim() || null,
        payout_notes: payoutNotes.trim() || null,
      };

      if (paymentMode === 'client_processor') {
        if (publicKey.trim()) payload.public_key = publicKey.trim();
        if (secretKey.trim()) payload.secret_key = secretKey.trim();
        if (webhookSecret.trim()) payload.webhook_secret = webhookSecret.trim();
      }

      if (canEditFees) {
        payload.platform_fee_flat_cents = Math.max(0, Math.round(parseFloat(feeFlatDollars || '0') * 100));
        payload.platform_fee_per_registrant_cents = Math.max(0, Math.round(parseFloat(feePerRegDollars || '0') * 100));
        payload.platform_fee_cap_cents =
          feeCapDollars.trim() === '' ? null : Math.max(0, Math.round(parseFloat(feeCapDollars) * 100));
      }

      const res = await api.updateOrganizationPaymentConfig(organizationSlug, payload);
      hydrate(res.payment_config, res.can_edit_platform_fees);
      toast.success('Payment configuration saved');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save payment configuration';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleRotateWebhook = async () => {
    setRotating(true);
    try {
      const res = await api.rotateOrganizationWebhookToken(organizationSlug);
      hydrate(res.payment_config, res.can_edit_platform_fees);
      toast.success('Webhook endpoint token rotated. Update the endpoint URL in your Stripe dashboard.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to rotate webhook token');
    } finally {
      setRotating(false);
    }
  };

  const handleCopyWebhook = async () => {
    if (!config?.webhook_url) return;
    await navigator.clipboard.writeText(config.webhook_url);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6">
        <div className="flex items-center gap-2 text-neutral-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading payment configuration…</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-brand-50 text-brand-700">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Payments &amp; Processor Mode</h2>
            <p className="text-xs text-neutral-500">
              Per-organization checkout mode, encrypted processor credentials, and payout details.
            </p>
          </div>
        </div>
        {config && (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              config.stripe_configured || config.payment_mode === 'external_link' || config.payment_mode === 'offline'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{config.payment_mode.replace('_', ' ')}</span>
          </span>
        )}
      </div>

      <div className="p-6 space-y-6">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Mode selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODE_OPTIONS.map((opt) => {
            const active = paymentMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleModeChange(opt.value)}
                className={`text-left rounded-xl border p-3.5 transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-50/40 ring-1 ring-brand-600'
                    : 'border-neutral-200 hover:border-neutral-300 bg-white'
                }`}
              >
                <div className="text-sm font-semibold text-neutral-900">{opt.label}</div>
                <p className="mt-1 text-xs text-neutral-500 leading-relaxed">{opt.description}</p>
              </button>
            );
          })}
        </div>

        {/* Provider + Test Mode */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1.5">Processor Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as PaymentProcessorProvider)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-brand-600 focus:outline-none"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {(paymentMode === 'platform_collect' || paymentMode === 'client_processor') && (
            <div className="flex items-end pb-1.5">
              <label className="inline-flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={testMode}
                  onChange={(e) => setTestMode(e.target.checked)}
                  className="rounded border-neutral-300 text-brand-600 focus:ring-brand-600"
                />
                <span>Enable simulated test checkout mode (no live Stripe charge)</span>
              </label>
            </div>
          )}
        </div>

        {/* External Links */}
        {paymentMode === 'external_link' && (
          <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <ExternalLink className="h-3.5 w-3.5" />
              <span>External HTTPS Payment URLs (Org Defaults)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Regular Checkout URL</label>
                <input
                  type="url"
                  value={externalCheckoutUrl}
                  onChange={(e) => setExternalCheckoutUrl(e.target.value)}
                  placeholder="https://swipesimple.com/links/..."
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Walk-In Checkout URL</label>
                <input
                  type="url"
                  value={externalWalkinUrl}
                  onChange={(e) => setExternalWalkinUrl(e.target.value)}
                  placeholder="https://swipesimple.com/links/..."
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Open Donation URL</label>
                <input
                  type="url"
                  value={externalDonationUrl}
                  onChange={(e) => setExternalDonationUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* Client Processor Encrypted Credentials */}
        {paymentMode === 'client_processor' && (
          <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <KeyRound className="h-3.5 w-3.5" />
              <span>Encrypted Client Stripe Credentials</span>
            </div>
            <p className="text-xs text-neutral-500">
              Keys are encrypted at rest and never displayed back. Leave blank to keep existing stored credentials.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Publishable Key {config?.has_public_key ? `(${config.masked_public_key})` : ''}
                </label>
                <input
                  type="text"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder={config?.has_public_key ? 'Leave blank to keep stored key' : 'pk_live_...'}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Secret Key {config?.has_secret_key ? '(Stored)' : ''}
                </label>
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={config?.has_secret_key ? '•••••••• (saved)' : 'sk_live_...'}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Webhook Signing Secret {config?.has_webhook_secret ? '(Stored)' : ''}
                </label>
                <input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={config?.has_webhook_secret ? '•••••••• (saved)' : 'whsec_...'}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            {config?.webhook_url && (
              <div className="pt-2">
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Dedicated Stripe Webhook Endpoint URL
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-mono text-neutral-700">
                    {config.webhook_url}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    {copiedWebhook ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedWebhook ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRotateWebhook}
                    disabled={rotating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${rotating ? 'animate-spin' : ''}`} />
                    <span>Rotate Token</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Payout Payee & Platform Fee Terms */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <Building2 className="h-3.5 w-3.5" />
              <span>Payout Payee Details</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">Legal Payee Name</label>
              <input
                type="text"
                value={payoutPayeeName}
                onChange={(e) => setPayoutPayeeName(e.target.value)}
                placeholder="Organization legal name for checks/transfers"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">Bank Name</label>
              <input
                type="text"
                value={payoutBankName}
                onChange={(e) => setPayoutBankName(e.target.value)}
                placeholder="e.g. Bank of Guam"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">Payout Memo / Delivery Notes</label>
              <textarea
                rows={2}
                value={payoutNotes}
                onChange={(e) => setPayoutNotes(e.target.value)}
                placeholder="Check mailing address or memo instructions"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Platform Fee Terms
              </span>
              {!canEditFees && <span className="text-[11px] text-neutral-400">Managed by platform admin</span>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Flat Fee ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!canEditFees}
                  value={feeFlatDollars}
                  onChange={(e) => setFeeFlatDollars(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Per Reg ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!canEditFees}
                  value={feePerRegDollars}
                  onChange={(e) => setFeePerRegDollars(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Fee Cap ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!canEditFees}
                  value={feeCapDollars}
                  onChange={(e) => setFeeCapDollars(e.target.value)}
                  placeholder="None"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-500"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-neutral-100">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>{saving ? 'Saving…' : 'Save Payment Settings'}</span>
          </button>
        </div>
      </div>
    </form>
  );
};
