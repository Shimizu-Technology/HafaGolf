import type { ReactNode } from 'react';
import { ChevronLeft, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ThemePackDefinition } from '../../utils/themePacks';

export interface TournamentThemeHeroProps {
  pack: ThemePackDefinition;
  title: string;
  organizerName?: string;
  edition?: string | null;
  eventLine: string;
  status: ReactNode;
  action?: ReactNode;
  logoUrl?: string | null;
  organizationLogoUrl?: string | null;
  reversedLogoUrl?: string | null;
  photoUrl?: string | null;
  emblemUrl?: string | null;
  commemorativeBannerUrl?: string | null;
  tributeTitle?: string | null;
  tributeSubtitle?: string | null;
  progress?: { label: string; percent: number | null };
}

function BackToEvents({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={`inline-flex min-h-11 items-center gap-1 text-sm font-medium hover:underline ${light ? 'text-white' : 'text-slate-700'}`}>
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      Back to Events
    </Link>
  );
}

function Edition({ edition, className }: { edition?: string | null; className: string }) {
  const label = edition?.trim();
  if (!label) return null;

  return <p className={className}>{/^\d+(st|nd|rd|th)$/i.test(label) ? `${label} Annual` : label}</p>;
}

export function MemorialFormalHero({
  pack, title, organizerName, edition, eventLine, status, action, organizationLogoUrl, logoUrl, emblemUrl,
  commemorativeBannerUrl, tributeTitle, tributeSubtitle, photoUrl,
}: TournamentThemeHeroProps) {
  const logo = logoUrl || organizationLogoUrl;

  return (
    <div className="border-b border-[#d8ccae] bg-gradient-to-b from-white to-[#f5f4ee] text-[#1e3553]">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-2 sm:px-6 sm:pb-16">
        <BackToEvents />
        <div className="flex flex-col items-center text-center">
          {logo && <img src={logo} alt={organizerName || 'Organizer logo'} className="h-24 max-w-full object-contain md:h-32" />}
          {commemorativeBannerUrl && (
            <img src={commemorativeBannerUrl} alt="Commemorative banner" className="mt-4 max-h-28 w-auto max-w-full object-contain" />
          )}
          <div aria-hidden="true" className="memorial-hairline mb-5 mt-6 h-px w-28 bg-[#9c7b38] sm:mb-7 sm:w-40" />
          <Edition edition={edition} className="font-theme-heading text-lg italic text-slate-600 sm:text-2xl" />
          <div className="mt-3 flex max-w-4xl items-center justify-center gap-3 sm:gap-6">
            {emblemUrl && (
              <img src={emblemUrl} alt="Tribute emblem" className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20 md:h-24 md:w-24" />
            )}
            <div className={`min-w-0 ${emblemUrl ? 'text-left' : ''}`}>
              <h1 className={pack.typography.tournamentTitleClass}>{title}</h1>
              {tributeTitle && <p className="mt-2 break-words font-theme-heading text-lg font-semibold text-[#725420] sm:text-2xl">{tributeTitle}</p>}
              {tributeSubtitle && <p className="mt-1 break-words text-sm leading-relaxed text-slate-600 sm:text-base">{tributeSubtitle}</p>}
            </div>
          </div>
          {eventLine && <p className="mt-5 text-base text-slate-700">{eventLine}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{status}{action}</div>
          {photoUrl && (
            <img src={photoUrl} alt={`${title} event artwork`} loading="lazy"
              className="mt-7 max-h-56 max-w-full rounded-lg border border-[#d8ccae] bg-white object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}

export function CharityBrightHero({
  pack, title, organizerName, edition, eventLine, status, action, organizationLogoUrl, logoUrl, reversedLogoUrl, photoUrl,
}: TournamentThemeHeroProps) {
  const normalLogo = logoUrl || organizationLogoUrl;
  const logo = reversedLogoUrl || normalLogo;

  return (
    <div className="relative isolate bg-brand-950 text-white">
      {photoUrl && (
        <>
          <img src={photoUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/65 via-black/25 to-transparent" />
        </>
      )}
      <div className="mx-auto flex min-h-[26rem] max-w-6xl flex-col justify-between gap-24 px-4 pb-9 pt-4 sm:min-h-[33rem] sm:px-8 sm:pb-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-full bg-black/60 px-3"><BackToEvents light /></div>
          {logo && (
            <img src={logo} alt={organizerName || 'Organizer logo'}
              className={`h-16 max-w-[45%] rounded-lg object-contain sm:h-20 ${reversedLogoUrl ? 'bg-black/50 p-2' : 'bg-white p-2'}`} />
          )}
        </div>
        <div className="max-w-3xl">
          <Edition edition={edition} className="mb-2 text-sm font-semibold text-white [text-shadow:0_1px_4px_#000,0_1px_12px_#000]" />
          <h1 className={`${pack.typography.tournamentTitleClass} [text-shadow:0_2px_5px_#000,0_2px_18px_#000]`}>{title}</h1>
          {eventLine && <p className="mt-3 text-base font-medium text-white [text-shadow:0_1px_4px_#000,0_1px_12px_#000] sm:text-lg">{eventLine}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">{action}{status}</div>
        </div>
      </div>
    </div>
  );
}

function RegistrationProgress({ label, percent }: NonNullable<TournamentThemeHeroProps['progress']>) {
  if (percent == null) return null;

  return (
    <div className="mt-6 max-w-sm border-t border-white/25 pt-4">
      <p className="text-xs font-bold uppercase tracking-wider text-white">Registration progress</p>
      <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="mt-2 block h-2 w-full overflow-hidden rounded-full"
        role="meter" aria-label="Registration progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label}>
        <rect width="100" height="4" fill="white" fillOpacity=".2" />
        <rect width="100" height="4" className="fill-accent-300" transform={`scale(${percent / 100} 1)`} />
      </svg>
      <p className="mt-2 text-sm text-white/90">{label}</p>
    </div>
  );
}

export function CrestClassicHero({
  pack, title, organizerName, edition, eventLine, status, action, logoUrl, emblemUrl, photoUrl, progress,
}: TournamentThemeHeroProps) {
  const crest = emblemUrl || logoUrl;

  return (
    <div className="border-y-4 border-accent-400 bg-brand-950 text-white">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-2 sm:px-8 sm:pb-12">
        <BackToEvents light />
        <div className="mt-2 grid min-w-0 border-2 border-accent-300/65 p-2 sm:p-3">
          <div className="grid items-center gap-5 border border-accent-300/40 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-8 sm:p-8">
            <div className="relative isolate grid min-h-40 place-items-center overflow-hidden rounded-sm border border-white/20 bg-brand-900 sm:min-h-60">
              {photoUrl && <img src={photoUrl} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-[.45]" />}
              {crest ? (
                <img src={crest} alt={emblemUrl ? 'Tournament crest' : organizerName || 'Organizer logo'}
                  className={`h-28 w-28 rounded-lg object-contain p-2 sm:h-40 sm:w-40 ${emblemUrl ? 'bg-brand-950/80' : 'bg-white'}`} />
              ) : <Shield className="h-20 w-20 text-accent-300" strokeWidth={1} aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <Edition edition={edition} className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-300" />
              <h1 className={pack.typography.tournamentTitleClass}>{title}</h1>
              {eventLine && <p className="mt-3 text-white/90">{eventLine}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-3">{action}{status}</div>
              {progress && <RegistrationProgress {...progress} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DefaultCleanHero({
  pack, title, organizerName, edition, eventLine, status, action, logoUrl, photoUrl, emblemUrl,
}: TournamentThemeHeroProps) {
  return (
    <div className="border-b border-neutral-200 bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-2 sm:px-6 lg:px-8 lg:pb-14">
        <BackToEvents />
        <div className={`mt-4 grid items-center gap-8 ${photoUrl ? 'md:grid-cols-[1fr_0.9fr]' : 'max-w-3xl'}`}>
          <div className="min-w-0">
            {(logoUrl || emblemUrl) && <img src={logoUrl || emblemUrl || undefined} alt={logoUrl ? organizerName || 'Organizer logo' : 'Tournament emblem'}
              className="mb-5 h-12 max-w-[12rem] object-contain object-left" />}
            <Edition edition={edition} className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-700" />
            <h1 className={pack.typography.tournamentTitleClass}>{title}</h1>
            {eventLine && <p className="mt-3 text-base text-slate-600 sm:text-lg">{eventLine}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3">{action}{status}</div>
          </div>
          {photoUrl && <img src={photoUrl} alt={`${title} event artwork`} className="aspect-[16/10] w-full rounded-2xl border border-neutral-200 bg-neutral-50 object-contain" />}
        </div>
      </div>
    </div>
  );
}
