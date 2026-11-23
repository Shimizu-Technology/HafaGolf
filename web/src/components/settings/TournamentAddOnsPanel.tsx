import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles, Tag, Trash2, Edit2, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  api,
  type TournamentAddOn,
  type TournamentAddOnCategory,
  type TournamentAddOnInput,
} from '../../services/api';
import { SettingsSection } from './SettingsFields';

interface StarterTemplate {
  name: string;
  description: string;
  price_cents: number;
  max_quantity_per_order: number;
  category: TournamentAddOnCategory;
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: 'Mulligan Pack',
    description: '2 mulligans to use anytime during the round',
    price_cents: 2000,
    max_quantity_per_order: 4,
    category: 'mulligans',
  },
  {
    name: 'Super Ticket Bundle',
    description: 'Mulligans, putting contest entry, and bonus raffle tickets',
    price_cents: 5000,
    max_quantity_per_order: 4,
    category: 'super_ticket',
  },
  {
    name: 'Putting Contest',
    description: 'Entry into the pre-round putting contest for prizes',
    price_cents: 1000,
    max_quantity_per_order: 4,
    category: 'contest',
  },
];

const CATEGORY_LABELS: Record<TournamentAddOnCategory, string> = {
  super_ticket: 'Super Ticket',
  mulligans: 'Mulligans',
  contest: 'Contest',
  raffle_bundle: 'Raffle Bundle',
  other: 'Other',
};

function formatDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

interface AddOnFormState {
  name: string;
  description: string;
  price_dollars: string;
  max_quantity_per_order: string;
  max_total_quantity: string;
  category: TournamentAddOnCategory;
  active: boolean;
}

const EMPTY_FORM: AddOnFormState = {
  name: '',
  description: '',
  price_dollars: '20',
  max_quantity_per_order: '4',
  max_total_quantity: '',
  category: 'super_ticket',
  active: true,
};

export const TournamentAddOnsPanel: React.FC<{ tournamentId: number }> = ({ tournamentId }) => {
  const [addOns, setAddOns] = useState<TournamentAddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AddOnFormState>(EMPTY_FORM);
  const latestTournamentId = useRef(tournamentId);

  const loadAddOns = useCallback(async () => {
    latestTournamentId.current = tournamentId;
    setLoading(true);
    try {
      const res = await api.getTournamentAddOns(tournamentId, true);
      if (latestTournamentId.current === tournamentId) {
        setAddOns(res.add_ons || []);
      }
    } catch (err) {
      if (latestTournamentId.current === tournamentId) {
        toast.error(err instanceof Error ? err.message : 'Failed to load add-ons');
      }
    } finally {
      if (latestTournamentId.current === tournamentId) {
        setLoading(false);
      }
    }
  }, [tournamentId]);

  useEffect(() => {
    loadAddOns();
  }, [loadAddOns]);

  const handleQuickAddTemplate = async (template: StarterTemplate) => {
    setSaving(true);
    try {
      const res = await api.createTournamentAddOn(tournamentId, {
        ...template,
        active: true,
        sort_order: addOns.length,
      });
      setAddOns((prev) => [...prev, res.add_on]);
      toast.success(`Added "${template.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add template');
    } finally {
      setSaving(false);
    }
  };

  const openCreateForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEditForm = (item: TournamentAddOn) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description || '',
      price_dollars: (item.price_cents / 100).toFixed(item.price_cents % 100 === 0 ? 0 : 2),
      max_quantity_per_order: String(item.max_quantity_per_order),
      max_total_quantity: item.max_total_quantity != null ? String(item.max_total_quantity) : '',
      category: item.category,
      active: item.active,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error('Please enter an add-on name');
      return;
    }

    const priceCents = Math.max(0, Math.round((parseFloat(form.price_dollars) || 0) * 100));
    const maxPerOrder = Math.max(1, parseInt(form.max_quantity_per_order, 10) || 1);
    const maxTotal = form.max_total_quantity.trim()
      ? Math.max(1, parseInt(form.max_total_quantity, 10) || 1)
      : null;

    const payload: TournamentAddOnInput = {
      name: trimmedName,
      description: form.description.trim() || null,
      price_cents: priceCents,
      max_quantity_per_order: maxPerOrder,
      max_total_quantity: maxTotal,
      category: form.category,
      active: form.active,
    };

    setSaving(true);
    try {
      if (editingId) {
        const res = await api.updateTournamentAddOn(tournamentId, editingId, payload);
        setAddOns((prev) => prev.map((item) => (item.id === editingId ? res.add_on : item)));
        toast.success('Add-on updated');
      } else {
        const res = await api.createTournamentAddOn(tournamentId, {
          ...payload,
          sort_order: addOns.length,
        });
        setAddOns((prev) => [...prev, res.add_on]);
        toast.success('Add-on created');
      }
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save add-on');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: TournamentAddOn) => {
    setSaving(true);
    try {
      const res = await api.updateTournamentAddOn(tournamentId, item.id, { active: !item.active });
      setAddOns((prev) => prev.map((existing) => (existing.id === item.id ? res.add_on : existing)));
      toast.success(res.add_on.active ? 'Add-on enabled' : 'Add-on hidden');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update add-on');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: TournamentAddOn) => {
    setSaving(true);
    try {
      const res = await api.deleteTournamentAddOn(tournamentId, item.id);
      if (res.deactivated && res.add_on) {
        setAddOns((prev) => prev.map((existing) => (existing.id === item.id ? res.add_on! : existing)));
        toast.success(res.message);
      } else {
        setAddOns((prev) => prev.filter((existing) => existing.id !== item.id));
        toast.success('Add-on deleted');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove add-on');
    } finally {
      setSaving(false);
    }
  };

  const existingNames = new Set(addOns.map((a) => a.name.toLowerCase()));

  return (
    <SettingsSection
      title="Registration Add-Ons & Super Tickets"
      description="Offer optional mulligan packs, super ticket bundles, or contests during online registration. Purchased items automatically appear on player check-in cards and print sheets."
    >
      {/* Quick starter templates */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Quick starter templates
        </p>
        <div className="flex flex-wrap gap-2">
          {STARTER_TEMPLATES.map((tpl) => {
            const alreadyAdded = existingNames.has(tpl.name.toLowerCase());
            return (
              <button
                key={tpl.name}
                type="button"
                disabled={saving || alreadyAdded}
                onClick={() => handleQuickAddTemplate(tpl)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {alreadyAdded ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                {tpl.name} ({formatDollars(tpl.price_cents)})
              </button>
            );
          })}
          <button
            type="button"
            disabled={saving}
            onClick={openCreateForm}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Custom Add-On
          </button>
        </div>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 space-y-3" data-testid="addon-editor-form">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">
              {editingId ? 'Edit Add-On' : 'New Registration Add-On'}
            </h4>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Super Ticket Bundle"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as TournamentAddOnCategory })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Price ($) *</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price_dollars}
                onChange={(e) => setForm({ ...form, price_dollars: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Max / order</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.max_quantity_per_order}
                  onChange={(e) => setForm({ ...form, max_quantity_per_order: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Total cap</label>
                <input
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={form.max_total_quantity}
                  onChange={(e) => setForm({ ...form, max_total_quantity: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Short description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What's included in this add-on"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="h-4 w-4 rounded accent-brand-600"
              />
              Show on public registration form
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSubmit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingId ? 'Save Changes' : 'Create Add-On'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing add-ons list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading add-ons…
        </div>
      ) : addOns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-4 text-center text-sm text-gray-500">
          No add-ons yet. Click a starter template above or create a custom add-on.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {addOns.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900">{item.name}</span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {formatDollars(item.price_cents)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    <Tag className="h-3 w-3" />
                    {CATEGORY_LABELS[item.category] || item.category}
                  </span>
                  {!item.active && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Hidden
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="mt-0.5 text-xs text-gray-500">{item.description}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Sold: <strong className="text-gray-700">{item.sold_quantity ?? 0}</strong>
                  {item.max_total_quantity != null && ` / ${item.max_total_quantity}`}
                  {' · '}Max {item.max_quantity_per_order} per order
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleToggleActive(item)}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {item.active ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => openEditForm(item)}
                  aria-label={`Edit ${item.name}`}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleDelete(item)}
                  aria-label={`Delete ${item.name}`}
                  className="rounded-lg border border-gray-200 p-1.5 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
};
