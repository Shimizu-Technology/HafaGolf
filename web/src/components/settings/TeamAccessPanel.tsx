import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, RotateCcw, Send, Shield, Sliders, Trash2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { SettingsInput, SettingsSection, SettingsSelect, settingsButton } from './SettingsFields';
import type { SettingsRequest } from './settingsForm';

interface RoleCatalogItem {
  key: string;
  label: string;
  description: string;
  default_capabilities: string[];
}

interface CapabilityCatalogItem {
  key: string;
  label: string;
  category: string;
  description: string;
}

interface OrgTournamentOption {
  id: number;
  name: string;
  slug: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  canonical_role?: string;
  role_label?: string;
  permissions?: Record<string, boolean>;
  effective_capabilities?: Record<string, boolean>;
  scoped_tournament_ids?: number[];
  invitation_pending?: boolean;
}

const DEFAULT_ROLE_CATALOG: RoleCatalogItem[] = [
  {
    key: 'org_admin',
    label: 'Org Admin',
    description: 'Full access to all events, finances, settings, Homepage Studio, and team management.',
    default_capabilities: [],
  },
  {
    key: 'coordinator',
    label: 'Tournament Coordinator',
    description: 'Runs event operations: registrations, pairings, sponsors, check-in, raffle draw, reports, and broadcasts.',
    default_capabilities: [],
  },
  {
    key: 'checkin_volunteer',
    label: 'Check-In Volunteer',
    description: 'Dedicated Check-In Station: search players, check in, and verify door payments. No financial totals or raffle draw.',
    default_capabilities: ['check_in', 'verify_door_payment'],
  },
  {
    key: 'raffle_volunteer',
    label: 'Raffle Volunteer',
    description: 'Dedicated Raffle POS Station: sell raffle tickets and resend buyer confirmations. Cannot draw winners or view finances.',
    default_capabilities: ['raffle_sell'],
  },
  {
    key: 'scoring_marshal',
    label: 'Scoring Marshal',
    description: 'Course scoring access only: enter and verify hole scores.',
    default_capabilities: ['enter_scores'],
  },
];

export function TeamAccessPanel({ request, organizationSlug }: { request: SettingsRequest; organizationSlug: string }) {
  const path = `/api/v1/admin/organizations/${organizationSlug}/members`;
  const [members, setMembers] = useState<Member[]>([]);
  const [roleCatalog, setRoleCatalog] = useState<RoleCatalogItem[]>(DEFAULT_ROLE_CATALOG);
  const [capabilityCatalog, setCapabilityCatalog] = useState<CapabilityCatalogItem[]>([]);
  const [tournaments, setTournaments] = useState<OrgTournamentOption[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('org_admin');
  const [busy, setBusy] = useState<string | null>(null);

  // Inline member permission editor state
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string>('org_admin');
  const [editOverrides, setEditOverrides] = useState<Record<string, boolean>>({});
  const [editScopedIds, setEditScopedIds] = useState<number[]>([]);

  const { requestConfirmation, confirmationDialog } = useConfirmDialog();

  useEffect(() => {
    const upload = new AbortController();
    setLoading(true);
    setError('');
    request<{
      members?: Member[];
      role_catalog?: RoleCatalogItem[];
      capability_catalog?: CapabilityCatalogItem[];
      tournaments?: OrgTournamentOption[];
    }>(path, { signal: upload.signal })
      .then((res) => {
        if (upload.signal.aborted) return;
        setMembers(res.members ?? []);
        if (res.role_catalog && res.role_catalog.length > 0) setRoleCatalog(res.role_catalog);
        if (res.capability_catalog) setCapabilityCatalog(res.capability_catalog);
        if (res.tournaments) setTournaments(res.tournaments);
      })
      .catch(() => {
        if (!upload.signal.aborted) setError('Could not load the team list.');
      })
      .finally(() => {
        if (!upload.signal.aborted) setLoading(false);
      });
    return () => upload.abort();
  }, [path, request]);

  const roleCatalogByKey = useMemo(() => {
    const map: Record<string, RoleCatalogItem> = {};
    for (const r of roleCatalog) map[r.key] = r;
    return map;
  }, [roleCatalog]);

  const selectedInviteRole = roleCatalogByKey[role];

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy('invite');
    try {
      const data = await request<{ member: Member; invitation_sent?: boolean }>(path, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), role }),
      });
      setMembers((current) => [...current, data.member]);
      setEmail('');
      setRole('org_admin');
      toast.success(data.invitation_sent ? 'Invitation sent' : 'Team member added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not invite this team member');
    } finally {
      setBusy(null);
    }
  }

  function startEditing(member: Member) {
    if (editingMemberId === member.id) {
      setEditingMemberId(null);
      return;
    }
    setEditingMemberId(member.id);
    setEditRole(member.canonical_role || (member.role === 'admin' ? 'org_admin' : member.role));
    setEditOverrides({ ...(member.permissions || {}) });
    setEditScopedIds([...(member.scoped_tournament_ids || [])]);
  }

  async function savePermissions(member: Member) {
    if (busy) return;
    setBusy(`edit-${member.id}`);
    try {
      const data = await request<{ member: Member }>(`${path}/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role: editRole,
          permissions: editOverrides,
          scoped_tournament_ids: editScopedIds,
        }),
      });
      setMembers((current) => current.map((m) => (m.id === member.id ? data.member : m)));
      setEditingMemberId(null);
      toast.success(`Updated permissions for ${member.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update permissions');
    } finally {
      setBusy(null);
    }
  }

  async function updateMember(member: Member, action: 'remove' | 'resend') {
    if (busy) return;
    if (
      action === 'remove' &&
      !(await requestConfirmation({
        title: 'Remove team member?',
        description: `${member.name || member.email} will lose access to this organization.`,
        confirmLabel: 'Remove access',
        tone: 'danger',
      }))
    ) {
      return;
    }
    setBusy(member.id);
    try {
      if (action === 'remove') {
        await request(`${path}/${member.id}`, { method: 'DELETE' });
        setMembers((current) => current.filter((item) => item.id !== member.id));
        toast.success('Team member removed');
      } else {
        await request(`${path}/${member.id}/resend_invite`, { method: 'POST' });
        toast.success('Invitation resent');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update this team member');
    } finally {
      setBusy(null);
    }
  }

  const adminCount = members.filter((m) => m.role === 'admin' || m.role === 'org_admin').length;

  return (
    <SettingsSection
      title="Team, roles & volunteer stations"
      description="Assign exact roles so check-in and raffle volunteers get focused stations without access to financial totals, raffle draws, or settings."
    >
      {confirmationDialog}
      <form className="space-y-2.5" onSubmit={invite}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <SettingsInput
            label="Email to invite"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={setEmail}
          />
          <SettingsSelect label="Role preset" value={role} onChange={(event) => setRole(event.target.value)}>
            {roleCatalog.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </SettingsSelect>
          <button type="submit" disabled={Boolean(busy) || !email.trim()} className={settingsButton}>
            <UserPlus className="h-4 w-4" aria-hidden="true" /> {busy === 'invite' ? 'Inviting…' : 'Send invite'}
          </button>
        </div>
        {selectedInviteRole && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{selectedInviteRole.label}:</span>{' '}
            {selectedInviteRole.description}
          </p>
        )}
      </form>

      {loading && (
        <p role="status" className="text-sm text-gray-600">
          Loading team members…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && members.length === 0 && <p className="text-sm text-gray-600">No team members yet.</p>}

      {members.length > 0 && (
        <ul className="space-y-3">
          {members.map((member) => {
            const isMemberAdmin = member.role === 'admin' || member.role === 'org_admin';
            const isEditing = editingMemberId === member.id;
            const overrideKeys = Object.keys(member.permissions || {});
            const scopedCount = member.scoped_tournament_ids?.length ?? 0;
            const editRoleMeta = roleCatalogByKey[editRole];
            const defaultCapSet = new Set(editRoleMeta?.default_capabilities ?? []);

            return (
              <li key={member.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 break-words">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{member.name}</p>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                        <Shield className="h-3 w-3 text-brand-600" />
                        {member.role_label || member.role.replace(/_/g, ' ')}
                      </span>
                      {overrideKeys.length > 0 && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                          {overrideKeys.length} override{overrideKeys.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {scopedCount > 0 && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800 ring-1 ring-blue-200">
                          Scoped to {scopedCount} event{scopedCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {member.email}
                      {member.invitation_pending && ' · Invite pending'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={settingsButton}
                      disabled={Boolean(busy)}
                      onClick={() => startEditing(member)}
                    >
                      <Sliders className="h-4 w-4" aria-hidden="true" />
                      Permissions
                      {isEditing ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {member.invitation_pending && (
                      <button
                        type="button"
                        className={settingsButton}
                        disabled={Boolean(busy)}
                        onClick={() => void updateMember(member, 'resend')}
                      >
                        <Send className="h-4 w-4" aria-hidden="true" /> Resend invite
                      </button>
                    )}
                    {(!isMemberAdmin || adminCount > 1) && (
                      <button
                        type="button"
                        className={settingsButton}
                        disabled={Boolean(busy)}
                        onClick={() => void updateMember(member, 'remove')}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div
                    data-testid={`member-permissions-editor-${member.id}`}
                    className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SettingsSelect
                        label="Role preset"
                        value={editRole}
                        onChange={(e) => {
                          setEditRole(e.target.value);
                          setEditOverrides({});
                        }}
                      >
                        {roleCatalog.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </SettingsSelect>
                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setEditOverrides({});
                            setEditScopedIds([]);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset overrides
                        </button>
                      </div>
                    </div>

                    {capabilityCatalog.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Capability overrides
                        </p>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {capabilityCatalog.map((cap) => {
                            const presetDefault = editRole === 'org_admin' || defaultCapSet.has(cap.key);
                            const effective = cap.key in editOverrides ? editOverrides[cap.key] : presetDefault;
                            const isOverridden = cap.key in editOverrides && editOverrides[cap.key] !== presetDefault;
                            return (
                              <label
                                key={cap.key}
                                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                                  isOverridden
                                    ? 'border-amber-300 bg-amber-50/50'
                                    : 'border-slate-100 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={effective}
                                  disabled={editRole === 'org_admin'}
                                  onChange={(e) => {
                                    const nextVal = e.target.checked;
                                    setEditOverrides((prev) => {
                                      const next = { ...prev };
                                      if (nextVal === presetDefault) {
                                        delete next[cap.key];
                                      } else {
                                        next[cap.key] = nextVal;
                                      }
                                      return next;
                                    });
                                  }}
                                  className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-brand-700"
                                />
                                <span>
                                  <span className="font-medium text-slate-800">{cap.label}</span>
                                  {isOverridden && (
                                    <span className="ml-1.5 text-[10px] font-semibold uppercase text-amber-700">
                                      Override
                                    </span>
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {tournaments.length > 0 && editRole !== 'org_admin' && (
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Restrict to specific events (leave all unchecked for all org events)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {tournaments.map((t) => {
                            const checked = editScopedIds.includes(t.id);
                            return (
                              <label
                                key={t.id}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setEditScopedIds((prev) =>
                                      e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                                    );
                                  }}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand-700"
                                />
                                {t.name}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => setEditingMemberId(null)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void savePermissions(member)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Save permissions
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}
