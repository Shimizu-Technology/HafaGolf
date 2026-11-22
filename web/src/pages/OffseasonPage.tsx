import { CalendarClock, Flag, RefreshCw, Sparkles, Trophy, Users } from 'lucide-react';

export function OffseasonPage({ onRetry }: { onRetry?: () => void }) {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <section className="relative min-h-[520px] overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-900 text-brand-foreground">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_30%)]" />
        <div className="relative mx-auto flex min-h-[520px] max-w-6xl flex-col justify-center px-6 py-20 lg:px-8">
          <div className="mb-8 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <Flag className="h-6 w-6 text-brand-foreground" />
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold">
            <Trophy size={17} /> Event services temporarily unavailable
          </div>
          <h1 className="mt-7 max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Tournament registration is currently offline.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-brand-foreground/85">
            We are unable to connect to the event service right now, or registration is between seasons. Please check back shortly for upcoming tournaments and event updates.
          </p>
          {onRetry ? (
            <div className="mt-9 flex flex-col items-start gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                <RefreshCw size={17} /> Check services again
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 lg:px-8 lg:py-24">
        <div className="grid gap-6 md:grid-cols-3">
          <article className="rounded-2xl border border-brand-100 bg-brand-50/50 p-6">
            <Users className="text-brand-600" />
            <h2 className="mt-4 text-xl font-bold">Community tournaments</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Every registration, sponsorship, and volunteer shift supports tournament organizers and participants.
            </p>
          </article>
          <article className="rounded-2xl border border-brand-100 bg-brand-50/50 p-6">
            <CalendarClock className="text-brand-600" />
            <h2 className="mt-4 text-xl font-bold">Upcoming events</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Online registration opens automatically as soon as the organizer publishes the next tournament date.
            </p>
          </article>
          <article className="rounded-2xl border border-brand-100 bg-brand-50/50 p-6">
            <Sparkles className="text-brand-600" />
            <h2 className="mt-4 text-xl font-bold">Stay connected</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Check back soon for tournament schedules, sponsor opportunities, and registration announcements.
            </p>
          </article>
        </div>
      </section>

      <footer className="border-t border-neutral-200 px-6 py-7 text-center text-xs text-neutral-500">
        Event platform built by{' '}
        <a href="https://shimizu-technology.com" className="font-semibold hover:text-neutral-800">
          Shimizu Technology
        </a>
      </footer>
    </main>
  );
}
