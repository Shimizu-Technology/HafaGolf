import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Ticket,
  UserX,
  X,
} from 'lucide-react';
import { formatPhoneReadback } from '../utils/rafflePhone';
import {
  canProceedWithDraw,
  getReadinessIssueBadge,
  MIN_OVERRIDE_REASON_LENGTH,
  summarizeReadinessHeadline,
  type DrawReadinessReport,
} from '../utils/raffleReadiness';

export type PreDrawTarget =
  | {
      type: 'single';
      prize: {
        id: number;
        name: string;
        tier_display: string;
        value_dollars: number;
      };
    }
  | {
      type: 'all';
      remainingCount: number;
    };

interface RafflePreDrawModalProps {
  tournamentId: string;
  target: PreDrawTarget;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onReviewNeedsAttention: () => void;
  onConfirmDraw: (options: {
    overrideReadiness: boolean;
    overrideReason: string;
  }) => Promise<void>;
}

export const RafflePreDrawModal: React.FC<RafflePreDrawModalProps> = ({
  tournamentId,
  target,
  getToken,
  onClose,
  onReviewNeedsAttention,
  onConfirmDraw,
}) => {
  const [report, setReport] = useState<DrawReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSubmitError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/tournaments/${tournamentId}/raffle/draw_readiness`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to check pre-draw readiness');
      }
      setReport(data as DrawReadinessReport);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to check pre-draw readiness');
    } finally {
      setLoading(false);
    }
  }, [getToken, tournamentId]);

  useEffect(() => {
    void fetchReadiness();
  }, [fetchReadiness]);

  const canDraw = canProceedWithDraw(report, overrideChecked, overrideReason);
  const isOverrideFlow = Boolean(report && !report.ready && report.eligible_ticket_count > 0);
  const headline = report ? summarizeReadinessHeadline(report) : null;

  const handleConfirm = async () => {
    if (!canDraw || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirmDraw({
        overrideReadiness: isOverrideFlow ? overrideChecked : false,
        overrideReason: isOverrideFlow ? overrideReason.trim() : '',
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to run draw');
    } finally {
      setSubmitting(false);
    }
  };

  const drawSubject =
    target.type === 'single'
      ? `Drawing winner for "${target.prize.name}"`
      : `Drawing winners for all ${target.remainingCount} remaining ${
          target.remainingCount === 1 ? 'prize' : 'prizes'
        }`;

  const primaryLabel =
    target.type === 'single'
      ? isOverrideFlow
        ? 'Override & Draw Prize'
        : 'Draw Now'
      : isOverrideFlow
        ? `Override & Draw All (${target.remainingCount})`
        : `Draw All (${target.remainingCount})`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pre-draw-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2
              id="pre-draw-modal-title"
              className="text-lg font-semibold text-slate-900"
            >
              Pre-Draw Readiness Check
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">{drawSubject}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void fetchReadiness()}
              disabled={loading || submitting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              title="Re-check delivery readiness"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Re-check
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              aria-label="Close pre-draw modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
              <p className="mt-3 text-sm font-medium">
                Checking delivery confirmations and buyer names...
              </p>
            </div>
          ) : loadError || !report ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-semibold text-red-900">Could not load readiness report</p>
                  <p className="text-xs text-red-700">{loadError || 'Unexpected response from server.'}</p>
                  <button
                    type="button"
                    onClick={() => void fetchReadiness()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry Check
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Readiness Headline Banner */}
              {headline && (
                <div
                  className={`rounded-xl border p-4 ${
                    headline.tone === 'ready'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : headline.tone === 'blocked'
                        ? 'border-red-200 bg-red-50 text-red-900'
                        : 'border-amber-200 bg-amber-50 text-amber-950'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {headline.tone === 'ready' ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
                    ) : headline.tone === 'blocked' ? (
                      <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                    ) : (
                      <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{headline.title}</p>
                      <p className="mt-0.5 text-xs opacity-90 leading-relaxed">{headline.subtitle}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Cards ("Everyone got their numbers") */}
              <div>
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Everyone Got Their Numbers
                  </p>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                    <Ticket className="h-3.5 w-3.5 text-brand-600" />
                    {report.eligible_ticket_count.toLocaleString()} eligible{' '}
                    {report.eligible_ticket_count === 1 ? 'ticket' : 'tickets'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                    <div className="flex items-center justify-between">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="text-2xl font-bold text-emerald-700">
                        {report.confirmed_delivered_count}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs font-semibold text-emerald-900">
                      Confirmed Delivered
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      of {report.paid_buyer_batch_count} paid{' '}
                      {report.paid_buyer_batch_count === 1 ? 'buyer' : 'buyers'}
                    </p>
                  </div>

                  <div
                    className={`rounded-xl border p-3.5 ${
                      report.unconfirmed_delivery_count > 0
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Clock
                        className={`h-4 w-4 ${
                          report.unconfirmed_delivery_count > 0 ? 'text-amber-600' : 'text-slate-400'
                        }`}
                      />
                      <span
                        className={`text-2xl font-bold ${
                          report.unconfirmed_delivery_count > 0 ? 'text-amber-800' : 'text-slate-700'
                        }`}
                      >
                        {report.unconfirmed_delivery_count}
                      </span>
                    </div>
                    <p
                      className={`mt-1.5 text-xs font-semibold ${
                        report.unconfirmed_delivery_count > 0 ? 'text-amber-900' : 'text-slate-700'
                      }`}
                    >
                      Unconfirmed
                    </p>
                    <p
                      className={`text-[11px] ${
                        report.unconfirmed_delivery_count > 0 ? 'text-amber-700' : 'text-slate-500'
                      }`}
                    >
                      pending / accepted
                    </p>
                  </div>

                  <div
                    className={`rounded-xl border p-3.5 ${
                      report.failed_delivery_count > 0
                        ? 'border-red-200 bg-red-50'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <AlertTriangle
                        className={`h-4 w-4 ${
                          report.failed_delivery_count > 0 ? 'text-red-600' : 'text-slate-400'
                        }`}
                      />
                      <span
                        className={`text-2xl font-bold ${
                          report.failed_delivery_count > 0 ? 'text-red-700' : 'text-slate-700'
                        }`}
                      >
                        {report.failed_delivery_count}
                      </span>
                    </div>
                    <p
                      className={`mt-1.5 text-xs font-semibold ${
                        report.failed_delivery_count > 0 ? 'text-red-900' : 'text-slate-700'
                      }`}
                    >
                      Failed / Bounced
                    </p>
                    <p
                      className={`text-[11px] ${
                        report.failed_delivery_count > 0 ? 'text-red-700' : 'text-slate-500'
                      }`}
                    >
                      no delivered backup
                    </p>
                  </div>

                  <div
                    className={`rounded-xl border p-3.5 ${
                      report.missing_name_count > 0
                        ? 'border-red-200 bg-red-50'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <UserX
                        className={`h-4 w-4 ${
                          report.missing_name_count > 0 ? 'text-red-600' : 'text-slate-400'
                        }`}
                      />
                      <span
                        className={`text-2xl font-bold ${
                          report.missing_name_count > 0 ? 'text-red-700' : 'text-slate-700'
                        }`}
                      >
                        {report.missing_name_count}
                      </span>
                    </div>
                    <p
                      className={`mt-1.5 text-xs font-semibold ${
                        report.missing_name_count > 0 ? 'text-red-900' : 'text-slate-700'
                      }`}
                    >
                      Missing Names
                    </p>
                    <p
                      className={`text-[11px] ${
                        report.missing_name_count > 0 ? 'text-red-700' : 'text-slate-500'
                      }`}
                    >
                      blank / placeholder
                    </p>
                  </div>
                </div>
              </div>

              {/* Optional informational notice for unsynced included tickets */}
              {report.registration_tickets_included && report.unsynced_registration_count > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">Registration tickets:</span>{' '}
                  {report.unsynced_registration_count} active registered{' '}
                  {report.unsynced_registration_count === 1 ? 'golfer has' : 'golfers have'} not yet
                  had included raffle tickets synced. Use &ldquo;Sync Registration Tickets&rdquo; on
                  the Tickets tab if needed.
                </div>
              )}

              {/* Affected Buyers List */}
              {report.issues.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border-b border-slate-200 px-4 py-2.5">
                    <p className="text-xs font-semibold text-slate-800">
                      Affected Buyers ({report.issues_total_count})
                    </p>
                    <button
                      type="button"
                      onClick={onReviewNeedsAttention}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
                    >
                      Review in Needs Attention
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {report.issues.map((issue) => {
                      const badge = getReadinessIssueBadge(issue.issue_reason);
                      const contactDisplay = [
                        issue.buyer_phone ? formatPhoneReadback(issue.buyer_phone) : null,
                        issue.buyer_email,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      const errorNote = issue.sms_error || issue.email_error;

                      return (
                        <div
                          key={`${issue.ticket_id}-${issue.raffle_sale_batch_id ?? 'single'}`}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2.5 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`font-semibold ${
                                  issue.buyer_name ? 'text-slate-900' : 'text-red-700 italic'
                                }`}
                              >
                                {issue.buyer_name || 'Missing buyer name'}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500">
                                #{issue.ticket_number}
                                {issue.ticket_count > 1 ? ` (${issue.ticket_count} tickets)` : ''}
                              </span>
                            </div>
                            <p className="mt-0.5 text-slate-500 truncate">
                              {contactDisplay || 'No phone or email on file'}
                            </p>
                            {errorNote && (
                              <p className="mt-0.5 text-[11px] text-red-600">{errorNote}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                badge.tone === 'error'
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-800'
                              }`}
                            >
                              {badge.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {report.issues_truncated && (
                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
                      Showing first {report.issues.length} of {report.issues_total_count} affected
                      buyers. Open Needs Attention to view and fix all.
                    </div>
                  )}
                </div>
              )}

              {/* Audited Override Gate */}
              {isOverrideFlow && (
                <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-4 space-y-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideChecked}
                      onChange={(e) => setOverrideChecked(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm font-semibold text-amber-950">
                      Override &amp; Draw Anyway
                      <span className="block text-xs font-normal text-amber-900 mt-0.5">
                        This override and your reason will be recorded in the Activity Log.
                      </span>
                    </span>
                  </label>

                  {overrideChecked && (
                    <div>
                      <label
                        htmlFor="predraw-override-reason"
                        className="block text-xs font-semibold text-amber-950 mb-1"
                      >
                        Override reason <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="predraw-override-reason"
                        type="text"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="e.g. Verified ticket numbers verbally with buyer at banquet table"
                        className="w-full rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      />
                      {overrideReason.trim().length > 0 &&
                        overrideReason.trim().length < MIN_OVERRIDE_REASON_LENGTH && (
                          <p className="mt-1 text-[11px] text-red-700">
                            Enter at least {MIN_OVERRIDE_REASON_LENGTH} characters.
                          </p>
                        )}
                    </div>
                  )}
                </div>
              )}

              {submitError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                  {submitError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {report && !report.ready && report.issues.length > 0 && (
              <button
                type="button"
                onClick={onReviewNeedsAttention}
                disabled={submitting}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              >
                Review in Needs Attention
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!canDraw || loading || submitting}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isOverrideFlow
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
