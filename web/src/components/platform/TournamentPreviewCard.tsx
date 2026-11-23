import type { CSSProperties } from 'react';
import { Award, CalendarDays, Flag, Handshake, Shield, Sparkles, Ticket } from 'lucide-react';
import { THEME_PACKS } from '../../utils/themePacks';
import type { SampleTournamentStyle } from './sampleData';

const STYLE_ICONS = {
  memorial: Award,
  charity: Sparkles,
  alumni: Shield,
} as const;

/** A miniature public tournament page, styled the way the matching theme pack styles a real one. */
export function TournamentPreviewCard({ style }: { style: SampleTournamentStyle }) {
  const { palette } = style;
  const pack = THEME_PACKS[style.packId];
  const Emblem = STYLE_ICONS[style.id];
  const filled = Math.round((style.teamsRegistered / style.teamCapacity) * 100);
  const isAlumni = style.id === 'alumni';

  return (
    <article
      aria-label={`Sample ${style.label.toLowerCase()} tournament page: ${style.tournamentName}`}
      className="overflow-hidden shadow-[0_30px_60px_-28px_rgba(11,59,46,0.45),0_10px_24px_-12px_rgba(17,24,39,0.18)]"
      style={{
        background: palette.surface,
        color: palette.ink,
        borderRadius: palette.radius,
        border: isAlumni ? `2px solid ${palette.rule}` : '1px solid rgba(17, 24, 39, 0.08)',
      } as CSSProperties}
    >
      <header
        className="relative px-5 pb-5 pt-5 sm:px-6 sm:pt-6"
        style={{ background: palette.headerBackground, color: palette.headerInk }}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center"
            style={{
              borderRadius: isAlumni ? '8px' : '999px',
              border: `1.5px solid ${palette.rule}`,
              color: style.id === 'memorial' ? palette.rule : palette.headerInk,
            }}
          >
            <Emblem className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p
              className="ph-ui text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: palette.headerMuted }}
            >
              {style.eyebrow}
            </p>
            <h3
              className={`mt-1 break-words text-[1.35rem] leading-tight sm:text-2xl ${style.uppercaseTitle ? 'uppercase tracking-tight' : ''}`}
              style={{ fontFamily: palette.headingFont, fontWeight: style.id === 'charity' ? 800 : 700, color: palette.headerInk }}
            >
              {style.tournamentName}
            </h3>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="mt-4"
          style={{ height: style.id === 'memorial' ? 1 : 3, width: style.id === 'memorial' ? 72 : 56, background: palette.rule, borderRadius: 2 }}
        />
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: palette.headerMuted }}>
          <CalendarDays aria-hidden="true" className="h-4 w-4" />
          <span>{style.dateLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{style.formatLabel}</span>
        </p>
      </header>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        <div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">Teams registered</span>
            <span className="tabular-nums font-semibold">
              {style.teamsRegistered} of {style.teamCapacity}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: palette.track }}>
            <div className="h-full rounded-full" style={{ width: `${filled}%`, background: palette.accent }} />
          </div>
        </div>

        <ul className="space-y-2.5 text-sm">
          <li className="flex items-start gap-2.5">
            <Handshake aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: palette.accent }} />
            <span>
              <span className="font-semibold">{style.sponsorTier}:</span>{' '}
              <span style={{ color: palette.muted }}>{style.sponsorName}</span>
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Ticket aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" style={{ color: palette.accent }} />
            <span style={{ color: palette.muted }}>{style.raffleHighlight}</span>
          </li>
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span
            aria-hidden="true"
            className="inline-flex min-h-[40px] items-center gap-2 px-4 text-sm font-semibold"
            style={{ background: palette.accent, color: palette.accentInk, borderRadius: palette.buttonRadius }}
          >
            <Flag className="h-4 w-4" />
            {style.ctaLabel}
          </span>
          <span className="ph-ui text-xs font-medium" style={{ color: palette.muted }}>
            {pack.name} theme
          </span>
        </div>
      </div>
    </article>
  );
}
