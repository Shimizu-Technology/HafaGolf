import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { THEME_PACKS } from '../../utils/themePacks';
import { FINE_POINTER_QUERY, useMediaQuery, useTiltCard } from './motion';
import { SAMPLE_STYLES } from './sampleData';
import { TournamentPreviewCard } from './TournamentPreviewCard';

/**
 * Signature moment one: switch a sample tournament between three real theme packs. With a mouse
 * and motion allowed, the preview leans toward the pointer and turns when dragged.
 */
export function StyleSwitcher({ motionOk }: { motionOk: boolean }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const tiltEnabled = motionOk && finePointer;
  const tilt = useTiltCard(cardRef, tiltEnabled);
  const active = SAMPLE_STYLES[activeIndex];

  const select = (index: number, focus = false) => {
    const next = (index + SAMPLE_STYLES.length) % SAMPLE_STYLES.length;
    setActiveIndex(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: activeIndex + 1,
      ArrowDown: activeIndex + 1,
      ArrowLeft: activeIndex - 1,
      ArrowUp: activeIndex - 1,
      Home: 0,
      End: SAMPLE_STYLES.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(moves[event.key], true);
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="ph-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ph-brass-text)]">
          Try a tournament style
        </p>
        <p className="text-xs text-[var(--ph-ink-muted)]">Sample tournaments · all names fictional</p>
      </div>

      <div
        role="tablist"
        aria-label="Tournament style"
        className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-[var(--ph-line)] bg-white p-1"
      >
        {SAMPLE_STYLES.map((style, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={style.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`ph-style-tab-${style.id}`}
              aria-selected={selected}
              aria-controls="ph-style-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(index)}
              onKeyDown={onKeyDown}
              className={`ph-ui min-h-[44px] rounded-full px-3 text-sm font-semibold transition-colors duration-150 ${
                selected
                  ? 'bg-[var(--ph-evergreen)] text-white'
                  : 'text-[var(--ph-ink-muted)] hover:bg-[var(--ph-paper)] hover:text-[var(--ph-ink)]'
              }`}
            >
              {style.label}
            </button>
          );
        })}
      </div>

      <div
        id="ph-style-panel"
        role="tabpanel"
        aria-labelledby={`ph-style-tab-${active.id}`}
        className="ph-tilt-stage mt-5"
        data-tilt={tiltEnabled ? 'on' : 'off'}
        {...tilt}
      >
        <div ref={cardRef} className="ph-tilt-card">
          <div key={active.id} className="ph-card-enter">
            <TournamentPreviewCard style={active} />
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-[var(--ph-ink-muted)]">
        <span className="font-semibold text-[var(--ph-ink)]">{THEME_PACKS[active.packId].name}:</span>{' '}
        {THEME_PACKS[active.packId].idealFor}.
      </p>
    </div>
  );
}
