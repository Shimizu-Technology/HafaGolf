import { ExternalLink, Star } from 'lucide-react';
import { SponsorMonogram } from './sponsors/SponsorMonogram';
import type { Sponsor, SponsorTier, Tournament } from '../services/api';
import type { ThemePackDefinition } from '../utils/themePacks';

const FALLBACK_SPONSOR_TIERS: SponsorTier[] = [
  { key: 'title', label: 'Title Sponsors', sort_order: 0 },
  { key: 'platinum', label: 'Major Sponsors', sort_order: 1 },
  { key: 'gold', label: 'Major Sponsors', sort_order: 2 },
  { key: 'silver', label: 'Supporting Sponsors', sort_order: 3 },
  { key: 'bronze', label: 'Supporting Sponsors', sort_order: 4 },
  { key: 'hole', label: 'Hole Sponsors', sort_order: 5 },
];

function sortHoleSponsors(sponsors: Sponsor[], courseConfigs: Tournament['course_configs'] = []) {
  const courseOrder = new Map((courseConfigs || []).map((course, index) => [course.key, index]));

  return [...sponsors].sort((a, b) => {
    const courseA = a.course_key ? (courseOrder.get(a.course_key) ?? 999) : 999;
    const courseB = b.course_key ? (courseOrder.get(b.course_key) ?? 999) : 999;
    if (courseA !== courseB) return courseA - courseB;
    return (a.hole_number || 0) - (b.hole_number || 0) || a.name.localeCompare(b.name);
  });
}

export function PublicSponsors({
  tournament, pack, featuredOnly = false,
}: {
  tournament: Tournament;
  pack: ThemePackDefinition;
  featuredOnly?: boolean;
}) {
  if (tournament.show_public_sponsors === false || !tournament.sponsors?.length) return null;

  const sponsorTiers = [...(tournament.sponsor_tiers?.length ? tournament.sponsor_tiers : FALLBACK_SPONSOR_TIERS)]
    .sort((a, b) => a.sort_order - b.sort_order);
  const tiersByKey = new Map(sponsorTiers.map((tier, index) => [tier.key, index]));

  // Retain sponsors from old tiers even if their tier was renamed or removed.
  for (const sponsor of tournament.sponsors) {
    if (tiersByKey.has(sponsor.tier)) continue;
    tiersByKey.set(sponsor.tier, sponsorTiers.length);
    sponsorTiers.push({
      key: sponsor.tier,
      label: sponsor.tier_display || sponsor.tier,
      sort_order: sponsorTiers.length,
    });
  }

  const sponsors = featuredOnly
    ? [...tournament.sponsors]
      .sort((a, b) => (tiersByKey.get(a.tier) ?? 0) - (tiersByKey.get(b.tier) ?? 0))
      .slice(0, 3)
    : tournament.sponsors;

  return (
    <section className={pack.id === 'charity-bright' ? 'border-y border-brand-100 bg-brand-50' : pack.surfaces.mutedSectionClass}>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
        <div className="flex items-center gap-3 mb-8">
          <Star className="w-5 h-5 text-accent-500" strokeWidth={2} />
          <h2 className={pack.typography.sectionTitleClass}>{tournament.sponsor_wall_title?.trim() || 'Our Sponsors'}</h2>
        </div>

        {sponsorTiers.map((tierDef) => {
          const tierSponsors = sponsors.filter(s => s.tier === tierDef.key);
          if (tierSponsors.length === 0) return null;

          const isHoleTier = tierSponsors.some(s => s.hole_number != null);
          const isTopTier = tierDef.sort_order <= 1 || pack.id === 'charity-bright';

          return (
            <div key={tierDef.key} className="mb-8 last:mb-0">
              <h3 className="text-lg font-semibold text-neutral-700 tracking-tight mb-4">
                {tierDef.label}{tierDef.label.toLowerCase().includes('sponsor') ? '' : ' Sponsors'}
              </h3>
              {isHoleTier ? (
                <HoleSponsorGrid sponsors={tierSponsors} courseConfigs={tournament.course_configs} pack={pack} />
              ) : (
                <SponsorGrid
                  sponsors={tierSponsors}
                  size={isTopTier ? 'large' : 'small'}
                  columns={isTopTier ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}
                  pack={pack}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sponsor grid (static)
// ---------------------------------------------------------------------------

function SponsorGrid({
  sponsors,
  size,
  columns,
  pack,
}: {
  sponsors: Sponsor[];
  size: 'large' | 'small';
  columns: string;
  pack: ThemePackDefinition;
}) {
  return (
    <div className={`grid ${columns} gap-4`}>
      {sponsors.map((sponsor) => (
        <SponsorCard key={sponsor.id} sponsor={sponsor} size={size} pack={pack} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hole sponsor grid (static)
// ---------------------------------------------------------------------------

function safeExternalUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function HoleSponsorGrid({
  sponsors,
  courseConfigs,
  pack,
}: {
  sponsors: Sponsor[];
  courseConfigs?: Tournament['course_configs'];
  pack: ThemePackDefinition;
}) {
  const sorted = sortHoleSponsors(sponsors, courseConfigs);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {sorted.map((sponsor) => {
        const inner = (
          <div className={`relative ${pack.surfaces.cardClass} overflow-hidden`}>
            {/* Logo area */}
            <div className="flex items-center justify-center bg-neutral-50/60 p-4 min-h-[80px]">
              {sponsor.logo_url ? (
                <img
                  src={sponsor.logo_url}
                  alt={sponsor.name}
                  className="max-w-full max-h-10 object-contain"
                />
              ) : (
                <SponsorMonogram name={sponsor.name} size="sm" />
              )}
            </div>
            {/* Name */}
            <div className="text-center px-2 py-2">
              <p className="font-semibold text-neutral-800 text-xs truncate">{sponsor.name}</p>
              {sponsor.display_label && (
                <p className="text-[10px] text-neutral-500 mt-1">{sponsor.display_label}</p>
              )}
              {safeExternalUrl(sponsor.website_url) && (
                <span className="inline-flex items-center gap-1 text-[10px] text-brand-600 mt-1">
                  <ExternalLink className="w-2.5 h-2.5" />
                  Visit
                </span>
              )}
            </div>
          </div>
        );
        const safeHref = safeExternalUrl(sponsor.website_url);
        return safeHref ? (
          <a key={sponsor.id} href={safeHref} target="_blank" rel="noopener noreferrer" className="block">
            {inner}
          </a>
        ) : (
          <div key={sponsor.id}>{inner}</div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sponsor card
// ---------------------------------------------------------------------------

function SponsorCard({
  sponsor,
  size,
  pack,
}: {
  sponsor: Sponsor;
  size: 'large' | 'small';
  pack: ThemePackDefinition;
}) {
  const isLarge = size === 'large';

  const card = (
    <div className={`group relative ${pack.surfaces.cardClass} flex flex-col overflow-hidden`}>
      {/* Logo / placeholder area */}
      <div className={`flex items-center justify-center bg-neutral-50/60 ${
        isLarge ? 'p-5 min-h-[100px]' : 'p-4 min-h-[72px]'
      }`}>
        {sponsor.logo_url ? (
          <img
            src={sponsor.logo_url}
            alt={sponsor.name}
            className={`max-w-full object-contain ${isLarge ? 'max-h-14' : 'max-h-9'}`}
          />
        ) : (
          <SponsorMonogram name={sponsor.name} size={isLarge ? 'lg' : 'sm'} />
        )}
      </div>

      {/* Name + description */}
      <div className={`text-center ${isLarge ? 'px-3 py-3' : 'px-2 py-2'}`}>
        <p className={`font-semibold text-neutral-800 leading-tight ${
          isLarge ? 'text-sm' : 'text-xs'
        }`}>
          {sponsor.name}
        </p>
        {sponsor.description && isLarge && (
          <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2 leading-relaxed">
            {sponsor.description}
          </p>
        )}
        {safeExternalUrl(sponsor.website_url) && (
          <span className={`inline-flex items-center gap-1 text-brand-600 mt-1.5 ${
            isLarge ? 'text-xs' : 'text-[10px]'
          }`}>
            <ExternalLink className="w-2.5 h-2.5" />
            Visit
          </span>
        )}
      </div>
    </div>
  );

  const safeHref = safeExternalUrl(sponsor.website_url);
  if (safeHref) {
    return (
      <a href={safeHref} target="_blank" rel="noopener noreferrer" className="block">
        {card}
      </a>
    );
  }

  return card;
}
