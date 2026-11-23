import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ThemePackDefinition } from '../../utils/themePacks';
import {
  isDarkHeroSurface,
  resolveHeroLogo,
  type ResolvedHomepageConfig,
} from '../../utils/homepageConfig';

export interface TournamentThemeHeroProps {
  pack: ThemePackDefinition;
  homepageConfig?: ResolvedHomepageConfig;
  title: string;
  organizerName?: string;
  edition?: string | null;
  eventLine: string;
  status: ReactNode;
  action?: ReactNode;
  showBackLink?: boolean;
  backLinkTo?: string;
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

function BackToEvents({ light = false, to = '/', show = true }: { light?: boolean; to?: string; show?: boolean }) {
  if (!show) return null;
  return (
    <Link
      to={to}
      className={`inline-flex min-h-11 items-center gap-1 text-sm font-medium transition-colors hover:underline ${
        light ? 'text-white/90 hover:text-white' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      Back to Events
    </Link>
  );
}

function formatEdition(edition?: string | null): string | null {
  const label = edition?.trim();
  if (!label) return null;
  return /^\d+(st|nd|rd|th)$/i.test(label) ? `${label} Annual` : label;
}

/**
 * Ceremonial Light (maps memorial-formal):
 * Airy light slate/sky/emerald wash so dark-ink logos always pop cleanly, single deduplicated logo/crest,
 * eyebrow status pill above title, tribute silhouette lockup, and clean CTA row (never duplicating logos).
 */
export function MemorialFormalHero({
  pack,
  homepageConfig,
  title,
  organizerName,
  edition,
  eventLine,
  status,
  action,
  showBackLink = true,
  backLinkTo = '/',
  organizationLogoUrl,
  logoUrl,
  reversedLogoUrl,
  emblemUrl,
  commemorativeBannerUrl,
  tributeTitle,
  tributeSubtitle,
}: TournamentThemeHeroProps) {
  const logoDisplay = homepageConfig?.logo_display ?? 'auto';
  const heroLogo = resolveHeroLogo({
    logoDisplay,
    isDarkSurface: false,
    commemorativeBannerUrl,
    logoUrl,
    organizationLogoUrl,
    reversedLogoUrl,
  });
  const editionLabel = formatEdition(edition);
  const eyebrowText = homepageConfig?.eyebrow_label || tributeTitle || '';
  const showSilhouette = Boolean(emblemUrl) && homepageConfig?.artwork_display !== 'none';

  return (
    <div
      className="relative overflow-hidden border-b border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#eef5fb_55%,#f2faf6_100%)] text-[#1e3553]"
      style={{
        backgroundImage:
          'radial-gradient(rgba(30,53,83,0.06) 1px, transparent 1px), linear-gradient(180deg,#f8fbff 0%,#eef5fb 55%,#f2faf6 100%)',
        backgroundSize: '24px 24px, 100% 100%',
      }}
    >
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-3 sm:px-6 sm:pb-14">
        <div className="flex items-center justify-between">
          <BackToEvents to={backLinkTo} show={showBackLink} />
        </div>
        <div className="mt-2 flex flex-col items-center text-center">
          {heroLogo.url && (
            <img
              src={heroLogo.url}
              alt={heroLogo.kind === 'commemorative' ? 'Commemorative banner' : organizerName || 'Organizer logo'}
              className={
                heroLogo.kind === 'commemorative'
                  ? 'max-h-24 w-auto max-w-full object-contain sm:max-h-28'
                  : 'h-20 w-auto max-w-full object-contain sm:h-24'
              }
            />
          )}

          {status && <div className="mt-5">{status}</div>}

          {eyebrowText && (
            <p className="mt-4 text-xl font-extrabold uppercase tracking-[0.06em] text-[#1e3553] sm:text-3xl">
              {eyebrowText}
            </p>
          )}

          {editionLabel && (
            <p className="mt-1.5 font-theme-heading text-lg italic text-[#3b526b] sm:text-2xl">
              {editionLabel}
            </p>
          )}

          <div className="mt-4 flex max-w-4xl items-center justify-center gap-4 sm:gap-6">
            {showSilhouette && emblemUrl && (
              <img
                src={emblemUrl}
                alt="Tribute emblem"
                className="h-20 w-auto shrink-0 object-contain sm:h-28"
              />
            )}
            <div className={`min-w-0 ${showSilhouette ? 'text-left' : 'text-center'}`}>
              <h1 className={pack.typography.tournamentTitleClass}>{title}</h1>
              {tributeSubtitle && (
                <p className="mt-1.5 break-words text-sm font-bold uppercase tracking-[0.14em] text-[#b38928] sm:text-base">
                  {tributeSubtitle}
                </p>
              )}
            </div>
          </div>

          {eventLine && !homepageConfig?.sections?.some((s) => s.key === 'event_details_card' && s.enabled) && (
            <p className="mt-4 text-base text-slate-600">{eventLine}</p>
          )}

          {action && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Charity Showcase & Scenic Photo (maps charity-bright):
 * - showcase_split (default): Rich brand gradient + 2-column split (text/CTA left, framed intact flyer right).
 * - full_bleed_bg (scenic-photo): Full-bleed text-free golf photography with dark contrast scrim.
 */
export function CharityBrightHero({
  pack,
  homepageConfig,
  title,
  organizerName,
  edition,
  eventLine,
  status,
  action,
  showBackLink = true,
  backLinkTo = '/',
  organizationLogoUrl,
  logoUrl,
  reversedLogoUrl,
  photoUrl,
  emblemUrl,
}: TournamentThemeHeroProps) {
  const artworkMode = homepageConfig?.artwork_display ?? 'showcase_split';
  const heroSurface = homepageConfig?.hero_surface ?? 'brand_gradient';
  const isFullBleed = (artworkMode === 'full_bleed_bg' || heroSurface === 'photo_scrim') && Boolean(photoUrl);
  const isSplitShowcase = !isFullBleed && artworkMode === 'showcase_split' && Boolean(photoUrl);
  const darkSurface = isDarkHeroSurface(heroSurface);
  const editionLabel = formatEdition(edition);

  const heroLogo = resolveHeroLogo({
    logoDisplay: homepageConfig?.logo_display ?? 'auto',
    isDarkSurface: darkSurface,
    logoUrl,
    organizationLogoUrl,
    reversedLogoUrl,
  });

  if (isFullBleed && photoUrl) {
    return (
      <div className="relative isolate overflow-hidden bg-brand-950 text-white">
        <img src={photoUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/40 to-black/25"
        />
        <div className="mx-auto flex min-h-[25rem] max-w-6xl flex-col justify-between gap-16 px-4 pb-10 pt-4 sm:min-h-[30rem] sm:px-8 sm:pb-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {showBackLink ? (
              <div className="rounded-full bg-black/45 px-3 backdrop-blur-xs">
                <BackToEvents light to={backLinkTo} show={showBackLink} />
              </div>
            ) : (
              <div />
            )}
            {heroLogo.url && (
              <img
                src={heroLogo.url}
                alt={organizerName || 'Organizer logo'}
                className={`h-12 max-w-[11rem] rounded-lg object-contain sm:h-14 ${
                  heroLogo.kind === 'reversed' ? 'bg-black/35 p-2' : 'bg-white/95 p-2'
                }`}
              />
            )}
          </div>

          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              {status}
              {editionLabel && <span className="text-sm font-semibold text-white/90">{editionLabel}</span>}
            </div>
            <h1 className={pack.typography.tournamentTitleClass}>{title}</h1>
            {eventLine && <p className="mt-3 text-base font-medium text-white/90 sm:text-lg">{eventLine}</p>}
            {action && <div className="mt-6 flex flex-wrap items-center gap-3">{action}</div>}
          </div>
        </div>
      </div>
    );
  }

  // Default Charity Showcase: crisp 2-column split on rich brand gradient (flyer stays 100% legible & intact)
  return (
    <div className={`relative isolate overflow-hidden ${pack.hero.gradientClass} text-white`}>
      <div aria-hidden="true" className={`absolute inset-0 -z-10 ${pack.hero.overlayClass}`} />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:py-14">
        <div
          className={
            isSplitShowcase
              ? 'grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12'
              : 'max-w-3xl'
          }
        >
          <div className="min-w-0">
            <div className="mb-5 flex items-center gap-3">
              {emblemUrl ? (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 p-2 ring-1 ring-white/25">
                  <img src={emblemUrl} alt="" className="h-full w-full object-contain" />
                </div>
              ) : heroLogo.url && !isSplitShowcase ? (
                <img
                  src={heroLogo.url}
                  alt={organizerName || 'Organizer logo'}
                  className={`h-11 max-w-[10rem] rounded-lg object-contain ${
                    heroLogo.kind === 'reversed' ? 'bg-white/10 p-1.5' : 'bg-white p-1.5'
                  }`}
                />
              ) : null}
              <BackToEvents light to={backLinkTo} show={showBackLink} />
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              {status}
              {homepageConfig?.eyebrow_label ? (
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/85">
                  {homepageConfig.eyebrow_label}
                </span>
              ) : editionLabel ? (
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/80">
                  {editionLabel}
                </span>
              ) : null}
            </div>

            <h1 className="break-words font-theme-heading text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
              {title}
            </h1>

            {eventLine && <p className="mt-3 text-base font-medium text-white/90 sm:text-lg">{eventLine}</p>}

            {action && <div className="mt-6 flex flex-wrap items-center gap-3">{action}</div>}
          </div>

          {isSplitShowcase && photoUrl && (
            <div className="relative">
              <div className="overflow-hidden rounded-[24px] bg-white/15 p-3 shadow-[0_24px_64px_rgba(0,0,0,0.28)] ring-1 ring-white/25 backdrop-blur-sm sm:p-4">
                <div className="aspect-[16/10] w-full overflow-hidden rounded-[16px] bg-white">
                  <img
                    src={photoUrl}
                    alt={`${title} event flyer`}
                    className="h-full w-full object-contain"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RegistrationProgress({ label, percent }: NonNullable<TournamentThemeHeroProps['progress']>) {
  if (percent == null) return null;

  return (
    <div className="mt-6 max-w-md border-t border-white/20 pt-4">
      <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-white/90">
        <span>Registration progress</span>
        <span className="text-accent-300">{percent}%</span>
      </div>
      <svg
        viewBox="0 0 100 4"
        preserveAspectRatio="none"
        className="mt-2 block h-2 w-full overflow-hidden rounded-full"
        role="meter"
        aria-label="Registration progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
      >
        <rect width="100" height="4" fill="white" fillOpacity=".2" />
        <rect width="100" height="4" className="fill-accent-300" transform={`scale(${percent / 100} 1)`} />
      </svg>
      <p className="mt-2 text-sm text-white/85">{label}</p>
    </div>
  );
}

/**
 * Varsity Crest (maps crest-classic):
 * Collegiate editorial dark header with gold hairline frame, status pill ABOVE title,
 * uniform action button row, and graceful collapse when no crest/photo is uploaded (zero empty placeholder box).
 */
export function CrestClassicHero({
  pack,
  homepageConfig,
  title,
  organizerName,
  edition,
  eventLine,
  status,
  action,
  showBackLink = true,
  backLinkTo = '/',
  logoUrl,
  organizationLogoUrl,
  reversedLogoUrl,
  emblemUrl,
  photoUrl,
  progress,
}: TournamentThemeHeroProps) {
  const artworkMode = homepageConfig?.artwork_display ?? 'emblem_lockup';
  const heroLogo = resolveHeroLogo({
    logoDisplay: homepageConfig?.logo_display ?? 'auto',
    isDarkSurface: true,
    logoUrl,
    organizationLogoUrl,
    reversedLogoUrl,
  });
  const crest = artworkMode === 'none' ? null : emblemUrl || heroLogo.url;
  const hasVisualPanel = Boolean(crest || (artworkMode !== 'none' && photoUrl));
  const editionLabel = homepageConfig?.eyebrow_label || formatEdition(edition);

  return (
    <div className="border-y-4 border-accent-400 bg-gradient-to-br from-brand-900 via-brand-950 to-brand-950 text-white">
      <div className="mx-auto max-w-6xl px-4 pb-9 pt-3 sm:px-8 sm:pb-12">
        <BackToEvents light to={backLinkTo} show={showBackLink} />
        <div className="mt-2 min-w-0 rounded-sm border border-accent-300/50 p-2 sm:p-3">
          <div
            className={`grid items-center gap-6 border border-accent-300/30 p-5 sm:p-8 lg:p-10 ${
              hasVisualPanel ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)] sm:gap-10' : ''
            }`}
          >
            {hasVisualPanel && (
              <div className="relative isolate grid min-h-44 place-items-center overflow-hidden rounded-lg border border-white/20 bg-brand-900/90 p-4 sm:min-h-56">
                {photoUrl && (
                  <img
                    src={photoUrl}
                    alt=""
                    className={`absolute inset-0 -z-10 h-full w-full ${
                      artworkMode === 'showcase_split' ? 'object-contain bg-white p-2' : 'object-cover opacity-50'
                    }`}
                  />
                )}
                {crest && artworkMode !== 'showcase_split' && (
                  <img
                    src={crest}
                    alt={emblemUrl ? 'Tournament crest' : organizerName || 'Organizer logo'}
                    className={`h-28 w-28 rounded-lg object-contain p-2 sm:h-36 sm:w-36 ${
                      emblemUrl || heroLogo.kind === 'reversed' ? 'bg-brand-950/80' : 'bg-white'
                    }`}
                  />
                )}
              </div>
            )}

            <div className={`min-w-0 ${hasVisualPanel ? '' : 'max-w-3xl'}`}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                {status}
                {editionLabel && (
                  <span className="text-xs font-bold uppercase tracking-[0.18em] text-accent-300">
                    {editionLabel}
                  </span>
                )}
              </div>
              <h1 className={pack.typography.tournamentTitleClass}>{title}</h1>
              {eventLine && <p className="mt-3 text-base text-white/90 sm:text-lg">{eventLine}</p>}
              {action && <div className="mt-6 flex flex-wrap items-center gap-3">{action}</div>}
              {progress && <RegistrationProgress {...progress} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Clean Editorial (maps default-clean):
 * Crisp white minimalist header with status eyebrow pill above title, uniform button row, and clean split artwork.
 */
export function DefaultCleanHero({
  pack,
  homepageConfig,
  title,
  organizerName,
  edition,
  eventLine,
  status,
  action,
  showBackLink = true,
  backLinkTo = '/',
  logoUrl,
  organizationLogoUrl,
  reversedLogoUrl,
  photoUrl,
  emblemUrl,
}: TournamentThemeHeroProps) {
  const artworkMode = homepageConfig?.artwork_display ?? 'showcase_split';
  const showPhoto = Boolean(photoUrl) && artworkMode !== 'none';
  const heroLogo = resolveHeroLogo({
    logoDisplay: homepageConfig?.logo_display ?? 'auto',
    isDarkSurface: false,
    logoUrl,
    organizationLogoUrl,
    reversedLogoUrl,
  });
  const editionLabel = homepageConfig?.eyebrow_label || formatEdition(edition);

  return (
    <div className="border-b border-neutral-200 bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-3 sm:px-6 lg:px-8 lg:pb-14">
        <BackToEvents to={backLinkTo} show={showBackLink} />
        <div className={`mt-4 grid items-center gap-8 ${showPhoto ? 'md:grid-cols-[1fr_0.95fr]' : 'max-w-3xl'}`}>
          <div className="min-w-0">
            {(heroLogo.url || emblemUrl) && (
              <img
                src={heroLogo.url || emblemUrl || undefined}
                alt={heroLogo.url ? organizerName || 'Organizer logo' : 'Tournament emblem'}
                className="mb-5 h-12 max-w-[12rem] object-contain object-left"
              />
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              {status}
              {editionLabel && (
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
                  {editionLabel}
                </span>
              )}
            </div>
            <h1 className={pack.typography.tournamentTitleClass}>{title}</h1>
            {eventLine && <p className="mt-3 text-base text-slate-600 sm:text-lg">{eventLine}</p>}
            {action && <div className="mt-6 flex flex-wrap items-center gap-3">{action}</div>}
          </div>
          {showPhoto && photoUrl && (
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-2 shadow-sm">
              <img
                src={photoUrl}
                alt={`${title} event artwork`}
                className="aspect-[16/10] w-full rounded-xl bg-white object-contain"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
