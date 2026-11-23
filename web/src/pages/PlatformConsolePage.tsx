import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  DollarSign,
  Globe,
  Palette,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import { useAdmin } from '../contexts';
import { useAuthToken } from '../hooks/useAuthToken';
import { useOrganizationStore } from '../stores/organizationStore';
import {
  NewOrganizationWizard,
  type PlatformFeatureCatalogItem,
  type WizardOrganizationPayload,
} from '../components/platform/NewOrganizationWizard';

interface PlatformDomain {
  id: string;
  hostname: string;
  is_primary: boolean;
  verified_at?: string | null;
}

interface PlatformAdminMember {
  id: number;
  user_id: number;
  email: string;
  name?: string | null;
  role: string;
}

interface PlatformOrgRow {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'offseason' | 'archived';
  subscription_status: string;
  offseason_enabled: boolean;
  primary_color?: string | null;
  accent_color?: string | null;
  logo_url?: string | null;
  primary_host?: string | null;
  domains: PlatformDomain[];
  features: Record<string, boolean>;
  payment_mode: string;
  processor_provider: string;
  platform_fee_per_registrant_cents: number;
  tournament_count: number;
  active_tournament_count: number;
  confirmed_golfers_count: number;
  latest_tournament_slug?: string | null;
  admins: PlatformAdminMember[];
}

interface PlatformSettlementRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  tournament_id: number;
  tournament_name: string;
  tournament_slug: string;
  tournament_status: string;
  settlement_status: string;
  gross_cents: number;
  processing_fee_cents: number;
  platform_fee_cents: number;
  net_cents: number;
  organizer_proceeds_cents: number;
  paid_cents: number;
  balance_due_cents: number;
}

interface PlatformOverviewResponse {
  summary: {
    total_orgs: number;
    active_orgs: number;
    offseason_orgs: number;
    archived_orgs: number;
    active_tournaments: number;
    total_confirmed_golfers: number;
    pending_payouts_cents: number;
    platform_collect_org_count: number;
  };
  feature_catalog: PlatformFeatureCatalogItem[];
  organizations: PlatformOrgRow[];
  settlements: PlatformSettlementRow[];
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
}

const STATUS_BADGES: Record<PlatformOrgRow['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20',
  offseason: 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/25',
  archived: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
};

export const PlatformConsolePage: React.FC = () => {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAdmin();
  const { getToken } = useAuthToken();
  const { setAccessibleOrganizations } = useOrganizationStore();

  const [overview, setOverview] = useState<PlatformOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'organizations' | 'settlements'>('organizations');
  const [searchQuery, setSearchQuery] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [savingOrg, setSavingOrg] = useState(false);
  const [newDomainHost, setNewDomainHost] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');

  const apiBase = import.meta.env.VITE_API_URL || '';
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const authedFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getTokenRef.current();
      if (!token) throw new Error('Authentication required');
      const res = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.errors?.join(', ') || data.error || 'Request failed');
      }
      return data as T;
    },
    [apiBase]
  );

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authedFetch<PlatformOverviewResponse>('/api/v1/admin/platform/overview');
      setOverview(data);
      // Keep sidebar org switcher in sync
      const orgList = await api.getAdminOrganizations().catch(() => null);
      if (orgList) setAccessibleOrganizations(orgList);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load platform overview');
    } finally {
      setLoading(false);
    }
  }, [authedFetch, setAccessibleOrganizations]);

  useEffect(() => {
    if (isSuperAdmin) {
      void loadOverview();
    } else {
      setLoading(false);
    }
  }, [isSuperAdmin, loadOverview]);

  const filteredOrgs = useMemo(() => {
    const list = overview?.organizations ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        (o.primary_host || '').toLowerCase().includes(q)
    );
  }, [overview?.organizations, searchQuery]);

  const selectedOrg = useMemo(
    () => overview?.organizations.find((o) => o.slug === selectedSlug) ?? null,
    [overview?.organizations, selectedSlug]
  );

  const handleWizardSubmit = async (payload: WizardOrganizationPayload) => {
    try {
      const res = await authedFetch<{ organization: { slug: string; name: string } }>(
        '/api/v1/admin/platform/organizations',
        { method: 'POST', body: JSON.stringify({ organization: payload }) }
      );
      toast.success(`Launched ${res.organization.name}`);
      setShowWizard(false);
      await loadOverview();
      setSelectedSlug(res.organization.slug);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create organization');
      throw err;
    }
  };

  const handlePatchOrg = async (
    slug: string,
    patch: {
      status?: 'active' | 'offseason' | 'archived';
      features?: Record<string, boolean>;
      payment_config?: { payment_mode: string; processor_provider: string };
    },
    successMsg: string
  ) => {
    try {
      setSavingOrg(true);
      await authedFetch(`/api/v1/admin/platform/organizations/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ organization: patch }),
      });
      toast.success(successMsg);
      await loadOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingOrg(false);
    }
  };

  const handleAddDomain = async (org: PlatformOrgRow) => {
    const hostname = newDomainHost.trim();
    if (!hostname) return;
    try {
      await api.createOrganizationDomain(org.slug, { hostname });
      toast.success(`Added ${hostname}`);
      setNewDomainHost('');
      await loadOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add domain');
    }
  };

  const handleSetPrimaryDomain = async (org: PlatformOrgRow, domainId: string, hostname: string) => {
    try {
      await api.updateOrganizationDomain(org.slug, String(domainId), { is_primary: true });
      toast.success(`${hostname} is now primary`);
      await loadOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update primary domain');
    }
  };

  const handleDeleteDomain = async (org: PlatformOrgRow, domainId: string, hostname: string) => {
    try {
      await api.deleteOrganizationDomain(org.slug, String(domainId));
      toast.success(`Removed ${hostname}`);
      await loadOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove domain');
    }
  };

  const handleAddOrgAdmin = async (org: PlatformOrgRow) => {
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) return;
    try {
      await authedFetch(`/api/v1/admin/organizations/${org.slug}/members`, {
        method: 'POST',
        body: JSON.stringify({ email, role: 'admin' }),
      });
      toast.success(`Added ${email} as Org Admin`);
      setNewAdminEmail('');
      await loadOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not invite admin');
    }
  };

  const handleRemoveOrgAdmin = async (org: PlatformOrgRow, memberId: number, email: string) => {
    try {
      await authedFetch(`/api/v1/admin/organizations/${org.slug}/members/${memberId}`, {
        method: 'DELETE',
      });
      toast.success(`Removed ${email}`);
      await loadOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove member');
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h1 className="text-lg font-semibold">Super Admin Access Required</h1>
          <p className="mt-2 text-sm">
            Only platform super administrators can access the HafaGolf Platform Console.
          </p>
        </div>
      </div>
    );
  }

  const summary = overview?.summary;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
            <ShieldCheck className="h-3.5 w-3.5" />
            Shimizu Technology Control Tower
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Platform Super Admin Console</h1>
          <p className="mt-1 text-sm text-slate-600">
            Launch new golf organizations, configure modules &amp; homepages, and track cross-org settlements.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowWizard((v) => !v)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          {showWizard ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span>{showWizard ? 'Close Wizard' : 'New Organization'}</span>
        </button>
      </div>

      {/* Summary KPI cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={Building2}
            label="Organizations"
            value={String(summary.total_orgs)}
            sub={`${summary.active_orgs} active · ${summary.offseason_orgs} off-season · ${summary.archived_orgs} archived`}
          />
          <SummaryCard
            icon={Trophy}
            label="Active Tournaments"
            value={String(summary.active_tournaments)}
            sub="Open or in progress across all orgs"
          />
          <SummaryCard
            icon={Users}
            label="Confirmed Golfers"
            value={summary.total_confirmed_golfers.toLocaleString()}
            sub="Across all client tournaments"
          />
          <SummaryCard
            icon={DollarSign}
            label="Pending Payouts"
            value={fmtUsd(summary.pending_payouts_cents)}
            sub={`${summary.platform_collect_org_count} platform-collect org${summary.platform_collect_org_count === 1 ? '' : 's'}`}
          />
        </div>
      )}

      {/* 5-step Guided New Org Wizard */}
      {showWizard && overview && (
        <NewOrganizationWizard
          featureCatalog={overview.feature_catalog}
          onCancel={() => setShowWizard(false)}
          onSubmit={handleWizardSubmit}
        />
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'organizations'}
            onClick={() => setActiveTab('organizations')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'organizations' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Organizations ({overview?.organizations.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'settlements'}
            onClick={() => setActiveTab('settlements')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'settlements' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Settlements &amp; Health ({overview?.settlements.length ?? 0})
          </button>
        </div>

        {activeTab === 'organizations' && (
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search orgs or domains..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Loading platform console…
        </div>
      ) : activeTab === 'organizations' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
          {/* Org Directory */}
          <div className="space-y-4">
            {filteredOrgs.map((org) => {
              const isSelected = selectedOrg?.slug === org.slug;
              return (
                <div
                  key={org.id}
                  className={`rounded-2xl border bg-white p-5 transition ${
                    isSelected ? 'border-brand-600 ring-2 ring-brand-600/15' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white font-bold text-sm"
                        style={{ backgroundColor: org.primary_color || '#1e3a5f' }}
                      >
                        {org.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-base font-bold text-slate-900">{org.name}</h2>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGES[org.status]}`}>
                            {org.status}
                          </span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {org.payment_mode}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          /{org.slug} · {org.primary_host || 'No custom domain'} · {org.tournament_count} event
                          {org.tournament_count === 1 ? '' : 's'} · {org.confirmed_golfers_count} confirmed golfers
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(isSelected ? null : org.slug)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        {isSelected ? 'Close Panel' : 'Control Panel'}
                      </button>
                      <Link
                        to={`/admin/settings?org=${encodeURIComponent(org.slug)}&tab=look`}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                      >
                        <Palette className="h-3.5 w-3.5" />
                        Homepage Studio
                      </Link>
                      <button
                        type="button"
                        onClick={() => navigate(`/admin?org=${encodeURIComponent(org.slug)}`)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        Manage as Org
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredOrgs.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                No organizations match your search.
              </div>
            )}
          </div>

          {/* Per-Org Control Panel Drawer */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
            {selectedOrg && overview ? (
              <div className="space-y-5" data-testid="org-control-panel">
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{selectedOrg.name}</h3>
                    <p className="text-xs text-slate-500">Per-organization governance &amp; modules</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedSlug(null)}
                    aria-label="Close control panel"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Org Status */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Organization Status</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['active', 'offseason', 'archived'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={savingOrg}
                        onClick={() => handlePatchOrg(selectedOrg.slug, { status: st }, `${selectedOrg.name} marked ${st}`)}
                        className={`rounded-lg border px-2.5 py-2 text-xs font-semibold capitalize transition ${
                          selectedOrg.status === st
                            ? 'border-brand-600 bg-brand-50 text-brand-800'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment Mode */}
                <div>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Payment Mode</span>
                    <select
                      disabled={savingOrg}
                      value={selectedOrg.payment_mode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        const provider =
                          mode === 'platform_collect' || mode === 'client_processor'
                            ? 'stripe'
                            : mode === 'external_link'
                            ? 'swipesimple'
                            : 'none';
                        void handlePatchOrg(
                          selectedOrg.slug,
                          { payment_config: { payment_mode: mode, processor_provider: provider } },
                          `Updated payment mode to ${mode}`
                        );
                      }}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="platform_collect">Platform Collect (Shimizu Stripe)</option>
                      <option value="client_processor">Client Stripe</option>
                      <option value="external_link">External Link (SwipeSimple)</option>
                      <option value="offline">Offline (Check / Cash)</option>
                    </select>
                  </label>
                </div>

                {/* Enabled Modules */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Enabled Modules</p>
                  <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {overview.feature_catalog.map((feat) => {
                      const enabled = Boolean(selectedOrg.features[feat.key]);
                      return (
                        <label
                          key={feat.key}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
                        >
                          <span className="text-xs font-medium text-slate-800">{feat.label}</span>
                          <input
                            type="checkbox"
                            disabled={savingOrg}
                            checked={enabled}
                            onChange={() =>
                              void handlePatchOrg(
                                selectedOrg.slug,
                                { features: { [feat.key]: !enabled } },
                                `${feat.label} ${!enabled ? 'enabled' : 'disabled'}`
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-brand-600"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Domains */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Custom Domains</p>
                  <div className="space-y-1.5">
                    {selectedOrg.domains.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-slate-800">
                          <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{d.hostname}</span>
                          {d.is_primary && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {!d.is_primary && (
                            <button
                              type="button"
                              onClick={() => void handleSetPrimaryDomain(selectedOrg, d.id, d.hostname)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                            >
                              Make Primary
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDeleteDomain(selectedOrg, d.id, d.hostname)}
                            aria-label={`Delete ${d.hostname}`}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={newDomainHost}
                      onChange={(e) => setNewDomainHost(e.target.value)}
                      placeholder="events.client.org"
                      className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddDomain(selectedOrg)}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Org Admins */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Org Admins</p>
                  <div className="space-y-1.5">
                    {selectedOrg.admins.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <span className="truncate text-slate-800">{m.email}</span>
                        <button
                          type="button"
                          onClick={() => void handleRemoveOrgAdmin(selectedOrg, m.id, m.email)}
                          aria-label={`Remove ${m.email}`}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="email"
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      placeholder="admin@client.org"
                      className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddOrgAdmin(selectedOrg)}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center">
                <Settings2 className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-800">Per-Org Control Panel</p>
                <p className="mt-1 text-xs text-slate-500">
                  Select any organization on the left to toggle modules, change status, manage domains, or invite Org Admins.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Cross-Org Settlements & Health Tab */
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-bold text-slate-900">Platform Collect Settlements &amp; Payouts</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Live overview across every organization collecting registration or sponsor funds through Shimizu Technology’s Stripe account.
            </p>
          </div>
          {overview && overview.settlements.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Organization / Event</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Fees</th>
                    <th className="px-4 py-3 text-right">Net Owed</th>
                    <th className="px-4 py-3 text-right">Paid Out</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3 text-right">Statement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.settlements.map((row) => (
                    <tr key={`${row.organization_id}-${row.tournament_id}`} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{row.organization_name}</p>
                        <p className="text-xs text-slate-500">{row.tournament_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-700">
                          {row.settlement_status === 'finalized' && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                          {row.settlement_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{fmtUsd(row.gross_cents)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {fmtUsd(row.processing_fee_cents + row.platform_fee_cents)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {fmtUsd(row.organizer_proceeds_cents)}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-700">{fmtUsd(row.paid_cents)}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {fmtUsd(row.balance_due_cents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/admin/events/${row.tournament_slug}/payments?org=${encodeURIComponent(row.organization_slug)}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                        >
                          Payout Statement
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-10 text-center text-sm text-slate-500">
              No organizations are currently configured in <code className="font-mono">platform_collect</code> mode.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}
