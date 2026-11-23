import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CalendarDays, CheckCircle, ClipboardCheck, Clock, ExternalLink, Flag, Lock, Save, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganization } from '../OrganizationProvider';
import { useApplyBranding } from '../../utils/branding';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { SponsorMonogram } from './SponsorMonogram';
import {
  TSHIRT_SIZES,
  formatGuamDeadline,
  groupSlotsIntoTeams,
  normalizeTeamSize,
  teamHeading,
  type SlotTeam,
} from '../../utils/sponsorTeams';
import {
  toVerifiedPortalData,
  type OrgInfo,
  type PortalSlot,
  type PortalSponsorship,
  type SponsorInfo,
  type TournamentInfo,
  type VerifiedSponsorPortalData,
} from './sponsorPortalTypes';

const API_URL = import.meta.env.VITE_API_URL;

interface PlayerDraft {
  player_name: string;
  player_email: string;
  player_phone: string;
  tshirt_size: string;
  handicap: string;
}

const inputClass = 'w-full min-h-[48px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600';

function draftFor(slot: PortalSlot): PlayerDraft {
  return {
    player_name: slot.player_name || '',
    player_email: slot.player_email || '',
    player_phone: slot.player_phone || '',
    tshirt_size: slot.tshirt_size || '',
    handicap: slot.handicap === null || slot.handicap === undefined ? '' : String(slot.handicap),
  };
}

function draftChanged(slot: PortalSlot, draft: PlayerDraft | undefined): boolean {
  if (!draft) return false;
  const saved = draftFor(slot);
  return (Object.keys(saved) as (keyof PlayerDraft)[]).some((key) => saved[key].trim() !== draft[key].trim());
}

const isFilled = (slot: PortalSlot) => !!slot.player_name?.trim();

export const SponsorPortalDashboard: React.FC<{
  sessionToken: string;
  initialSponsor: SponsorInfo;
  initialTournament: TournamentInfo;
  initialOrg: OrgInfo;
  onSessionExpired: () => void;
  onSwitchSponsorship: (data: VerifiedSponsorPortalData) => void;
}> = ({ sessionToken, initialSponsor, initialTournament, initialOrg, onSessionExpired, onSwitchSponsorship }) => {
  const { organization } = useOrganization();
  const { requestConfirmation, confirmationDialog } = useConfirmDialog();
  const sponsor = initialSponsor;
  const orgInfo = initialOrg;
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>(initialTournament);
  const [slots, setSlots] = useState<PortalSlot[]>([]);
  const [drafts, setDrafts] = useState<Record<number, PlayerDraft>>({});
  const [slotErrors, setSlotErrors] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingTeam, setSavingTeam] = useState<number | null>(null);
  const [sponsorships, setSponsorships] = useState<PortalSponsorship[]>([]);
  const [switchingTo, setSwitchingTo] = useState<number | null>(null);

  const branding = useApplyBranding({
    ...organization,
    name: orgInfo?.name || organization?.name,
    primary_color: orgInfo?.primary_color || organization?.primary_color,
    logo_url: orgInfo?.logo_url || organization?.logo_url,
  });
  const brandColor = branding.primaryColor;

  const teamSize = normalizeTeamSize(tournamentInfo.team_size);
  const deadline = tournamentInfo.sponsor_edit_deadline;
  const locked = tournamentInfo.edit_deadline_passed ?? (deadline ? new Date(deadline) < new Date() : false);
  const waiverEnabled = tournamentInfo.waiver_enabled !== false;
  const handicapRequired = !!tournamentInfo.handicap_required;

  const authHeaders = useMemo(() => ({ 'X-Sponsor-Session': sessionToken }), [sessionToken]);

  const fetchSlots = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/sponsor_slots`, { headers: authHeaders });
      if (res.status === 401) { onSessionExpired(); return; }
      if (!res.ok) { setLoadFailed(true); return; }
      const data = await res.json();
      const loaded: PortalSlot[] = data.slots || [];
      setSlots(loaded);
      setDrafts(Object.fromEntries(loaded.map((slot) => [slot.id, draftFor(slot)])));
      setLoadFailed(false);
      if (data.tournament) setTournamentInfo((prev) => ({ ...prev, ...data.tournament }));
      else if (typeof data.waiver_enabled === 'boolean') setTournamentInfo((prev) => ({ ...prev, waiver_enabled: data.waiver_enabled }));
    } catch {
      setLoadFailed(true);
    }
  }, [authHeaders, onSessionExpired]);

  useEffect(() => {
    fetchSlots().finally(() => setLoading(false));
  }, [fetchSlots]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/v1/sponsor_access/sponsorships`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.sponsorships) setSponsorships(data.sponsorships); })
      .catch(() => { /* the switcher is optional */ });
    return () => { cancelled = true; };
  }, [authHeaders]);

  const updateDraft = (slotId: number, field: keyof PlayerDraft, value: string) => {
    setDrafts((prev) => ({ ...prev, [slotId]: { ...prev[slotId], [field]: value } }));
    setSlotErrors((prev) => {
      if (!prev[slotId]) return prev;
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  };

  const validateTeam = (team: SlotTeam<PortalSlot>): Record<number, string[]> => {
    const errors: Record<number, string[]> = {};
    for (const slot of team.slots) {
      const draft = drafts[slot.id];
      if (!draft) continue;
      const messages: string[] = [];
      const named = !!draft.player_name.trim();
      const handicap = draft.handicap.trim();
      if (draft.player_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.player_email.trim())) {
        messages.push('Please check the email address.');
      }
      if (handicap && (Number.isNaN(Number(handicap)) || Number(handicap) < -10 || Number(handicap) > 54)) {
        messages.push('Handicap must be a number between -10 and 54.');
      }
      if (named && handicapRequired && !handicap) {
        messages.push('This event needs a handicap for each player.');
      }
      if (!named && (draft.player_email.trim() || draft.player_phone.trim())) {
        messages.push('Add the player’s name, or clear the email and phone.');
      }
      if (messages.length) errors[slot.id] = messages;
    }
    return errors;
  };

  const saveTeam = async (team: SlotTeam<PortalSlot>) => {
    const errors = validateTeam(team);
    if (Object.keys(errors).length) {
      setSlotErrors((prev) => ({ ...prev, ...errors }));
      toast.error('Please fix the highlighted players.');
      return;
    }

    setSavingTeam(team.teamNumber);
    try {
      const res = await fetch(`${API_URL}/api/v1/sponsor_slots/batch`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slots: team.slots.map((slot) => {
            const draft = drafts[slot.id] || draftFor(slot);
            const handicap = draft.handicap.trim();
            return {
              id: slot.id,
              player_name: draft.player_name.trim() || null,
              player_email: draft.player_email.trim() || null,
              player_phone: draft.player_phone.trim() || null,
              tshirt_size: draft.tshirt_size || null,
              handicap: handicap === '' ? null : Number(handicap),
            };
          }),
        }),
      });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json().catch(() => null);
      if (res.status === 403) {
        toast.error(data?.error || 'Changes are closed for this event.');
        setTournamentInfo((prev) => ({ ...prev, edit_deadline_passed: true }));
        return;
      }
      if (!res.ok) {
        if (data?.slot_errors) setSlotErrors(data.slot_errors);
        toast.error(data?.error || 'Nothing was saved. Please try again.');
        return;
      }

      const saved: PortalSlot[] = data.slots || [];
      const savedById = new Map(saved.map((slot) => [slot.id, slot]));
      setSlots((prev) => prev.map((slot) => savedById.get(slot.id) || slot));
      setDrafts((prev) => ({ ...prev, ...Object.fromEntries(saved.map((slot) => [slot.id, draftFor(slot)])) }));
      const label = teamSize === 1 ? `Player ${team.firstPlayer}` : `Team ${team.teamNumber}`;
      toast.success(`${label} saved. ${data.filled_count} of ${data.slot_count} players saved.`);
    } catch {
      toast.error('Nothing was saved. Please check your connection and try again.');
    } finally {
      setSavingTeam(null);
    }
  };

  const hasUnsavedChanges = slots.some((slot) => draftChanged(slot, drafts[slot.id]));

  const switchTo = async (target: PortalSponsorship) => {
    if (target.current || switchingTo) return;
    if (hasUnsavedChanges) {
      const confirmed = await requestConfirmation({
        title: 'Leave without saving?',
        description: 'Some players on this page have not been saved yet. Switching events will discard those changes.',
        confirmLabel: 'Switch anyway',
        tone: 'danger',
      });
      if (!confirmed) return;
    }

    setSwitchingTo(target.sponsor_id);
    try {
      const res = await fetch(`${API_URL}/api/v1/sponsor_access/switch`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsor_id: target.sponsor_id }),
      });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.session_token) {
        toast.error(data?.error || 'Could not open that event.');
        return;
      }
      onSwitchSponsorship(toVerifiedPortalData(data));
    } catch {
      toast.error('Could not open that event.');
    } finally {
      setSwitchingTo(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-base text-gray-600">Loading your sponsor portal…</p>
      </div>
    );
  }

  const savedCount = slots.filter(isFilled).length;
  const savedPercent = slots.length > 0 ? Math.round((savedCount / slots.length) * 100) : 0;
  const teams = groupSlotsIntoTeams(slots, teamSize);
  const eventLabel = [tournamentInfo.name, tournamentInfo.year && !tournamentInfo.name?.includes(String(tournamentInfo.year)) ? tournamentInfo.year : null]
    .filter(Boolean).join(' ');

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {confirmationDialog}
      <header className="text-white" style={{ backgroundColor: brandColor }}>
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5 sm:px-5">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="" className="h-9 w-auto rounded object-contain" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15"><Flag className="h-5 w-5" aria-hidden="true" /></span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/80">{orgInfo?.name || organization?.name || 'Sponsor Portal'}</p>
            <p className="truncate text-lg font-bold">{eventLabel || 'Sponsor Portal'}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-5 sm:px-5">
        {sponsorships.length > 1 && (
          <section aria-label="Choose an event" className="rounded-xl border border-brand-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <CalendarDays className="h-5 w-5 text-brand-600" aria-hidden="true" />
              You sponsor more than one event
            </h2>
            <p className="mt-1 text-base text-gray-700">Pick the event you want to fill in. You are viewing <strong>{eventLabel}</strong>.</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sponsorships.map((item) => (
                <button
                  key={item.sponsor_id}
                  type="button"
                  onClick={() => switchTo(item)}
                  aria-current={item.current ? 'true' : undefined}
                  disabled={!!switchingTo}
                  className={`flex min-h-[56px] flex-col items-start justify-center rounded-lg border px-4 py-2 text-left disabled:cursor-not-allowed ${
                    item.current ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-600/30' : 'border-gray-300 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span className="text-base font-semibold text-gray-900">
                    {item.tournament_name}{item.tournament_year && !item.tournament_name.includes(String(item.tournament_year)) ? ` ${item.tournament_year}` : ''}
                  </span>
                  <span className="text-sm text-gray-600">
                    {item.current ? 'Viewing now · ' : switchingTo === item.sponsor_id ? 'Opening… · ' : ''}
                    {item.filled_count} of {item.slot_count} players entered
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Sponsor" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-4">
            {sponsor.logo_url ? (
              <img src={sponsor.logo_url} alt={sponsor.name} className="h-14 w-14 flex-shrink-0 rounded-xl bg-gray-50 object-contain p-1.5" />
            ) : (
              <SponsorMonogram name={sponsor.name} size="md" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold text-gray-900">{sponsor.name}</h1>
              <p className="text-base text-gray-600">{sponsor.tier_display}</p>
            </div>
            {sponsor.website_url && (
              <a href={sponsor.website_url} target="_blank" rel="noopener noreferrer" aria-label="Sponsor website"
                className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                <ExternalLink className="h-5 w-5" aria-hidden="true" />
              </a>
            )}
          </div>

          {slots.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-2 text-base">
                <span className="font-semibold text-gray-900">{savedCount} of {slots.length} players saved</span>
                {savedCount === slots.length && (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-700">
                    <CheckCircle className="h-4 w-4" aria-hidden="true" /> All done
                  </span>
                )}
              </div>
              <div
                className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gray-100"
                role="progressbar"
                aria-label="Players saved"
                aria-valuemin={0}
                aria-valuemax={slots.length}
                aria-valuenow={savedCount}
              >
                <div className="h-full rounded-full" style={{ width: `${savedPercent}%`, backgroundColor: brandColor }} />
              </div>
            </div>
          )}
        </section>

        {deadline && (
          locked ? (
            <div role="status" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
              <Lock className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-700" aria-hidden="true" />
              <div>
                <p className="text-base font-semibold text-red-900">Player list is locked</p>
                <p className="text-base text-red-800">
                  The deadline to make changes was {formatGuamDeadline(deadline)}. Please contact the event organizer if something needs to change.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <p className="text-base font-semibold text-amber-900">Please finish by {formatGuamDeadline(deadline)}</p>
                <p className="text-base text-amber-800">You can add or change players any time before then. Guam time (ChST).</p>
              </div>
            </div>
          )
        )}

        <aside aria-label="Waiver and check-in" className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <ClipboardCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-700" aria-hidden="true" />
          <div className="space-y-1 text-base text-blue-950">
            <p className="font-semibold">Waiver &amp; check-in</p>
            <p>Players you save here are added to the tournament check-in list automatically. They do not need to register separately.</p>
            {waiverEnabled && (
              <p>Each player will confirm the tournament waiver online or at check-in on event day.</p>
            )}
          </div>
        </aside>

        {loadFailed && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-900">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p>We could not load your players.</p>
              <button type="button" onClick={() => fetchSlots()} className="mt-2 min-h-[48px] rounded-lg border border-red-300 bg-white px-4 font-semibold">Try again</button>
            </div>
          </div>
        )}

        {teamSize === 1 && slots.length > 0 && (
          <h2 className="pt-2 text-lg font-semibold text-gray-900">Individual Players</h2>
        )}

        {teams.map((team) => {
          const teamSaved = team.slots.filter(isFilled).length;
          const teamDirty = team.slots.some((slot) => draftChanged(slot, drafts[slot.id]));
          const heading = teamSize === 1 ? `Player ${team.firstPlayer}` : teamHeading(team);
          const headingId = `team-${team.teamNumber}-heading`;
          return (
            <section key={team.teamNumber} aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
                <h3 id={headingId} className="flex items-center gap-2 text-base font-semibold text-gray-900">
                  <Users className="h-5 w-5 text-gray-500" aria-hidden="true" /> {heading}
                </h3>
                <span className={`text-sm font-medium ${teamDirty ? 'text-amber-800' : 'text-gray-600'}`}>
                  {teamDirty ? 'Unsaved changes' : `${teamSaved} of ${team.slots.length} saved`}
                </span>
              </div>

              <div className="divide-y divide-gray-100">
                {team.slots.map((slot) => {
                  const draft = drafts[slot.id] || draftFor(slot);
                  const errors = slotErrors[slot.id];
                  const idBase = `slot-${slot.id}`;
                  return (
                    <fieldset key={slot.id} className="space-y-3 p-4" aria-describedby={errors ? `${idBase}-errors` : undefined}>
                      <legend className="text-base font-semibold text-gray-800">Player {slot.slot_number}</legend>
                      <div>
                        <label htmlFor={`${idBase}-name`} className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
                        <input id={`${idBase}-name`} type="text" autoComplete="off" placeholder="First and last name"
                          value={draft.player_name} disabled={locked}
                          onChange={(e) => updateDraft(slot.id, 'player_name', e.target.value)} className={inputClass} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor={`${idBase}-email`} className="mb-1 block text-sm font-medium text-gray-700">Email (optional)</label>
                          <input id={`${idBase}-email`} type="email" inputMode="email" autoComplete="off" placeholder="name@example.com"
                            value={draft.player_email} disabled={locked}
                            onChange={(e) => updateDraft(slot.id, 'player_email', e.target.value)} className={inputClass} />
                        </div>
                        <div>
                          <label htmlFor={`${idBase}-phone`} className="mb-1 block text-sm font-medium text-gray-700">Phone (optional)</label>
                          <input id={`${idBase}-phone`} type="tel" inputMode="tel" autoComplete="off" placeholder="(671) 555-1234"
                            value={draft.player_phone} disabled={locked}
                            onChange={(e) => updateDraft(slot.id, 'player_phone', e.target.value)} className={inputClass} />
                        </div>
                        <div>
                          <label htmlFor={`${idBase}-shirt`} className="mb-1 block text-sm font-medium text-gray-700">Shirt size (optional)</label>
                          <select id={`${idBase}-shirt`} value={draft.tshirt_size} disabled={locked}
                            onChange={(e) => updateDraft(slot.id, 'tshirt_size', e.target.value)} className={inputClass}>
                            <option value="">Select size…</option>
                            {TSHIRT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                          </select>
                        </div>
                        {handicapRequired && (
                          <div>
                            <label htmlFor={`${idBase}-handicap`} className="mb-1 block text-sm font-medium text-gray-700">Handicap (needed for this event)</label>
                            <input id={`${idBase}-handicap`} type="number" inputMode="decimal" step="0.1" min={-10} max={54} placeholder="e.g. 14.2"
                              value={draft.handicap} disabled={locked}
                              onChange={(e) => updateDraft(slot.id, 'handicap', e.target.value)} className={inputClass} />
                          </div>
                        )}
                      </div>
                      {errors && (
                        <ul id={`${idBase}-errors`} className="space-y-1 text-sm text-red-700">
                          {errors.map((message) => (
                            <li key={message} className="flex items-start gap-1.5">
                              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" /> {message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </fieldset>
                  );
                })}
              </div>

              {!locked && (
                <div className="border-t border-gray-100 bg-gray-50 p-4">
                  <button
                    type="button"
                    onClick={() => saveTeam(team)}
                    disabled={savingTeam !== null}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg px-5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    style={{ backgroundColor: brandColor }}
                  >
                    <Save className="h-5 w-5" aria-hidden="true" />
                    {savingTeam === team.teamNumber ? 'Saving…' : teamSize === 1 ? 'Save Player' : 'Save Team'}
                  </button>
                  <p className="mt-2 text-sm text-gray-600">Leave a name blank to keep that spot open.</p>
                </div>
              )}
            </section>
          );
        })}

        {slots.length === 0 && !loadFailed && (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden="true" />
            <p className="text-base text-gray-700">No player spots have been set up for this sponsorship yet.</p>
            <p className="mt-1 text-base text-gray-600">Please contact the event organizer.</p>
          </div>
        )}

        {(tournamentInfo.contact_email || tournamentInfo.contact_phone) && (
          <footer className="rounded-xl border border-gray-200 bg-white p-4 text-base text-gray-700">
            <p className="font-semibold text-gray-900">Need help?</p>
            <p>
              Contact {tournamentInfo.contact_name || 'the event organizer'}
              {tournamentInfo.contact_email && <> at <a className="font-medium text-brand-700 underline" href={`mailto:${tournamentInfo.contact_email}`}>{tournamentInfo.contact_email}</a></>}
              {tournamentInfo.contact_phone && <> or <a className="font-medium text-brand-700 underline" href={`tel:${tournamentInfo.contact_phone}`}>{tournamentInfo.contact_phone}</a></>}.
            </p>
          </footer>
        )}
      </main>
    </div>
  );
};
