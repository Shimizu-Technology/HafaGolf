import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, HelpCircle, Loader2, Search, Ticket, Trophy } from 'lucide-react';

type TicketResult = { ticket_number: string } & (
  | { status: 'winner'; prize: { name: string; tier_display: string; claimed: boolean } }
  | { status: 'entered' | 'ineligible' | 'not_found'; prize: null }
);

function TicketResultBanner({ result }: { result: TicketResult }) {
  const { status, ticket_number: number } = result;

  if (status === 'winner') {
    return (
      <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <Trophy className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0 break-words">
          <p className="font-bold">Winning ticket #{number}</p>
          <p className="mt-1">{result.prize.name} · {result.prize.tier_display}</p>
          <p className="mt-1">
            {result.prize.claimed
              ? 'Already claimed. Visit the raffle desk if you have questions.'
              : 'Ready to claim. Bring this ticket to the raffle desk to pick up your prize.'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'entered') {
    return (
      <div className="flex gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0 break-words">
          <p className="font-bold">Ticket #{number} is entered</p>
          <p className="mt-1">Your ticket is active in the drawing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 rounded-xl border border-neutral-300 bg-neutral-100 p-4 text-neutral-900">
      <HelpCircle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
      <div className="min-w-0 break-words">
        <p className="font-bold">{status === 'ineligible' ? `Ticket #${number} is inactive` : 'Ticket not found'}</p>
        <p className="mt-1">
          {status === 'ineligible'
            ? 'This ticket is ineligible for the drawing. Visit the raffle desk for help.'
            : 'Double-check the letters and numbers on your ticket and try again.'}
        </p>
      </div>
    </div>
  );
}

export function RaffleTicketCheck({ tournamentId }: { tournamentId: string }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [number, setNumber] = useState('');
  const [result, setResult] = useState<TicketResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => () => requestRef.current?.abort(), []);

  const resetLookup = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setResult(null);
    setError('');
    setLoading(false);
  };

  const checkTicket = async (event: FormEvent) => {
    event.preventDefault();
    const ticketNumber = number.trim();
    if (!ticketNumber || requestRef.current) return;

    const request = new AbortController();
    requestRef.current = request;
    setLoading(true);
    setResult(null);
    setError('');

    try {
      const query = new URLSearchParams({ ticket_number: ticketNumber });
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/tournaments/${tournamentId}/raffle/check_ticket?${query}`,
        { cache: 'no-store', signal: request.signal },
      );
      if (response.status === 429) {
        if (!request.signal.aborted) setError('Too many ticket checks. Wait a minute and try again.');
        return;
      }
      if (!response.ok) throw new Error('We couldn’t check your ticket. Please try again.');
      const data: TicketResult = await response.json();
      if (!request.signal.aborted) setResult(data);
    } catch {
      if (!request.signal.aborted) setError('We couldn’t check your ticket. Please try again.');
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="mb-6 rounded-2xl border border-brand-200 bg-white p-4 shadow-sm sm:mb-8 sm:p-6">
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-xl font-bold text-neutral-950">
        <Ticket className="h-6 w-6 shrink-0 text-brand-600" aria-hidden="true" />
        Check My Ticket
      </h2>
      <p id={`${id}-help`} className="mt-1 text-base text-neutral-600">
        Enter the number from your raffle ticket to see if it’s in the drawing or has won a prize.
      </p>
      <form onSubmit={checkTicket} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label htmlFor={id} className="sr-only">Ticket number</label>
        <input
          ref={inputRef}
          id={id}
          aria-describedby={`${id}-help`}
          value={number}
          onChange={(event) => {
            resetLookup();
            setNumber(event.target.value);
          }}
          placeholder="Ticket number"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          required
          className="min-h-[48px] w-full min-w-0 rounded-xl border border-neutral-300 bg-neutral-50 px-4 text-base text-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        />
        <button
          type="submit"
          disabled={loading || !number.trim()}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-base font-semibold text-brand-foreground hover:bg-brand-700 disabled:opacity-60"
        >
          {loading
            ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
            : <Search className="h-5 w-5" aria-hidden="true" />}
          {loading ? 'Checking…' : 'Check Ticket'}
        </button>
        <button
          type="button"
          disabled={!number}
          onClick={() => {
            resetLookup();
            setNumber('');
            inputRef.current?.focus();
          }}
          className="min-h-[48px] rounded-xl border border-neutral-300 px-4 text-base font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Clear
        </button>
      </form>
      <div role="status" className={result || error ? 'mt-4' : undefined}>
        {result && <TicketResultBanner result={result} />}
        {error && <p className="rounded-xl border border-red-300 bg-red-50 p-4 font-medium text-red-900">{error}</p>}
      </div>
    </section>
  );
}
