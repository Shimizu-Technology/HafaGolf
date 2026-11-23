import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Ticket } from 'lucide-react';
import { formatPhoneReadback } from '../utils/rafflePhone';

export interface RaffleSaleDetails {
  buyerName: string;
  email?: string;
  phone?: string;
  bundleLabel?: string;
  quantity: number;
  total: string;
  paymentLabel: string;
  receipt?: string;
  notes?: string;
}

interface RaffleConfirmSaleModalProps {
  sale: RaffleSaleDetails;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RaffleConfirmSaleModal({ sale, submitting, error, onCancel, onConfirm }: RaffleConfirmSaleModalProps) {
  const titleId = useId();
  const helpId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const backdropPressed = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    editRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const fields = [
    ['Buyer name', sale.buyerName],
    ['Phone', sale.phone ? formatPhoneReadback(sale.phone) : 'Email delivery only'],
    ...(sale.email ? [['Email', sale.email]] : []),
    ['Bundle', sale.bundleLabel || 'Custom sale'],
    ['Tickets', sale.quantity.toLocaleString()],
    ['Payment method', sale.paymentLabel],
    ...(sale.receipt ? [['Receipt', sale.receipt]] : []),
    ...(sale.notes ? [['Notes', sale.notes]] : []),
  ];

  return createPortal(
    <dialog
      ref={dialogRef}
      data-static-flow
      aria-labelledby={titleId}
      aria-describedby={helpId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-auto rounded-2xl bg-white p-0 text-slate-950 shadow-xl backdrop:bg-slate-950/65"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onCancel();
      }}
      onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (!submitting && backdropPressed.current && event.target === event.currentTarget) onCancel();
        backdropPressed.current = false;
      }}
    >
      <div className="p-4 sm:p-6">
        <h2 id={titleId} className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <Ticket className="h-6 w-6 shrink-0 text-brand-700" aria-hidden="true" />
          Confirm Raffle Sale
        </h2>
        <p id={helpId} className="mt-2 text-base text-slate-700">
          Read the contact details back to the buyer before you complete the sale.
        </p>
        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-2 rounded-xl bg-slate-100 p-4 text-base">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-semibold text-slate-700">{label}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words font-medium">{value}</dd>
            </div>
          ))}
          <div className="col-span-2 mt-1 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-300 pt-3">
            <dt className="font-bold">Total</dt>
            <dd className="text-2xl font-extrabold tabular-nums">{sale.total}</dd>
          </div>
        </dl>
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-900">{error}</p>}
        <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <button
            ref={editRef}
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="min-h-[48px] rounded-xl border border-slate-400 px-4 text-base font-semibold hover:bg-slate-50 disabled:opacity-60"
          >
            Go Back &amp; Edit
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-bold text-brand-foreground hover:bg-brand-700 disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />}
            Complete Sale &amp; Send Tickets
          </button>
        </div>
        <p role="status" className="sr-only">{submitting ? 'Completing sale and sending tickets' : ''}</p>
      </div>
    </dialog>,
    document.body,
  );
}
