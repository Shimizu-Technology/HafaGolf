/**
 * Returns the fallback organization slug used before host-based tenant
 * resolution (PR-1a) resolves the active organization from the request domain.
 */
export function getDefaultOrgSlug(): string {
  const configured = import.meta.env.VITE_DEFAULT_ORG_SLUG?.trim();
  return configured || 'default';
}
