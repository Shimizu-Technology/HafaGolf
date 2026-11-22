import type { ReactNode } from 'react';
import { resolveThemePack, type ThemePackDefinition } from '../utils/themePacks';

interface PublicHeroProps {
  imageUrl?: string | null;
  imageAlt: string;
  children: ReactNode;
  maxWidthClassName?: string;
  containerClassName?: string;
  contentClassName?: string;
  imageDisplay?: 'background' | 'showcase';
  themePack?: ThemePackDefinition;
}

export function PublicHero({
  imageUrl,
  imageAlt,
  children,
  maxWidthClassName = 'max-w-5xl',
  containerClassName = '',
  contentClassName = '',
  imageDisplay = 'background',
  themePack,
}: PublicHeroProps) {
  const pack = themePack ?? resolveThemePack(null);
  const hasShowcaseImage = Boolean(imageUrl) && imageDisplay === 'showcase';
  const hasBackgroundImage = Boolean(imageUrl) && imageDisplay === 'background';
  const resolvedImageUrl = imageUrl ?? undefined;

  return (
    <section
      data-theme-pack={pack.id}
      data-hero-variant={pack.hero.variant}
      className={`relative overflow-hidden text-brand-foreground ${containerClassName}`.trim()}
    >
      <div className={`absolute inset-0 ${pack.hero.gradientClass}`} />
      <div className={`absolute inset-0 ${pack.hero.overlayClass}`} />

      {hasBackgroundImage ? (
        <>
          <div
            className="absolute inset-0 hidden md:block bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url("${imageUrl}")` }}
          />
          <div className="absolute inset-0 hidden md:block bg-[linear-gradient(90deg,rgb(var(--brand-900-rgb)/0.94)_0%,rgb(var(--brand-700-rgb)/0.78)_48%,rgb(var(--brand-600-rgb)/0.72)_100%)]" />
          <div className="absolute inset-0 hidden md:block bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_34%)]" />
        </>
      ) : null}

      <div className={`relative z-10 mx-auto w-full ${maxWidthClassName} px-4 sm:px-6 lg:px-8 py-10 sm:py-12 lg:py-16`}>
        {hasBackgroundImage ? (
          <div className="mb-6 md:hidden">
            <div className={pack.hero.showcaseFrameClass}>
              <div className="aspect-[16/10] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_55%),linear-gradient(135deg,rgba(255,255,255,0.16),rgba(255,255,255,0.04))] p-3">
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
                <div className="aspect-[16/10] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_55%),linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.04))] p-3 sm:p-4">
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
