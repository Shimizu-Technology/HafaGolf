import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { StyleSwitcher } from './StyleSwitcher';

export const HERO_HEADLINE = 'Run your tournament from first sign-up to final draw.';

/** The hero headline rises word by word in CSS; the full sentence stays the heading's accessible name. */
function WordRiseHeadline({ text }: { text: string }) {
  return (
    <h1 className="ph-display text-[2.5rem] font-semibold leading-[1.05] text-[var(--ph-ink)] sm:text-6xl lg:text-[4.25rem]">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split(' ').map((word, index) => (
          <Fragment key={`${word}-${index}`}>
            <span className="ph-word-mask">
              <span className="ph-word" style={{ '--ph-word-index': index } as CSSProperties}>
                {word}
              </span>
            </span>{' '}
          </Fragment>
        ))}
      </span>
    </h1>
  );
}

export function PlatformHero({ motionOk, consoleHref }: { motionOk: boolean; consoleHref: string }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#efe9db] to-transparent"
      />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16 lg:px-8 lg:pb-28">
        <div>
          <p className="ph-ui flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ph-brass-text)]">
            <span aria-hidden="true" className="h-px w-8 bg-[var(--ph-brass)]" />
            Golf tournament software for Guam and the Pacific
          </p>
          <div className="mt-5">
            <WordRiseHeadline text={HERO_HEADLINE} />
          </div>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--ph-ink-muted)]">
            HafaGolf is built for the committees behind charity, memorial, and alumni golf tournaments.
            Registration, sponsors, morning check-in, and the banquet raffle live in one place, dressed in
            your event’s colors instead of ours.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <a
              href={consoleHref}
              className="ph-ui inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--ph-evergreen)] px-6 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--ph-fairway)]"
            >
              Open Organizer Console
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
            <a
              href="#tournament-day"
              className="ph-ui inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-[#d8cfbb] bg-white/60 px-6 text-[15px] font-semibold text-[var(--ph-ink)] transition-colors duration-150 hover:border-[var(--ph-brass)] hover:bg-white"
            >
              See how it works
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="lg:self-start lg:pt-2">
          <StyleSwitcher motionOk={motionOk} />
        </div>
      </div>
    </section>
  );
}
