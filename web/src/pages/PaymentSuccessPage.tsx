import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { api, PaymentConfirmation } from '../services/api';

/**
 * PaymentSuccessPage - Confirms Stripe Checkout (or local simulated test mode)
 * and forwards the golfer/registration to the tournament success page.
 */
export const PaymentSuccessPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [status, setStatus] = useState<'confirming' | 'confirmed' | 'error'>('confirming');
  const [confirmation, setConfirmation] = useState<PaymentConfirmation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus('error');
      setErrorMessage('Missing checkout session identifier.');
      return;
    }

    let cancelled = false;
    async function confirm() {
      try {
        const res = await api.confirmPayment(sessionId!);
        if (cancelled) return;

        setConfirmation(res);
        setStatus('confirmed');

        if (res.tournament_slug && res.tournament) {
          const registration = res.registration;
          const golfer = res.golfer || (registration
            ? {
                id: registration.id,
                name: registration.contact_name || registration.display_team_name,
                email: registration.contact_email || '',
                phone: registration.contact_phone || '',
                partner_name: registration.team_members?.[1]?.name || null,
                team_name: registration.display_team_name,
                registration_status: registration.registration_status,
                payment_token: registration.payment_token,
              }
            : undefined);

          navigate(`/${res.tournament_slug}/success`, {
            replace: true,
            state: {
              golfer,
              registration,
              tournament: res.tournament,
              paymentComplete: true,
            },
          });
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(err instanceof Error ? err.message : 'Unable to confirm payment.');
        }
      }
    }

    confirm();
    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

  if (status === 'confirming') {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-6">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-brand-600 mx-auto mb-4" />
          <p className="text-neutral-700 font-medium">Confirming your payment...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-neutral-900 mb-2">Payment Confirmation Issue</h1>
          <p className="text-sm text-neutral-600 mb-6">{errorMessage}</p>
          <Link
            to="/"
            className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-brand-600 text-brand-foreground text-sm font-semibold hover:bg-brand-700 transition-colors"
          >
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-neutral-200 p-8 text-center shadow-sm">
        <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-neutral-900 mb-2">Payment Confirmed!</h1>
        <p className="text-sm text-neutral-600 mb-6">
          {confirmation?.message || 'Your registration payment has been confirmed.'}
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-brand-600 text-brand-foreground text-sm font-semibold hover:bg-brand-700 transition-colors"
        >
          Back to Events
        </Link>
      </div>
    </div>
  );
};
