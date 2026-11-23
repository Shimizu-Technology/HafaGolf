import { BrandingMediaPanel, type StoryPhotoDraft } from '../BrandingMediaPanel';
import { ThemePackPicker } from '../ThemePackPicker';
import { SettingsCheckbox, SettingsInput, SettingsSection } from './SettingsFields';
import type { OrganizationDraft, TournamentDraftProps, TournamentSettings, UpdateOrganization } from './settingsForm';

export function LookAndPhotosTab({ draft, update, event, updateEvent, updateStoryPhotos, getToken, onUploadStateChange, uploadsPending }: {
  draft: OrganizationDraft;
  update: UpdateOrganization;
  event: TournamentDraftProps | null;
  updateEvent: (patch: Partial<TournamentSettings>) => void;
  updateStoryPhotos: (update: (photos: StoryPhotoDraft[]) => StoryPhotoDraft[]) => void;
  getToken: () => Promise<string | null>;
  onUploadStateChange: (uploading: boolean) => void;
  uploadsPending: boolean;
}) {
  const eventDraft = event?.tournamentSettings;
  return (
    <>
      {eventDraft && (
        <SettingsSection title="Public theme" description="Choose how the event page presents photos, event information, and registration.">
          <ThemePackPicker value={eventDraft.theme_preset} onChange={(theme_preset) => updateEvent({ theme_preset })}
            eventName={eventDraft.name} organizationName={draft.name} eventDateLabel={eventDraft.event_date}
            locationName={eventDraft.location_name} entryFeeLabel={eventDraft.entry_fee_display} />
        </SettingsSection>
      )}
      <SettingsSection title="Brand colors" description="Enter a six-digit color code, such as #1E3A5F. Leave a color blank to use the default.">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Organization main color" placeholder="#1E3A5F" value={draft.primary_color}
            onChange={(primary_color) => update({ primary_color })} />
          <SettingsInput label="Organization accent color" placeholder="#D0A24A" value={draft.accent_color}
            onChange={(accent_color) => update({ accent_color })} />
        </div>
        {eventDraft && (
          <>
            <SettingsCheckbox label="Use organization colors for this event" checked={eventDraft.use_org_branding}
              onChange={(use_org_branding) => updateEvent({ use_org_branding })}
              help="Use the organization’s branding on this event’s public pages." />
            {!eventDraft.use_org_branding && (
              <div className="grid gap-4 sm:grid-cols-2">
                <SettingsInput label="Event main color" value={eventDraft.primary_color_override}
                  onChange={(primary_color_override) => updateEvent({ primary_color_override })} />
                <SettingsInput label="Event accent color" value={eventDraft.accent_color_override}
                  onChange={(accent_color_override) => updateEvent({ accent_color_override })} />
              </div>
            )}
          </>
        )}
      </SettingsSection>
      <BrandingMediaPanel organization={draft} tournament={eventDraft ?? null}
        onOrganizationChange={update} onTournamentChange={updateEvent}
        onStoryPhotosChange={updateStoryPhotos} getToken={getToken}
        onUploadStateChange={onUploadStateChange} uploadsPending={uploadsPending} />
    </>
  );
}
