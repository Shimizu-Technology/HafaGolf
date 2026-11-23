import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { createConsumer } from '@rails/actioncable';
import { useMotionOk } from '../hooks/useMotionOk';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useOrganization } from '../components/OrganizationProvider';
import {
  Gift,
  Trophy,
  Clock,
  Ticket,
  ChevronLeft,
  RefreshCw,
  Star,
  Sparkles,
  PartyPopper,
  Search,
  Loader2,
  Monitor,
  MonitorOff,
  Check,
  X,
  Pin,
  Timer,
  ArrowRight,
} from 'lucide-react';
import { RaffleTicketCheck } from '../components/RaffleTicketCheck';
import { SignedInAdminBar } from '../components/SignedInAdminBar';
import { getDefaultOrgSlug } from '../utils/tenant';
import {
  applyServerHoldPreference,
  AUTO_DISMISS_DELAY_MS,
  shouldAutoDismissSpotlight,
  toggleLocalHoldPreference,
  transitionSpotlightOnCleared,
  transitionSpotlightOnDrawStarted,
  transitionSpotlightOnWinnerRevealed,
  type LiveDrawState,
  type SpotlightPreferencesState,
} from '../utils/raffleSpotlight';

interface Prize {
  id: number;
  name: string;
  description: string | null;
  value_cents: number;
  value_dollars: number;
  tier: string;
  tier_display: string;
  image_url: string | null;
  sponsor_name: string | null;
  sponsor_logo_url: string | null;
  position: number;
  won: boolean;
  claimed: boolean;
  winner?: {
    name: string;
    won_at: string;
    ticket_number: string;
  };
}

interface RaffleBoardData {
  tournament: {
    id: string;
    name: string;
    raffle_enabled: boolean;
    raffle_draw_time: string | null;
    raffle_description: string | null;
    raffle_hold_winner_on_screen?: boolean;
  };
  prizes: Prize[];
  stats: {
    total_prizes: number;
    prizes_won: number;
    prizes_remaining: number;
    total_tickets_sold: number;
  };
  last_updated: string;
}

const TIERS = ['grand', 'platinum', 'gold', 'silver', 'standard'];
const TIER_RANK = TIERS.reduce<Record<string, number>>((acc, tier, index) => {
  acc[tier] = index;
  return acc;
}, {});
const PUBLIC_PRIZES_PER_PAGE = 12;
const formatPrizeValue = (value: number) => value.toLocaleString('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
});
const SPINNING_TICKET_COUNT = 16;
const SPINNING_TICKET_ROTATE_STEP = 8;
const FALLBACK_SPINNING_TICKETS = ['TIX-0001', 'TIX-0002', 'TIX-0003', 'TIX-0004'];

type PublicPrizeStatusFilter = '' | 'available' | 'won';
type PublicPrizeSort = 'tier' | 'position' | 'name' | 'value_desc' | 'value_asc';

// ---------------------------------------------------------------------------
// Tier styling helpers
// ---------------------------------------------------------------------------

const TIER_STYLES = {
  grand: { Icon: Trophy, pill: 'bg-amber-100 text-amber-950', art: 'bg-amber-50 text-amber-900' },
  platinum: { Icon: Star, pill: 'bg-indigo-100 text-indigo-950', art: 'bg-indigo-50 text-indigo-900' },
  gold: { Icon: Sparkles, pill: 'bg-yellow-100 text-yellow-950', art: 'bg-yellow-50 text-yellow-900' },
  silver: { Icon: Star, pill: 'bg-slate-200 text-slate-950', art: 'bg-slate-100 text-slate-700' },
  standard: { Icon: Gift, pill: 'bg-brand-100 text-brand-900', art: 'bg-brand-50 text-brand-700' },
};

function prizeTier(tier: string) {
  return TIER_STYLES[tier as keyof typeof TIER_STYLES] || TIER_STYLES.standard;
}

function TierBadge({ prize, large = false }: { prize: Prize; large?: boolean }) {
  const { Icon, pill } = prizeTier(prize.tier);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold ${pill} ${large ? 'text-base' : 'text-sm'}`}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {prize.tier_display}
    </span>
  );
}

function PrizeArtwork({ prize, eager = false }: { prize: Prize; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const { Icon, art } = prizeTier(prize.tier);
  if (prize.image_url && !failed) {
    return (
      <img
        src={prize.image_url}
        alt=""
        className="h-full w-full bg-white object-contain p-3"
        loading={eager ? 'eager' : 'lazy'}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={`grid h-full place-items-center ${art}`}>
      <span className="grid h-20 w-20 place-items-center rounded-full border border-current/20 bg-white/60">
        <Icon className="h-10 w-10" strokeWidth={1.5} aria-hidden="true" />
      </span>
    </div>
  );
}

function SponsorLogo({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : (
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-5 max-w-12 shrink-0 object-contain" />
  );
}

export const RaffleBoardPage: React.FC = () => {
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const displayMode = searchParams.get('display');
  const isTvMode = displayMode === 'tv' || displayMode === 'projector';
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const focusModeButton = useRef(false);
  const motionOk = useMotionOk();
  const { organization } = useOrganization();
  const orgSlug = organization?.slug || getDefaultOrgSlug();
  const [data, setData] = useState<RaffleBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prizeSearch, setPrizeSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PublicPrizeStatusFilter>('');
  const [sortBy, setSortBy] = useState<PublicPrizeSort>('tier');
  const [page, setPage] = useState(1);
  const [liveDraw, setLiveDraw] = useState<LiveDrawState | null>(null);
  const [spotlightPrefs, setSpotlightPrefs] = useState<SpotlightPreferencesState>({
    holdWinnerOnScreen: true,
    hasLocalOverride: false,
  });
  const holdWinnerOnScreen = spotlightPrefs.holdWinnerOnScreen;
  const [spinSampleOffset, setSpinSampleOffset] = useState(0);
  const revealTimeoutRef = useRef<number | null>(null);
  const drawSafetyTimeoutRef = useRef<number | null>(null);
  const drawStartRef = useRef<{ drawId: string; startedAt: number } | null>(null);

  const changeDisplayMode = useCallback((tv: boolean) => {
    focusModeButton.current = true;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tv) next.set('display', 'tv');
      else next.delete('display');
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (focusModeButton.current && modeButtonRef.current) {
      modeButtonRef.current.focus();
      focusModeButton.current = false;
    }
  }, [isTvMode, loading, error]);

  const toggleHoldWinnerMode = useCallback(() => {
    setSpotlightPrefs((current) => toggleLocalHoldPreference(current));
  }, []);

  const clearLiveDrawTimers = useCallback(() => {
    if (revealTimeoutRef.current) {
      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }
    if (drawSafetyTimeoutRef.current) {
      window.clearTimeout(drawSafetyTimeoutRef.current);
      drawSafetyTimeoutRef.current = null;
    }
  }, []);

  const dismissLiveDraw = useCallback(() => {
    clearLiveDrawTimers();
    drawStartRef.current = null;
    setLiveDraw(null);
  }, [clearLiveDrawTimers]);

  const fetchData = useCallback(async () => {
    try {
      const tournamentRes = await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/organizations/${orgSlug}/tournaments/${tournamentSlug}`
      );
      if (!tournamentRes.ok) throw new Error('Tournament not found');
      const tournamentData = await tournamentRes.json();
      const tournamentId = tournamentData.id || tournamentData.tournament?.id;

      const boardRes = await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/tournaments/${tournamentId}/raffle/board`,
        { cache: 'no-store' }
      );
      if (!boardRes.ok) throw new Error('Failed to load raffle');
      const boardData = await boardRes.json();

      setData(boardData);
      setSpotlightPrefs((current) =>
        applyServerHoldPreference(current, boardData.tournament?.raffle_hold_winner_on_screen)
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load raffle');
    } finally {
      setLoading(false);
    }
  }, [orgSlug, tournamentSlug]);

  const [cableConnected, setCableConnected] = useState(false);
  const hadCableConnectionRef = useRef(false);

  // Initial load + visibility-aware fallback polling:
  // Fast 5s sync if ActionCable is disconnected; gentle 30s safety sync while connected; paused when tab hidden.
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useVisibilityPolling(
    () => {
      void fetchData();
    },
    cableConnected ? 30000 : 5000
  );

  useEffect(() => {
    if (!data?.tournament?.id) return;

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const wsUrl = import.meta.env.VITE_WS_URL || `${apiUrl.replace(/^http/, 'ws')}/cable`;
    const consumer = createConsumer(wsUrl);
    const subscription = consumer.subscriptions.create(
      { channel: 'RaffleChannel', tournament_id: data.tournament.id },
      {
        connected() {
          setCableConnected(true);
          if (hadCableConnectionRef.current) {
            void fetchData();
          } else {
            hadCableConnectionRef.current = true;
          }
        },
        disconnected() {
          setCableConnected(false);
        },
        rejected() {
          setCableConnected(false);
        },
        received(event: {
          action: string;
          draw_id?: string;
          hold_on_screen?: boolean;
          eligible_ticket_count?: number;
          preview_ticket_numbers?: string[];
          preview_ticket_sample_count?: number;
          preview_ticket_sample_is_sample?: boolean;
          started_at?: string;
          prize?: {
            id: number;
            name: string;
            winner_name?: string;
            winning_ticket?: { ticket_number?: string };
          };
        }) {
          if (event.action === 'spotlight_cleared') {
            clearLiveDrawTimers();
            drawStartRef.current = null;
            setLiveDraw(transitionSpotlightOnCleared());
            return;
          }

          const { action, draw_id: drawId, prize } = event;
          if (!drawId || !prize) return;
          if (action !== 'draw_started' && action !== 'prize_won' && action !== 'winner_revealed') return;

          clearLiveDrawTimers();
          const previous = drawStartRef.current;
          const isNewDraw = action === 'draw_started' || previous?.drawId !== drawId;
          const startedAt = isNewDraw ? Date.now() : previous.startedAt;
          if (isNewDraw) {
            drawStartRef.current = { drawId, startedAt };
            setSpinSampleOffset(0);
            setLiveDraw(transitionSpotlightOnDrawStarted({
              drawId,
              prizeId: prize.id,
              prizeName: prize.name,
              eligibleTicketCount: event.eligible_ticket_count || 0,
              previewTicketSampleCount: event.preview_ticket_sample_count || event.preview_ticket_numbers?.length || 0,
              previewTicketSampleIsSample: event.preview_ticket_sample_is_sample === true,
              previewTicketNumbers: event.preview_ticket_numbers || [],
              startedAt,
            }));
          }

          if (action === 'draw_started') {
            drawSafetyTimeoutRef.current = window.setTimeout(() => {
              drawStartRef.current = null;
              setLiveDraw((current) => (
                current?.drawId === drawId && current.phase === 'spinning' ? null : current
              ));
              void fetchData();
            }, 15000);
            return;
          }

          setSpotlightPrefs((current) => applyServerHoldPreference(current, event.hold_on_screen));
          const elapsed = Date.now() - startedAt;
          revealTimeoutRef.current = window.setTimeout(() => {
            setSpinSampleOffset(0);
            setLiveDraw((latest) =>
              transitionSpotlightOnWinnerRevealed(latest, {
                drawId,
                winnerName: prize.winner_name,
                winnerTicketNumber: prize.winning_ticket?.ticket_number,
              })
            );
            void fetchData();
          }, Math.max(0, 3600 - elapsed));
        },
      }
    );

    return () => {
      clearLiveDrawTimers();
      drawStartRef.current = null;
      setCableConnected(false);
      subscription.unsubscribe();
      consumer.disconnect();
    };
  }, [clearLiveDrawTimers, data?.tournament?.id, fetchData]);

  const visiblePrizes = useMemo(() => {
    const query = prizeSearch.trim().toLowerCase();
    return (data?.prizes || [])
      .filter((prize) => {
        if (query) {
          const haystack = [
            prize.name,
            prize.description || '',
            prize.sponsor_name || '',
            prize.tier_display,
          ].join(' ').toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        if (tierFilter && prize.tier !== tierFilter) return false;
        if (statusFilter === 'available' && prize.won) return false;
        if (statusFilter === 'won' && !prize.won) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'position':
            return a.position - b.position || (TIER_RANK[a.tier] ?? 99) - (TIER_RANK[b.tier] ?? 99);
          case 'name':
            return a.name.localeCompare(b.name);
          case 'value_desc':
            return b.value_dollars - a.value_dollars || a.position - b.position;
          case 'value_asc':
            return a.value_dollars - b.value_dollars || a.position - b.position;
          case 'tier':
          default:
            return (TIER_RANK[a.tier] ?? 99) - (TIER_RANK[b.tier] ?? 99) || a.position - b.position;
        }
      });
  }, [data?.prizes, prizeSearch, tierFilter, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(visiblePrizes.length / PUBLIC_PRIZES_PER_PAGE));
  const paginatedPrizes = visiblePrizes.slice((page - 1) * PUBLIC_PRIZES_PER_PAGE, page * PUBLIC_PRIZES_PER_PAGE);
  const spinningTicketNumbers = useMemo(() => {
    const source = liveDraw?.previewTicketNumbers.length
      ? liveDraw.previewTicketNumbers
      : FALLBACK_SPINNING_TICKETS;

    if (source.length <= SPINNING_TICKET_COUNT) return source;

    return Array.from({ length: SPINNING_TICKET_COUNT }, (_, index) => (
      source[(spinSampleOffset + index) % source.length]
    ));
  }, [liveDraw?.previewTicketNumbers, spinSampleOffset]);

  useEffect(() => {
    setPage(1);
  }, [prizeSearch, tierFilter, statusFilter, sortBy]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!shouldAutoDismissSpotlight(liveDraw, holdWinnerOnScreen)) return;

    const timeout = window.setTimeout(() => setLiveDraw(null), AUTO_DISMISS_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [liveDraw, holdWinnerOnScreen]);

  useEffect(() => {
    if (!isTvMode && !liveDraw) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isTvMode) changeDisplayMode(false);
      else dismissLiveDraw();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTvMode, liveDraw, changeDisplayMode, dismissLiveDraw]);

  useEffect(() => {
    if (!motionOk || liveDraw?.phase !== 'spinning') return;
    const previewCount = liveDraw.previewTicketNumbers.length;
    if (previewCount <= SPINNING_TICKET_COUNT) return;

    const interval = window.setInterval(() => {
      setSpinSampleOffset((current) => (current + SPINNING_TICKET_ROTATE_STEP) % previewCount);
    }, 520);

    return () => window.clearInterval(interval);
  }, [motionOk, liveDraw?.phase, liveDraw?.drawId, liveDraw?.previewTicketNumbers.length]);

  const formatCountdown = (drawTime: string) => {
    const now = new Date();
    const draw = new Date(drawTime);
    const diff = draw.getTime() - now.getTime();
    if (diff <= 0) return 'Drawing now!';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  const exitTvButton = (
    <button
      ref={modeButtonRef}
      type="button"
      onClick={() => changeDisplayMode(false)}
      className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-400 bg-slate-800 px-4 text-base font-semibold text-white hover:bg-slate-700"
    >
      <MonitorOff className="h-5 w-5" aria-hidden="true" />
      Exit TV Mode
    </button>
  );

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-600/20 border-t-brand-600 mx-auto" />
          <p className="mt-5 text-sm text-neutral-500 tracking-wide uppercase">Loading raffle</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-6">
          <Gift className="w-12 h-12 text-neutral-300 mx-auto mb-6" strokeWidth={1.5} />
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Raffle Unavailable</h1>
          <p className="mt-3 text-neutral-500 leading-relaxed">{error}</p>
          {isTvMode ? <div className="mt-6">{exitTvButton}</div> : (
          <Link
            to={`/${tournamentSlug}`}
            className="inline-flex items-center gap-2 mt-6 px-6 py-2.5 text-sm font-semibold text-brand-foreground bg-brand-600 rounded-full transition-colors hover:bg-brand-700"
          >
            Back to Tournament
          </Link>
          )}
        </div>
      </div>
    );
  }

  const { tournament, prizes, stats } = data;

  // ---------------------------------------------------------------------------
  // Raffle disabled state
  // ---------------------------------------------------------------------------
  if (!tournament.raffle_enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-6">
          <Gift className="w-12 h-12 text-neutral-300 mx-auto mb-6" strokeWidth={1.5} />
          <h2 className="text-2xl font-semibold text-neutral-900 tracking-tight">Raffle Coming Soon</h2>
          <p className="mt-3 text-neutral-500 leading-relaxed">
            The raffle for {tournament.name} is not active yet. Check back closer to the event!
          </p>
          {isTvMode ? <div className="mt-6">{exitTvButton}</div> : (
          <Link
            to={`/${tournamentSlug}`}
            className="inline-flex items-center gap-2 mt-6 px-6 py-2.5 text-sm font-semibold text-brand-foreground bg-brand-600 rounded-full transition-colors hover:bg-brand-700"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Tournament
          </Link>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  if (isTvMode) {
    const spotlightPrize = prizes.find((prize) => prize.id === liveDraw?.prizeId);
    const availablePrizes = prizes.filter((prize) => !prize.won);
    const recentWinners = prizes
      .filter((prize) => prize.won && prize.winner)
      .sort((a, b) => (b.winner?.won_at || '').localeCompare(a.winner?.won_at || ''))
      .slice(0, 6);

    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-screen-2xl space-y-8 px-4 py-6 sm:px-8 lg:px-12">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="min-w-0 flex-1 basis-72 break-words text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              {tournament.name} Raffle
            </h1>
            {exitTvButton}
          </header>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
            {([
              ['Prizes', stats.total_prizes],
              ['Won', stats.prizes_won],
              ['Remaining', stats.prizes_remaining],
              ['Tickets sold', stats.total_tickets_sold],
            ] as const).map(([label, count]) => (
              <div key={label} className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 sm:px-5">
                <dt className="text-base font-medium text-slate-300 sm:text-xl">{label}</dt>
                <dd className="break-words text-3xl font-bold tabular-nums sm:text-5xl">{count.toLocaleString()}</dd>
              </div>
            ))}
          </dl>

          <section aria-label="Live raffle draw spotlight" className="min-w-0 rounded-3xl border border-amber-300/50 bg-slate-900 px-4 py-8 text-center sm:px-10 lg:py-12">
            {!liveDraw ? (
              <>
                <Ticket className="mx-auto h-12 w-12 text-amber-300" aria-hidden="true" />
                <h2 className="mt-3 text-3xl font-bold sm:text-5xl">Live Raffle Draw</h2>
                <p className="mt-2 text-lg text-slate-300 sm:text-2xl">
                  {stats.prizes_remaining > 0 ? 'Waiting for the next draw' : 'All prizes have been drawn'}
                </p>
              </>
            ) : liveDraw.phase === 'spinning' ? (
              <>
                <p className="text-xl font-semibold text-amber-200 sm:text-3xl">Drawing now</p>
                <h2 className="mt-2 break-words text-4xl font-bold sm:text-6xl">{liveDraw.prizeName}</h2>
                <p className="mt-3 text-lg text-slate-200 sm:text-2xl">
                  {liveDraw.eligibleTicketCount.toLocaleString()} eligible tickets
                </p>
                {liveDraw.previewTicketNumbers.length > 0 && (
                  <div aria-hidden="true" className="mx-auto mt-6 grid max-w-5xl grid-cols-2 gap-2 sm:grid-cols-4">
                    {spinningTicketNumbers.slice(0, 8).map((number) => (
                      <span key={number} className="min-w-0 break-words rounded-lg bg-slate-800 px-1 py-3 font-mono text-base font-semibold text-white motion-safe:animate-pulse sm:text-2xl lg:text-3xl">
                        {number}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className={`mx-auto grid max-w-6xl items-center gap-6 ${spotlightPrize ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]' : ''}`}>
                {spotlightPrize && (
                  <div className="mx-auto h-40 w-full max-w-sm overflow-hidden rounded-2xl sm:h-52 lg:h-72">
                    <PrizeArtwork key={spotlightPrize.image_url} prize={spotlightPrize} eager />
                  </div>
                )}
                <div className="min-w-0 break-words">
                  <p className="text-xl font-bold uppercase tracking-widest text-amber-200 sm:text-3xl">Winner</p>
                  <h2 data-testid="spotlight-winner-name" className="mt-2 text-4xl font-extrabold leading-tight sm:text-6xl lg:text-8xl">
                    {liveDraw.winnerName}
                  </h2>
                  {liveDraw.winnerTicketNumber && (
                    <p className="mt-3 font-mono text-2xl font-semibold text-amber-200 sm:text-4xl">#{liveDraw.winnerTicketNumber}</p>
                  )}
                  <p className="mt-3 text-2xl font-semibold text-slate-200 sm:text-4xl">{liveDraw.prizeName}</p>
                </div>
              </div>
            )}
          </section>

          {recentWinners.length > 0 && (
            <section aria-labelledby="tv-winners-title">
              <h2 id="tv-winners-title" className="mb-4 text-2xl font-bold sm:text-4xl">Recent winners</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {recentWinners.map((prize) => (
                  <li key={prize.id} className="min-w-0 break-words rounded-xl border border-slate-700 bg-slate-900 p-4">
                    <p className="text-xl font-bold sm:text-3xl">{prize.winner?.name}</p>
                    <p className="mt-1 text-lg text-slate-200 sm:text-2xl">{prize.name}</p>
                    {prize.winner?.ticket_number && (
                      <p className="mt-1 font-mono text-lg text-amber-200 sm:text-xl">#{prize.winner.ticket_number}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {availablePrizes.length > 0 && (
            <section aria-labelledby="tv-prizes-title">
              <h2 id="tv-prizes-title" className="mb-4 text-2xl font-bold sm:text-4xl">Prizes still to draw</h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {availablePrizes.map((prize) => (
                  <li key={prize.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
                    <div className="h-40">
                      <PrizeArtwork key={prize.image_url} prize={prize} />
                    </div>
                    <div className="space-y-2 break-words p-4">
                      <TierBadge prize={prize} large />
                      <p className="text-xl font-bold sm:text-2xl">{prize.name}</p>
                      {prize.value_dollars > 0 && <p className="text-xl font-semibold">{formatPrizeValue(prize.value_dollars)}</p>}
                      {prize.sponsor_name && <p className="text-lg text-slate-200">Sponsored by {prize.sponsor_name}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <SignedInAdminBar />
      {liveDraw && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/85 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Live raffle draw spotlight"
        >
          <div className="relative w-full max-h-[calc(100dvh-3rem)] max-w-4xl overflow-auto rounded-3xl bg-white shadow-2xl">
            <button
              type="button"
              onClick={dismissLiveDraw}
              className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70"
              aria-label="Dismiss live draw"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="bg-brand-600 px-6 py-5 text-brand-foreground sm:px-10 sm:py-7">
              <div className="flex flex-wrap items-center gap-2.5 pr-12">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-300">
                  Live raffle draw
                </p>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {holdWinnerOnScreen ? (
                    <>
                      <Pin className="h-3 w-3" />
                      Banquet Hold Mode
                    </>
                  ) : (
                    <>
                      <Timer className="h-3 w-3" />
                      Auto-dismiss (9s)
                    </>
                  )}
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{liveDraw.prizeName}</h2>
              <p className="mt-1.5 text-sm text-white/80">
                Drawing from {liveDraw.eligibleTicketCount.toLocaleString()} ticket{liveDraw.eligibleTicketCount === 1 ? '' : 's'} in this draw.
                {liveDraw.phase === 'spinning' && liveDraw.previewTicketNumbers.length > 0 && liveDraw.previewTicketSampleIsSample && (
                  <span className="block">
                    The animation is rotating through {liveDraw.previewTicketSampleCount.toLocaleString()} sample ticket numbers while the server draws from the full eligible pool.
                  </span>
                )}
                {liveDraw.phase === 'spinning' && liveDraw.previewTicketNumbers.length === 0 && (
                  <span className="block">
                    Showing placeholder ticket animation while the server finalizes the draw from the full eligible pool.
                  </span>
                )}
              </p>
            </div>

            <div className="p-6 sm:p-10">
              {liveDraw.phase === 'spinning' ? (
                <>
                  <div className="rounded-3xl border border-neutral-200 bg-neutral-950 p-4 text-white sm:p-6">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {spinningTicketNumbers.map((ticketNumber, index) => (
                        <div
                          key={`${liveDraw.drawId}-${spinSampleOffset}-${ticketNumber}-${index}`}
                          className={`${index >= 8 ? 'hidden sm:block' : ''} rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-center font-mono text-sm font-semibold text-white shadow-sm motion-safe:animate-pulse`}
                          style={{ animationDelay: `${(index % 8) * 90}ms`, animationDuration: '700ms' }}
                        >
                          {ticketNumber}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-3 text-sm font-medium text-neutral-600">
                    <Loader2 className="h-5 w-5 motion-safe:animate-spin text-brand-600" />
                    Shuffling {liveDraw.eligibleTicketCount.toLocaleString()} ticket{liveDraw.eligibleTicketCount === 1 ? '' : 's'} in this draw
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                    <Trophy className="h-9 w-9" />
                  </div>
                  <p className="mt-4 text-sm font-bold uppercase tracking-[0.26em] text-brand-600">
                    Winner
                  </p>
                  <p
                    className="mt-3 text-4xl font-extrabold tracking-tight text-neutral-950 sm:text-6xl lg:text-7xl leading-[1.08] break-words"
                    data-testid="spotlight-winner-name"
                  >
                    {liveDraw.winnerName || 'Winner Selected'}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {liveDraw.winnerTicketNumber && (
                      <span className="inline-flex items-center gap-2 rounded-2xl border-2 border-neutral-900 bg-neutral-950 px-5 py-2.5 font-mono text-xl sm:text-2xl font-bold tracking-wider text-white">
                        <Ticket className="h-5 w-5 text-accent-300" />
                        #{liveDraw.winnerTicketNumber}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-100 px-5 py-2.5 text-lg sm:text-xl font-semibold text-neutral-800">
                      <Gift className="h-5 w-5 text-brand-600 shrink-0" />
                      {liveDraw.prizeName}
                    </span>
                  </div>

                  {/* Banquet MC controls */}
                  <div className="mt-8 pt-6 border-t border-neutral-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={toggleHoldWinnerMode}
                      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors w-full sm:w-auto ${
                        holdWinnerOnScreen
                          ? 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
                          : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {holdWinnerOnScreen ? (
                        <>
                          <Pin className="h-4 w-4" />
                          Hold Winner: ON
                        </>
                      ) : (
                        <>
                          <Timer className="h-4 w-4" />
                          Auto-Dismiss: 9s
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={dismissLiveDraw}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand-700 transition-colors w-full sm:w-auto"
                    >
                      Dismiss / Next Prize
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ================================================================= */}
      {/* HERO HEADER                                                        */}
      {/* ================================================================= */}
      <div className="relative bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-brand-foreground">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 basis-64">
              <Link
                to={`/${tournamentSlug}`}
                className="inline-flex items-center gap-1 text-white/70 hover:text-white text-sm transition-colors mb-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Tournament
              </Link>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2 sm:gap-3">
                <Gift className="w-6 h-6 sm:w-7 sm:h-7 text-accent-300 shrink-0" strokeWidth={1.5} />
                <span className="min-w-0 break-words">{tournament.name} Raffle</span>
              </h1>
              {tournament.raffle_description && (
                <p className="mt-2 text-white/70 text-sm sm:text-base max-w-xl">{tournament.raffle_description}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:mt-6">
              {tournament.raffle_draw_time && (
                <div className="text-right hidden sm:block">
                  <p className="text-white/60 text-xs">Drawing in</p>
                  <p className="text-lg font-bold text-accent-300 flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {formatCountdown(tournament.raffle_draw_time)}
                  </p>
                </div>
              )}
              <button
                ref={modeButtonRef}
                type="button"
                onClick={() => changeDisplayMode(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/40 bg-white/15 px-3 text-base font-semibold text-white hover:bg-white/25"
              >
                <Monitor className="h-5 w-5 shrink-0" aria-hidden="true" />
                TV / Projector Mode
              </button>
              <button
                type="button"
                onClick={toggleHoldWinnerMode}
                className={`inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  holdWinnerOnScreen
                    ? 'bg-white/20 text-white hover:bg-white/30'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
                title={
                  holdWinnerOnScreen
                    ? 'Banquet Hold Mode ON: winners stay on screen until dismissed or next prize is drawn'
                    : 'Auto-dismiss ON: winner overlay closes after 9 seconds'
                }
              >
                {holdWinnerOnScreen ? (
                  <>
                    <Pin className="w-3.5 h-3.5 text-accent-300" />
                    <span className="hidden sm:inline">Hold Winner: ON</span>
                    <span className="sm:hidden">Hold</span>
                  </>
                ) : (
                  <>
                    <Timer className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Auto-Dismiss (9s)</span>
                    <span className="sm:hidden">9s</span>
                  </>
                )}
              </button>
              <button
                onClick={fetchData}
                className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

          {/* Mobile draw time */}
          {tournament.raffle_draw_time && (
            <div className="mt-3 flex items-center gap-2 text-sm sm:hidden">
              <Clock className="w-4 h-4 text-accent-300" />
              <span className="text-white/70">Drawing in</span>
              <span className="font-bold text-accent-300">{formatCountdown(tournament.raffle_draw_time)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* STATS BAR                                                          */}
      {/* ================================================================= */}
      <div className="bg-white border-b border-neutral-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6">
            <div className="flex items-center gap-3 p-3 sm:p-0">
              <div className="w-10 h-10 rounded-xl bg-accent-500/10 flex items-center justify-center shrink-0">
                <Gift className="w-5 h-5 text-accent-500" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 break-words">
                <p className="text-xl sm:text-2xl font-bold text-neutral-900">{stats.total_prizes}</p>
                <p className="text-xs text-neutral-500">Prizes</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 sm:p-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5 text-emerald-600" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 break-words">
                <p className="text-xl sm:text-2xl font-bold text-neutral-900">{stats.prizes_won}</p>
                <p className="text-xs text-neutral-500">Won</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 sm:p-0">
              <div className="w-10 h-10 rounded-xl bg-brand-600/10 flex items-center justify-center shrink-0">
                <Star className="w-5 h-5 text-brand-600" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 break-words">
                <p className="text-xl sm:text-2xl font-bold text-neutral-900">{stats.prizes_remaining}</p>
                <p className="text-xs text-neutral-500">Remaining</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 sm:p-0">
              <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center shrink-0">
                <Ticket className="w-5 h-5 text-neutral-600" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 break-words">
                <p className="text-xl sm:text-2xl font-bold text-neutral-900">{stats.total_tickets_sold}</p>
                <p className="text-xs text-neutral-500">Tickets Sold</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* MAIN CONTENT                                                       */}
      {/* ================================================================= */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <RaffleTicketCheck key={tournament.id} tournamentId={tournament.id} />

        {/* Prize Filters */}
        <div className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={prizeSearch}
                onChange={(e) => setPrizeSearch(e.target.value)}
                placeholder="Search prizes or sponsors…"
                aria-label="Search prizes or sponsors"
                className="min-h-[44px] w-full min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 py-3 pl-10 pr-4 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
            </div>
            <select
              aria-label="Prize tier"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="min-h-[44px] w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            >
              <option value="">All tiers</option>
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</option>
              ))}
            </select>
            <select
              aria-label="Prize status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PublicPrizeStatusFilter)}
              className="min-h-[44px] w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            >
              <option value="">All prizes</option>
              <option value="available">Available</option>
              <option value="won">Won</option>
            </select>
            <select
              aria-label="Sort prizes"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as PublicPrizeSort)}
              className="min-h-[44px] w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            >
              <option value="tier">Sort by tier</option>
              <option value="position">Sort by list order</option>
              <option value="name">Sort by name</option>
              <option value="value_desc">Value high to low</option>
              <option value="value_asc">Value low to high</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span>
              Showing {paginatedPrizes.length ? ((page - 1) * PUBLIC_PRIZES_PER_PAGE) + 1 : 0}
              –{Math.min(page * PUBLIC_PRIZES_PER_PAGE, visiblePrizes.length)} of {visiblePrizes.length} prizes
            </span>
            {(prizeSearch || tierFilter || statusFilter || sortBy !== 'tier') && (
              <button
                type="button"
                onClick={() => {
                  setPrizeSearch('');
                  setTierFilter('');
                  setStatusFilter('');
                  setSortBy('tier');
                }}
                className="min-h-[44px] text-base font-medium text-brand-600 hover:text-brand-700"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Prize Grid */}
        {prizes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-neutral-200">
            <Gift className="w-12 h-12 text-neutral-300 mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-neutral-500">No prizes yet. Check back soon!</p>
          </div>
        ) : visiblePrizes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-neutral-200">
            <Search className="w-12 h-12 text-neutral-300 mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-neutral-500">No prizes match those filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {paginatedPrizes.map((prize) => (
              <div
                key={prize.id}
                className={`relative flex flex-col bg-white rounded-2xl border border-neutral-200 overflow-hidden transition-all duration-200 ${
                  prize.won ? 'border-neutral-300' : 'hover:shadow-md'
                }`}
              >
                <div className="relative h-44 sm:h-48">
                  <PrizeArtwork key={prize.image_url} prize={prize} />
                  <div className="absolute top-3 left-3">
                    <TierBadge prize={prize} />
                  </div>
                </div>

                {/* Prize Info — flex-1 so cards stretch equally */}
                <div className="flex min-w-0 flex-1 flex-col break-words p-4 sm:p-5">
                  <h3 className="text-base font-bold text-neutral-900 leading-snug">{prize.name}</h3>
                  {prize.description && (
                    <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{prize.description}</p>
                  )}

                  {/* Sponsor */}
                  {prize.sponsor_name && (
                    <div className="flex items-center gap-1.5 mt-2">
                      {prize.sponsor_logo_url && <SponsorLogo key={prize.sponsor_logo_url} url={prize.sponsor_logo_url} />}
                      <span className="min-w-0 text-sm text-neutral-600">Sponsored by {prize.sponsor_name}</span>
                    </div>
                  )}

                  {/* Spacer pushes value to bottom */}
                  <div className="flex-1" />

                  {/* Value — always at bottom */}
                  {prize.value_dollars > 0 && (
                    <div className="mt-4 pt-3 border-t border-neutral-100">
                      <p className="text-lg font-bold text-neutral-900">
                        {formatPrizeValue(prize.value_dollars)}
                        <span className="text-sm font-normal text-neutral-400 ml-1">value</span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Winner Overlay */}
                {prize.won && prize.winner && (
                  <div className="flex min-w-0 flex-col items-start break-words border-t border-neutral-200 bg-neutral-900 p-4 text-white">
                    <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent-300"><PartyPopper className="h-4 w-4" aria-hidden="true" /> Winner</p>
                    <p className="w-full text-lg font-bold">{prize.winner.name}</p>
                    <p className="w-full text-sm text-white/80 mt-1 font-mono">
                      Ticket #{prize.winner.ticket_number}
                    </p>
                    {prize.claimed && (
                      <span className="mt-3 inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium">
                        <Check className="w-3 h-3" />
                        Claimed
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {visiblePrizes.length > PUBLIC_PRIZES_PER_PAGE && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-sm text-neutral-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-neutral-200 px-3 py-2 text-base font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-neutral-200 px-3 py-2 text-base font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ================================================================= */}
      {/* FOOTER                                                             */}
      {/* ================================================================= */}
      <footer className="border-t border-neutral-200 mt-8">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-6 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500">
          <p>
            Powered by <span className="font-medium text-neutral-600">Shimizu Technology</span>
          </p>
          <p className="text-xs">
            {cableConnected ? 'Live updates connected' : 'Syncing every 5 seconds'}
          </p>
        </div>
      </footer>
    </div>
  );
};
