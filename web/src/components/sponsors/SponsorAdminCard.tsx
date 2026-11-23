import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import {
  ChevronDown, ChevronUp, Copy, Edit, ExternalLink, Mail, Save, SlidersHorizontal, Trash2, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SponsorMonogram } from './SponsorMonogram';
import type { AdminSponsor, AdminSponsorSlot, CourseConfig } from './sponsorAdminTypes';
import {
  TSHIRT_SIZES,
  copyTextToClipboard,
  describeSponsorSlots,
  groupSlotsIntoTeams,
  portalStatus,
  teamHeading,
  type PortalStatusTone,
} from '../../utils/sponsorTeams';
import { formatShortDate } from '../../utils/dates';

const API_URL = import.meta.env.VITE_API_URL;

const STATUS_CLASSES: Record<PortalStatusTone, string> = {
  complete: 'bg-green-50 text-green-800 ring-green-200',
  partial: 'bg-amber-50 text-amber-800 ring-amber-200',
  empty: 'bg-gray-100 text-gray-700 ring-gray-200',
  none: 'bg-gray-50 text-gray-500 ring-gray-200',
};

const inputClass = 'w-full min-h-[48px] rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30';
const actionButtonClass = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export interface SponsorQuickEdit {
  slot_count: number;
  active: boolean;
  logo_url: string;
  hole_number: number | null;
}

export const SponsorAdminCard: React.FC<{
  sponsor: AdminSponsor;
  tournamentId: number;
  teamSize: number;
  courseConfigs: CourseConfig[];
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSendInvite: () => Promise<void>;
  onQuickSave: (changes: SponsorQuickEdit) => Promise<boolean>;
  onSlotsFilledChange: (sponsorId: number, slotsFilled: number) => void;
}> = ({
  sponsor, tournamentId, teamSize, courseConfigs, expanded, onToggleExpand, onEdit, onDelete,
  onSendInvite, onQuickSave, onSlotsFilledChange,
}) => {
  const { getToken } = useAuth();
  const status = portalStatus(sponsor.slot_count, sponsor.slots_filled);
  const portalBlockedReason = !sponsor.login_email
    ? 'Add a portal email to share the portal.'
    : !sponsor.active
      ? 'Turn this sponsor on to share the portal.'
      : null;

  const [sendingInvite, setSendingInvite] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickForm, setQuickForm] = useState<SponsorQuickEdit>(() => quickFormFor(sponsor));

  const holeCourse = courseConfigs.find((course) => course.key === sponsor.course_key) || courseConfigs[0];

  const handleCopyLink = async () => {
    setCopyingLink(true);
    setManualLink(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournamentId}/sponsors/${sponsor.id}/portal_link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        toast.error(data?.error || 'Could not create a portal link.');
        return;
      }
      if (await copyTextToClipboard(data.url)) {
        toast.success('Link copied for WhatsApp / SMS');
      } else {
        setManualLink(data.url);
        toast('Copy the link shown below the buttons.');
      }
    } catch {
      toast.error('Could not create a portal link.');
    } finally {
      setCopyingLink(false);
    }
  };

  const handleSendInvite = async () => {
    setSendingInvite(true);
    try {
      await onSendInvite();
    } finally {
      setSendingInvite(false);
    }
  };

  const openQuickEdit = () => {
    setQuickForm(quickFormFor(sponsor));
    setQuickEditOpen(true);
  };

  const saveQuickEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickSaving(true);
    try {
      if (await onQuickSave(quickForm)) setQuickEditOpen(false);
    } finally {
      setQuickSaving(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={sponsor.name}>
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {sponsor.logo_url ? (
            <img src={sponsor.logo_url} alt={sponsor.name} className="h-12 w-12 flex-shrink-0 rounded-lg bg-gray-50 object-contain" />
          ) : (
            <SponsorMonogram name={sponsor.name} size="sm" className="h-12 w-12" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-gray-900">{sponsor.name}</h3>
              {!sponsor.active && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-200">
                  Hidden
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600">{sponsor.display_label}</p>
            <p className="flex items-center gap-1.5 text-sm text-gray-700">
              <Mail className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
              {sponsor.login_email
                ? <span className="truncate">{sponsor.login_email}</span>
                : <span className="text-gray-500">No portal email yet</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800">
                <Users className="h-4 w-4 text-gray-400" aria-hidden="true" />
                {describeSponsorSlots(sponsor.slot_count, sponsor.slots_filled, teamSize)}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_CLASSES[status.tone]}`}>
                {status.label}
              </span>
            </div>
            {sponsor.portal_link_issued_at && (
              <p className="text-xs text-gray-500">Portal link last shared {formatShortDate(sponsor.portal_link_issued_at)}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:w-[22rem]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleSendInvite}
              disabled={!!portalBlockedReason || sendingInvite}
              className={`${actionButtonClass} bg-brand-600 text-white hover:bg-brand-700`}
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {sendingInvite ? 'Sending…' : 'Send Portal Invite'}
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={!!portalBlockedReason || copyingLink}
              className={`${actionButtonClass} border border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100`}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              {copyingLink ? 'Getting link…' : 'Copy Portal Link'}
            </button>
          </div>
          {portalBlockedReason && <p className="text-xs text-gray-500">{portalBlockedReason}</p>}
          {manualLink && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <label htmlFor={`portal-link-${sponsor.id}`} className="mb-1 block text-sm font-medium text-amber-900">
                Copy this link and paste it into WhatsApp or a text message:
              </label>
              <input
                id={`portal-link-${sponsor.id}`}
                readOnly
                value={manualLink}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputClass} bg-white`}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {sponsor.slot_count > 0 && (
              <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={expanded}
                className={`${actionButtonClass} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}
              >
                {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                Players
              </button>
            )}
            <button
              type="button"
              onClick={quickEditOpen ? () => setQuickEditOpen(false) : openQuickEdit}
              aria-expanded={quickEditOpen}
              className={`${actionButtonClass} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Quick Edit
            </button>
            <button type="button" onClick={onEdit} aria-label={`Edit ${sponsor.name}`} className={`${actionButtonClass} border border-gray-200 text-gray-600 hover:bg-gray-50`}>
              <Edit className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={onDelete} aria-label={`Delete ${sponsor.name}`} className={`${actionButtonClass} border border-gray-200 text-red-600 hover:bg-red-50`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
            {sponsor.website_url && (
              <a
                href={sponsor.website_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${sponsor.name} website`}
                className={`${actionButtonClass} border border-gray-200 text-gray-600 hover:bg-gray-50`}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </div>

      {quickEditOpen && (
        <form onSubmit={saveQuickEdit} className="border-t border-gray-100 bg-gray-50 p-4" aria-label={`Quick edit ${sponsor.name}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor={`qe-slots-${sponsor.id}`} className="mb-1 block text-sm font-medium text-gray-700">Player slots</label>
              <input
                id={`qe-slots-${sponsor.id}`}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={quickForm.slot_count}
                onChange={(e) => setQuickForm({ ...quickForm, slot_count: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500">{describeSponsorSlots(quickForm.slot_count, 0, teamSize).split(' · ')[0]}</p>
            </div>
            <div>
              <label htmlFor={`qe-logo-${sponsor.id}`} className="mb-1 block text-sm font-medium text-gray-700">Logo link</label>
              <input
                id={`qe-logo-${sponsor.id}`}
                type="url"
                placeholder="https://example.com/logo.png"
                value={quickForm.logo_url}
                onChange={(e) => setQuickForm({ ...quickForm, logo_url: e.target.value })}
                className={inputClass}
              />
              {sponsor.has_uploaded_logo && (
                <p className="mt-1 text-xs text-gray-500">An uploaded logo is showing. Use Edit to replace it.</p>
              )}
            </div>
            {sponsor.tier === 'hole' && holeCourse ? (
              <div>
                <label htmlFor={`qe-hole-${sponsor.id}`} className="mb-1 block text-sm font-medium text-gray-700">Hole</label>
                <select
                  id={`qe-hole-${sponsor.id}`}
                  value={quickForm.hole_number ?? ''}
                  onChange={(e) => setQuickForm({ ...quickForm, hole_number: e.target.value ? Number(e.target.value) : null })}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">Select hole…</option>
                  {Array.from({ length: holeCourse.hole_count || 0 }, (_, i) => i + 1).map((hole) => (
                    <option key={hole} value={hole}>{holeCourse.name} {hole}</option>
                  ))}
                </select>
              </div>
            ) : <div className="hidden lg:block" />}
            <div className="flex items-end">
              <label className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-lg border border-gray-300 bg-white px-3">
                <input
                  type="checkbox"
                  checked={quickForm.active}
                  onChange={(e) => setQuickForm({ ...quickForm, active: e.target.checked })}
                  className="h-5 w-5"
                />
                <span className="text-base text-gray-800">Active (shown publicly)</span>
              </label>
            </div>
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setQuickEditOpen(false)} className={`${actionButtonClass} border border-gray-300 bg-white text-gray-700 hover:bg-gray-100`}>
              Cancel
            </button>
            <button type="submit" disabled={quickSaving} className={`${actionButtonClass} bg-brand-600 text-white hover:bg-brand-700`}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {quickSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {expanded && sponsor.slot_count > 0 && (
        <SponsorPlayersPanel
          sponsor={sponsor}
          tournamentId={tournamentId}
          teamSize={teamSize}
          onSlotsFilledChange={onSlotsFilledChange}
        />
      )}
    </article>
  );
};

function quickFormFor(sponsor: AdminSponsor): SponsorQuickEdit {
  return {
    slot_count: sponsor.slot_count || 0,
    active: sponsor.active,
    logo_url: sponsor.raw_logo_url || '',
    hole_number: sponsor.hole_number,
  };
}

// ---------------------------------------------------------------------------
// Admin player editor, grouped into teams by the tournament team size
// ---------------------------------------------------------------------------
const SponsorPlayersPanel: React.FC<{
  sponsor: AdminSponsor;
  tournamentId: number;
  teamSize: number;
  onSlotsFilledChange: (sponsorId: number, slotsFilled: number) => void;
}> = ({ sponsor, tournamentId, teamSize, onSlotsFilledChange }) => {
  const { getToken } = useAuth();
  const [slots, setSlots] = useState<AdminSponsorSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [slotForm, setSlotForm] = useState({ player_name: '', player_email: '', player_phone: '', tshirt_size: '' });
  const [saving, setSaving] = useState(false);
  const latestSponsor = useRef(sponsor.id);

  const fetchSlots = useCallback(async () => {
    latestSponsor.current = sponsor.id;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournamentId}/sponsors/${sponsor.id}/slots`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || latestSponsor.current !== sponsor.id) return;
      const data = await res.json();
      const loaded: AdminSponsorSlot[] = data.slots || [];
      setSlots(loaded);
      onSlotsFilledChange(sponsor.id, loaded.filter((slot) => !!slot.player_name?.trim()).length);
    } catch {
      toast.error('Could not load players.');
    } finally {
      setLoading(false);
    }
  }, [getToken, tournamentId, sponsor.id, onSlotsFilledChange]);

  useEffect(() => {
    setLoading(true);
    setEditingSlotId(null);
    fetchSlots();
  }, [fetchSlots, sponsor.slot_count]);

  const startEditing = (slot: AdminSponsorSlot) => {
    setEditingSlotId(slot.id);
    setSlotForm({
      player_name: slot.player_name || '',
      player_email: slot.player_email || '',
      player_phone: slot.player_phone || '',
      tshirt_size: slot.tshirt_size || '',
    });
  };

  const saveSlot = async (slotId: number) => {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournamentId}/sponsors/${sponsor.id}/slots/${slotId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(slotForm),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error?.details?.join?.(', ') || data?.error?.message || data?.error || 'Could not save this player.');
        return;
      }
      const nextSlots = slots.map((slot) => (slot.id === slotId ? data.slot as AdminSponsorSlot : slot));
      setSlots(nextSlots);
      onSlotsFilledChange(sponsor.id, nextSlots.filter((slot) => !!slot.player_name?.trim()).length);
      toast.success('Player saved');
      setEditingSlotId(null);
    } catch {
      toast.error('Could not save this player.');
    } finally {
      setSaving(false);
    }
  };

  const teams = groupSlotsIntoTeams(slots, teamSize);

  return (
    <div className="border-t border-gray-100 bg-gray-50 p-4">
      <h4 className="mb-3 text-sm font-semibold text-gray-700">Sponsored players</h4>
      {loading ? (
        <p className="text-sm text-gray-500">Loading players…</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-500">No player slots yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {teams.map((team) => (
            <section key={team.teamNumber} className="rounded-lg border border-gray-200 bg-white" aria-label={teamHeading(team)}>
              <h5 className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-800">
                {teamSize === 1 ? `Player ${team.firstPlayer}` : teamHeading(team)}
              </h5>
              <ul className="divide-y divide-gray-100">
                {team.slots.map((slot) => (
                  <li key={slot.id} className="p-3">
                    {editingSlotId === slot.id ? (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-gray-700">Player {slot.slot_number}</p>
                        <input aria-label="Player name" placeholder="Full name" value={slotForm.player_name}
                          onChange={(e) => setSlotForm({ ...slotForm, player_name: e.target.value })} className={inputClass} />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <input aria-label="Email" type="email" placeholder="Email" value={slotForm.player_email}
                            onChange={(e) => setSlotForm({ ...slotForm, player_email: e.target.value })} className={inputClass} />
                          <input aria-label="Phone" type="tel" placeholder="Phone" value={slotForm.player_phone}
                            onChange={(e) => setSlotForm({ ...slotForm, player_phone: e.target.value })} className={inputClass} />
                          <select aria-label="Shirt size" value={slotForm.tshirt_size}
                            onChange={(e) => setSlotForm({ ...slotForm, tshirt_size: e.target.value })} className={`${inputClass} bg-white`}>
                            <option value="">Shirt size</option>
                            {TSHIRT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                          </select>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingSlotId(null)} className={`${actionButtonClass} border border-gray-300 text-gray-700 hover:bg-gray-100`}>Cancel</button>
                          <button type="button" onClick={() => saveSlot(slot.id)} disabled={saving} className={`${actionButtonClass} bg-brand-600 text-white hover:bg-brand-700`}>
                            <Save className="h-4 w-4" aria-hidden="true" /> {saving ? 'Saving…' : 'Save Player'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="w-6 flex-shrink-0 text-sm font-semibold text-gray-400">{slot.slot_number}</span>
                        <div className="min-w-0 flex-1">
                          {slot.player_name ? (
                            <>
                              <p className="truncate text-sm font-medium text-gray-900">{slot.player_name}</p>
                              <p className="truncate text-xs text-gray-500">
                                {[slot.player_email, slot.player_phone, slot.tshirt_size && `Shirt ${slot.tshirt_size}`].filter(Boolean).join(' · ') || 'No contact info'}
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-gray-500">Not entered yet</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => startEditing(slot)}
                          aria-label={`Edit player ${slot.slot_number}`}
                          className={`${actionButtonClass} border border-gray-200 text-gray-600 hover:bg-gray-50`}
                        >
                          <Edit className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
