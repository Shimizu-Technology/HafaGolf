import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ClipboardList, FileSignature, Handshake, Ticket, Trophy } from 'lucide-react';
import { PINNED_VIEWPORT_QUERY, useMediaQuery, useScrollProgress } from './motion';
import { MiniCheckIn } from './MiniCheckIn';
import { formatUsd, payoutTotal, SAMPLE_PAYOUT_LINES, SAMPLE_RAFFLE_DRAW } from './sampleData';

interface Stage {
  id: string;
  time: string;
  title: string;
  body: string;
  panel: ReactNode;
}

const STAGES: Stage[] = [
  {
    id: 'weeks-before',
    time: 'Weeks before',
    title: 'Registration and the sponsor portal',
    body: 'Teams register and pay online. Sponsors open their own link to name their foursomes, and every golfer’s waiver is tracked as they sign.',
    panel: <RegistrationPanel />,
  },
  {
    id: 'six-am',
    time: '6:00 AM',
    title: 'A–J and K–Z phone check-in',
    body: 'Volunteers split the line by last name and check golfers in from their phones, with each waiver confirmed before carts roll.',
    panel: <MiniCheckIn />,
  },
  {
    id: 'banquet',
    time: 'Banquet and wrap-up',
    title: 'Live raffle board and payout statement',
    body: 'Sell tickets from a tablet, draw winners on the banquet projector or TV, and close the night with registrations, sponsors, and raffle sales reconciled.',
    panel: <RafflePanel />,
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Signature moment two. On tall desktop screens with motion allowed, the section pins for about
 * 1.5 viewports while scroll crossfades the three stages; everywhere else it is three still cards.
 */
export function TournamentDayFlow({ motionOk }: { motionOk: boolean }) {
  const tallDesktop = useMediaQuery(PINNED_VIEWPORT_QUERY);
  const pinned = motionOk && tallDesktop;
  const sectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);

  useScrollProgress(sectionRef, pinned, (progress) => {
    const position = progress * (STAGES.length - 1);
    if (railRef.current) railRef.current.style.transform = `scaleY(${progress.toFixed(4)})`;
    panelRefs.current.forEach((panel, index) => {
      if (!panel) return;
      const distance = position - index;
      panel.style.opacity = clamp((0.5 - Math.abs(distance)) / 0.2, 0, 1).toFixed(3);
      panel.style.transform = `translateY(${(-distance * 28).toFixed(1)}px)`;
    });
    const nextActive = Math.round(position);
    if (nextActive !== activeRef.current) {
      activeRef.current = nextActive;
      setActive(nextActive);
    }
  });

  // Hidden stages leave the tab order and the accessibility tree while pinned.
  useEffect(() => {
    panelRefs.current.forEach((panel, index) => {
      if (!panel) return;
      const hidden = pinned && index !== active;
      panel.toggleAttribute('inert', hidden);
      if (hidden) panel.setAttribute('aria-hidden', 'true');
      else panel.removeAttribute('aria-hidden');
      if (!pinned) {
        panel.style.opacity = '';
        panel.style.transform = '';
      }
    });
  }, [pinned, active]);

  const goToStage = (index: number) => {
    const section = sectionRef.current;
    if (!section) return;
    const range = section.offsetHeight - window.innerHeight;
    const top = window.scrollY + section.getBoundingClientRect().top + range * (index / (STAGES.length - 1));
    window.scrollTo({ top, behavior: 'smooth' });
  };

  const heading = (
    <div>
      <p className="ph-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ph-brass-light)]">
        How tournament day runs
      </p>
      <h2 className="ph-display mt-3 text-3xl font-semibold leading-tight text-white sm:text-4xl">
        One system, from the first sign-up to the last raffle ticket.
      </h2>
    </div>
  );

  if (!pinned) {
    return (
      <section id="tournament-day" ref={sectionRef} className="scroll-mt-4 bg-[var(--ph-evergreen)] py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">{heading}</div>
          <ol className="mt-12 space-y-12">
            {STAGES.map((stage, index) => (
              <li key={stage.id} className="grid gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-start md:gap-10">
                <StageCopy stage={stage} index={index} />
                <div>{stage.panel}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section
      id="tournament-day"
      ref={sectionRef}
      data-pinned=""
      className="relative bg-[var(--ph-evergreen)]"
      style={{ height: '250vh' }}
    >
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-12 px-8">
          <div>
            {heading}
            <div className="relative mt-10 pl-6">
              <div aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-px bg-white/15">
                <div ref={railRef} className="ph-progress-rail-fill h-full w-full bg-[var(--ph-brass-light)]" style={{ transform: 'scaleY(0)' }} />
              </div>
              <ol className="space-y-2">
                {STAGES.map((stage, index) => (
                  <li key={stage.id}>
                    <button
                      type="button"
                      onClick={() => goToStage(index)}
                      aria-current={index === active ? 'step' : undefined}
                      className={`w-full rounded-xl px-4 py-3 text-left transition-colors duration-200 ${
                        index === active ? 'bg-white/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <span className="ph-ui block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ph-brass-light)]">
                        {stage.time}
                      </span>
                      <span className={`mt-1 block text-lg font-semibold ${index === active ? 'text-white' : 'text-white/70'}`}>
                        {stage.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="grid">
            {STAGES.map((stage, index) => (
              <div
                key={stage.id}
                ref={(el) => {
                  panelRefs.current[index] = el;
                }}
                className={`ph-flow-panel [grid-area:1/1] ${index === active ? '' : 'pointer-events-none'}`}
              >
                <p className="mb-4 max-w-xl text-base leading-relaxed text-white/85">{stage.body}</p>
                {stage.panel}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StageCopy({ stage, index }: { stage: Stage; index: number }) {
  return (
    <div className="md:pt-2">
      <p className="ph-ui flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ph-brass-light)]">
        <span className="tabular-nums">0{index + 1}</span>
        <span aria-hidden="true" className="h-px w-8 bg-[var(--ph-brass-light)]/60" />
        {stage.time}
      </p>
      <h3 className="ph-display mt-3 text-2xl font-semibold text-white">{stage.title}</h3>
      <p className="mt-3 text-base leading-relaxed text-white/80">{stage.body}</p>
    </div>
  );
}

function PanelShell({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--ph-line)] bg-white p-4 text-[var(--ph-ink)] shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="ph-ui text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ph-brass-text)]">{eyebrow}</p>
        <p className="text-sm text-[var(--ph-ink-muted)]">Illustrative data</p>
      </div>
      {children}
    </div>
  );
}

function RegistrationPanel() {
  const rows = [
    { icon: ClipboardList, label: 'Teams registered', value: '28 of 36', fill: 78 },
    { icon: Handshake, label: 'Sponsor foursomes named', value: '6 of 8', fill: 75 },
    { icon: FileSignature, label: 'Waivers signed', value: '92 of 112', fill: 82 },
  ];
  return (
    <PanelShell eyebrow="Registration desk">
      <ul className="mt-4 space-y-4">
        {rows.map(({ icon: Icon, label, value, fill }) => (
          <li key={label}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Icon aria-hidden="true" className="h-4 w-4 text-[var(--ph-fairway)]" />
                {label}
              </span>
              <span className="font-semibold tabular-nums">{value}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ece6d8]">
              <div className="h-full rounded-full bg-[var(--ph-fairway)]" style={{ width: `${fill}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 rounded-xl border border-[var(--ph-line)] bg-[var(--ph-paper)] p-3 text-sm">
        <p className="font-semibold">Coral Lantern Studio (demo) · Eagle sponsor</p>
        <p className="mt-1 text-[var(--ph-ink-muted)]">Private sponsor link · 2 foursomes · 6 of 8 players named</p>
      </div>
    </PanelShell>
  );
}

function RafflePanel() {
  return (
    <PanelShell eyebrow="Banquet board">
      <div className="mt-4 rounded-xl bg-[var(--ph-evergreen)] p-5 text-white">
        <p className="ph-ui flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ph-brass-light)]">
          <Trophy aria-hidden="true" className="h-4 w-4" />
          Now drawing
        </p>
        <p className="ph-display mt-2 text-4xl font-semibold tabular-nums">Ticket #{SAMPLE_RAFFLE_DRAW.ticketNumber}</p>
        <p className="mt-2 text-sm text-white/80">
          {SAMPLE_RAFFLE_DRAW.prize} · donated by {SAMPLE_RAFFLE_DRAW.donor}
        </p>
      </div>
      <div className="mt-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Ticket aria-hidden="true" className="h-4 w-4 text-[var(--ph-fairway)]" />
          Payout statement
        </p>
        <dl className="mt-2 divide-y divide-[var(--ph-line)] text-sm">
          {SAMPLE_PAYOUT_LINES.map((line) => (
            <div key={line.label} className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--ph-ink-muted)]">{line.label}</dt>
              <dd className="font-medium tabular-nums">{formatUsd(line.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 py-2 font-semibold">
            <dt>Total raised</dt>
            <dd className="tabular-nums" data-testid="ph-payout-total">
              {formatUsd(payoutTotal())}
            </dd>
          </div>
        </dl>
      </div>
    </PanelShell>
  );
}
