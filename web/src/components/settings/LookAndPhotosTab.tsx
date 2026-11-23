import { BrandingMediaPanel, type StoryPhotoDraft } from '../BrandingMediaPanel';
import { HomepageStudio } from './HomepageStudio';
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
      <SettingsSection
        title="Homepage Studio"
        description="Configure your public theme archetype, hero artwork mode, landing behavior, and visible sections with a live preview before saving."
      >
        <HomepageStudio
          orgName={draft.name}
          orgConfig={draft.homepage_config}
          eventConfig={eventDraft ? eventDraft.homepage_config : undefined}
          themePreset={eventDraft?.theme_preset}
          primaryColor={eventDraft && !eventDraft.use_org_branding ? eventDraft.primary_color_override || draft.primary_color : draft.primary_color}
          accentColor={eventDraft && !eventDraft.use_org_branding ? eventDraft.accent_color_override || draft.accent_color : draft.accent_color}
          logoUrl={draft.logo_url}
          reversedLogoUrl={draft.reversed_logo_url}
          commemorativeBannerUrl={eventDraft?.commemorative_banner_url}
          eventPhotoUrl={eventDraft?.banner_url_override}
          emblemUrl={eventDraft?.signature_image_url_override}
          eventName={eventDraft?.name}
          eventDate={eventDraft?.event_date}
          locationName={eventDraft?.location_name}
          entryFeeLabel={eventDraft?.entry_fee_display || (eventDraft?.entry_fee_dollars ? `$${eventDraft.entry_fee_dollars}` : undefined)}
          tributeTitle={eventDraft?.tribute_title}
          tributeSubtitle={eventDraft?.tribute_subtitle}
          onChangeOrgConfig={(homepage_config) => update({ homepage_config })}
          onChangeEventConfig={
            eventDraft
              ? (homepage_config, nextThemePreset) =>
                  updateEvent({
                    homepage_config,
                    ...(nextThemePreset ? { theme_preset: nextThemePreset } : {}),
                  })
              : undefined
          }
        />
      </SettingsSection>

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
