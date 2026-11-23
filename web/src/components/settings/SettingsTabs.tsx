import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

const tabs = [
  ['event', 'Event Info'],
  ['look', 'Look & Photos'],
  ['registration', 'Registration & Waiver'],
  ['sponsors', 'Sponsors & Portal'],
  ['payments', 'Payments & Payouts'],
  ['raffle', 'Raffle'],
] as const;

export type SettingsTab = typeof tabs[number][0];

export function SettingsTabs({ active, onChange, panels }: {
  active: SettingsTab;
  onChange: (tab: SettingsTab) => void;
  panels: Record<SettingsTab, ReactNode>;
}) {
  const id = useId();
  const [visited, setVisited] = useState<SettingsTab[]>([active]);

  function select(tab: SettingsTab) {
    setVisited((current) => current.includes(tab) ? current : [...current, tab]);
    onChange(tab);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const [tab] = tabs[next];
    select(tab);
    const button = document.getElementById(`${id}-tab-${tab}`);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <>
      <div role="tablist" aria-label="Settings sections" className="mb-5 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1">
        {tabs.map(([tab, label], index) => (
          <button key={tab} id={`${id}-tab-${tab}`} type="button" role="tab" aria-selected={tab === active}
            aria-controls={`${id}-panel-${tab}`} tabIndex={tab === active ? 0 : -1}
            className={`min-h-[48px] shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 ${tab === active ? 'bg-brand-600 text-brand-foreground' : 'text-gray-700 hover:bg-gray-100'}`}
            onClick={() => select(tab)} onKeyDown={(event) => handleKey(event, index)}>
            {label}
          </button>
        ))}
      </div>
      {tabs.map(([tab]) => (
        <div key={tab} id={`${id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}
          tabIndex={0} hidden={active !== tab} className="space-y-5">
          {(tab === active || visited.includes(tab)) && panels[tab]}
        </div>
      ))}
    </>
  );
}
