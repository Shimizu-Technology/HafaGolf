import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthToken } from '../hooks/useAuthToken';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useOrganization } from '../components/OrganizationProvider';
import { adminEventPath } from '../utils/adminRoutes';
import { formatDateTime } from '../utils/dates';

const API_URL = import.meta.env.VITE_API_URL || '';

export type BroadcastAudience = 'all_confirmed' | 'checked_in' | 'unchecked_in' | 'sponsors' | 'specific_groups';
export type BroadcastChannel = 'email' | 'sms' | 'both';

export interface BroadcastAnnouncementRecord {
  id: number;
  audience: BroadcastAudience;
  target_group_ids: number[];
  channel: BroadcastChannel;
  subject: string | null;
  message: string;
  recipient_count: number;
  email_recipient_count: number;
  sms_recipient_count: number;
  sent_count: number;
  failed_count: number;
  dry_run: boolean;
  status: 'completed' | 'dry_run' | 'failed';
  sender_name: string;
  sent_at: string | null;
  created_at: string | null;
}

interface BroadcastGroupOption {
  id: number;
  group_number: number;
  hole_number: number | null;
  hole_position_label: string | null;
}

interface BroadcastConfig {
  email_configured: boolean;
  sms_configured: boolean;
  local_dry_run_mode: boolean;
}

interface BroadcastPreview {
  recipient_count: number;
  email_recipients: number;
  sms_recipients: number;
  dry_run: boolean;
  email_configured: boolean;
  sms_configured: boolean;
  effective_channel?: BroadcastChannel;
  skipped_channel?: 'email' | 'sms' | null;
}

const AUDIENCE_OPTIONS: Array<{ value: BroadcastAudience; label: string; description: string }> = [
  { value: 'all_confirmed', label: 'All Confirmed Players', description: 'Every confirmed player and teammate' },
  { value: 'checked_in', label: 'Checked-In Only', description: 'Players already checked in at the desk' },
  { value: 'unchecked_in', label: 'Not Yet Checked In', description: 'Confirmed players still on the way' },
  { value: 'sponsors', label: 'Active Sponsors', description: 'Sponsor portal contacts for this event' },
  { value: 'specific_groups', label: 'Specific Groups / Holes', description: 'Target one or more starting groups' },
];

const CHANNEL_OPTIONS: Array<{ value: BroadcastChannel; label: string }> = [
  { value: 'both', label: 'Email + SMS' },
  { value: 'email', label: 'Email Only' },
  { value: 'sms', label: 'SMS Only' },
];

const QUICK_TEMPLATES: Array<{ id: string; label: string; subject: string; message: string }> = [
  {
    id: 'shotgun-15',
    label: '15-Minute Shotgun Call',
    subject: '15-Minute Shotgun Start Call',
    message: 'Players, please head to your assigned golf carts now. The shotgun start begins in 15 minutes!',
  },
  {
    id: 'weather-delay',
    label: 'Weather / Lightning Delay',
    subject: 'Weather Delay — Please Return to Clubhouse',
    message: 'Play is temporarily suspended due to weather/lightning. Please return to the clubhouse immediately and wait for the all-clear.',
  },
  {
    id: 'awards-raffle',
    label: 'Awards Banquet & Raffle Starting Now',
    subject: 'Awards Banquet & Raffle Starting Now',
    message: 'Head into the banquet area now! Lunch, tournament awards, and the live raffle draw are getting underway.',
  },
];

function audienceLabel(audience: BroadcastAudience): string {
  return AUDIENCE_OPTIONS.find((opt) => opt.value === audience)?.label || audience;
}

function channelLabel(channel: BroadcastChannel): string {
  return CHANNEL_OPTIONS.find((opt) => opt.value === channel)?.label || channel.toUpperCase();
}

export const BroadcastsPage: React.FC = () => {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const { organization } = useOrganization();
  const { getToken } = useAuthToken();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const { requestConfirmation, confirmationDialog } = useConfirmDialog();
  const orgSlug = organization?.slug || '';

  const [tournamentId, setTournamentId] = useState<number | null>(null);
  const [tournamentName, setTournamentName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [announcements, setAnnouncements] = useState<BroadcastAnnouncementRecord[]>([]);
  const [groups, setGroups] = useState<BroadcastGroupOption[]>([]);
  const [config, setConfig] = useState<BroadcastConfig>({
    email_configured: false,
    sms_configured: false,
    local_dry_run_mode: true,
  });

  const [audience, setAudience] = useState<BroadcastAudience>('all_confirmed');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [channel, setChannel] = useState<BroadcastChannel>('both');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const startLoad = useLatestRequest(`${orgSlug}/${tournamentSlug}`);
  const startPreview = useLatestRequest(`${tournamentId}`);

  const fetchData = useCallback(async () => {
    if (!orgSlug || !tournamentSlug) return;
    const isCurrent = startLoad();
    setLoading(true);
    setLoadError(null);

    try {
      const token = await getTokenRef.current();
      if (!isCurrent()) return;
      const headers = { Authorization: `Bearer ${token}` };

      const eventRes = await fetch(
        `${API_URL}/api/v1/admin/organizations/${orgSlug}/tournaments/${tournamentSlug}`,
        { headers }
      );
      if (!eventRes.ok) throw new Error('Could not load tournament details.');
      const eventData = await eventRes.json();
      if (!isCurrent()) return;

      const t = eventData.tournament || eventData;
      setTournamentId(t.id);
      setTournamentName(t.name || '');

      const bcastRes = await fetch(`${API_URL}/api/v1/tournaments/${t.id}/broadcasts`, { headers });
      if (!bcastRes.ok) {
        const errBody = await bcastRes.json().catch(() => null);
        throw new Error(errBody?.error || 'Could not load broadcast announcements.');
      }
      const bcastData = await bcastRes.json();
      if (!isCurrent()) return;

      setAnnouncements(bcastData.announcements || []);
      setGroups(bcastData.groups || []);
      if (bcastData.config) {
        setConfig(bcastData.config);
      }
    } catch (err) {
      if (!isCurrent()) return;
      setLoadError(err instanceof Error ? err.message : 'Failed to load announcements.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [orgSlug, tournamentSlug, startLoad]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live recipient count preview
  useEffect(() => {
    if (!tournamentId) return;
    const isCurrent = startPreview();

    if (audience === 'specific_groups' && selectedGroupIds.length === 0) {
      setPreviewLoading(false);
      setPreview({
        recipient_count: 0,
        email_recipients: 0,
        sms_recipients: 0,
        dry_run:
          channel === 'email'
            ? !config.email_configured
            : channel === 'sms'
              ? !config.sms_configured
              : !config.email_configured && !config.sms_configured,
        email_configured: config.email_configured,
        sms_configured: config.sms_configured,
        effective_channel: channel,
        skipped_channel: null,
      });
      return;
    }

    setPreview(null);
    setPreviewLoading(true);

    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!isCurrent()) return;
        const res = await fetch(`${API_URL}/api/v1/tournaments/${tournamentId}/broadcasts/preview`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            broadcast: {
              audience,
              channel,
              target_group_ids: audience === 'specific_groups' ? selectedGroupIds : [],
            },
          }),
        });
        if (!res.ok) {
          if (isCurrent()) setPreview(null);
          return;
        }
        const data = await res.json();
        if (!isCurrent()) return;
        setPreview(data);
      } catch {
        if (isCurrent()) setPreview(null);
      } finally {
        if (isCurrent()) setPreviewLoading(false);
      }
    })();
  }, [tournamentId, audience, channel, selectedGroupIds, config.email_configured, config.sms_configured, startPreview]);

  const toggleGroupSelection = (groupId: number) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const applyTemplate = (tpl: typeof QUICK_TEMPLATES[number]) => {
    setSubject(tpl.subject);
    setMessage(tpl.message);
  };

  const requiresSubject = channel === 'email' || channel === 'both';
  const previewReady = !previewLoading && preview !== null;
  const recipientCount = preview?.recipient_count ?? 0;
  const isDryRun = preview ? preview.dry_run : config.local_dry_run_mode;
  const skippedChannel = preview?.skipped_channel ?? null;
  const effectiveChannel = preview?.effective_channel ?? channel;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId || !previewReady) return;

    if (!message.trim()) {
      toast.error('Please enter an announcement message.');
      return;
    }
    if (requiresSubject && !subject.trim()) {
      toast.error('Please enter an email subject line.');
      return;
    }
    if (audience === 'specific_groups' && selectedGroupIds.length === 0) {
      toast.error('Please select at least one starting group.');
      return;
    }
    if (recipientCount <= 0) {
      toast.error('No reachable recipients found for this audience and channel.');
      return;
    }

    const partialChannelNote = skippedChannel
      ? ` Note: ${skippedChannel.toUpperCase()} is not configured, so only ${effectiveChannel.toUpperCase()} will be sent.`
      : '';

    const confirmed = await requestConfirmation({
      title: isDryRun ? 'Record Dry-Run Broadcast?' : 'Send Tournament Broadcast?',
      description: isDryRun
        ? `Local Dry-Run Mode is active (outbound email/SMS keys are not configured for ${channelLabel(channel)}). Record a simulated ${channelLabel(channel)} broadcast for ${recipientCount} ${recipientCount === 1 ? 'recipient' : 'recipients'} in "${audienceLabel(audience)}"? No real emails or texts will be sent.`
        : `Send this ${channelLabel(effectiveChannel)} announcement immediately to ${recipientCount} ${recipientCount === 1 ? 'recipient' : 'recipients'} in "${audienceLabel(audience)}"?${partialChannelNote} This cannot be undone.`,
      confirmLabel: isDryRun ? 'Record Dry Run' : `Send to ${recipientCount} Recipients`,
      tone: isDryRun ? 'default' : 'danger',
    });

    if (!confirmed) return;

    setSending(true);
    try {
      const token = await getTokenRef.current();
      const res = await fetch(`${API_URL}/api/v1/tournaments/${tournamentId}/broadcasts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          broadcast: {
            audience,
            channel,
            target_group_ids: audience === 'specific_groups' ? selectedGroupIds : [],
            subject: requiresSubject ? subject.trim() : undefined,
            message: message.trim(),
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Failed to send broadcast.');
        return;
      }

      if (data?.announcement) {
        setAnnouncements((prev) => [data.announcement, ...prev]);
      }
      setSubject('');
      setMessage('');
      toast.success(data?.message || 'Broadcast recorded.');
    } catch {
      toast.error('Failed to send broadcast.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-3xl bg-white p-8">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
          Loading broadcast tools…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {confirmationDialog}

      {/* Header */}
      <section className="rounded-[28px] bg-brand-600 px-4 py-4 text-brand-foreground shadow-sm sm:px-6 sm:py-5 lg:px-8">
        <div className="mx-auto max-w-6xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link
              to={adminEventPath(tournamentSlug || '')}
              className="mb-1 inline-flex items-center gap-2 text-sm text-white/80 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Tournament
            </Link>
            <h1 className="flex items-center gap-2.5 text-xl font-bold sm:text-2xl">
              <Megaphone className="h-6 w-6 shrink-0" />
              Day-Of Broadcast Announcements
            </h1>
            {tournamentName && <p className="mt-0.5 text-sm text-white/80">{tournamentName}</p>}
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold hover:bg-white/20"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 px-4">
        {loadError && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {loadError}
          </div>
        )}

        {/* Dry-run / Provider Readiness Banner */}
        {previewReady && isDryRun && (
          <div
            data-testid="broadcast-dry-run-banner"
            className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-950"
          >
            <FlaskConical className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Local Dry-Run Mode Active</p>
              <p className="text-xs text-amber-800 mt-0.5">
                Outbound email/SMS credentials are not configured for this channel. Submitting a broadcast safely records a Dry Run entry in history and the audit log without sending external messages.
              </p>
            </div>
          </div>
        )}

        {previewReady && !isDryRun && skippedChannel && (
          <div
            data-testid="broadcast-partial-channel-banner"
            className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-950"
          >
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Partial Delivery Readiness ({skippedChannel.toUpperCase()} Not Configured)</p>
              <p className="text-xs text-amber-800 mt-0.5">
                {skippedChannel.toUpperCase()} credentials are not configured, so only {effectiveChannel.toUpperCase()} messages will be sent ({recipientCount}{' '}
                {recipientCount === 1 ? 'recipient' : 'recipients'}).
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Composer */}
          <form onSubmit={handleSend} className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-brand-600" />
                Quick Day-Of Templates
              </p>
              <div className="flex flex-wrap gap-2">
                {QUICK_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="inline-flex min-h-[40px] items-center rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Audience */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="broadcast-audience" className="text-sm font-semibold text-gray-900">
                  Target Audience
                </label>
                <span
                  data-testid="broadcast-recipient-count"
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800"
                >
                  <Users className="h-3.5 w-3.5" />
                  {previewLoading ? 'Counting…' : `${recipientCount} ${recipientCount === 1 ? 'recipient' : 'recipients'}`}
                </span>
              </div>
              <select
                id="broadcast-audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
                className="w-full min-h-[48px] rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              >
                {AUDIENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} — {opt.description}
                  </option>
                ))}
              </select>

              {preview && (
                <p className="text-xs text-gray-500">
                  Reachable via Email: <strong>{preview.email_recipients}</strong> · Reachable via SMS:{' '}
                  <strong>{preview.sms_recipients}</strong>
                </p>
              )}

              {audience === 'specific_groups' && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-700">Select starting groups</p>
                  {groups.length === 0 ? (
                    <p className="text-xs text-gray-500">No groups created for this tournament yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {groups.map((g) => {
                        const checked = selectedGroupIds.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleGroupSelection(g.id)}
                            aria-pressed={checked}
                            className={`inline-flex min-h-[38px] items-center rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                              checked
                                ? 'border-brand-600 bg-brand-600 text-white'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            {g.hole_position_label || `Group ${g.group_number}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Channel */}
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-gray-900">Delivery Channel</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Delivery channel">
                {CHANNEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={channel === opt.value}
                    onClick={() => setChannel(opt.value)}
                    className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                      channel === opt.value
                        ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600/20'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {opt.value === 'email' ? (
                      <Mail className="h-4 w-4" />
                    ) : opt.value === 'sms' ? (
                      <MessageSquare className="h-4 w-4" />
                    ) : (
                      <Megaphone className="h-4 w-4" />
                    )}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Subject */}
            {requiresSubject && (
              <div>
                <label htmlFor="broadcast-subject" className="mb-1 block text-sm font-semibold text-gray-900">
                  Email Subject *
                </label>
                <input
                  id="broadcast-subject"
                  type="text"
                  maxLength={200}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., 15-Minute Shotgun Start Call"
                  className="w-full min-h-[48px] rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>
            )}

            {/* Message */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="broadcast-message" className="text-sm font-semibold text-gray-900">
                  Message *
                </label>
                <span className="text-xs text-gray-500">
                  {message.length} / 2000 chars
                  {(channel === 'sms' || channel === 'both') && ` · ${Math.max(1, Math.ceil(message.length / 160))} SMS seg`}
                </span>
              </div>
              <textarea
                id="broadcast-message"
                rows={4}
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a clear, concise update for golfers or sponsors…"
                className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="submit"
                disabled={sending || !previewReady || recipientCount <= 0}
                data-testid="broadcast-submit-btn"
                className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : !previewReady ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking Recipients…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {isDryRun
                      ? `Preview & Record Dry Run (${recipientCount})`
                      : `Review & Send (${recipientCount})`}
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Delivery History */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Clock className="h-4 w-4 text-brand-600" />
                Broadcast History ({announcements.length})
              </h2>
            </div>

            {announcements.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                No announcements sent for this event yet.
              </div>
            ) : (
              <ul className="space-y-3" data-testid="broadcast-history-list">
                {announcements.map((item) => (
                  <li key={item.id} className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-900">
                        {item.subject || `${channelLabel(item.channel)} Announcement`}
                      </span>
                      {item.dry_run || item.status === 'dry_run' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
                          <FlaskConical className="h-3 w-3" />
                          Dry Run
                        </span>
                      ) : item.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" />
                          Sent ({item.sent_count})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-800">
                          Failed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 whitespace-pre-line">{item.message}</p>
                    <p className="text-[11px] text-gray-500">
                      {audienceLabel(item.audience)} · {channelLabel(item.channel)} · {item.recipient_count}{' '}
                      {item.recipient_count === 1 ? 'recipient' : 'recipients'} · By {item.sender_name}
                      {item.sent_at ? ` · ${formatDateTime(item.sent_at)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
