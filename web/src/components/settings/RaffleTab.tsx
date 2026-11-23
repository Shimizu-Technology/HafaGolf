import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SettingsCheckbox, SettingsInput, SettingsSection, SettingsTextarea, settingsButton } from './SettingsFields';
import { asCents, type TournamentDraftProps, type RaffleBundleDef } from './settingsForm';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function BundlePrice({ index, priceCents, onChange }: { index: number; priceCents: number; onChange: (value: number) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <SettingsInput label={`Bundle ${index + 1} price ($)`} type="number" min={0} step="0.01"
      value={typing ?? (priceCents / 100).toFixed(2)}
      onBlur={() => setTyping(null)}
      onChange={(value) => {
        setTyping(value);
        onChange(asCents(value) ?? 0);
      }} />
  );
}

export function RaffleTab({ tournamentSettings: event, handleTournamentChange: change }: TournamentDraftProps) {
  function updateBundle(index: number, patch: Partial<RaffleBundleDef>) {
    change('raffle_bundles', event.raffle_bundles.map((bundle, i) => {
      if (i !== index) return bundle;
      const updated = { ...bundle, ...patch };
      return { ...updated, label: `${currency.format(updated.price_cents / 100)} for ${updated.quantity} tickets` };
    }));
  }

  return (
    <>
      <SettingsSection title="Event raffle">
        <SettingsCheckbox label="Enable the raffle for this event" checked={event.raffle_enabled}
          onChange={(value) => change('raffle_enabled', value)} />
        {event.raffle_enabled && (
          <>
            <SettingsTextarea label="Raffle description" rows={3} value={event.raffle_description}
              onChange={(value) => change('raffle_description', value)} />
            <SettingsCheckbox label="Let players buy raffle tickets during registration" checked={event.raffle_include_with_registration}
              onChange={(value) => change('raffle_include_with_registration', value)} />
            <SettingsCheckbox label="Keep the winner on the banquet screen" checked={event.raffle_hold_winner_on_screen}
              onChange={(value) => change('raffle_hold_winner_on_screen', value)}
              help="Leave the winner visible until you clear the screen or draw again." />
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsInput label="Price per ticket ($)" type="number" min={0} step="0.01" value={event.raffle_ticket_price_dollars}
                onChange={(value) => change('raffle_ticket_price_dollars', value)} />
              <SettingsInput label="Draw date and time" type="datetime-local" value={event.raffle_draw_time.slice(0, 16)}
                onChange={(value) => change('raffle_draw_time', value)} />
            </div>
          </>
        )}
      </SettingsSection>
      {event.raffle_enabled && (
        <SettingsSection title="Ticket bundles" description="Offer several tickets together for one price.">
          {event.raffle_bundles.map((bundle, index) => {
            const perTicket = bundle.price_cents / Math.max(1, bundle.quantity) / 100;
            return (
              <div key={index} className="space-y-2 rounded-xl border border-gray-200 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <SettingsInput label={`Bundle ${index + 1} ticket count`} type="number" min={1} value={bundle.quantity}
                    onChange={(value) => updateBundle(index, { quantity: Math.max(1, parseInt(value, 10) || 1) })} />
                  <BundlePrice index={index} priceCents={bundle.price_cents} onChange={(price_cents) => updateBundle(index, { price_cents })} />
                  <button type="button" className={settingsButton} aria-label={`Remove bundle ${index + 1}`}
                    onClick={() => change('raffle_bundles', event.raffle_bundles.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="text-sm text-gray-600">
                  {currency.format(perTicket)} per ticket
                  {perTicket > Number(event.raffle_ticket_price_dollars) && ' · Costs more per ticket than buying individually.'}
                </p>
              </div>
            );
          })}
          <button type="button" className={settingsButton} onClick={() => change('raffle_bundles', [
            ...event.raffle_bundles, { quantity: 10, price_cents: 5000, label: '' },
          ])}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add bundle
          </button>
        </SettingsSection>
      )}
    </>
  );
}
