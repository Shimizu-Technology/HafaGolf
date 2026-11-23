import { useState } from 'react';
import { LiabilityWaiver } from '../LiabilityWaiver';
import { SettingsCheckbox, SettingsInput, SettingsSection, SettingsSelect, SettingsTextarea, settingsButton } from './SettingsFields';
import type { RegistrationMode, TournamentDraftProps } from './settingsForm';

export function RegistrationAndWaiverTab({ tournamentSettings: event, handleTournamentChange: change, organizationName, sponsorReservedTeams, sponsorReservedSlots }: TournamentDraftProps & {
  organizationName: string;
  sponsorReservedTeams: number;
  sponsorReservedSlots: number;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const entryUnit = event.capacity_unit === 'teams' && Number(event.team_size) > 1 ? 'team' : 'player';
  const reserved = event.capacity_unit === 'players' ? sponsorReservedSlots : sponsorReservedTeams;

  return (
    <>
      <SettingsSection title="Registration">
        <SettingsSelect label="Who can register" value={event.registration_mode}
          onChange={(input) => change('registration_mode', input.target.value as RegistrationMode)}>
          <option value="regular">Online registration is open</option>
          <option value="walkin">Walk-ins only</option>
          <option value="closed">Registration is closed</option>
        </SettingsSelect>
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label={`Entry fee per ${entryUnit} ($)`} type="number" min={0} step="0.01" value={event.entry_fee_dollars}
            onChange={(value) => change('entry_fee_dollars', value)} help={entryUnit === 'team' ? 'One fee covers the whole team.' : 'Each entered player is charged this fee.'} />
          <SettingsInput label={`Employee entry fee per ${entryUnit} ($)`} type="number" min={0} step="0.01" value={event.employee_entry_fee_dollars}
            onChange={(value) => change('employee_entry_fee_dollars', value)} help="Applies when employee discounts are enabled below and the employee number is verified." />
          <SettingsInput label="How to show the entry fee on the event page" value={event.entry_fee_display}
            placeholder={`e.g. $150 per ${entryUnit}`} onChange={(value) => change('entry_fee_display', value)}
            help="This text does not change the amount charged." />
          <SettingsInput label="Online registration deadline" type="datetime-local" value={event.registration_deadline.slice(0, 16)}
            onChange={(value) => change('registration_deadline', value)} />
          {event.registration_mode === 'walkin' && (
            <SettingsInput label={`Walk-in fee per ${entryUnit} ($)`} type="number" min={0} step="0.01" value={event.walkin_fee}
              onChange={(value) => change('walkin_fee', value)} />
          )}
        </div>
        <SettingsInput label="What the entry fee includes" value={event.fee_includes} onChange={(value) => change('fee_includes', value)} />
      </SettingsSection>
      <SettingsSection title="Teams, capacity, and waitlist">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsSelect label="Team size" value={event.team_size} onChange={(input) => change('team_size', input.target.value)}>
            <option value="1">1 player</option>
            <option value="2">2 players</option>
            <option value="4">4 players</option>
          </SettingsSelect>
          <SettingsSelect label="Count capacity by" value={event.capacity_unit}
            onChange={(input) => change('capacity_unit', input.target.value as 'players' | 'teams')}>
            <option value="players">Players</option>
            <option value="teams">Teams</option>
          </SettingsSelect>
        </div>
        {Number(event.team_size) > 1 && (
          <SettingsCheckbox label="Allow teams to sign up with fewer players" checked={event.allow_partial_teams}
            onChange={(value) => change('allow_partial_teams', value)} />
        )}
        <SettingsInput label={`Maximum capacity (${event.capacity_unit})`} type="number" min={1} value={event.max_capacity}
          onChange={(value) => change('max_capacity', value)}
          help={reserved > 0 && event.max_capacity
            ? `${reserved} reserved for sponsors · ${Math.max(0, Number(event.max_capacity) - reserved)} available for public registration`
            : 'Leave blank for no capacity limit.'} />
        {event.registration_mode !== 'closed' && (
          <>
            <SettingsCheckbox label="Let people join a waitlist when the event is full" checked={event.waitlist_enabled}
              onChange={(value) => change('waitlist_enabled', value)} />
            {event.waitlist_enabled && <SettingsInput label="Waitlist limit" type="number" min={1} value={event.waitlist_max}
              onChange={(value) => change('waitlist_max', value)} help="Leave blank for no limit." />}
          </>
        )}
      </SettingsSection>
      <SettingsSection title="Liability waiver">
        <SettingsCheckbox label="Require a waiver for every player" checked={event.waiver_enabled}
          onChange={(value) => change('waiver_enabled', value)} />
        {event.waiver_enabled && (
          <>
            <SettingsTextarea label="Custom waiver text" rows={5} value={event.waiver_text} onChange={(value) => change('waiver_text', value)}
              help="Leave this blank to use the standard waiver with your organization’s name." />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={settingsButton} aria-expanded={showPreview}
                onClick={() => setShowPreview((current) => !current)}>{showPreview ? 'Hide preview' : 'Preview waiver'}</button>
              <button type="button" className={settingsButton} disabled={!event.waiver_text}
                onClick={() => change('waiver_text', '')}>Reset to default</button>
            </div>
            {showPreview && <LiabilityWaiver organizationName={organizationName} waiverText={event.waiver_text} />}
          </>
        )}
      </SettingsSection>
    </>
  );
}
