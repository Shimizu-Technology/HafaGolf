import type { ReactNode } from 'react';
import {
  CharityBrightHero,
  CrestClassicHero,
  DefaultCleanHero,
  MemorialFormalHero,
  type TournamentThemeHeroProps,
} from './themes/TournamentHeroes';
import { resolveThemePack, type ThemePackDefinition, type ThemePackId } from '../utils/themePacks';
import type { ArtworkDisplay, HeroSurface } from '../utils/homepageConfig';

interface PublicHeroProps {
  imageUrl?: string | null;
  imageAlt: string;
  children: ReactNode;
  maxWidthClassName?: string;
  containerClassName?: string;
  contentClassName?: string;
  imageDisplay?: 'background' | 'showcase' | 'none';
  heroSurface?: HeroSurface;
  artworkDisplay?: ArtworkDisplay;
  themePack?: ThemePackDefinition;
}

export function PublicHero({
  imageUrl,
  imageAlt,
  children,
  maxWidthClassName = 'max-w-5xl',
  containerClassName = '',
  contentClassName = '',
  imageDisplay,
  heroSurface,
  artworkDisplay,
  themePack,
}: PublicHeroProps) {
  const pack = themePack ?? resolveThemePack(null);
  const effectiveSurface: HeroSurface =
    heroSurface ??
    (pack.id === 'memorial-formal'
      ? 'light_airy'
      : pack.id === 'crest-classic'
      ? 'dark_editorial'
      : 'brand_gradient');

  const isLightSurface = effectiveSurface === 'light_airy';

  // Only show background photo when explicitly full_bleed_bg or photo_scrim (never muddy behind gradient/light headers)
  const resolvedDisplay: 'background' | 'showcase' | 'none' =
    imageDisplay ??
    (artworkDisplay === 'full_bleed_bg' || effectiveSurface === 'photo_scrim'
      ? 'background'
      : artworkDisplay === 'showcase_split'
      ? 'showcase'
      : 'none');

  const hasShowcaseImage = Boolean(imageUrl) && resolvedDisplay === 'showcase';
  const hasBackgroundImage = Boolean(imageUrl) && resolvedDisplay === 'background';
  const resolvedImageUrl = imageUrl ?? undefined;

  const surfaceBgClass = isLightSurface
    ? 'border-b border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#eef5fb_55%,#f2faf6_100%)] text-[#1e3553]'
    : effectiveSurface === 'dark_editorial'
    ? 'bg-brand-950 text-white'
    : 'text-brand-foreground';

  return (
    <section
      data-theme-pack={pack.id}
      data-hero-variant={pack.hero.variant}
      data-hero-surface={effectiveSurface}
      className={`relative overflow-hidden ${surfaceBgClass} ${containerClassName}`.trim()}
    >
      {!isLightSurface && (
        <>
          <div className={`absolute inset-0 ${pack.hero.gradientClass}`} />
          <div className={`absolute inset-0 ${pack.hero.overlayClass}`} />
        </>
      )}

      {hasBackgroundImage && !isLightSurface ? (
        <>
          <div
            className="absolute inset-0 hidden md:block bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url("${imageUrl}")` }}
          />
          <div className="absolute inset-0 hidden md:block bg-[linear-gradient(90deg,rgb(var(--brand-900-rgb)/0.92)_0%,rgb(var(--brand-700-rgb)/0.76)_48%,rgb(var(--brand-600-rgb)/0.68)_100%)]" />
        </>
      ) : null}

      <div className={`relative z-10 mx-auto w-full ${maxWidthClassName} px-4 sm:px-6 lg:px-8 py-10 sm:py-12 lg:py-16`}>
        {hasBackgroundImage && !isLightSurface ? (
          <div className="mb-6 md:hidden">
            <div className={pack.hero.showcaseFrameClass}>
              <div className="aspect-[16/10] bg-white/10 p-3">
                <img
                  src={resolvedImageUrl}
                  alt={imageAlt}
                  className="h-full w-full rounded-[20px] object-contain"
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className={hasShowcaseImage ? 'grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] lg:items-center' : ''}>
          <div className={contentClassName || pack.hero.contentWrapperClass}>{children}</div>

          {hasShowcaseImage ? (
            <div className="relative">
              <div className={pack.hero.showcaseFrameClass}>
                <div className="aspect-[16/10] bg-white/10 p-3 sm:p-4">
                  <img
                    src={resolvedImageUrl}
                    alt={imageAlt}
                    className="h-full w-full rounded-[18px] bg-white/95 object-contain"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const TOURNAMENT_HEROES = {
  'default-clean': DefaultCleanHero,
  'charity-bright': CharityBrightHero,
  'memorial-formal': MemorialFormalHero,
  'crest-classic': CrestClassicHero,
} satisfies Record<ThemePackId, (props: TournamentThemeHeroProps) => ReactNode>;

export function PublicTournamentHero(props: TournamentThemeHeroProps) {
  const { pack, homepageConfig } = props;
  const archetype = homepageConfig?.archetype;

  const ThemeHero =
    archetype === 'ceremonial-light'
      ? MemorialFormalHero
      : archetype === 'charity-showcase' || archetype === 'scenic-photo'
      ? CharityBrightHero
      : archetype === 'varsity-crest'
      ? CrestClassicHero
      : archetype === 'clean-editorial'
      ? DefaultCleanHero
      : TOURNAMENT_HEROES[pack.id];

  return (
    <section
      data-hero-variant={pack.hero.variant}
      data-homepage-archetype={archetype ?? pack.id}
      data-hero-surface={homepageConfig?.hero_surface}
      data-artwork-display={homepageConfig?.artwork_display}
    >
      <ThemeHero {...props} />
    </section>
  );
}
