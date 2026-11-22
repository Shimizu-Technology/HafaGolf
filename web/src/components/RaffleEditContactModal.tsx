import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Save,
  Send,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  formatPhoneReadback,
  normalizeRafflePhone,
  validateRafflePhonePair,
} from '../utils/rafflePhone';
import { isChannelFailed, type TicketDeliveryStatus } from '../utils/raffleDelivery';

export interface EditableRaffleTicket {
  id: number;
  ticket_number: string;
  purchaser_name: string;
  purchaser_email: string | null;
  purchaser_phone: string | null;
  raffle_sale_batch_id?: number | null;
  delivery_status?: TicketDeliveryStatus;
}

interface DeliveryResult {
  success: boolean;
  skipped?: boolean;
  error?: string | null;
  message_id?: string | null;
}

interface DeliveryResults {
  email?: DeliveryResult;
  sms?: DeliveryResult;
}

interface RaffleEditContactModalProps {
  ticket: EditableRaffleTicket;
  tournamentId: string;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onSuccess: () => void;
}

const deliveryFailureMessage = (delivery?: DeliveryResults | null) => {
  if (!delivery) return null;

  const failures = ([
    ['Email', delivery.email],
    ['SMS', delivery.sms],
  ] as const).filter(([, result]) => result && !result.skipped && !result.success);

  if (failures.length === 0) return null;

  return failures
    .map(([label, result]) => `${label} failed${result?.error ? `: ${result.error}` : ''}`)
    .join('. ');
};

const deliverySuccessLabels = (delivery?: DeliveryResults | null) => {
  if (!delivery) return [];

  return ([
    ['email', delivery.email],
    ['SMS', delivery.sms],
  ] as const)
    .filter(([, result]) => result?.success)
    .map(([label]) => label);
};

export const RaffleEditContactModal: React.FC<RaffleEditContactModalProps> = ({
  ticket,
  tournamentId,
  getToken,
  onClose,
  onSuccess,
}) => {
  const initialPhone = ticket.purchaser_phone || '';
  const initialPhoneNormalized = normalizeRafflePhone(initialPhone);
  const smsFailedPreviously = isChannelFailed(ticket.delivery_status?.sms);

  const [buyerName, setBuyerName] = useState(ticket.purchaser_name || '');
  const [buyerEmail, setBuyerEmail] = useState(ticket.purchaser_email || '');
  const [buyerPhone, setBuyerPhone] = useState(initialPhone);
  const [buyerPhoneConfirm, setBuyerPhoneConfirm] = useState(
    initialPhoneNormalized && !smsFailedPreviously ? initialPhone : ''
  );
  const [submittingMode, setSubmittingMode] = useState<'resend' | 'save' | null>(null);

  const phoneValidation = useMemo(
    () => validateRafflePhonePair(buyerPhone, buyerPhoneConfirm),
    [buyerPhone, buyerPhoneConfirm]
  );

  const trimmedName = buyerName.trim();
  const trimmedEmail = buyerEmail.trim();
  const phoneBlocked =
    phoneValidation.status === 'incomplete' || phoneValidation.status === 'mismatch';
  const hasContact = trimmedEmail !== '' || phoneValidation.status === 'valid';
  const canSubmit = trimmedName !== '' && !phoneBlocked && hasContact;

  const smsError = ticket.delivery_status?.sms?.error_text;
  const emailError = ticket.delivery_status?.email?.error_text;
  const hasPriorFailure =
    isChannelFailed(ticket.delivery_status?.sms) ||
    isChannelFailed(ticket.delivery_status?.email);

  const handlePhoneChange = (nextValue: string) => {
    setBuyerPhone(nextValue);
    if (
      initialPhoneNormalized &&
      normalizeRafflePhone(nextValue) !== initialPhoneNormalized &&
      buyerPhoneConfirm === initialPhone
    ) {
      setBuyerPhoneConfirm('');
    }
  };

  const handleSubmit = async (resend: boolean) => {
    if (!canSubmit || submittingMode) return;

    setSubmittingMode(resend ? 'resend' : 'save');
    try {
      const token = await getToken();
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/tournaments/${tournamentId}/raffle/tickets/${ticket.id}/contact`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            buyer_name: trimmedName,
            buyer_email: trimmedEmail,
            buyer_phone: phoneValidation.normalized || '',
            resend,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update contact');
      }

      if (resend) {
        const channels = deliverySuccessLabels(data.delivery);
        const ticketCount = data.ticket_count || 1;
        const ticketWord = ticketCount === 1 ? 'ticket' : 'tickets';

        if (channels.length > 0) {
          toast.success(
            `Updated ${ticketCount} ${ticketWord} and sent confirmation via ${channels.join(' and ')}`
          );
        } else {
          toast.success(`Contact updated across ${ticketCount} ${ticketWord}`);
        }

        const warning = deliveryFailureMessage(data.delivery);
        if (warning) {
          toast.error(`Contact saved, but ${warning}`);
        }
      } else {
        toast.success(data.message || 'Contact updated');
      }

      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update contact');
    } finally {
      setSubmittingMode(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-contact-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2
              id="edit-contact-modal-title"
              className="text-lg font-semibold text-slate-900"
            >
              Edit Contact &amp; Resend
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ticket <span className="font-mono font-semibold text-slate-700">{ticket.ticket_number}</span>
              {' — '}updates all tickets in this buyer&apos;s sale batch.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Prior failure callout */}
          {hasPriorFailure && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-900">Previous delivery failed</p>
                  {isChannelFailed(ticket.delivery_status?.sms) && (
                    <p className="text-xs text-red-700">
                      <span className="font-medium">SMS ({ticket.delivery_status?.sms?.status}):</span>{' '}
                      {smsError || 'Carrier rejected or could not deliver message.'}
                    </p>
                  )}
                  {isChannelFailed(ticket.delivery_status?.email) && (
                    <p className="text-xs text-red-700">
                      <span className="font-medium">Email ({ticket.delivery_status?.email?.status}):</span>{' '}
                      {emailError || 'Email delivery failed or bounced.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Buyer name */}
          <div>
            <label
              htmlFor="edit-contact-name"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Buyer name <span className="text-red-500">*</span>
            </label>
            <input
              id="edit-contact-name"
              type="text"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Full name"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label
              htmlFor="edit-contact-email"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Email <span className="text-xs font-normal text-slate-500">(recommended for dual-channel backup)</span>
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="edit-contact-email"
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                placeholder="buyer@email.com"
                className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Double-entry phone */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="edit-contact-phone"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Phone number
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="edit-contact-phone"
                    type="tel"
                    value={buyerPhone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="671-555-1234"
                    className={`w-full rounded-xl border bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                      phoneValidation.status === 'incomplete'
                        ? 'border-red-400 focus:ring-red-500'
                        : phoneValidation.status === 'valid'
                          ? 'border-emerald-400 focus:ring-emerald-500'
                          : 'border-slate-300 focus:ring-brand-500'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-contact-phone-confirm"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Confirm phone number
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="edit-contact-phone-confirm"
                    type="tel"
                    autoComplete="off"
                    value={buyerPhoneConfirm}
                    onChange={(e) => setBuyerPhoneConfirm(e.target.value)}
                    placeholder="Re-enter phone"
                    className={`w-full rounded-xl border bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                      phoneValidation.status === 'mismatch'
                        ? 'border-red-400 focus:ring-red-500'
                        : phoneValidation.status === 'valid'
                          ? 'border-emerald-400 focus:ring-emerald-500'
                          : 'border-slate-300 focus:ring-brand-500'
                    }`}
                  />
                </div>
              </div>
            </div>

            {phoneValidation.error && (
              <div className="flex items-start gap-2 text-xs font-medium text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{phoneValidation.error}</span>
              </div>
            )}

            {phoneValidation.status === 'valid' && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>Phone numbers match ({phoneValidation.formatted})</span>
              </div>
            )}
          </div>

          {/* Read-back confirmation strip */}
          {canSubmit && (
            <div className="rounded-xl bg-slate-900 p-4 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Confirm with buyer before sending
              </p>
              <p className="mt-1 text-sm font-semibold text-white">{trimmedName}</p>
              {phoneValidation.normalized && (
                <p className="mt-1 flex items-center gap-2 font-mono text-lg font-bold tracking-wide text-emerald-300">
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  {formatPhoneReadback(phoneValidation.normalized)}
                </p>
              )}
              {trimmedEmail ? (
                <p className="mt-1 flex items-center gap-2 text-xs text-slate-200">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {trimmedEmail}
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-300">
                  SMS only — adding an email gives a backup delivery channel.
                </p>
              )}
            </div>
          )}

          {!hasContact && !phoneBlocked && (
            <p className="text-xs text-amber-700">
              Enter at least an email address or a confirmed 10-digit phone number.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submittingMode !== null}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit(false)}
            disabled={!canSubmit || submittingMode !== null}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingMode === 'save' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Only
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit(true)}
            disabled={!canSubmit || submittingMode !== null}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingMode === 'resend' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Save &amp; Resend
          </button>
        </div>
      </div>
    </div>
  );
};
