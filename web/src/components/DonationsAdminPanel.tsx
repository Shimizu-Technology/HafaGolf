import React, { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  CreditCard,
  DollarSign,
  Heart,
  Loader2,
  Plus,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminDonationRecord, AdminDonationsResponse, api } from '../services/api';
import { formatDateTime } from '../utils/dates';

interface DonationsAdminPanelProps {
  tournamentId: number;
  orgSlug?: string;
  tournamentSlug?: string;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const DonationsAdminPanel: React.FC<DonationsAdminPanelProps> = ({
  tournamentId,
  orgSlug,
  tournamentSlug,
}) => {
  const [data, setData] = useState<AdminDonationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const loadDonations = useCallback(async () => {
    setLoading(true);
    setFeatureDisabled(false);
    try {
      const res = await api.getAdminDonations(tournamentId);
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load donations';
      if (msg.toLowerCase().includes('disabled') || msg.includes('403')) {
        setFeatureDisabled(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadDonations();
  }, [loadDonations]);

  const publicDonatePath =
    orgSlug && tournamentSlug ? `/${orgSlug}/tournaments/${tournamentSlug}/donate` : null;

  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center bg-white rounded-xl border border-gray-200">
        <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (featureDisabled) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <Heart className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-gray-900">Online Donations Feature Is Off</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
          Enable the <span className="font-medium text-gray-700">Online Donations</span> feature flag in
          Organization or Event Settings to accept online donations and track offline contributions.
        </p>
      </div>
    );
  }

  const donations: AdminDonationRecord[] = data?.donations || [];
  const totals = data?.totals || {
    total_raised_cents: 0,
    paid_count: 0,
    pending_count: 0,
    refunded_cents: 0,
    stripe_cents: 0,
    offline_cents: 0,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Heart className="w-4 h-4 text-brand-600" />
            Donations Ledger
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Track online Stripe donations and record offline cash or check contributions.
            {publicDonatePath && (
              <>
                {' '}Public page:{' '}
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{publicDonatePath}</code>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadDonations}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            title="Refresh donations"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-600 text-brand-foreground hover:bg-brand-700 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Record Offline Donation
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <DollarSign className="w-4 h-4 text-brand-600" />
            Total Raised
          </div>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatUsd(totals.total_raised_cents)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Users className="w-4 h-4 text-brand-600" />
            Paid Donations
          </div>
          <p className="mt-1 text-xl font-bold text-gray-900">{totals.paid_count}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CreditCard className="w-4 h-4 text-emerald-600" />
            Stripe Online
          </div>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatUsd(totals.stripe_cents)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Banknote className="w-4 h-4 text-amber-600" />
            Offline / Check
          </div>
          <p className="mt-1 text-xl font-bold text-gray-900">{formatUsd(totals.offline_cents)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {donations.length === 0 ? (
          <div className="py-12 text-center px-4">
            <Heart className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700">No donations recorded yet</p>
            <p className="text-xs text-gray-500 mt-1">
              Online donations and recorded check/cash contributions will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Donor</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {donations.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900">{d.donor_name}</span>
                        {d.anonymous && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            Anonymous publicly
                          </span>
                        )}
                      </div>
                      {(d.donor_email || d.donor_phone) && (
                        <p className="text-xs text-gray-400">
                          {[d.donor_email, d.donor_phone].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{formatUsd(d.amount_cents)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                          d.payment_status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : d.payment_status === 'pending'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {d.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 capitalize">
                      {d.payment_method || d.payment_type}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">
                      {d.message || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {d.paid_at ? formatDateTime(d.paid_at) : d.created_at ? formatDateTime(d.created_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <RecordOfflineDonationModal
          tournamentId={tournamentId}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            loadDonations();
          }}
        />
      )}
    </div>
  );
};

const RecordOfflineDonationModal: React.FC<{
  tournamentId: number;
  onClose: () => void;
  onSaved: () => void;
}> = ({ tournamentId, onClose, onSaved }) => {
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorPhone, setDonorPhone] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  const [paymentType, setPaymentType] = useState<'check' | 'cash' | 'offline'>('check');
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseFloat(amountDollars);
    if (Number.isNaN(parsed) || parsed <= 0) {
      toast.error('Enter a valid donation amount greater than $0.00');
      return;
    }

    setSaving(true);
    try {
      await api.createOfflineDonation(tournamentId, {
        donor_name: donorName.trim(),
        donor_email: donorEmail.trim() || undefined,
        donor_phone: donorPhone.trim() || undefined,
        amount_cents: Math.round(parsed * 100),
        payment_type: paymentType,
        payment_method: paymentType,
        anonymous,
        message: message.trim() || undefined,
      });
      toast.success('Offline donation recorded');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record donation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Record Offline Donation</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Donor Name *</label>
            <input
              type="text"
              required
              value={donorName}
              onChange={(e) => setDonorName(e.target.value)}
              placeholder="Donor or company name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Amount (USD) *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                placeholder="100.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as 'check' | 'cash' | 'offline')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="offline">Other Offline</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={donorEmail}
                onChange={(e) => setDonorEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={donorPhone}
                onChange={(e) => setDonorPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Note / Message</label>
            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Check # or donor message"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="rounded border-gray-300 text-brand-600"
            />
            <span>Hide donor name on public donor wall</span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-brand-foreground text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Donation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
