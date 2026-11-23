import { OrgPaymentConfigPanel } from '../OrgPaymentConfigPanel';
import { SettingsCheckbox, SettingsInput, SettingsSection, SettingsTextarea } from './SettingsFields';
import type { TournamentDraftProps } from './settingsForm';

export function PaymentsAndPayoutsTab({ organizationSlug, event, onPaymentDirtyChange }: {
  organizationSlug: string;
  event: TournamentDraftProps | null;
  onPaymentDirtyChange: (dirty: boolean) => void;
}) {
  return (
    <>
      <OrgPaymentConfigPanel organizationSlug={organizationSlug} onDirtyChange={onPaymentDirtyChange} />
      {event && <EventPaymentSettings {...event} />}
    </>
  );
}

function EventPaymentSettings({ tournamentSettings: event, handleTournamentChange: change }: TournamentDraftProps) {
  return (
    <>
      <SettingsSection title="Event payment links" description="These links apply to this event. Use Payments & Processor Mode above to set the default for all events.">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Online registration payment link" type="url" value={event.swipe_simple_url} onChange={(value) => change('swipe_simple_url', value)} />
          <SettingsInput label="Walk-in payment link" type="url" value={event.walkin_swipe_simple_url} onChange={(value) => change('walkin_swipe_simple_url', value)} />
        </div>
        <SettingsTextarea label="Payment instructions" rows={3} value={event.payment_instructions} onChange={(value) => change('payment_instructions', value)} />
      </SettingsSection>
      <SettingsSection title="Tax receipts" description="Add the information to include on eligible receipts.">
        <SettingsCheckbox label="Include tax receipt information" checked={event.tax_receipt_enabled}
          onChange={(value) => change('tax_receipt_enabled', value)} />
        {event.tax_receipt_enabled && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsInput label="Legal organization name" value={event.tax_org_name} onChange={(value) => change('tax_org_name', value)} />
              <SettingsInput label="Federal tax ID (EIN)" placeholder="12-3456789" value={event.tax_org_ein}
                onChange={(value) => change('tax_org_ein', value)} />
              <SettingsInput label="Fair market value per player ($)" type="number" min={0} step="0.01" value={event.fmv_per_player_dollars}
                onChange={(value) => change('fmv_per_player_dollars', value)}
                help="The value of golf, meals, and other benefits a player receives." />
            </div>
            <SettingsTextarea label="Extra note on tax receipts" rows={3} value={event.tax_receipt_disclaimer}
              onChange={(value) => change('tax_receipt_disclaimer', value)} />
          </>
        )}
      </SettingsSection>
    </>
  );
}
