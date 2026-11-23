import { useEffect, useState } from 'react';
import { ArrowUpRight, Calendar, MapPin, Trophy, Users } from 'lucide-react';

export interface DirectoryOrganization {
  name: string;
  slug: string;
  primary_color: string | null;
  logo_url: string | null;
  primary_host: string;
}

export interface DirectoryTournament {
  slug: string;
  name: string;
  edition: string | null;
  year: number;
  status: string;
  event_date: string | null;
  location_name: string | null;
  format_name: string | null;
  tournament_format: string | null;
  team_size: number | null;
  entry_fee_display: string | null;
  registration_open: boolean;
  can_register: boolean;
  availability: 'open' | 'waitlist' | 'full' | 'in_progress' | 'closed' | 'completed';
  public_url: string;
  register_url: string | null;
  leaderboard_url: string | null;
  organization: DirectoryOrganization;
}

export interface DirectoryResponse {
  upcoming: DirectoryTournament[];
  past: DirectoryTournament[];
  updated_at?: string;
}

const VALID_HEX = /^#[0-9a-f]{6}$/i;
const VALID_HTTP_URL = /^https?:\/\//i;
const FETCH_TIMEOUT_MS = 6000;

function safeAccentColor(color: string | null | undefined): string {
  return color && VALID_HEX.test(color.trim()) ? color.trim() : '#0b3b2e';
}

function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return VALID_HTTP_URL.test(trimmed) ? trimmed : null;
}

function statusBadge(item: DirectoryTournament): { label: string; className: string } {
  switch (item.availability) {
    case 'in_progress':
      return {
        label: 'Tournament Day',
        className: 'bg-[#0b3b2e] text-white',
      };
    case 'open':
      return {
        label: 'Registration Open',
        className: 'bg-[#e6f4ee] text-[#0b3b2e] border border-[#b9dfce]',
      };
    case 'waitlist':
      return {
        label: 'Waitlist Open',
        className: 'bg-[#fef6e4] text-[#855a0c] border border-[#ecd39a]',
      };
    case 'full':
      return {
        label: 'Field Full',
        className: 'bg-[#f3f0e8] text-[#4b5563] border border-[#dcd4c2]',
      };
    case 'completed':
      return {
        label: 'Completed',
        className: 'bg-[#f3f0e8] text-[#4b5563] border border-[#dcd4c2]',
      };
    default:
      return {
        label: 'Registration Closed',
        className: 'bg-[#f3f0e8] text-[#4b5563] border border-[#dcd4c2]',
      };
  }
}

function formatSummary(item: DirectoryTournament): string | null {
  if (item.format_name) return item.format_name;
  const parts: string[] = [];
  if (item.team_size && item.team_size > 1) parts.push(`${item.team_size}-Person`);
  if (item.tournament_format) {
    parts.push(
      item.tournament_format
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

export function TournamentsDirectory({
  onHasTournamentsChange,
}: {
  onHasTournamentsChange?: (hasAny: boolean) => void;
}) {
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl || typeof fetch !== 'function') {
      onHasTournamentsChange?.(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    fetch(`${apiUrl}/api/v1/directory/tournaments`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: DirectoryResponse | null) => {
        if (!payload || !Array.isArray(payload.upcoming) || !Array.isArray(payload.past)) {
          onHasTournamentsChange?.(false);
          return;
        }
        const hasAny = payload.upcoming.length > 0 || payload.past.length > 0;
        onHasTournamentsChange?.(hasAny);
        if (!hasAny) return;
        setData(payload);
        if (payload.upcoming.length === 0 && payload.past.length > 0) {
          setView('past');
        }
      })
      .catch(() => {
        // Silently degrade if the backend is paused or unreachable so the homepage stays clean.
        onHasTournamentsChange?.(false);
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [onHasTournamentsChange]);

  if (!data) return null;

  const hasUpcoming = data.upcoming.length > 0;
  const hasPast = data.past.length > 0;
  if (!hasUpcoming && !hasPast) return null;

  const activeView = view === 'upcoming' && !hasUpcoming ? 'past' : view === 'past' && !hasPast ? 'upcoming' : view;
  const items = activeView === 'upcoming' ? data.upcoming : data.past;

  return (
    <section
      id="tournaments"
      aria-labelledby="ph-directory-heading"
      className="scroll-mt-4 border-t border-[var(--ph-line)] bg-[#f4efe3] py-16 sm:py-20"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="ph-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ph-brass-text)]">
              Tournaments on HafaGolf
            </p>
            <h2 id="ph-directory-heading" className="ph-display mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
              {activeView === 'upcoming' ? 'Active and upcoming tournaments' : 'Recent tournaments'}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[var(--ph-ink-muted)]">
              Click any event to open that organization’s tournament page for registration, sponsorships, or live updates.
            </p>
          </div>

          {hasUpcoming && hasPast && (
            <div
              role="group"
              aria-label="Filter tournaments"
              className="inline-flex self-start rounded-full border border-[var(--ph-line)] bg-white p-1 md:self-auto"
            >
              <button
                type="button"
                aria-pressed={activeView === 'upcoming'}
                onClick={() => setView('upcoming')}
                className={`ph-ui min-h-[44px] rounded-full px-4 text-sm font-semibold transition-colors duration-150 ${
                  activeView === 'upcoming'
                    ? 'bg-[var(--ph-evergreen)] text-white'
                    : 'text-[var(--ph-ink-muted)] hover:text-[var(--ph-ink)]'
                }`}
              >
                Active & Upcoming ({data.upcoming.length})
              </button>
              <button
                type="button"
                aria-pressed={activeView === 'past'}
                onClick={() => setView('past')}
                className={`ph-ui min-h-[44px] rounded-full px-4 text-sm font-semibold transition-colors duration-150 ${
                  activeView === 'past'
                    ? 'bg-[var(--ph-evergreen)] text-white'
                    : 'text-[var(--ph-ink-muted)] hover:text-[var(--ph-ink)]'
                }`}
              >
                Past ({data.past.length})
              </button>
            </div>
          )}
        </div>

        <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const badge = statusBadge(item);
            const accent = safeAccentColor(item.organization.primary_color);
            const logoUrl = safeExternalUrl(item.organization.logo_url);
            const publicUrl = safeExternalUrl(item.public_url) ?? '#tournaments';
            const registerUrl = safeExternalUrl(item.register_url);
            const leaderboardUrl = safeExternalUrl(item.leaderboard_url);
            const format = formatSummary(item);

            return (
              <li
                key={`${item.organization.slug}-${item.slug}`}
                className="flex flex-col overflow-hidden rounded-2xl border border-[var(--ph-line)] bg-white shadow-sm"
              >
                <div aria-hidden="true" className="h-1.5 w-full" style={{ backgroundColor: accent }} />
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {logoUrl && (
                        <img
                          src={logoUrl}
                          alt=""
                          className="h-7 w-7 shrink-0 rounded-md object-contain"
                          loading="lazy"
                        />
                      )}
                      <span className="ph-ui truncate text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ph-ink-muted)]">
                        {item.organization.name}
                      </span>
                    </div>
                    <span className={`ph-ui shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>

                  <h3 className="ph-display mt-4 text-xl font-semibold leading-snug text-[var(--ph-ink)]">
                    {item.name}
                  </h3>
                  {item.edition && (
                    <p className="mt-1 text-sm text-[var(--ph-ink-muted)]">{item.edition}</p>
                  )}

                  <dl className="mt-4 space-y-2 text-sm text-[var(--ph-ink-muted)]">
                    {item.event_date && (
                      <div className="flex items-center gap-2">
                        <Calendar aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--ph-fairway)]" />
                        <dt className="sr-only">Date</dt>
                        <dd>{item.event_date}</dd>
                      </div>
                    )}
                    {item.location_name && (
                      <div className="flex items-center gap-2">
                        <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--ph-fairway)]" />
                        <dt className="sr-only">Course</dt>
                        <dd className="truncate">{item.location_name}</dd>
                      </div>
                    )}
                    {(format || item.entry_fee_display) && (
                      <div className="flex items-center gap-2">
                        <Users aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--ph-fairway)]" />
                        <dt className="sr-only">Format and entry fee</dt>
                        <dd>
                          {[format, item.entry_fee_display].filter(Boolean).join(' · ')}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="mt-6 flex flex-wrap items-center gap-2 pt-4 border-t border-[var(--ph-line)]">
                    {registerUrl ? (
                      <>
                        <a
                          href={registerUrl}
                          className="ph-ui inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--ph-evergreen)] px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--ph-fairway)]"
                        >
                          {item.availability === 'waitlist' ? 'Join Waitlist' : 'Register'}
                          <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                        </a>
                        <a
                          href={publicUrl}
                          className="ph-ui inline-flex min-h-[44px] items-center justify-center rounded-full border border-[#d8cfbb] px-4 text-sm font-semibold text-[var(--ph-ink)] transition-colors duration-150 hover:border-[var(--ph-brass)]"
                        >
                          Details
                        </a>
                      </>
                    ) : (
                      <a
                        href={publicUrl}
                        className="ph-ui inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--ph-evergreen)] px-4 text-sm font-semibold text-[var(--ph-evergreen)] transition-colors duration-150 hover:bg-[var(--ph-evergreen)] hover:text-white"
                      >
                        View Event
                        <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                      </a>
                    )}
                    {leaderboardUrl && (
                      <a
                        href={leaderboardUrl}
                        className="ph-ui inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-[#d8cfbb] px-3.5 text-sm font-semibold text-[var(--ph-ink)] transition-colors duration-150 hover:border-[var(--ph-brass)]"
                        aria-label={`View leaderboard for ${item.name}`}
                      >
                        <Trophy aria-hidden="true" className="h-4 w-4 text-[var(--ph-brass-text)]" />
                        Scores
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
