import { useEffect, useState } from 'react';
import { Send, Trash2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { SettingsInput, SettingsSection, SettingsSelect, settingsButton } from './SettingsFields';
import type { SettingsRequest } from './settingsForm';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  invitation_pending?: boolean;
}

export function TeamAccessPanel({ request, organizationSlug }: { request: SettingsRequest; organizationSlug: string }) {
  const path = `/api/v1/admin/organizations/${organizationSlug}/members`;
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'volunteer'>('admin');
  const [busy, setBusy] = useState<string | null>(null);
  const { requestConfirmation, confirmationDialog } = useConfirmDialog();

  useEffect(() => {
    const upload = new AbortController();
    setLoading(true);
    setError('');
    request<{ members?: Member[] }>(path, { signal: upload.signal })
      .then(({ members = [] }) => { if (!upload.signal.aborted) setMembers(members); })
      .catch(() => { if (!upload.signal.aborted) setError('Could not load the team list.'); })
      .finally(() => { if (!upload.signal.aborted) setLoading(false); });
    return () => upload.abort();
  }, [path, request]);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy('invite');
    try {
      const data = await request<{ member: Member; invitation_sent?: boolean }>(path, {
        method: 'POST', body: JSON.stringify({ email: email.trim(), role }),
      });
      setMembers((current) => [...current, data.member]);
      setEmail('');
      setRole('admin');
      toast.success(data.invitation_sent ? 'Invitation sent' : 'Team member added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not invite this team member');
    } finally {
      setBusy(null);
    }
  }

  async function updateMember(member: Member, action: 'remove' | 'resend') {
    if (busy) return;
    if (action === 'remove' && !(await requestConfirmation({
      title: 'Remove team member?',
      description: `${member.name || member.email} will lose access to this organization.`,
      confirmLabel: 'Remove access',
      tone: 'danger',
    }))) return;
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

  const adminCount = members.filter((member) => member.role === 'admin').length;
  return (
    <SettingsSection title="Admins and volunteers" description="Invite people by email. Volunteers can access check-in and raffle ticket sales.">
      {confirmationDialog}
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" onSubmit={invite}>
        <SettingsInput label="Email to invite" type="email" autoComplete="off" required value={email} onChange={setEmail} />
        <SettingsSelect label="Access level" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
          <option value="admin">Admin</option>
          <option value="volunteer">Volunteer</option>
        </SettingsSelect>
        <button type="submit" disabled={Boolean(busy) || !email.trim()} className={settingsButton}>
          <UserPlus className="h-4 w-4" aria-hidden="true" /> {busy === 'invite' ? 'Inviting…' : 'Send invite'}
        </button>
      </form>
      {loading && <p role="status" className="text-sm text-gray-600">Loading team members…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!loading && !error && members.length === 0 && <p className="text-sm text-gray-600">No team members yet.</p>}
      {members.length > 0 && (
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 p-3">
              <div className="min-w-0 break-words">
                <p className="font-medium">{member.name}</p>
                <p className="text-sm text-gray-700">{member.email}</p>
                <p className="text-sm text-gray-600 capitalize">{member.role}{member.invitation_pending && ' · Invite pending'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {member.invitation_pending && (
                  <button type="button" className={settingsButton} disabled={Boolean(busy)} onClick={() => void updateMember(member, 'resend')}>
                    <Send className="h-4 w-4" aria-hidden="true" /> Resend invite
                  </button>
                )}
                {(member.role !== 'admin' || adminCount > 1) && (
                  <button type="button" className={settingsButton} disabled={Boolean(busy)} onClick={() => void updateMember(member, 'remove')}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove access
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
