import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  Monitor,
  Smartphone,
  Sparkles,
  Image as ImageIcon,
  Layers,
  Sliders,
} from 'lucide-react';
import {
  HOMEPAGE_ARCHETYPE_LIST,
  HOMEPAGE_ARCHETYPES_BY_ID,
  SECTION_LABELS,
  resolveEffectiveHeroRender,
  resolveHeroLogo,
  resolveHomepageConfig,
  type ArtworkDisplay,
  type HeroSurface,
  type HomepageArchetype,
  type HomepageConfig,
  type HomepageSectionConfig,
  type LandingMode,
  type LogoDisplay,
} from '../../utils/homepageConfig';
import { StatusPill } from '../ui/PublicPrimitives';

export interface HomepageStudioProps {
  orgName: string;
  orgConfig: HomepageConfig;
  eventConfig?: HomepageConfig | null;
  themePreset?: string | null;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string | null;
  reversedLogoUrl?: string | null;
  commemorativeBannerUrl?: string | null;
  eventPhotoUrl?: string | null;
  emblemUrl?: string | null;
  eventName?: string;
  eventDate?: string;
  locationName?: string;
  entryFeeLabel?: string;
  tributeTitle?: string;
  tributeSubtitle?: string;
  onChangeOrgConfig: (next: HomepageConfig) => void;
  onChangeEventConfig?: (next: HomepageConfig, nextThemePreset?: string) => void;
}

const HERO_SURFACES: { value: HeroSurface; label: string; hint: string }[] = [
  { value: 'light_airy', label: 'Light Airy', hint: 'Best for dark-ink logos & formal tributes' },
  { value: 'brand_gradient', label: 'Brand Gradient', hint: 'Rich color wash with high-contrast white type' },
  { value: 'dark_editorial', label: 'Dark Editorial', hint: 'Deep collegiate header with gold rules' },
  { value: 'photo_scrim', label: 'Photo Scrim', hint: 'Dark contrast scrim over scenic photography' },
];

const ARTWORK_MODES: { value: ArtworkDisplay; label: string; hint: string }[] = [
  { value: 'showcase_split', label: '2-Column Framed Showcase', hint: 'Best for designed event flyers with text or logos' },
  { value: 'full_bleed_bg', label: 'Full-Bleed Scenic Photo', hint: 'For text-free golf course photography only' },
  { value: 'emblem_lockup', label: 'Emblem / Silhouette Lockup', hint: 'Compact emblem beside title; collapses cleanly if empty' },
  { value: 'none', label: 'No Hero Artwork', hint: 'Clean typographic header only' },
];

const LOGO_MODES: { value: LogoDisplay; label: string }[] = [
  { value: 'auto', label: 'Smart Single Logo (auto, never duplicates)' },
  { value: 'commemorative_banner', label: 'Commemorative Banner Only' },
  { value: 'org_logo', label: 'Organization Logo Only' },
  { value: 'reversed_logo', label: 'Reversed Light Logo Only' },
  { value: 'none', label: 'Hide Hero Logo' },
];

export function HomepageStudio({
  orgName,
  orgConfig,
  eventConfig,
  themePreset,
  primaryColor,
  accentColor,
  logoUrl,
  reversedLogoUrl,
  commemorativeBannerUrl,
  eventPhotoUrl,
  emblemUrl,
  eventName,
  eventDate,
  locationName,
  entryFeeLabel,
  tributeTitle,
  tributeSubtitle,
  onChangeOrgConfig,
  onChangeEventConfig,
}: HomepageStudioProps) {
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const resolved = resolveHomepageConfig(orgConfig, eventConfig, themePreset);
  const effectiveHero = resolveEffectiveHeroRender(resolved, Boolean(eventPhotoUrl));
  const darkSurface = effectiveHero.isDark;

  const patchTarget = (patch: Partial<HomepageConfig>, nextThemePreset?: string) => {
    const { landing_mode, ...eventPatch } = patch;
    // Landing behavior has a single persisted owner: organization.homepage_config
    if (landing_mode !== undefined) {
      onChangeOrgConfig({ ...orgConfig, landing_mode });
    }
    if (Object.keys(eventPatch).length > 0 || nextThemePreset) {
      if (onChangeEventConfig && eventConfig !== undefined) {
        const { landing_mode: _ignoredEventLandingMode, ...cleanEventConfig } = eventConfig || {};
        onChangeEventConfig({ ...cleanEventConfig, ...eventPatch }, nextThemePreset);
      } else {
        onChangeOrgConfig({ ...orgConfig, ...patch });
      }
    }
  };

  const selectArchetype = (archetype: HomepageArchetype) => {
    const meta = HOMEPAGE_ARCHETYPES_BY_ID[archetype];
    const nextPatch: Partial<HomepageConfig> = {
      archetype,
      hero_surface: meta.defaults.hero_surface,
      artwork_display: meta.defaults.artwork_display,
      logo_display: meta.defaults.logo_display,
      sections: meta.defaults.sections.map((s) => ({ ...s })),
    };
    patchTarget(nextPatch, meta.themePreset);
  };

  const updateSections = (nextSections: HomepageSectionConfig[]) => {
    patchTarget({ sections: nextSections });
  };

  const toggleSection = (index: number) => {
    const next = resolved.sections.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s));
    updateSections(next);
  };

  const moveSection = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= resolved.sections.length) return;
    const next = [...resolved.sections];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    updateSections(next);
  };

  const previewLogo = resolveHeroLogo({
    logoDisplay: resolved.logo_display,
    isDarkSurface: darkSurface,
    commemorativeBannerUrl,
    logoUrl,
    organizationLogoUrl: logoUrl,
    reversedLogoUrl,
  });

  const brandHex = primaryColor && /^#[0-9a-f]{6}$/i.test(primaryColor) ? primaryColor : '#1E3A5F';
  const accentHex = accentColor && /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#C5A059';
  const enabledSections = resolved.sections.filter((s) => s.enabled);

  return (
    <div className="space-y-6" data-testid="homepage-studio">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.95fr)] xl:items-start">
        {/* Left column: 3-layer controls */}
        <div className="space-y-6">
          {/* Layer 1: Theme Archetype */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-700" />
              <h4 className="text-sm font-semibold text-gray-900">Layer 1 · Theme Archetype</h4>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {HOMEPAGE_ARCHETYPE_LIST.map((item) => {
                const selected = resolved.archetype === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectArchetype(item.id)}
                    aria-pressed={selected}
                    className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-all ${
                      selected
                        ? 'border-brand-600 bg-brand-50/60 ring-2 ring-brand-600/20'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900">{item.label}</span>
                      {selected && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-gray-600">{item.tagline}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Layer 2: Structured Hero & Landing Controls */}
          <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-brand-700" />
              <h4 className="text-sm font-semibold text-gray-900">Layer 2 · Hero &amp; Landing Controls</h4>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-gray-800">Landing Behavior</span>
                <select
                  value={resolved.landing_mode}
                  onChange={(e) => patchTarget({ landing_mode: e.target.value as LandingMode })}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                >
                  <option value="org_hub">Multi-Event Org Hub (org header + event cards)</option>
                  <option value="direct_to_active_event">Direct to Active Event (skip org listing)</option>
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  Use Direct to Active Event for single-tournament domains.
                </span>
              </label>

              <label className="block text-sm">
                <span className="font-medium text-gray-800">Hero Surface</span>
                <select
                  value={resolved.hero_surface}
                  onChange={(e) => patchTarget({ hero_surface: e.target.value as HeroSurface })}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                >
                  {HERO_SURFACES.map((surface) => (
                    <option key={surface.value} value={surface.value}>
                      {surface.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  {HERO_SURFACES.find((s) => s.value === resolved.hero_surface)?.hint}
                </span>
              </label>

              <label className="block text-sm">
                <span className="font-medium text-gray-800">Artwork Display Mode</span>
                <select
                  value={resolved.artwork_display}
                  onChange={(e) => patchTarget({ artwork_display: e.target.value as ArtworkDisplay })}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                >
                  {ARTWORK_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  {ARTWORK_MODES.find((m) => m.value === resolved.artwork_display)?.hint}
                </span>
              </label>

              <label className="block text-sm">
                <span className="font-medium text-gray-800">Logo Rule</span>
                <select
                  value={resolved.logo_display}
                  onChange={(e) => patchTarget({ logo_display: e.target.value as LogoDisplay })}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                >
                  {LOGO_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  Prevents stacked or dark-on-dark duplicate logos automatically.
                </span>
              </label>
            </div>

            <label className="block text-sm">
              <span className="font-medium text-gray-800">Eyebrow / Series Label (optional)</span>
              <input
                type="text"
                maxLength={120}
                value={resolved.eyebrow_label}
                onChange={(e) => patchTarget({ eyebrow_label: e.target.value })}
                placeholder="e.g. 2026 Airport Week or 2027 Alumni Classic"
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
            </label>
          </div>

          {/* Layer 3: Sections Toggle & Reorder */}
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-brand-700" />
              <h4 className="text-sm font-semibold text-gray-900">Layer 3 · Page Sections (Toggle &amp; Order)</h4>
            </div>
            <div className="divide-y divide-gray-100">
              {resolved.sections.map((section, idx) => {
                const meta = SECTION_LABELS[section.key];
                return (
                  <div key={section.key} className="flex items-center justify-between gap-3 py-2.5">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={section.enabled}
                        onChange={() => toggleSection(idx)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">{meta.label}</span>
                        <span className="block text-xs text-gray-500">{meta.description}</span>
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveSection(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${meta.label} up`}
                        className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-35"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSection(idx, 1)}
                        disabled={idx === resolved.sections.length - 1}
                        aria-label={`Move ${meta.label} down`}
                        className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-35"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right column: Sticky Live Preview */}
        <div className="xl:sticky xl:top-6">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                <Eye className="h-3.5 w-3.5 text-brand-700" />
                <span>Live Preview</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium normal-case text-gray-500">
                  {HOMEPAGE_ARCHETYPES_BY_ID[resolved.archetype].label}
                </span>
              </div>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewDevice('desktop')}
                  aria-label="Desktop preview"
                  aria-pressed={previewDevice === 'desktop'}
                  className={`rounded-md p-1.5 ${
                    previewDevice === 'desktop' ? 'bg-white text-brand-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('mobile')}
                  aria-label="Mobile preview"
                  aria-pressed={previewDevice === 'mobile'}
                  className={`rounded-md p-1.5 ${
                    previewDevice === 'mobile' ? 'bg-white text-brand-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex justify-center p-4">
              <div
                data-testid="homepage-studio-preview"
                data-preview-device={previewDevice}
                className={`w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all ${
                  previewDevice === 'mobile' ? 'max-w-[290px]' : ''
                }`}
              >
                {/* Live Hero Preview */}
                <div
                  className="relative overflow-hidden p-5"
                  style={
                    effectiveHero.surface === 'light_airy'
                      ? { background: 'linear-gradient(180deg, #f8fbff 0%, #eef5fb 55%, #f2faf6 100%)', color: '#1e3553' }
                      : effectiveHero.surface === 'dark_editorial'
                      ? { background: `linear-gradient(135deg, ${brandHex}, #111827)`, color: '#ffffff', borderTop: `3px solid ${accentHex}` }
                      : { background: `linear-gradient(135deg, ${brandHex}, #0f172a)`, color: '#ffffff' }
                  }
                >
                  {effectiveHero.showFullBleedPhoto && eventPhotoUrl && (
                    <>
                      <img src={eventPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/20" />
                    </>
                  )}

                  <div
                    className={`relative z-10 ${
                      resolved.archetype === 'ceremonial-light'
                        ? 'flex flex-col items-center text-center'
                        : effectiveHero.showSplitPhoto && previewDevice === 'desktop'
                        ? 'grid grid-cols-[1.1fr_0.9fr] items-center gap-4'
                        : ''
                    }`}
                  >
                    <div className="min-w-0">
                      {previewLogo.url && (
                        <img
                          src={previewLogo.url}
                          alt="Preview logo"
                          className={`mb-2.5 h-8 w-auto max-w-[8rem] object-contain ${
                            resolved.archetype === 'ceremonial-light' ? 'mx-auto' : ''
                          } ${darkSurface && previewLogo.kind === 'standard' ? 'rounded bg-white p-1' : ''}`}
                        />
                      )}

                      <div className="mb-2">
                        <StatusPill label="Registration Open" tone="open" onDark={darkSurface} />
                      </div>

                      {(resolved.eyebrow_label || tributeTitle) && (
                        <p
                          className="text-[11px] font-bold uppercase tracking-wider"
                          style={{ color: darkSurface ? accentHex : '#1e3553' }}
                        >
                          {resolved.eyebrow_label || tributeTitle}
                        </p>
                      )}

                      <div
                        className={`mt-1 flex items-center gap-2.5 ${
                          resolved.archetype === 'ceremonial-light' ? 'justify-center' : ''
                        }`}
                      >
                        {emblemUrl && resolved.artwork_display === 'emblem_lockup' && (
                          <img src={emblemUrl} alt="" className="h-10 w-auto shrink-0 object-contain" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-base font-extrabold leading-tight">
                            {eventName || orgName || 'Annual Golf Classic'}
                          </p>
                          {tributeSubtitle && (
                            <p className="truncate text-[10px] font-bold uppercase tracking-wider" style={{ color: accentHex }}>
                              {tributeSubtitle}
                            </p>
                          )}
                        </div>
                      </div>

                      <p className={`mt-1.5 truncate text-[11px] ${darkSurface ? 'text-white/80' : 'text-slate-600'}`}>
                        {[eventDate || 'May 2, 2027', locationName || 'Country Club'].filter(Boolean).join(' · ')}
                      </p>

                      <div
                        className={`mt-3 flex flex-wrap gap-2 ${
                          resolved.archetype === 'ceremonial-light' ? 'justify-center' : ''
                        }`}
                      >
                        <span
                          className={`inline-flex items-center px-3 py-1 text-[11px] font-semibold ${
                            resolved.archetype === 'ceremonial-light' || resolved.archetype === 'varsity-crest'
                              ? 'rounded-md'
                              : 'rounded-full'
                          }`}
                          style={
                            darkSurface
                              ? { backgroundColor: '#ffffff', color: brandHex }
                              : { backgroundColor: brandHex, color: '#ffffff' }
                          }
                        >
                          Register Now
                        </span>
                      </div>
                    </div>

                    {resolved.artwork_display === 'showcase_split' && eventPhotoUrl && (
                      <div className="mt-3 overflow-hidden rounded-lg bg-white/20 p-1.5 ring-1 ring-white/25 sm:mt-0">
                        <img
                          src={eventPhotoUrl}
                          alt="Flyer preview"
                          className="aspect-[16/10] w-full rounded bg-white object-contain"
                        />
                      </div>
                    )}

                    {resolved.artwork_display === 'showcase_split' && !eventPhotoUrl && previewDevice === 'desktop' && (
                      <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-white/30 bg-white/10 text-[10px] text-white/70">
                        <span className="inline-flex items-center gap-1">
                          <ImageIcon className="h-3 w-3" /> Flyer preview slot
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section stack preview */}
                <div className="space-y-2 bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <span>Active Sections ({enabledSections.length})</span>
                    <span>{resolved.landing_mode === 'direct_to_active_event' ? 'Direct Event URL' : 'Org Hub'}</span>
                  </div>
                  {enabledSections.map((sec) => (
                    <div
                      key={sec.key}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700"
                    >
                      <span className="font-medium">{SECTION_LABELS[sec.key].label}</span>
                      {sec.key === 'event_details_card' && entryFeeLabel && (
                        <span className="font-semibold text-emerald-700">{entryFeeLabel}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
