import { useEffect } from 'react';
import { ArrowRight, Flag, LogIn, Mail } from 'lucide-react';
import { useMotionOk } from '../hooks/useMotionOk';
import { getOrganizerConsoleHref } from '../utils/adminHost';
import { Capabilities } from '../components/platform/Capabilities';
import { PlatformHero } from '../components/platform/PlatformHero';
import { TournamentDayFlow } from '../components/platform/TournamentDayFlow';
import '../components/platform/platform.css';

export const PLATFORM_CONTACT_EMAIL = 'leon@shimizu-technology.com';

/**
 * The public HafaGolf platform homepage, for tournament committees evaluating the product.
 * The only page with editorial motion; every other public and admin flow stays still.
 */
export function PlatformHomePage() {
  const motionOk = useMotionOk();
  const consoleHref = getOrganizerConsoleHref();

  useEffect(() => {
    document.title = 'HafaGolf | Golf tournament software for Guam and the Pacific';
  }, []);

  return (
    <div className="ph-root min-h-screen" data-motion={motionOk ? 'ok' : 'reduced'}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <a href="#top" className="ph-ui inline-flex min-h-[44px] items-center gap-2 text-lg font-bold text-[var(--ph-evergreen)]">
          <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ph-evergreen)] text-white">
            <Flag className="h-4 w-4" />
          </span>
          HafaGolf
        </a>
        <nav aria-label="Platform" className="flex items-center gap-1 sm:gap-2">
          <a
            href="#tournament-day"
            className="ph-ui hidden min-h-[44px] items-center rounded-full px-4 text-sm font-medium text-[var(--ph-ink-muted)] hover:text-[var(--ph-ink)] sm:inline-flex"
          >
            How it works
          </a>
          <a
            href={consoleHref}
            className="ph-ui inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--ph-evergreen)] px-4 text-sm font-semibold text-[var(--ph-evergreen)] transition-colors duration-150 hover:bg-[var(--ph-evergreen)] hover:text-white"
          >
            <LogIn aria-hidden="true" className="h-4 w-4" />
            Organizer Sign In
          </a>
        </nav>
      </header>

      <main id="top">
        <PlatformHero motionOk={motionOk} consoleHref={consoleHref} />
        <Capabilities />
        <TournamentDayFlow motionOk={motionOk} />

        <section aria-labelledby="ph-closing-heading" className="py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <span aria-hidden="true" className="mx-auto block h-px w-16 bg-[var(--ph-brass)]" />
            <h2 id="ph-closing-heading" className="ph-display mt-8 text-3xl font-semibold leading-tight sm:text-5xl">
              Ready to run your next tournament?
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[var(--ph-ink-muted)]">
              Sign in to set up your event, or write to us and we will walk your committee through it.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <a
                href={consoleHref}
                className="ph-ui inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[var(--ph-evergreen)] px-7 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--ph-fairway)]"
              >
                Open Organizer Console
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
              <a
                href={`mailto:${PLATFORM_CONTACT_EMAIL}?subject=${encodeURIComponent('HafaGolf for our tournament')}`}
                className="ph-ui inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-[#d8cfbb] bg-white px-7 text-[15px] font-semibold text-[var(--ph-ink)] transition-colors duration-150 hover:border-[var(--ph-brass)]"
              >
                <Mail aria-hidden="true" className="h-4 w-4" />
                Talk with us
              </a>
            </div>
          </div>
        </section>
      </main>

      <div className="border-t border-[var(--ph-line)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-[var(--ph-ink-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>HafaGolf · Tournament software for charity, memorial, and alumni golf.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <a href={consoleHref} className="inline-flex min-h-[44px] items-center hover:text-[var(--ph-ink)]">
              Organizer sign in
            </a>
            <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="inline-flex min-h-[44px] items-center hover:text-[var(--ph-ink)]">
              {PLATFORM_CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
