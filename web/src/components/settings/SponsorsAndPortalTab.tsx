import { SponsorTiersAdminPanel } from '../SponsorTiersAdminPanel';
import { SettingsCheckbox, SettingsInput, SettingsSection } from './SettingsFields';
import { SponsorTierEditor } from './SponsorTierEditor';
import type { OrganizationDraft, TournamentDraftProps, UpdateOrganization } from './settingsForm';

export function SponsorsAndPortalTab({ draft, update, organizationSlug, event }: {
  draft: OrganizationDraft;
  update: UpdateOrganization;
  organizationSlug: string;
  event: TournamentDraftProps | null;
}) {
  const settings = event?.tournamentSettings;
  const change = event?.handleTournamentChange;

  return (
    <>
      <SettingsSection title="Public sponsor display">
        <SettingsCheckbox label="Show featured sponsors on the organization homepage" checked={draft.show_homepage_sponsors}
          onChange={(show_homepage_sponsors) => update({ show_homepage_sponsors })} />
        {settings && change && (
          <>
            <SettingsCheckbox label="Show sponsors on the event page" checked={settings.show_public_sponsors}
              onChange={(value) => change('show_public_sponsors', value)} />
            <SettingsInput label="Sponsor section title" value={settings.sponsor_wall_title} placeholder="Our Sponsors"
              onChange={(value) => change('sponsor_wall_title', value)} />
          </>
        )}
      </SettingsSection>
      {settings && change && (
        <>
          <SettingsSection title="Sponsor portal" description="Sponsors can use their invitation link to enter player names and details.">
            <SettingsInput label="Deadline for sponsors to edit their teams" type="datetime-local"
              value={settings.sponsor_edit_deadline.slice(0, 16)} onChange={(value) => change('sponsor_edit_deadline', value)}
              help="After this time, sponsors need to contact you to make changes." />
          </SettingsSection>
          <SettingsSection title="Sponsor display tiers">
            <SponsorTierEditor tiers={settings.sponsor_tiers} onChange={(tiers) => change('sponsor_tiers', tiers)} />
          </SettingsSection>
          <SponsorTiersAdminPanel tournamentId={settings.id} orgSlug={organizationSlug} tournamentSlug={settings.slug} />
        </>
      )}
    </>
  );
}
