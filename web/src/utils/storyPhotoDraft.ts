let nextStoryPhotoId = 0;

export function createStoryPhotoId() {
  return globalThis.crypto?.randomUUID?.() ?? `story-photo-${++nextStoryPhotoId}`;
}
