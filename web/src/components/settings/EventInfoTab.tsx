import { Plus, X } from 'lucide-react';
import { SettingsCheckbox, SettingsInput, SettingsSection, SettingsTextarea, settingsButton } from './SettingsFields';
import { clampCourseHoleCount, createCourseConfig, MAX_COURSE_HOLES, type OrganizationDraft, type TournamentDraftProps, type UpdateOrganization } from './settingsForm';

export function EventInfoTab({ draft, update, event }: {
  draft: OrganizationDraft;
  update: UpdateOrganization;
  event: TournamentDraftProps | null;
}) {
  return (
    <>
      <SettingsSection title="Organization">
        <SettingsInput label="Organization name" required value={draft.name} onChange={(name) => update({ name })} />
        <SettingsInput label="Organization web address" required value={draft.slug}
          help="Use letters, numbers, and hyphens. Changing this can break links you’ve shared."
          onChange={(value) => update({ slug: value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Organization email" type="email" value={draft.contact_email} onChange={(contact_email) => update({ contact_email })} />
          <SettingsInput label="Organization phone" type="tel" value={draft.contact_phone} onChange={(contact_phone) => update({ contact_phone })} />
          <SettingsInput label="Organization website" type="url" value={draft.website_url} onChange={(website_url) => update({ website_url })} />
        </div>
      </SettingsSection>
      {event && <EventDetails {...event} />}
      <SettingsSection title="Public events homepage">
        <SettingsInput label="Tagline" value={draft.homepage_tagline} onChange={(homepage_tagline) => update({ homepage_tagline })} />
        <SettingsTextarea label="Mission statement" rows={3} value={draft.homepage_mission} onChange={(homepage_mission) => update({ homepage_mission })} />
        <fieldset className="space-y-3">
          <legend className="font-medium text-gray-900">Homepage highlights</legend>
          <p className="text-sm text-gray-600">Show up to four facts, such as the number of events you’ve hosted.</p>
          {draft.homepage_stats.map((stat, index) => (
            <div key={index} className="grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <SettingsInput label={`Value for highlight ${index + 1}`} value={stat.value}
                onChange={(value) => update({ homepage_stats: draft.homepage_stats.map((item, i) => i === index ? { ...item, value } : item) })} />
              <SettingsInput label={`Label for highlight ${index + 1}`} value={stat.label}
                onChange={(label) => update({ homepage_stats: draft.homepage_stats.map((item, i) => i === index ? { ...item, label } : item) })} />
              {draft.homepage_stats.length > 1 && (
                <button type="button" aria-label={`Remove highlight ${index + 1}`} className={settingsButton}
                  onClick={() => update({ homepage_stats: draft.homepage_stats.filter((_, i) => i !== index) })}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {draft.homepage_stats.length < 4 && (
            <button type="button" className={settingsButton}
              onClick={() => update({ homepage_stats: [...draft.homepage_stats, { value: '', label: '' }] })}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add highlight
            </button>
          )}
        </fieldset>
      </SettingsSection>
      <SettingsSection title="Off-season page" description="This page appears when you turn on off-season mode in Event Features below.">
        <SettingsInput label="Page title" value={draft.offseason_title} onChange={(offseason_title) => update({ offseason_title })} />
        <SettingsTextarea label="Message to visitors" rows={3} value={draft.offseason_message} onChange={(offseason_message) => update({ offseason_message })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Link label" value={draft.offseason_cta_label} onChange={(offseason_cta_label) => update({ offseason_cta_label })} />
          <SettingsInput label="Link address" type="url" value={draft.offseason_cta_url} onChange={(offseason_cta_url) => update({ offseason_cta_url })} />
        </div>
      </SettingsSection>
    </>
  );
}

function EventDetails({ tournamentSettings: event, handleTournamentChange: change }: TournamentDraftProps) {
  return (
    <>
      <SettingsSection title="Tournament">
        <SettingsInput label="Event name" required value={event.name} onChange={(value) => change('name', value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Event date" type="date" value={event.event_date.slice(0, 10)} onChange={(value) => change('event_date', value)} />
          <SettingsInput label="Format name" value={event.format_name} onChange={(value) => change('format_name', value)} />
          <SettingsInput label="Venue name" value={event.location_name} onChange={(value) => change('location_name', value)} />
          <SettingsInput label="Venue address" value={event.location_address} onChange={(value) => change('location_address', value)} />
        </div>
        <p className="text-sm text-gray-600">
          Scoring format <strong className="capitalize">{event.tournament_format?.replace(/_/g, ' ') || 'Scramble'}</strong>. Contact support to change it.
        </p>
        <SettingsCheckbox
          label="Show on HafaGolf public directory"
          checked={event.directory_listed}
          onChange={(value) => change('directory_listed', value)}
          help={
            event.public_listed
              ? 'Display this tournament on golf.shimizu-technology.com so golfers can discover it and click through to your site. Only published events with a configured web domain appear.'
              : 'This tournament is currently unlisted on its own site (public_listed is off), so it will not appear in the HafaGolf directory until public listing is enabled.'
          }
        />
      </SettingsSection>
      <SettingsSection title="Schedule and event details">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Check-in time" value={event.check_in_time} onChange={(value) => change('check_in_time', value)} />
          <SettingsInput label="Start time" value={event.start_time} onChange={(value) => change('start_time', value)} />
        </div>
        <SettingsTextarea label="Event schedule" rows={3} value={event.event_schedule}
          onChange={(value) => change('event_schedule', value)} />
        <SettingsTextarea label="About the event" rows={4} value={event.tournament_info}
          onChange={(value) => change('tournament_info', value)} />
      </SettingsSection>
      <SettingsSection title="Event contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Contact person" value={event.contact_name} onChange={(value) => change('contact_name', value)} />
          <SettingsInput label="Event phone" type="tel" value={event.contact_phone} onChange={(value) => change('contact_phone', value)} />
          <SettingsInput label="Event email" type="email" value={event.contact_email} onChange={(value) => change('contact_email', value)} />
        </div>
      </SettingsSection>
      <SettingsSection title="Starting courses" description="Set up the courses and starting slots used for groups and check-in.">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Teams per starting slot" type="number" min={1} max={4}
            value={event.teams_per_start_position} onChange={(value) => change('teams_per_start_position', value)}
            help={`${Number(event.team_size) * Number(event.teams_per_start_position)} players per starting slot.`} />
          <SettingsInput label="Starting slots per hole" type="number" min={1} max={26} placeholder="Unlimited"
            value={event.start_positions_per_hole} onChange={(value) => change('start_positions_per_hole', value)}
            help="Leave blank to allow as many slots as needed." />
        </div>
        {event.course_configs.map((course, index) => (
          <div key={course.key} className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <SettingsInput label={`Course ${index + 1} name`} value={course.name}
              onChange={(name) => change('course_configs', event.course_configs.map((item) => item.key === course.key ? { ...item, name } : item))} />
            <SettingsInput label="Holes" type="number" min={1} max={MAX_COURSE_HOLES} value={course.hole_count}
              onChange={(value) => change('course_configs', event.course_configs.map((item) => item.key === course.key
                ? { ...item, hole_count: clampCourseHoleCount(Number(value)) } : item))} />
            <button type="button" aria-label={`Remove course ${index + 1}`} className={settingsButton}
              disabled={event.course_configs.length <= 1}
              onClick={() => change('course_configs', event.course_configs.filter((item) => item.key !== course.key))}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button type="button" className={settingsButton}
          onClick={() => change('course_configs', [...event.course_configs, createCourseConfig()])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add course
        </button>
      </SettingsSection>
    </>
  );
}
