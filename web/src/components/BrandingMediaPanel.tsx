import { createStoryPhotoId } from '../utils/storyPhotoDraft';
import { useId } from 'react';
import { Images, Plus, Trash2 } from 'lucide-react';
import type { StoryPhoto } from '../services/api';
import { ImageUpload } from './ImageUpload';

export interface OrganizationMedia {
  logo_url: string;
  reversed_logo_url: string;
}

export interface StoryPhotoDraft extends StoryPhoto {
  draftId: string;
}

export interface TournamentMedia {
  banner_url_override: string;
  signature_image_url_override: string;
  commemorative_banner_url: string;
  tribute_title: string;
  tribute_subtitle: string;
  story_photos: StoryPhotoDraft[];
}

interface BrandingMediaPanelProps {
  organization: OrganizationMedia;
  tournament: TournamentMedia | null;
  onOrganizationChange: (patch: Partial<OrganizationMedia>) => void;
  onTournamentChange: (patch: Partial<TournamentMedia>) => void;
  onStoryPhotosChange: (update: (photos: StoryPhotoDraft[]) => StoryPhotoDraft[]) => void;
  getToken: () => Promise<string | null>;
  onUploadStateChange?: (uploading: boolean) => void;
  uploadsPending?: boolean;
}

const INPUT_CLASS = 'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand-500';

export function BrandingMediaPanel({
  organization, tournament, onOrganizationChange, onTournamentChange, onStoryPhotosChange, getToken, onUploadStateChange, uploadsPending,
}: BrandingMediaPanelProps) {
  const fieldId = useId();

  function updatePhoto(draftId: string, patch: Partial<StoryPhoto>) {
    onStoryPhotosChange((photos) => photos.map((photo) => photo.draftId === draftId ? { ...photo, ...patch } : photo));
  }

  return (
    <section aria-labelledby={fieldId} className="space-y-5 rounded-xl bg-white p-4 shadow-sm sm:p-6">
      <h2 id={fieldId} className="flex items-center gap-2 text-base font-semibold text-gray-900 sm:text-lg">
        <Images className="h-5 w-5 text-gray-400" aria-hidden="true" />
        Branding &amp; Photos
      </h2>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-gray-900">Organization logos</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageUpload label="Organization Logo" value={organization.logo_url} getToken={getToken} onUploadStateChange={onUploadStateChange}
            onChange={(url) => onOrganizationChange({ logo_url: url })} />
          <ImageUpload label="Reversed Logo" value={organization.reversed_logo_url} getToken={getToken} onUploadStateChange={onUploadStateChange}
            onChange={(url) => onOrganizationChange({ reversed_logo_url: url })}
            previewBackgroundClassName="bg-slate-900"
            helpText="Use a light version of your logo for photo backgrounds." />
        </div>
      </fieldset>

      {tournament && (
        <>
          <fieldset className="space-y-4">
            <legend className="mb-3 text-sm font-semibold text-gray-900">Event artwork &amp; tribute</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageUpload label="Event Hero Photo or Banner" value={tournament.banner_url_override} getToken={getToken} onUploadStateChange={onUploadStateChange}
                onChange={(url) => onTournamentChange({ banner_url_override: url })} />
              <ImageUpload label="Tribute or Secondary Emblem" value={tournament.signature_image_url_override} getToken={getToken} onUploadStateChange={onUploadStateChange}
                onChange={(url) => onTournamentChange({ signature_image_url_override: url })} />
              <div className="sm:col-span-2">
                <ImageUpload label="Commemorative Banner" value={tournament.commemorative_banner_url} getToken={getToken} onUploadStateChange={onUploadStateChange}
                  onChange={(url) => onTournamentChange({ commemorative_banner_url: url })} />
              </div>
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Tribute Title</span>
                <input className={INPUT_CLASS} value={tournament.tribute_title}
                  onChange={(event) => onTournamentChange({ tribute_title: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Tribute Subtitle</span>
                <input className={INPUT_CLASS} value={tournament.tribute_subtitle}
                  onChange={(event) => onTournamentChange({ tribute_subtitle: event.target.value })} />
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-900">Story photos</legend>
            <p className="text-sm text-gray-600">Add up to three photos for the Charity Bright event page.</p>
            {tournament.story_photos.map((photo, index) => (
              <div key={photo.draftId} className="space-y-3 rounded-xl border border-gray-200 p-3 sm:p-4">
                <ImageUpload label={`Story Photo ${index + 1}`} value={photo.url} getToken={getToken} onUploadStateChange={onUploadStateChange}
                  onChange={(url) => updatePhoto(photo.draftId, { url })} />
                <label className="block space-y-1 text-sm font-medium text-gray-700">
                  <span>Caption for Story Photo {index + 1}</span>
                  <input className={INPUT_CLASS} value={photo.caption ?? ''}
                    onChange={(event) => updatePhoto(photo.draftId, { caption: event.target.value })} />
                </label>
                <button type="button" className="inline-flex min-h-[48px] items-center gap-2 text-sm font-medium text-red-700 hover:underline"
                  disabled={uploadsPending}
                  onClick={() => onStoryPhotosChange((photos) => photos.filter((item) => item.draftId !== photo.draftId))}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove story photo {index + 1}
                </button>
              </div>
            ))}
            {tournament.story_photos.length < 3 && (
              <button type="button" className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-medium text-brand-700 hover:bg-brand-50"
                onClick={() => onStoryPhotosChange((photos) => photos.length < 3
                  ? [...photos, { draftId: createStoryPhotoId(), url: '', caption: '' }] : photos)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add story photo
              </button>
            )}
          </fieldset>
        </>
      )}
    </section>
  );
}
