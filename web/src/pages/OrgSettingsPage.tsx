import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams, type BlockerFunction } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganization } from '../components/OrganizationProvider';
import { OrgFeaturesPanel } from '../components/OrgFeaturesPanel';
import type { StoryPhotoDraft } from '../components/BrandingMediaPanel';
import { EventInfoTab } from '../components/settings/EventInfoTab';
import { LookAndPhotosTab } from '../components/settings/LookAndPhotosTab';
import { PaymentsAndPayoutsTab } from '../components/settings/PaymentsAndPayoutsTab';
import { RaffleTab } from '../components/settings/RaffleTab';
import { RegistrationAndWaiverTab } from '../components/settings/RegistrationAndWaiverTab';
import { SettingsTabs, type SettingsTab } from '../components/settings/SettingsTabs';
import { SponsorsAndPortalTab } from '../components/settings/SponsorsAndPortalTab';
import { TeamAccessPanel } from '../components/settings/TeamAccessPanel';
import {
  changedFields, loadEventSettings, organizationDraft, organizationPayload, tournamentPayload,
  type OrganizationDraft, type TournamentSettings,
} from '../components/settings/settingsForm';
import { useTournament } from '../contexts';
import { useAuthToken } from '../hooks/useAuthToken';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useOrganizationStore, type Organization } from '../stores/organizationStore';
import type { FeatureKey, OrganizationFeaturesResponse } from '../utils/features';

const eventFeatures = ['offseason_mode', 'live_scoring'] as const;
const registrationFeatures = ['employee_pricing', 'checkin_alpha_lanes', 'walkin_registration', 'waitlist'] as const;
const sponsorFeatures = ['sponsors', 'sponsor_checkout'] as const;
const paymentFeatures = ['donations', 'tax_receipts'] as const;
const raffleFeatures = ['raffle'] as const;
const validColor = /^#[0-9a-f]{6}$/i;
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validUrl = /^https?:\/\/[^\s]+$/i;

export function OrgSettingsPage() {
  const { organization } = useOrganization();
  const { tournamentSlug } = useParams<{ tournamentSlug: string }>();
  if (!organization) {
    return <p className="p-6 text-gray-700">Choose an organization to open its settings.</p>;
  }

  return <SettingsWorkspace key={`${organization.id}/${tournamentSlug ?? ''}`}
    organization={organization} tournamentSlug={tournamentSlug} />;
}

const VALID_SETTINGS_TABS: SettingsTab[] = ['event', 'look', 'registration', 'sponsors', 'payments', 'raffle'];

function SettingsWorkspace({ organization, tournamentSlug }: { organization: Organization; tournamentSlug?: string }) {
  const [searchParams] = useSearchParams();
  const initialTabParam = searchParams.get('tab') as SettingsTab | null;
  const initialTab: SettingsTab = initialTabParam && VALID_SETTINGS_TABS.includes(initialTabParam) ? initialTabParam : 'event';
  const { refreshTournaments } = useTournament();
  const { getToken } = useAuthToken();
  const [initialOrgSlug] = useState(organization.slug);
  const [draft, setDraft] = useState(() => organizationDraft(organization));
  const [savedDraft, setSavedDraft] = useState(draft);
  const [eventDraft, setEventDraft] = useState<TournamentSettings | null>(null);
  const [savedEvent, setSavedEvent] = useState<TournamentSettings | null>(null);
  const [eventDetails, setEventDetails] = useState<Awaited<ReturnType<typeof loadEventSettings>>>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [paymentsDirty, setPaymentsDirty] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const uploadsRef = useRef(0);
  const saveRef = useRef(false);
  const loadedEvent = useRef(false);
  const startSave = useLatestRequest();
  const uploadsPending = pendingUploads > 0;
  const dirty = Object.keys(changedFields(draft, savedDraft)).length > 0
    || Boolean(eventDraft && savedEvent && Object.keys(changedFields(eventDraft, savedEvent)).length);
  const protectEdits = dirty || uploadsPending || paymentsDirty;

  const request = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const token = await getToken();
    options?.signal?.throwIfAborted();
    if (!token) throw new Error('Please sign in to manage settings.');
    const response = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.errors?.join(', ') || data.error || 'Could not complete this request.');
    }
    return response.status === 204 ? undefined as T : response.json();
  }, [getToken]);

  useEffect(() => {
    if (loadedEvent.current) return;
    const load = new AbortController();
    setLoadError('');
    void loadEventSettings((path, options) => request(path, { ...options, signal: load.signal }), initialOrgSlug, tournamentSlug)
      .then((result) => {
        if (load.signal.aborted) return;
        loadedEvent.current = true;
        setEventDetails(result);
        setEventDraft(result?.draft ?? null);
        setSavedEvent(result?.draft ?? null);
      })
      .catch(() => {
        if (!load.signal.aborted) setLoadError('Could not load event settings. Reload the page to try again.');
      })
      .finally(() => { if (!load.signal.aborted) setLoading(false); });
    return () => load.abort();
  }, [initialOrgSlug, request, tournamentSlug]);

  const blocker = useBlocker(useCallback<BlockerFunction>(({ currentLocation, nextLocation }) =>
    protectEdits && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  [protectEdits]));

  useEffect(() => {
    if (blocker.state === 'blocked' && !saving && !protectEdits) blocker.proceed();
  }, [blocker, protectEdits, saving]);

  useEffect(() => {
    if (!protectEdits) return;
    const handleUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [protectEdits]);

  const onUploadStateChange = useCallback((uploading: boolean) => {
    uploadsRef.current += uploading ? 1 : -1;
    setPendingUploads(uploadsRef.current);
  }, []);

  function updateOrganization(patch: Partial<OrganizationDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveError('');
  }

  function updateEvent(patch: Partial<TournamentSettings>) {
    setEventDraft((current) => current && { ...current, ...patch });
    setSaveError('');
  }

  function handleTournamentChange<K extends keyof TournamentSettings>(field: K, value: TournamentSettings[K]) {
    updateEvent({
      [field]: value,
      ...(field === 'registration_mode' && value === 'closed' ? { waitlist_enabled: false } : {}),
      ...(field === 'team_size' && value === '1' ? { allow_partial_teams: false } : {}),
    });
  }

  function updateStoryPhotos(update: (photos: StoryPhotoDraft[]) => StoryPhotoDraft[]) {
    setEventDraft((current) => current && { ...current, story_photos: update(current.story_photos) });
  }

  function onFeaturesUpdated(response: OrganizationFeaturesResponse) {
    const updated = response.tournaments.find((event) => event.id === eventDraft?.id);
    if (updated && savedEvent?.raffle_enabled === eventDraft?.raffle_enabled) {
      setEventDraft((current) => current && { ...current, raffle_enabled: updated.raffle_enabled });
      setSavedEvent((current) => current && { ...current, raffle_enabled: updated.raffle_enabled });
    }
    void refreshTournaments();
  }

  async function handleSave() {
    if (saveRef.current || uploadsRef.current || !dirty) return;
    const validation = validateDraft(draft, eventDraft);
    if (validation) {
      setActiveTab(validation.tab);
      setSaveError(validation.message);
      return;
    }
    const isCurrent = startSave();
    saveRef.current = true;
    setSaving(true);
    setSaveError('');

    try {
      const orgPayload = organizationPayload(draft);
      const savedOrgPayload = organizationPayload(savedDraft);
      const { settings, ...orgChanges } = changedFields(orgPayload, savedOrgPayload);
      const settingsChanges = settings ? changedFields(settings, savedOrgPayload.settings) : null;
      if (settingsChanges || Object.keys(orgChanges).length) {
        const { organization: latestOrganization } = useOrganizationStore.getState();
        const updated = await request<Organization>(`/api/v1/admin/organizations/${organization.slug}`, {
          method: 'PATCH',
          body: JSON.stringify({ organization: {
            ...orgChanges,
            ...(settingsChanges ? { settings: { ...(latestOrganization?.settings ?? organization.settings), ...settingsChanges } } : {}),
          } }),
        });
        if (!isCurrent()) return;
        const store = useOrganizationStore.getState();
        store.setOrganization(updated);
        store.setAccessibleOrganizations(store.accessibleOrganizations.map((item) => item.id === updated.id ? updated : item));
      }
      setSavedDraft(draft);

      if (eventDraft && savedEvent) {
        const eventChanges = changedFields(tournamentPayload(eventDraft), tournamentPayload(savedEvent));
        if (Object.keys(eventChanges).length) {
          await request(`/api/v1/tournaments/${eventDraft.id}`, {
            method: 'PATCH', body: JSON.stringify({ tournament: eventChanges }),
          });
          if (!isCurrent()) return;
          void refreshTournaments();
        }
        setSavedEvent(eventDraft);
      }
      toast.success('Settings saved');
    } catch (error) {
      if (isCurrent()) setSaveError(error instanceof Error ? error.message : 'Could not save settings.');
    } finally {
      if (isCurrent()) {
        saveRef.current = false;
        setSaving(false);
      }
    }
  }

  const event = eventDraft && { tournamentSettings: eventDraft, handleTournamentChange };
  const featurePanel = (title: string, keys: readonly FeatureKey[], forEvent = true) => (
    <OrgFeaturesPanel organizationSlug={organization.slug} featureKeys={keys}
      title={title} eventId={forEvent ? eventDraft?.id : undefined} onFeaturesUpdated={onFeaturesUpdated} />
  );
  const noEvent = <p className="rounded-xl bg-white p-4 text-gray-600">{loadError || 'Create or select an event to edit these settings.'}</p>;

  return (
    <div data-static-flow className="mx-auto mb-16 min-w-0 max-w-5xl lg:mb-0">
      {blocker.state === 'blocked' && !saving && protectEdits && (
        <ConfirmDialog title="Leave settings?"
          description={uploadsPending
            ? 'An image is still uploading. Leaving will cancel the upload and discard your unsaved changes.'
            : 'Your unsaved changes will be lost if you leave this page.'}
          confirmLabel="Discard and leave" tone="danger" onConfirm={blocker.proceed} onCancel={blocker.reset} />
      )}
      <header className="mb-5 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
        <Link to="/admin" className="inline-flex min-h-[48px] items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-gray-600">{organization.name}{eventDraft && ` · ${eventDraft.name}`}</p>
      </header>
      {loading ? (
        <p role="status" className="rounded-xl bg-white p-4 text-gray-700">Loading settings…</p>
      ) : (
        <>
          {loadError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{loadError}</p>}
          <fieldset disabled={saving} className="min-w-0 pb-5">
            <legend className="sr-only">Edit settings</legend>
            <SettingsTabs active={activeTab} onChange={setActiveTab} panels={{
              event: <>
                <EventInfoTab draft={draft} update={updateOrganization} event={event} />
                <TeamAccessPanel request={request} organizationSlug={organization.slug} />
                {featurePanel('Event features', eventFeatures, false)}
              </>,
              look: <LookAndPhotosTab draft={draft} update={updateOrganization} event={event}
                updateEvent={updateEvent} updateStoryPhotos={updateStoryPhotos}
                getToken={getToken} onUploadStateChange={onUploadStateChange} uploadsPending={uploadsPending} />,
              registration: <>
                {event && eventDetails ? <RegistrationAndWaiverTab {...event} organizationName={draft.name}
                  sponsorReservedTeams={eventDetails.sponsorReservedTeams} sponsorReservedSlots={eventDetails.sponsorReservedSlots} /> : noEvent}
                {featurePanel('Registration and check-in options', registrationFeatures)}
              </>,
              sponsors: <>
                <SponsorsAndPortalTab draft={draft} update={updateOrganization} organizationSlug={organization.slug} event={event} />
                {featurePanel('Sponsor options', sponsorFeatures)}
              </>,
              payments: <>
                <PaymentsAndPayoutsTab organizationSlug={organization.slug} event={event} onPaymentDirtyChange={setPaymentsDirty} />
                {featurePanel('Donation and receipt options', paymentFeatures)}
              </>,
              raffle: <>{event ? <RaffleTab {...event} /> : noEvent}{featurePanel('Raffle availability', raffleFeatures)}</>,
            }} />
          </fieldset>
          <div className="sticky bottom-16 z-20 rounded-t-xl border border-gray-200 bg-white p-3 shadow-lg sm:p-4 lg:bottom-0">
            {saveError && <p role="alert" className="mb-2 text-sm font-medium text-red-700">{saveError}</p>}
            <div className="flex items-center justify-between gap-3">
              <p role="status" className="text-sm font-medium text-gray-700">
                {saving ? 'Saving settings…' : uploadsPending ? 'Uploading images…' : dirty ? 'Unsaved changes'
                  : paymentsDirty ? 'Use Save Payment Settings for your payment changes.' : 'All changes saved'}
              </p>
              <button type="button" onClick={() => void handleSave()} disabled={saving || uploadsPending || !dirty}
                className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-semibold text-brand-foreground hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-600">
                <Save className="h-4 w-4" aria-hidden="true" /> Save changes
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function validateDraft(draft: OrganizationDraft, event: TournamentSettings | null): { tab: SettingsTab; message: string } | null {
  if (!draft.name.trim() || !draft.slug) return { tab: 'event', message: 'Enter an organization name and web address.' };
  if (event && !event.name.trim()) return { tab: 'event', message: 'Enter an event name.' };
  if ([draft.contact_email, event?.contact_email].some((value) => value && !validEmail.test(value))) {
    return { tab: 'event', message: 'Enter a valid contact email address.' };
  }
  if ([draft.website_url, draft.offseason_cta_url].some((url) => url && !validUrl.test(url))) {
    return { tab: 'event', message: 'Enter web addresses that start with https:// or http://.' };
  }
  if ([draft.primary_color, draft.accent_color, event?.primary_color_override, event?.accent_color_override]
    .some((color) => color?.trim() && !validColor.test(color.trim()))) {
    return { tab: 'look', message: 'Enter brand colors in the format #1E3A5F.' };
  }
  if (event && [event.entry_fee_dollars, event.employee_entry_fee_dollars, event.walkin_fee]
    .some((price) => price && (!Number.isFinite(Number(price)) || Number(price) < 0))) {
    return { tab: 'registration', message: 'Enter fees of zero or more.' };
  }
  if (event && (Number(event.raffle_ticket_price_dollars) < 0 || event.raffle_bundles.some((bundle) => bundle.price_cents < 0))) {
    return { tab: 'raffle', message: 'Enter raffle prices of zero or more.' };
  }
  return null;
}

export default OrgSettingsPage;
