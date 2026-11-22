import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Calculator,
  CheckCircle2,
  Download,
  Lock,
  Plus,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  api,
  TournamentPayoutRecord,
  TournamentSettlementResponse,
} from '../services/api';
import { formatDateTime } from '../utils/dates';

interface PayoutStatementPanelProps {
  tournamentId: number;
}

function formatCents(cents: number | null | undefined): string {
  const val = cents ?? 0;
  const sign = val < 0 ? '-' : '';
  return `${sign}$${(Math.abs(val) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PayoutStatementPanel({ tournamentId }: PayoutStatementPanelProps) {
  const [data, setData] = useState<TournamentSettlementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [adjustmentDollars, setAdjustmentDollars] = useState('0.00');
  const [adjustmentNotes, setAdjustmentNotes] = useState('');

  const [showPayoutForm, setShowPayoutForm] = useState(false);
  const [payoutDollars, setPayoutDollars] = useState('');
  const [payoutProvider, setPayoutProvider] = useState<'check' | 'manual' | 'ach'>('check');
  const [payoutRef, setPayoutRef] = useState('');
  const [payoutPayee, setPayoutPayee] = useState('');
  const [payoutBank, setPayoutBank] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutMarkPaid, setPayoutMarkPaid] = useState(true);

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTournamentSettlement(tournamentId);
      setData(res);
      const currentAdj = res.settlement?.adjustment_cents ?? 0;
      setAdjustmentDollars((currentAdj / 100).toFixed(2));
      setAdjustmentNotes(res.settlement?.adjustment_notes || '');
      setPayoutPayee(res.payee_defaults.payee_name || '');
      setPayoutBank(res.payee_defaults.bank_name || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payout statement');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCalculate = async () => {
    const parsed = Number.parseFloat(adjustmentDollars || '0');
    if (Number.isNaN(parsed)) {
      setError('Adjustment amount must be a valid number.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.calculateTournamentSettlement(tournamentId, {
        adjustment_cents: Math.round(parsed * 100),
        adjustment_notes: adjustmentNotes.trim() || undefined,
      });
      setData(res);
      setMessage(`Calculated settlement statement v${res.settlement?.version ?? 1}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate settlement');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.finalizeTournamentSettlement(tournamentId);
      setData(res);
      setMessage(`Finalized statement v${res.settlement?.version ?? 1}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize statement');
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseFloat(payoutDollars);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setError('Enter a payout amount greater than $0.00.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `payout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await api.createTournamentPayout(tournamentId, {
        amount_cents: Math.round(parsed * 100),
        provider: payoutProvider,
        provider_payout_id: payoutRef.trim() || undefined,
        payee_name: payoutPayee.trim() || undefined,
        bank_name: payoutBank.trim() || undefined,
        notes: payoutNotes.trim() || undefined,
        mark_paid: payoutMarkPaid,
        idempotency_key: key,
      });
      setData(res);
      setShowPayoutForm(false);
      setPayoutDollars('');
      setPayoutRef('');
      setPayoutNotes('');
      setMessage(`Recorded ${payoutProvider} payout of ${formatCents(res.payout.amount_cents)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payout');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPaid = async (payout: TournamentPayoutRecord) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.markTournamentPayoutPaid(tournamentId, payout.id);
      setData(res);
      setMessage(`Marked payout ${payout.provider_payout_id || payout.id.slice(0, 8)} as paid.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark payout paid');
    } finally {
      setBusy(false);
    }
  };

  const handleVoidPayout = async (payoutId: string) => {
    if (!voidReason.trim()) {
      setError('Enter a reason before voiding a payout.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.voidTournamentPayout(tournamentId, payoutId, voidReason.trim());
      setData(res);
      setVoidingId(null);
      setVoidReason('');
      setMessage('Payout voided and payable balance updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void payout');
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = async () => {
    setError(null);
    try {
      const blob = await api.downloadTournamentSettlementCsv(tournamentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.tournament.slug || `tournament-${tournamentId}`}-payout-statement.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export CSV');
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        Loading payout statement...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-sm text-red-600">
        {error || 'Unable to load settlement statement.'}
      </div>
    );
  }

  const summary = data.settlement ?? data.live_preview;
  const remainingCapacity =
    data.settlement?.remaining_payout_capacity_cents ??
    Math.max(summary.organizer_proceeds_cents - (summary.paid_cents + summary.pending_payout_cents), 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">
              Payout Settlement Statement
            </h3>
            {data.settlement ? (
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  data.settlement.status === 'finalized'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                v{data.settlement.version} {data.settlement.status}
              </span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                Live Preview (Not Yet Calculated)
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Payment mode: <span className="font-medium text-gray-700">{data.payment_mode}</span>
            {data.payee_defaults.payee_name && (
              <>
                {' '}· Payee: <span className="font-medium text-gray-700">{data.payee_defaults.payee_name}</span>
              </>
            )}
            {data.payee_defaults.bank_name && <> ({data.payee_defaults.bank_name})</>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          {message}
        </div>
      )}

      {data.settlement?.ledger_changed_since_calculation && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Ledger changed since statement v{data.settlement.version} was calculated.</p>
            <p className="mt-0.5">
              Live proceeds are {formatCents(data.live_preview.organizer_proceeds_cents)} (vs {formatCents(data.settlement.organizer_proceeds_cents)} on v{data.settlement.version}).
              {data.can_manage_payouts && ' Recalculate to create an updated draft statement.'}
            </p>
          </div>
        </div>
      )}

      {/* Statement Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Gross Platform Collected" value={formatCents(summary.gross_cents)} />
        <MetricCard label="Refunds" value={formatCents(-summary.refund_cents)} tone="muted" />
        <MetricCard label="Processing Fees" value={formatCents(-summary.processing_fee_cents)} tone="muted" />
        <MetricCard label="Platform Fee" value={formatCents(-summary.platform_fee_cents)} tone="muted" />
        <MetricCard label="Adjustments" value={formatCents(summary.adjustment_cents)} />
        <MetricCard label="Organizer Proceeds" value={formatCents(summary.organizer_proceeds_cents)} tone="brand" />
        <MetricCard label="Paid Out" value={formatCents(summary.paid_cents)} tone="green" />
        <MetricCard
          label="Balance Owed (Payable)"
          value={formatCents(summary.payable_cents)}
          tone={summary.payable_cents > 0 ? 'amber' : 'green'}
        />
      </div>

      {/* Super Admin Controls */}
      {data.can_manage_payouts && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Manual Adjustment (USD, +/-)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={adjustmentDollars}
                  onChange={(e) => setAdjustmentDollars(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Adjustment Notes
                </label>
                <input
                  type="text"
                  value={adjustmentNotes}
                  onChange={(e) => setAdjustmentNotes(e.target.value)}
                  placeholder="Optional explanation for adjustment"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleCalculate}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50"
              >
                <Calculator size={14} />
                {data.settlement?.status === 'finalized' ? 'New Draft Version' : 'Recalculate Draft'}
              </button>
              {data.settlement && data.settlement.status === 'draft' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleFinalize}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg disabled:opacity-50"
                >
                  <Lock size={14} />
                  Finalize v{data.settlement.version}
                </button>
              )}
              {data.settlement && remainingCapacity > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPayoutDollars((remainingCapacity / 100).toFixed(2));
                    setShowPayoutForm((prev) => !prev);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-800 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                >
                  <Plus size={14} />
                  Record Payout
                </button>
              )}
            </div>
          </div>

          {showPayoutForm && (
            <form onSubmit={handleCreatePayout} className="border-t border-gray-200 pt-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Record Disbursement (Max Available: {formatCents(remainingCapacity)})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Amount (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={payoutDollars}
                    onChange={(e) => setPayoutDollars(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
                  <select
                    value={payoutProvider}
                    onChange={(e) => setPayoutProvider(e.target.value as 'check' | 'manual' | 'ach')}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="check">Check</option>
                    <option value="ach">ACH / Bank Transfer</option>
                    <option value="manual">Manual Disbursement</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Check # / Reference</label>
                  <input
                    type="text"
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    placeholder="e.g. CHK-1042"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Payee</label>
                  <input
                    type="text"
                    value={payoutPayee}
                    onChange={(e) => setPayoutPayee(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Bank</label>
                  <input
                    type="text"
                    value={payoutBank}
                    onChange={(e) => setPayoutBank(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                  <input
                    type="text"
                    value={payoutNotes}
                    onChange={(e) => setPayoutNotes(e.target.value)}
                    placeholder="Hand-delivered to treasurer"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={payoutMarkPaid}
                    onChange={(e) => setPayoutMarkPaid(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Mark payout as paid immediately
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPayoutForm(false)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
                  >
                    <Banknote size={14} />
                    Save Payout
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Recorded Payouts Table */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">Recorded Payouts</h4>
        {data.payouts.length === 0 ? (
          <p className="text-xs text-gray-500 py-4 border border-dashed border-gray-200 rounded-lg text-center">
            No payouts recorded for this tournament yet.
          </p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Method / Ref</th>
                  <th className="px-3 py-2">Payee</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  {data.can_manage_payouts && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.payouts.map((payout) => (
                  <React.Fragment key={payout.id}>
                    <tr>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                        {formatDateTime(payout.paid_at || payout.initiated_at || payout.created_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-gray-900 uppercase">{payout.provider}</span>
                        {payout.provider_payout_id && (
                          <span className="ml-1.5 text-gray-500">#{payout.provider_payout_id}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">
                        <div>{payout.payee_snapshot?.payee_name || '-'}</div>
                        {payout.payee_snapshot?.bank_name && (
                          <div className="text-[11px] text-gray-500">{payout.payee_snapshot.bank_name}</div>
                        )}
                        {payout.notes && <div className="text-[11px] text-gray-500">{payout.notes}</div>}
                        {payout.void_reason && (
                          <div className="text-[11px] text-red-600">Voided: {payout.void_reason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            payout.status === 'paid'
                              ? 'bg-green-100 text-green-700'
                              : payout.status === 'voided'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {payout.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                        {formatCents(payout.amount_cents)}
                      </td>
                      {data.can_manage_payouts && (
                        <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                          {payout.status === 'pending' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleMarkPaid(payout)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded"
                            >
                              <CheckCircle2 size={12} />
                              Mark Paid
                            </button>
                          )}
                          {payout.status !== 'voided' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setVoidingId(payout.id);
                                setVoidReason('');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded"
                            >
                              <XCircle size={12} />
                              Void
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {voidingId === payout.id && (
                      <tr className="bg-red-50/50">
                        <td colSpan={data.can_manage_payouts ? 6 : 5} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={voidReason}
                              onChange={(e) => setVoidReason(e.target.value)}
                              placeholder="Reason for voiding this payout..."
                              className="flex-1 min-w-[200px] px-2.5 py-1.5 text-xs border border-red-200 rounded bg-white"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleVoidPayout(payout.id)}
                              className="px-2.5 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded"
                            >
                              Confirm Void
                            </button>
                            <button
                              type="button"
                              onClick={() => setVoidingId(null)}
                              className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Itemized Platform Charges */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">
          Itemized Platform Charges ({data.line_items.length})
        </h4>
        {data.line_items.length === 0 ? (
          <p className="text-xs text-gray-500 py-4 border border-dashed border-gray-200 rounded-lg text-center">
            No platform-collected online charges found for this tournament.
          </p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Refund</th>
                  <th className="px-3 py-2 text-right">Proc. Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.line_items.map((item) => (
                  <tr key={`${item.source_type}-${item.source_id}`}>
                    <td className="px-3 py-2 uppercase text-gray-500">{item.source_type}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      <div>{item.label}</div>
                      {item.email && <div className="text-[11px] text-gray-500">{item.email}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{item.payment_status}</td>
                    <td className="px-3 py-2 text-right">{formatCents(item.gross_cents)}</td>
                    <td className="px-3 py-2 text-right text-red-600">
                      {item.refund_cents > 0 ? formatCents(-item.refund_cents) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {formatCents(item.processing_fee_cents)}{' '}
                      <span className="text-[10px] text-gray-400">({item.fee_source})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'brand' | 'green' | 'amber';
}) {
  const styles: Record<string, string> = {
    default: 'bg-white border-gray-200 text-gray-900',
    muted: 'bg-gray-50 border-gray-200 text-gray-700',
    brand: 'bg-brand-50 border-brand-200 text-brand-900',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
  };
  return (
    <div className={`rounded-xl border p-3 ${styles[tone]}`}>
      <p className="text-[11px] font-medium opacity-75">{label}</p>
      <p className="text-base sm:text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}
