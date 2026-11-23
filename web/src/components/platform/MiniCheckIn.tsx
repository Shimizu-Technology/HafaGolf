import { useState } from 'react';
import { Check, FileSignature, RotateCcw, UserCheck } from 'lucide-react';
import { laneFor, SAMPLE_GOLFERS } from './sampleData';
import type { CheckInLane } from './sampleData';

interface GolferStatus {
  checkedIn: boolean;
  waiverSigned: boolean;
}

const INITIAL_STATUS: Record<string, GolferStatus> = {
  abara: { checkedIn: true, waiverSigned: true },
  halvorsen: { checkedIn: false, waiverSigned: true },
  lindqvist: { checkedIn: false, waiverSigned: false },
  tarrant: { checkedIn: false, waiverSigned: false },
};

const LANES: CheckInLane[] = ['A–J', 'K–Z'];

/** A local, backend-free copy of the morning check-in screen that visitors can tap through. */
export function MiniCheckIn() {
  const [status, setStatus] = useState<Record<string, GolferStatus>>(INITIAL_STATUS);
  const checkedIn = SAMPLE_GOLFERS.filter((golfer) => status[golfer.id].checkedIn).length;
  const waivers = SAMPLE_GOLFERS.filter((golfer) => status[golfer.id].waiverSigned).length;
  const total = SAMPLE_GOLFERS.length;

  const toggle = (id: string, field: keyof GolferStatus) =>
    setStatus((prev) => ({ ...prev, [id]: { ...prev[id], [field]: !prev[id][field] } }));

  return (
    <div className="rounded-2xl border border-[var(--ph-line)] bg-white p-4 text-[var(--ph-ink)] shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ph-ui text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ph-brass-text)]">
            Try it · morning check-in
          </p>
          <p className="mt-1 text-sm text-[var(--ph-ink-muted)]">Demo data · all names fictional</p>
        </div>
        <button
          type="button"
          onClick={() => setStatus(INITIAL_STATUS)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[var(--ph-ink-muted)] hover:bg-[var(--ph-paper)] hover:text-[var(--ph-ink)]"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Reset
        </button>
      </div>

      <p aria-live="polite" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold tabular-nums">
        <span data-testid="ph-checkin-count">
          {checkedIn} of {total} checked in
        </span>
        <span data-testid="ph-waiver-count" className="text-[var(--ph-ink-muted)]">
          {waivers} of {total} waivers signed
        </span>
      </p>

      {LANES.map((lane) => {
        const golfers = SAMPLE_GOLFERS.filter((golfer) => laneFor(golfer.lastName) === lane);
        return (
          <section key={lane} aria-label={`Lane ${lane}`} className="mt-4">
            <h4 className="ph-ui text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ph-ink-muted)]">
              Lane {lane}
            </h4>
            <ul className="mt-2 divide-y divide-[var(--ph-line)] rounded-xl border border-[var(--ph-line)]">
              {golfers.map((golfer) => {
                const golferStatus = status[golfer.id];
                const name = `${golfer.firstName} ${golfer.lastName}`;
                return (
                  <li key={golfer.id} className="flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap">
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <p className="truncate text-[15px] font-semibold">{name}</p>
                      <p className="text-xs text-[var(--ph-ink-muted)]">{golfer.team}</p>
                    </div>
                    <StatusToggle
                      pressed={golferStatus.waiverSigned}
                      onClick={() => toggle(golfer.id, 'waiverSigned')}
                      label={`Waiver for ${name}`}
                      onText="Waiver signed"
                      offText="Waiver"
                      kind="waiver"
                    />
                    <StatusToggle
                      pressed={golferStatus.checkedIn}
                      onClick={() => toggle(golfer.id, 'checkedIn')}
                      label={`Check in ${name}`}
                      onText="Checked in"
                      offText="Check in"
                      kind="checkin"
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function StatusToggle({
  pressed,
  onClick,
  label,
  onText,
  offText,
  kind,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  onText: string;
  offText: string;
  kind: 'waiver' | 'checkin';
}) {
  const OffIcon = kind === 'waiver' ? FileSignature : UserCheck;
  const onClass =
    kind === 'checkin'
      ? 'border-[var(--ph-evergreen)] bg-[var(--ph-evergreen)] text-white'
      : 'border-[#c9b48a] bg-[#f6efdf] text-[#5c4413]';
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors duration-150 motion-safe:transition-[color,background-color,border-color,transform] motion-safe:active:scale-[0.97] sm:flex-none ${
        pressed ? onClass : 'border-[var(--ph-line)] bg-white text-[var(--ph-ink)] hover:border-[#cfc6b2]'
      }`}
    >
      {pressed ? <Check aria-hidden="true" className="h-4 w-4" /> : <OffIcon aria-hidden="true" className="h-4 w-4" />}
      <span className="whitespace-nowrap">{pressed ? onText : offText}</span>
    </button>
  );
}
