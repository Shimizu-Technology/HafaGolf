import React from 'react';
import {
  Award,
  Calendar,
  Check,
  ChevronRight,
  Flag,
  LayoutTemplate,
  MapPin,
  Shield,
  Sparkles,
} from 'lucide-react';
import {
  THEME_PACK_LIST,
  resolveThemePack,
  type ThemePackDefinition,
  type ThemePackIconKey,
  type ThemePackId,
} from '../utils/themePacks';

interface ThemePackPickerProps {
  value?: string | null;
  onChange: (packId: ThemePackId) => void;
  eventName?: string;
  organizationName?: string;
  eventDateLabel?: string;
  locationName?: string;
  entryFeeLabel?: string;
}

function PackIcon({ icon, className = 'w-4 h-4' }: { icon: ThemePackIconKey; className?: string }) {
  switch (icon) {
    case 'sparkles':
      return <Sparkles className={className} />;
    case 'award':
      return <Award className={className} />;
    case 'shield':
      return <Shield className={className} />;
    case 'layout':
    default:
      return <LayoutTemplate className={className} />;
  }
}

function ThemePackLivePreview({
  pack,
  eventName,
  organizationName,
  eventDateLabel,
  locationName,
  entryFeeLabel,
}: {
  pack: ThemePackDefinition;
  eventName: string;
  organizationName: string;
  eventDateLabel: string;
  locationName: string;
  entryFeeLabel: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
      data-theme-pack={pack.id}
      style={pack.cssVars as React.CSSProperties}
    >
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
          <PackIcon icon={pack.icon} className="h-3.5 w-3.5 text-brand-600" />
          <span>Live Preview — {pack.name}</span>
        </div>
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-700">
          {pack.signatureMotion.label}
        </span>
      </div>

      {/* Mini Hero Preview */}
      <div className={`relative overflow-hidden px-5 py-6 text-brand-foreground ${pack.hero.gradientClass}`}>
        <div className={`pointer-events-none absolute inset-0 ${pack.hero.overlayClass}`} />
        <div className="relative z-10 flex items-start gap-3.5">
          <div className={`${pack.hero.logoFrameClass} h-10 w-10 shrink-0`}>
            <Flag className="h-4 w-4 text-brand-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className={pack.hero.accentRuleClass} />
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
              {organizationName}
            </p>
            <h4
              className="mt-1 truncate text-lg font-bold text-white sm:text-xl"
              style={{
                fontFamily: pack.typography.headingFontFamily,
                letterSpacing: pack.typography.headingTracking,
              }}
            >
              {eventName}
            </h4>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/80">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {eventDateLabel}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {locationName}
              </span>
            </div>
            <span className={`mt-3 bg-accent-600 text-accent-foreground ${pack.surfaces.badgeClass}`}>
              Registration Open
            </span>
          </div>
        </div>
      </div>

      {/* Mini Card Surface Preview */}
      <div className={`p-4 sm:p-5 ${pack.surfaces.pageClass}`}>
        <div className={`overflow-hidden ${pack.surfaces.cardClass}`}>
          <div className={pack.surfaces.cardAccentBarClass} />
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={pack.typography.eyebrowClass}>Entry Fee</p>
              <p
                className="mt-0.5 text-lg font-bold text-neutral-900"
                style={{ fontFamily: pack.typography.headingFontFamily }}
              >
                {entryFeeLabel}
              </p>
              <p className="mt-1 text-xs text-neutral-500">{pack.shortTagline}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${pack.surfaces.ctaPrimaryClass} pointer-events-none px-4 py-2 text-xs`}>
                Register Now
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
              <span className={`${pack.surfaces.ctaSecondaryClass} pointer-events-none px-3.5 py-2 text-xs`}>
                Details
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">Motion posture:</span> {pack.signatureMotion.description} Registration, check-in, scoring, raffle POS, and admin screens stay completely quiet.
        </p>
      </div>
    </div>
  );
}

export const ThemePackPicker: React.FC<ThemePackPickerProps> = ({
  value,
  onChange,
  eventName,
  organizationName,
  eventDateLabel,
  locationName,
  entryFeeLabel,
}) => {
  const activePack = resolveThemePack(value);
  const isLegacyClassic = value?.trim().toLowerCase() === 'classic';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {THEME_PACK_LIST.map((pack) => {
          const isSelected = activePack.id === pack.id;
          return (
            <button
              key={pack.id}
              type="button"
              onClick={() => onChange(pack.id)}
              aria-pressed={isSelected}
              className={`group flex flex-col items-start rounded-xl border-2 p-4 text-left transition-colors ${
                isSelected
                  ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600/20'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
                      isSelected
                        ? 'bg-brand-600 text-brand-foreground'
                        : 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'
                    }`}
                  >
                    <PackIcon icon={pack.icon} className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{pack.name}</span>
                </div>
                {isSelected && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-brand-foreground">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">{pack.description}</p>
              <p className="mt-2 text-[11px] font-medium text-gray-400">
                Best for: {pack.idealFor}
              </p>
            </button>
          );
        })}
      </div>

      {isLegacyClassic && (
        <p className="text-xs text-gray-500">
          This event currently uses the legacy <span className="font-mono">classic</span> preset, which maps automatically to <span className="font-medium text-gray-700">Default Clean</span>.
        </p>
      )}

      <ThemePackLivePreview
        pack={activePack}
        eventName={eventName?.trim() || 'Annual Golf Tournament 2027'}
        organizationName={organizationName?.trim() || 'Your Organization'}
        eventDateLabel={eventDateLabel?.trim() || 'May 15, 2027'}
        locationName={locationName?.trim() || 'Country Club Golf Course'}
        entryFeeLabel={entryFeeLabel?.trim() || '$300/team'}
      />
    </div>
  );
};
