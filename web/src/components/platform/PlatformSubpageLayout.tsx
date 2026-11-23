import type { ReactNode } from 'react';
import { ArrowLeft, Flag, LogIn } from 'lucide-react';
import { getOrganizerConsoleHref } from '../../utils/adminHost';
import './platform.css';

export const PLATFORM_CONTACT_EMAIL = 'leon@shimizu-technology.com';

export function PlatformSubpageLayout({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const consoleHref = getOrganizerConsoleHref();

  return (
    <div className="ph-root min-h-screen flex flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <a
          href="/"
          className="ph-ui inline-flex min-h-[44px] items-center gap-2 text-lg font-bold text-[var(--ph-evergreen)]"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ph-evergreen)] text-white"
          >
            <Flag className="h-4 w-4" />
          </span>
          HafaGolf
        </a>
        <nav aria-label="Platform" className="flex items-center gap-1 sm:gap-2">
          <a
            href="/contact"
            className="ph-ui hidden min-h-[44px] items-center rounded-full px-4 text-sm font-medium text-[var(--ph-ink-muted)] hover:text-[var(--ph-ink)] sm:inline-flex"
          >
            Contact
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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-8">
        <a
          href="/"
          className="ph-ui inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-[var(--ph-ink-muted)] hover:text-[var(--ph-ink)]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to HafaGolf
        </a>

        <div className="mt-4">
          <p className="ph-ui flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ph-brass-text)]">
            <span aria-hidden="true" className="h-px w-8 bg-[var(--ph-brass)]" />
            {eyebrow}
          </p>
          <h1 className="ph-display mt-4 text-3xl font-semibold leading-tight text-[var(--ph-ink)] sm:text-5xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--ph-ink-muted)]">{subtitle}</p>
          )}
        </div>

        <div className="mt-10">{children}</div>
      </main>

      <div className="border-t border-[var(--ph-line)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-[var(--ph-ink-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>HafaGolf · Built by Shimizu Technology in Guam.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <a href="/contact" className="inline-flex min-h-[44px] items-center hover:text-[var(--ph-ink)]">
              Contact
            </a>
            <a href="/privacy" className="inline-flex min-h-[44px] items-center hover:text-[var(--ph-ink)]">
              Privacy Policy
            </a>
            <a href="/terms" className="inline-flex min-h-[44px] items-center hover:text-[var(--ph-ink)]">
              Terms of Service
            </a>
            <a href={consoleHref} className="inline-flex min-h-[44px] items-center hover:text-[var(--ph-ink)]">
              Organizer Sign In
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
