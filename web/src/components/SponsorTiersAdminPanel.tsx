import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  DollarSign,
  Edit,
  Loader2,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, PricedSponsorTier, SponsorTierInput } from '../services/api';

interface SponsorTiersAdminPanelProps {
  tournamentId: number;
  orgSlug?: string;
  tournamentSlug?: string;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export const SponsorTiersAdminPanel: React.FC<SponsorTiersAdminPanelProps> = ({
  tournamentId,
  orgSlug,
  tournamentSlug,
}) => {
  const [tiers, setTiers] = useState<PricedSponsorTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTier, setEditingTier] = useState<PricedSponsorTier | null>(null);

  const loadTiers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getSponsorTiers(tournamentId);
      setTiers(res.sponsor_tiers || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load sponsor tiers');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadTiers();
  }, [loadTiers]);

  const handleDelete = async (tier: PricedSponsorTier) => {
    if (!confirm(`Delete sponsor tier "${tier.label}"? Existing sponsors will remain intact.`)) return;
    try {
      await api.deleteSponsorTier(tournamentId, tier.id);
      toast.success('Sponsor tier deleted');
      loadTiers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete tier');
    }
  };

  const publicSponsorPath =
    orgSlug && tournamentSlug ? `/${orgSlug}/tournaments/${tournamentSlug}/sponsor` : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Tag className="w-4 h-4 text-brand-600" />
            Priced Sponsorship Tiers
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Configure priced sponsorship packages, included player slots, caps, and benefits for online checkout.
            {publicSponsorPath && (
              <>
                {' '}Public page: <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{publicSponsorPath}</code>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadTiers}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            title="Refresh tiers"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingTier(null);
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-600 text-brand-foreground hover:bg-brand-700 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Priced Tier
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center bg-white rounded-xl border border-gray-200">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      ) : tiers.length === 0 ? (
        <div className="py-12 text-center bg-white rounded-xl border border-gray-200 px-4">
          <Tag className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700">No priced sponsor tiers yet</p>
          <p className="text-xs text-gray-500 mt-1">
            Create tiers like Title Sponsor, Gold Foursome, or Hole Sponsor to accept online sponsorships.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col justify-between shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{tier.label}</h3>
                    <p className="text-xs text-gray-400 font-mono">{tier.key}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTier(tier);
                        setShowModal(true);
                      }}
                      className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-gray-100 rounded-lg"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(tier)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-2xl font-bold text-brand-700">{formatUsd(tier.price_cents)}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 font-medium">
                    <Users className="w-3 h-3" />
                    {tier.included_player_slots} player {tier.included_player_slots === 1 ? 'slot' : 'slots'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      tier.online_checkout_enabled
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {tier.online_checkout_enabled ? 'Online Checkout On' : 'Online Checkout Off'}
                  </span>
                  {tier.max_quantity !== null && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                      {tier.remaining_quantity} / {tier.max_quantity} remaining
                    </span>
                  )}
                </div>

                {tier.description && (
                  <p className="mt-3 text-xs text-gray-600 leading-relaxed">{tier.description}</p>
                )}

                {tier.benefits.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-gray-600">
                    {tier.benefits.map((benefit, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <Check className="w-3.5 h-3.5 text-brand-600 shrink-0 mt-0.5" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>Paid: {tier.sold_count}</span>
                <span>Sort: #{tier.sort_order}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <SponsorTierModal
          tournamentId={tournamentId}
          tier={editingTier}
          nextSortOrder={tiers.length}
          onClose={() => {
            setShowModal(false);
            setEditingTier(null);
          }}
          onSaved={() => {
            setShowModal(false);
            setEditingTier(null);
            loadTiers();
          }}
        />
      )}
    </div>
  );
};

const SponsorTierModal: React.FC<{
  tournamentId: number;
  tier: PricedSponsorTier | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tournamentId, tier, nextSortOrder, onClose, onSaved }) => {
  const [label, setLabel] = useState(tier?.label || '');
  const [key, setKey] = useState(tier?.key || '');
  const [description, setDescription] = useState(tier?.description || '');
  const [priceDollars, setPriceDollars] = useState(
    tier ? (tier.price_cents / 100).toFixed(2) : '500.00'
  );
  const [includedPlayerSlots, setIncludedPlayerSlots] = useState(
    tier ? String(tier.included_player_slots) : '4'
  );
  const [maxQuantity, setMaxQuantity] = useState(
    tier?.max_quantity != null ? String(tier.max_quantity) : ''
  );
  const [benefitsText, setBenefitsText] = useState((tier?.benefits || []).join('\n'));
  const [onlineCheckoutEnabled, setOnlineCheckoutEnabled] = useState(
    tier?.online_checkout_enabled ?? true
  );
  const [sortOrder, setSortOrder] = useState(
    tier ? String(tier.sort_order) : String(nextSortOrder)
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = Number.parseFloat(priceDollars);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      toast.error('Price must be $0.00 or higher');
      return;
    }

    const derivedKey =
      key.trim().toLowerCase() ||
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

    const payload: SponsorTierInput = {
      key: derivedKey,
      label: label.trim(),
      description: description.trim() || null,
      price_cents: Math.round(parsedPrice * 100),
      included_player_slots: Math.max(0, Number.parseInt(includedPlayerSlots, 10) || 0),
      max_quantity: maxQuantity.trim() ? Math.max(1, Number.parseInt(maxQuantity, 10) || 1) : null,
      benefits: benefitsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      online_checkout_enabled: onlineCheckoutEnabled,
      sort_order: Math.max(0, Number.parseInt(sortOrder, 10) || 0),
    };

    setSaving(true);
    try {
      if (tier) {
        await api.updateSponsorTier(tournamentId, tier.id, payload);
        toast.success('Sponsor tier updated');
      } else {
        await api.createSponsorTier(tournamentId, payload);
        toast.success('Sponsor tier created');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save sponsor tier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {tier ? 'Edit Priced Sponsor Tier' : 'Create Priced Sponsor Tier'}
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tier Label *</label>
              <input
                type="text"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Gold Sponsor"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Key <span className="text-gray-400">(lowercase slug)</span>
              </label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="gold"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Price (USD) *</label>
              <div className="relative">
                <DollarSign className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Included Player Slots</label>
              <input
                type="number"
                min="0"
                value={includedPlayerSlots}
                onChange={(e) => setIncludedPlayerSlots(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Max Quantity <span className="text-gray-400">(blank = ∞)</span>
              </label>
              <input
                type="number"
                min="1"
                value={maxQuantity}
                onChange={(e) => setMaxQuantity(e.target.value)}
                placeholder="Unlimited"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summary of this sponsorship package"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Benefits <span className="text-gray-400">(one per line)</span>
            </label>
            <textarea
              rows={4}
              value={benefitsText}
              onChange={(e) => setBenefitsText(e.target.value)}
              placeholder={'Logo on tournament banner\nOne 4-player team entry\nRecognition at banquet'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-center">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={onlineCheckoutEnabled}
                onChange={(e) => setOnlineCheckoutEnabled(e.target.checked)}
                className="rounded border-gray-300 text-brand-600"
              />
              <span>Enable online checkout</span>
            </label>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sort Order</label>
              <input
                type="number"
                min="0"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-brand-foreground text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {tier ? 'Save Changes' : 'Create Tier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
