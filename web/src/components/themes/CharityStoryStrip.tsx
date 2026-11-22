import type { StoryPhoto } from '../../services/api';
import { resolvePublicImageUrl } from '../../utils/branding';

export function CharityStoryStrip({ photos }: { photos?: StoryPhoto[] }) {
  if (!photos?.length) return null;

  return (
    <section aria-labelledby="event-story-heading" className="mx-auto max-w-5xl px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <h2 id="event-story-heading" className="mb-5 font-theme-heading text-2xl font-bold text-neutral-900">Story &amp; Impact</h2>
      <div className={`grid gap-4 ${photos.length === 2 ? 'sm:grid-cols-2' : photos.length === 3 ? 'sm:grid-cols-3' : 'max-w-2xl'}`}>
        {photos.map(({ url, caption }, index) => (
          <figure key={`${url}-${index}`} className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
            <img src={resolvePublicImageUrl(url) ?? undefined} alt={caption ? '' : 'Tournament story photo'}
              loading="lazy" className="aspect-[4/3] w-full bg-neutral-100 object-cover" />
            {caption && <figcaption className="break-words px-4 py-3 text-sm leading-relaxed text-neutral-700">{caption}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}
