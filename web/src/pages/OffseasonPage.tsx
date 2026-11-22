import { CalendarClock, ExternalLink, Flag, Mail, Phone, RefreshCw } from 'lucide-react';
import type { Organization } from '../stores/organizationStore';

interface OffseasonPageProps {
  organization?: Organization | null;
  onRetry?: () => void;
}

export function OffseasonPage({ organization, onRetry }: OffseasonPageProps) {
  const orgName = organization?.name || 'HafaGolf';
  const title =
    organization?.offseason_title ||
    (organization
      ? `${orgName} registration is currently closed.`
      : 'Tournament registration is currently offline.');
  const message =
    organization?.offseason_message ||
    (organization
      ? 'Online registration is closed between events. Check back soon or reach out to the organizers for upcoming tournament dates.'
      : 'We are unable to connect to the event service right now, or registration is between seasons. Please check back shortly.');
  const ctaUrl = organization?.offseason_cta_url || organization?.website_url || null;
  const ctaLabel = organization?.offseason_cta_label || (organization ? `Visit ${orgName}` : null);

  return (
    <main className="min-h-screen bg-white text-neutral-900 flex flex-col">
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-900 text-brand-foreground">
        {organization?.banner_url ? (
          <img
            src={organization.banner_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-25"
            aria-hidden="true"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_30%)]" />
        )}
        <div className="relative mx-auto flex min-h-[480px] max-w-5xl flex-col justify-center px-6 py-20 lg:px-8">
          {organization?.logo_url ? (
            <img
              src={organization.logo_url}
              alt={orgName}
              className="mb-8 h-16 w-auto self-start sm:h-20"
            />
          ) : (
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-semibold">
              <Flag className="h-4 w-4" />
              <span>{orgName}</span>
            </div>
          )}

          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider">
            <CalendarClock className="h-4 w-4" />
            <span>{organization ? 'Between Events' : 'Service Status'}</span>
          </div>

          <h1 className="mt-6 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-brand-foreground/85 sm:text-lg">
            {message}
          </p>

          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
            {ctaUrl && ctaLabel ? (
              <a
                href={ctaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                <span>{ctaLabel}</span>
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-6 py-3 font-semibold text-brand-foreground transition hover:bg-white/10"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Check services again</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {(organization?.contact_email || organization?.contact_phone) ? (
        <section className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
          <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-neutral-900">Contact {orgName}</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm text-neutral-600 sm:flex-row sm:gap-8">
              {organization.contact_email ? (
                <a
                  href={`mailto:${organization.contact_email}`}
                  className="inline-flex items-center gap-2 font-medium text-neutral-900 hover:underline"
                >
                  <Mail className="h-4 w-4 text-brand-600" />
                  <span>{organization.contact_email}</span>
                </a>
              ) : null}
              {organization.contact_phone ? (
                <a
                  href={`tel:${organization.contact_phone}`}
                  className="inline-flex items-center gap-2 font-medium text-neutral-900 hover:underline"
                >
                  <Phone className="h-4 w-4 text-brand-600" />
                  <span>{organization.contact_phone}</span>
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <footer className="mt-auto border-t border-neutral-200 px-6 py-6 text-center text-xs text-neutral-500">
        Powered by{' '}
        <a href="https://shimizu-technology.com" className="font-semibold hover:text-neutral-800">
          Shimizu Technology
        </a>
      </footer>
    </main>
  );
}
