import { useLatestRequest } from '../hooks/useLatestRequest';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { useOrganization } from '../components/OrganizationProvider';
import {
  Building2, Plus, ArrowLeft, RefreshCw, ExternalLink, Flag, Star, Award, Medal, X, Upload,
  Users, Tag, Heart, Eye, EyeOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminEventPath } from '../utils/adminRoutes';
import { SponsorTiersAdminPanel } from '../components/SponsorTiersAdminPanel';
import { DonationsAdminPanel } from '../components/DonationsAdminPanel';
import { SponsorAdminCard, type SponsorQuickEdit } from '../components/sponsors/SponsorAdminCard';
import type {
  AdminSponsor, CourseConfig, ManagedTournament, TierDefinition, TierOption,
} from '../components/sponsors/sponsorAdminTypes';
import { describeSlotTeams } from '../utils/sponsorTeams';

const API_URL = import.meta.env.VITE_API_URL;

const DEFAULT_TIERS: TierDefinition[] = [
  { key: 'title', label: 'Title Sponsor', sort_order: 0 },
  { key: 'platinum', label: 'Platinum', sort_order: 1 },
  { key: 'gold', label: 'Gold', sort_order: 2 },
  { key: 'silver', label: 'Silver', sort_order: 3 },
  { key: 'bronze', label: 'Bronze', sort_order: 4 },
  { key: 'hole', label: 'Hole Sponsor', sort_order: 5 },
];

const TIER_COLORS = [
  'text-yellow-600 bg-yellow-50',
  'text-slate-600 bg-slate-50',
  'text-amber-600 bg-amber-50',
  'text-gray-500 bg-gray-50',
  'text-orange-600 bg-orange-50',
  'text-green-600 bg-green-50',
  'text-blue-600 bg-blue-50',
  'text-purple-600 bg-purple-50',
];

const TIER_ICONS = [Star, Award, Medal, Medal, Medal, Flag, Medal, Medal];

function buildTiers(tierDefs: TierDefinition[]): TierOption[] {
  return [...tierDefs]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t, i) => ({
      value: t.key,
      label: t.label,
      icon: TIER_ICONS[i % TIER_ICONS.length],
      color: TIER_COLORS[i % TIER_COLORS.length],
    }));
}

function sortSponsorsForDisplay(sponsors: AdminSponsor[], courseConfigs: CourseConfig[] = []) {
  const courseOrder = new Map(courseConfigs.map((course, index) => [course.key, index]));

  return [...sponsors].sort((a, b) => {
    if (a.tier === 'hole' && b.tier === 'hole') {
      const courseA = a.course_key ? (courseOrder.get(a.course_key) ?? 999) : 999;
      const courseB = b.course_key ? (courseOrder.get(b.course_key) ?? 999) : 999;
      if (courseA !== courseB) return courseA - courseB;
      if ((a.hole_number || 0) !== (b.hole_number || 0)) return (a.hole_number || 0) - (b.hole_number || 0);
    }

    return a.position - b.position || a.name.localeCompare(b.name);
  });
}

function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const error = (data as { error?: unknown; errors?: unknown }).error ?? (data as { errors?: unknown }).errors;
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) return error.join(', ');
  if (error && typeof error === 'object') {
    const details = (error as { details?: unknown }).details;
    if (Array.isArray(details)) return details.join(', ');
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export const SponsorManagementPage: React.FC = () => {
  const { requestConfirmation, confirmationDialog } = useConfirmDialog();
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { organization } = useOrganization();
  const { getToken } = useAuth();

  const [tournament, setTournament] = useState<ManagedTournament | null>(null);
  const [tierDefinitions, setTierDefinitions] = useState<TierDefinition[]>(DEFAULT_TIERS);
  const [sponsors, setSponsors] = useState<AdminSponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<AdminSponsor | null>(null);
  const [expandedSponsor, setExpandedSponsor] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'sponsors' | 'tiers' | 'donations'>('sponsors');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [savingWall, setSavingWall] = useState(false);

  const startRefresh = useLatestRequest(`${organization?.slug}/${tournamentSlug}`);

  const fetchData = useCallback(async () => {
    if (!organization || !tournamentSlug) return;
    const isCurrent = startRefresh();
    if (!isCurrent()) return;

    try {
      const token = await getToken();
      if (!isCurrent()) return;
      const headers = { Authorization: `Bearer ${token}` };
      const tournamentRes = await fetch(
        `${API_URL}/api/v1/admin/organizations/${organization.slug}/tournaments/${tournamentSlug}`,
        { headers }
      );
      if (!tournamentRes.ok) throw new Error('Failed to load event');
      const tournamentData = await tournamentRes.json();
      if (!isCurrent()) return;
      const tid = (tournamentData.tournament || tournamentData).id;

      const manageRes = await fetch(`${API_URL}/api/v1/tournaments/${tid}/sponsors/manage`, { headers });
      if (!manageRes.ok) throw new Error('Failed to load sponsors');
      const data = await manageRes.json();
      if (!isCurrent()) return;
      setTournament(data.tournament);
      setTierDefinitions(data.tier_definitions?.length ? data.tier_definitions : DEFAULT_TIERS);
      setSponsors(data.sponsors || []);
    } catch {
      if (!isCurrent()) return;
      toast.error('Could not load sponsors. Please refresh.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [organization, tournamentSlug, getToken, startRefresh]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSponsorSlotsFilledChange = useCallback((sponsorId: number, slotsFilled: number, highestFilledSlot?: number) => {
    setSponsors((prev) =>
      prev.map((sponsor) =>
        sponsor.id === sponsorId
          ? {
              ...sponsor,
              slots_filled: slotsFilled,
              ...(highestFilledSlot !== undefined ? { highest_filled_slot: highestFilledSlot } : {}),
            }
          : sponsor
      )
    );
  }, []);

  const replaceSponsor = (updated: AdminSponsor) => {
    setSponsors((prev) => prev.map((sponsor) => (sponsor.id === updated.id ? updated : sponsor)));
  };

  const handleSendInvite = async (sponsor: AdminSponsor) => {
    if (!tournament) return;
    const confirmed = await requestConfirmation({
      title: 'Email the portal invite?',
      description: `We will email a sign-in link to ${sponsor.login_email} so ${sponsor.name} can enter their players.`,
      confirmLabel: 'Send invite',
    });
    if (!confirmed) return;

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournament.id}/sponsors/${sponsor.id}/send_portal_invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(apiErrorMessage(data, 'The invite could not be sent. Try Copy Portal Link instead.'));
        return;
      }
      toast.success(data?.message || 'Portal invite sent');
      setSponsors((prev) => prev.map((item) => (
        item.id === sponsor.id
          ? { ...item, has_active_portal_link: true, portal_link_issued_at: data?.portal_link_issued_at || item.portal_link_issued_at }
          : item
      )));
    } catch {
      toast.error('The invite could not be sent. Try Copy Portal Link instead.');
    }
  };

  const handleQuickSave = async (sponsor: AdminSponsor, changes: SponsorQuickEdit): Promise<boolean> => {
    if (!tournament) return false;
    const highestFilled = sponsor.highest_filled_slot ?? 0;
    if (changes.slot_count < sponsor.slots_filled || changes.slot_count < highestFilled) {
      const confirmed = await requestConfirmation({
        title: 'Remove entered players?',
        description: `${sponsor.name} has players entered in slots up to #${Math.max(highestFilled, sponsor.slots_filled)}. Lowering the slots to ${changes.slot_count} removes players in higher slots from the event.`,
        confirmLabel: 'Lower slots',
        tone: 'danger',
      });
      if (!confirmed) return false;
    }

    const payload: Record<string, unknown> = {
      slot_count: changes.slot_count,
      active: changes.active,
      logo_url: changes.logo_url.trim(),
    };
    if (sponsor.tier === 'hole') payload.hole_number = changes.hole_number;

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournament.id}/sponsors/${sponsor.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsor: payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(apiErrorMessage(data, 'Could not save changes.'));
        return false;
      }
      replaceSponsor(data.sponsor);
      toast.success('Sponsor updated');
      return true;
    } catch {
      toast.error('Could not save changes.');
      return false;
    }
  };

  const handleMarkCheckPaid = async (
    sponsor: AdminSponsor,
    payload: { check_number?: string; check_notes?: string }
  ): Promise<boolean> => {
    if (!tournament) return false;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournament.id}/sponsors/${sponsor.id}/mark_check_paid`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(apiErrorMessage(data, 'Could not mark check paid.'));
        return false;
      }
      if (data?.sponsor) {
        replaceSponsor(data.sponsor);
      }
      toast.success('Sponsor check marked paid and activated');
      return true;
    } catch {
      toast.error('Could not mark check paid.');
      return false;
    }
  };

  const handleToggleWall = async () => {
    if (!tournament) return;
    const next = !tournament.show_public_sponsors;
    setSavingWall(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournament.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournament: { show_public_sponsors: next } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(apiErrorMessage(data, 'Could not update the sponsor wall.'));
        return;
      }
      setTournament({ ...tournament, show_public_sponsors: next });
      toast.success(next ? 'Sponsors are now shown on the public page' : 'Sponsors are now hidden from the public page');
    } catch {
      toast.error('Could not update the sponsor wall.');
    } finally {
      setSavingWall(false);
    }
  };

  const handleDelete = async (sponsor: AdminSponsor) => {
    if (!await requestConfirmation({
      title: 'Delete sponsor?',
      description: `“${sponsor.name}” will be removed from this event’s sponsors.`,
      confirmLabel: 'Delete sponsor',
      tone: 'danger',
    })) return;
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/api/v1/tournaments/${tournament?.id}/sponsors/${sponsor.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Sponsor deleted');
      fetchData();
    } catch { toast.error('Could not delete sponsor.'); }
  };

  const TIERS = buildTiers(tierDefinitions);
  const teamSize = tournament?.team_size || 1;
  const courseConfigs = tournament?.course_configs || [];

  // Sponsors on tiers that were renamed or removed still need a home.
  const knownTiers = new Set(TIERS.map((tier) => tier.value));
  for (const sponsor of sponsors) {
    if (knownTiers.has(sponsor.tier)) continue;
    knownTiers.add(sponsor.tier);
    TIERS.push({ value: sponsor.tier, label: sponsor.tier_display || sponsor.tier, icon: Medal, color: TIER_COLORS[3] });
  }

  const sponsorsByTier = TIERS.reduce((acc, tier) => {
    acc[tier.value] = sponsors.filter((s) => s.tier === tier.value);
    return acc;
  }, {} as Record<string, AdminSponsor[]>);

  const activeSponsors = sponsors.filter((s) => s.active);
  const portalSlotsTotal = activeSponsors.reduce((sum, s) => sum + (s.slot_count || 0), 0);
  const portalSlotsFilled = activeSponsors.reduce((sum, s) => sum + Math.min(s.slots_filled || 0, s.slot_count || 0), 0);
  const fillPercent = portalSlotsTotal > 0 ? Math.round((portalSlotsFilled / portalSlotsTotal) * 100) : 0;
  const visibleTiers = tierFilter === 'all' ? TIERS : TIERS.filter((tier) => tier.value === tierFilter);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center rounded-3xl bg-white">
        <p className="text-base text-gray-600">Loading sponsors…</p>
      </div>
    );
  }

  const tabClass = (tab: typeof activeTab) => `inline-flex min-h-[48px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${
    activeTab === tab ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-gray-900'
  }`;

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {confirmationDialog}
      <section className="rounded-[28px] bg-brand-600 px-4 py-4 text-brand-foreground shadow-sm sm:px-6 sm:py-5 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link to={adminEventPath(tournamentSlug || '')} className="mb-1 inline-flex items-center gap-2 text-sm text-white/80 hover:text-white sm:mb-2">
                <ArrowLeft className="h-4 w-4" /> Back to Tournament
              </Link>
              <h1 className="flex items-center gap-2 text-xl font-bold sm:gap-3 sm:text-2xl">
                <Building2 className="h-6 w-6 flex-shrink-0 sm:h-8 sm:w-8" /> Sponsor Management
              </h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button type="button" onClick={fetchData} aria-label="Refresh sponsors" className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
                <RefreshCw className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => { setEditingSponsor(null); setShowModal(true); }}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                <Plus className="h-5 w-5" /> Add Sponsor
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-200">
          <button type="button" onClick={() => setActiveTab('sponsors')} className={tabClass('sponsors')}>
            <Building2 className="h-4 w-4" /> Sponsors ({sponsors.length})
          </button>
          <button type="button" onClick={() => setActiveTab('tiers')} className={tabClass('tiers')}>
            <Tag className="h-4 w-4" /> Priced Tiers
          </button>
          <button type="button" onClick={() => setActiveTab('donations')} className={tabClass('donations')}>
            <Heart className="h-4 w-4" /> Donations
          </button>
        </div>
      </div>

      {activeTab === 'tiers' && tournament?.id ? (
        <main className="mx-auto max-w-6xl px-4 pb-8">
          <SponsorTiersAdminPanel tournamentId={Number(tournament.id)} orgSlug={organization?.slug} tournamentSlug={tournamentSlug} />
        </main>
      ) : activeTab === 'donations' && tournament?.id ? (
        <main className="mx-auto max-w-6xl px-4 pb-8">
          <DonationsAdminPanel tournamentId={Number(tournament.id)} orgSlug={organization?.slug} tournamentSlug={tournamentSlug} />
        </main>
      ) : (
      <>
      {/* Summary strip */}
      <section aria-label="Sponsor summary" className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 md:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
          <Building2 className="h-8 w-8 flex-shrink-0 text-brand-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm text-gray-600">Total Sponsors</p>
            <p className="text-2xl font-bold text-gray-900">{activeSponsors.length}</p>
            {sponsors.length > activeSponsors.length && (
              <p className="text-xs text-gray-500">{sponsors.length - activeSponsors.length} hidden</p>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <Users className="h-8 w-8 flex-shrink-0 text-brand-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600">Portal Slots Filled</p>
              <p className="text-2xl font-bold text-gray-900">
                {portalSlotsFilled} / {portalSlotsTotal} <span className="text-base font-medium text-gray-600">players</span>
              </p>
            </div>
          </div>
          <div
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
            role="progressbar"
            aria-label="Portal slots filled"
            aria-valuemin={0}
            aria-valuemax={portalSlotsTotal}
            aria-valuenow={portalSlotsFilled}
          >
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${fillPercent}%` }} />
          </div>
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-600">Public Sponsor Wall</p>
              <p className="flex items-center gap-2 text-lg font-bold text-gray-900">
                {tournament?.show_public_sponsors
                  ? <><Eye className="h-5 w-5 text-green-600" aria-hidden="true" /> Visible</>
                  : <><EyeOff className="h-5 w-5 text-gray-500" aria-hidden="true" /> Hidden</>}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!tournament?.show_public_sponsors}
              aria-label="Show sponsors on the public event page"
              onClick={handleToggleWall}
              disabled={savingWall || !tournament}
              className={`relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full disabled:opacity-50 ${tournament?.show_public_sponsors ? 'bg-brand-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-6 w-6 rounded-full bg-white shadow ${tournament?.show_public_sponsors ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
          {tournament?.public_page_url && (
            <a
              href={tournament.public_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Preview Public Page
            </a>
          )}
          {tournament && !tournament.public_listed && (
            <p className="mt-2 text-xs text-gray-500">This event page is not published yet, so the public preview may not load.</p>
          )}
        </div>
      </section>

      {/* Tier filter pills */}
      {sponsors.length > 0 && (
        <nav aria-label="Filter by tier" className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4">
          {[{ value: 'all', label: 'All', count: sponsors.length }, ...TIERS.map((tier) => ({ value: tier.value, label: tier.label, count: (sponsorsByTier[tier.value] || []).length }))]
            .filter((pill) => pill.value === 'all' || pill.count > 0)
            .map((pill) => (
              <button
                key={pill.value}
                type="button"
                aria-pressed={tierFilter === pill.value}
                onClick={() => setTierFilter(pill.value)}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm font-medium ${
                  tierFilter === pill.value
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {pill.label}
                <span className={`rounded-full px-2 text-xs ${tierFilter === pill.value ? 'bg-white/20' : 'bg-gray-100'}`}>{pill.count}</span>
              </button>
            ))}
        </nav>
      )}

      {/* Sponsors by tier */}
      <main className="mx-auto max-w-6xl px-4 pb-8">
        {visibleTiers.map((tier) => {
          const tierSponsors = sortSponsorsForDisplay(sponsorsByTier[tier.value] || [], courseConfigs);
          if (tierSponsors.length === 0) return null;
          const TierIcon = tier.icon;

          return (
            <section key={tier.value} className="mb-6" aria-label={tier.label}>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <span className={`rounded-lg p-2 ${tier.color}`}><TierIcon className="h-5 w-5" /></span>
                {tier.label} ({tierSponsors.length})
              </h2>
              <div className="space-y-3">
                {tierSponsors.map((sponsor) => (
                  <SponsorAdminCard
                    key={sponsor.id}
                    sponsor={sponsor}
                    tournamentId={tournament?.id || 0}
                    teamSize={teamSize}
                    handicapRequired={Boolean(tournament?.handicap_required)}
                    courseConfigs={courseConfigs}
                    expanded={expandedSponsor === sponsor.id}
                    onToggleExpand={() => setExpandedSponsor(expandedSponsor === sponsor.id ? null : sponsor.id)}
                    onEdit={() => { setEditingSponsor(sponsor); setShowModal(true); }}
                    onDelete={() => handleDelete(sponsor)}
                    onSendInvite={() => handleSendInvite(sponsor)}
                    onQuickSave={(changes) => handleQuickSave(sponsor, changes)}
                    onMarkCheckPaid={(payload) => handleMarkCheckPaid(sponsor, payload)}
                    onSlotsFilledChange={handleSponsorSlotsFilledChange}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {sponsors.length === 0 && (
          <div className="rounded-xl bg-white py-12 text-center">
            <Building2 className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p className="text-base text-gray-600">No sponsors yet. Use Add Sponsor to create the first one.</p>
          </div>
        )}
      </main>
      </>
      )}

      {showModal && (
        <SponsorModal
          sponsor={editingSponsor}
          tournamentId={tournament?.id || 0}
          teamSize={teamSize}
          courseConfigs={courseConfigs}
          tiers={TIERS}
          onClose={() => { setShowModal(false); setEditingSponsor(null); }}
          onSuccess={() => { setShowModal(false); setEditingSponsor(null); fetchData(); }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sponsor Modal (Create / Edit)
// ---------------------------------------------------------------------------
const SponsorModal: React.FC<{
  sponsor: AdminSponsor | null;
  tournamentId: number;
  teamSize: number;
  courseConfigs: CourseConfig[];
  tiers: TierOption[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ sponsor, tournamentId, teamSize, courseConfigs, tiers, onClose, onSuccess }) => {
  const { getToken } = useAuth();
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: sponsor?.name || '',
    tier: sponsor?.tier || tiers[tiers.length - 1]?.value || 'bronze',
    logo_url: sponsor?.raw_logo_url || '',
    website_url: sponsor?.website_url || '',
    description: sponsor?.description || '',
    course_key: sponsor?.course_key || '',
    hole_number: sponsor?.hole_number || '',
    active: sponsor?.active ?? true,
    login_email: sponsor?.login_email || '',
    slot_count: sponsor?.slot_count || 0,
  });

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
      setForm({ ...form, logo_url: '' });
    }
  };

  const selectedCourse = courseConfigs.find((course) => course.key === form.course_key) || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = await getToken();
      const url = sponsor
        ? `${API_URL}/api/v1/tournaments/${tournamentId}/sponsors/${sponsor.id}`
        : `${API_URL}/api/v1/tournaments/${tournamentId}/sponsors`;
      const slotCount = form.slot_count;
      let res: Response;

      if (logoFile) {
        const fd = new FormData();
        fd.append('sponsor[name]', form.name);
        fd.append('sponsor[tier]', form.tier);
        fd.append('sponsor[logo_url]', '');
        fd.append('sponsor[website_url]', form.website_url);
        fd.append('sponsor[description]', form.description);
        fd.append('sponsor[course_key]', form.tier === 'hole' ? form.course_key : '');
        fd.append('sponsor[hole_number]', form.tier === 'hole' ? String(form.hole_number) : '');
        fd.append('sponsor[active]', String(form.active));
        fd.append('sponsor[login_email]', form.login_email);
        fd.append('sponsor[slot_count]', String(slotCount));
        fd.append('sponsor[logo]', logoFile);
        res = await fetch(url, { method: sponsor ? 'PATCH' : 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
      } else {
        const payload = {
          name: form.name,
          tier: form.tier,
          logo_url: form.logo_url,
          website_url: form.website_url,
          description: form.description,
          active: form.active,
          login_email: form.login_email,
          slot_count: slotCount,
          course_key: form.tier === 'hole' ? form.course_key : null,
          hole_number: form.tier === 'hole' ? Number(form.hole_number) : null,
        };
        res = await fetch(url, {
          method: sponsor ? 'PATCH' : 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sponsor: payload }),
        });
      }

      if (!res.ok) { const data = await res.json().catch(() => null); throw new Error(apiErrorMessage(data, 'Failed to save')); }
      toast.success(sponsor ? 'Sponsor updated' : 'Sponsor created');
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save sponsor');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{sponsor ? 'Edit Sponsor' : 'Add Sponsor'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full min-h-[48px] border rounded-lg px-3 py-2 text-base" required />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tier</label>
            <select
              value={form.tier}
              onChange={e => {
                const nextTier = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  tier: nextTier,
                  course_key: nextTier === 'hole' ? (prev.course_key || courseConfigs[0]?.key || '') : '',
                  hole_number: nextTier === 'hole' ? prev.hole_number : '',
                }));
              }}
              className="w-full min-h-[48px] border rounded-lg px-3 py-2 text-base"
            >
              {tiers.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
          </div>

          {form.tier === 'hole' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Course *</label>
                <select
                  value={form.course_key}
                  onChange={e => setForm({ ...form, course_key: e.target.value, hole_number: '' })}
                  className="w-full min-h-[48px] border rounded-lg px-3 py-2 text-base"
                  required
                >
                  <option value="">Select course...</option>
                  {courseConfigs.map((course) => (
                    <option key={course.key} value={course.key}>{course.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Hole Number *</label>
                <select value={form.hole_number} onChange={e => setForm({ ...form, hole_number: e.target.value })} className="w-full min-h-[48px] border rounded-lg px-3 py-2 text-base" required>
                  <option value="">Select hole...</option>
                  {Array.from({ length: selectedCourse?.hole_count || 0 }, (_, i) => i + 1).map(hole => (
                    <option key={hole} value={hole}>{selectedCourse?.name} {hole}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Sponsor Logo</label>
            <div className="space-y-2">
              <label className="flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-neutral-300 rounded-xl cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 text-sm text-neutral-500">
                <Upload className="w-4 h-4" /> {logoFile ? logoFile.name : 'Upload image'}
                <input type="file" accept="image/*" onChange={handleLogoFileChange} className="hidden" />
              </label>
              {!logoFile && (
                <div>
                  <p className="text-xs text-neutral-400 mb-1">Or paste a URL:</p>
                  <input type="url" placeholder="https://example.com/logo.png" value={form.logo_url}
                    onChange={e => { setForm({ ...form, logo_url: e.target.value }); setLogoFile(null); setLogoPreview(null); }}
                    className="w-full min-h-[48px] rounded-xl border border-neutral-200 px-3 py-2 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
                </div>
              )}
              {(logoPreview || form.logo_url) && (
                <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 flex items-center gap-3">
                  <img src={logoPreview || form.logo_url} alt="Preview" className="max-h-10 max-w-24 object-contain" />
                  <span className="text-xs text-neutral-500">Logo preview</span>
                  {logoFile && (<button type="button" onClick={() => { setLogoFile(null); setLogoPreview(null); }} className="ml-auto text-xs text-red-500 hover:underline">Remove</button>)}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Website URL</label>
            <input type="url" value={form.website_url} onChange={e => setForm({ ...form, website_url: e.target.value })} className="w-full min-h-[48px] border rounded-lg px-3 py-2 text-base" placeholder="https://..." />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full min-h-[48px] border rounded-lg px-3 py-2 text-base" rows={2} />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Portal Login Email <span className="text-xs text-neutral-400 ml-1">(sponsor receives a magic link to manage their teams)</span>
            </label>
            <input type="email" placeholder="sponsor@company.com" value={form.login_email || ''}
              onChange={e => setForm({ ...form, login_email: e.target.value })}
              className="w-full min-h-[48px] rounded-xl border border-neutral-200 px-3 py-2 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
          </div>

          <div>
            <label htmlFor="sponsor-slot-count" className="block text-sm font-medium text-neutral-700 mb-1">
              Player slots <span className="text-xs text-neutral-500 ml-1">(players this sponsor can enter in the portal)</span>
            </label>
            <input id="sponsor-slot-count" type="number" min="0" max="100" inputMode="numeric" placeholder="0" value={form.slot_count || 0}
              onChange={e => setForm({ ...form, slot_count: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              className="w-full min-h-[48px] rounded-xl border border-neutral-200 px-3 py-2 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
            <p className="text-xs text-neutral-500 mt-1">
              {form.slot_count > 0
                ? `= ${describeSlotTeams(form.slot_count, teamSize)} (${teamSize === 1 ? 'individual players' : `${teamSize} players per team`})`
                : `Tip: this event uses ${teamSize === 1 ? 'individual players' : `teams of ${teamSize}`}.`}
            </p>
          </div>

          <label htmlFor="active" className="flex min-h-[48px] cursor-pointer items-center gap-3">
            <input type="checkbox" id="active" className="h-5 w-5" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
            <span className="text-base">Active (visible on public pages)</span>
          </label>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 min-h-[48px] px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 min-h-[48px] px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'Saving...' : (sponsor ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
