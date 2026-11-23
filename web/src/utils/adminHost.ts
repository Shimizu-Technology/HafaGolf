export const DEFAULT_ADMIN_ORIGIN = 'https://golf.shimizu-technology.com';

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function normalizeOrigin(raw?: string | null): string {
  const candidate = (raw || '').trim();
  if (!candidate) return DEFAULT_ADMIN_ORIGIN;

  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return DEFAULT_ADMIN_ORIGIN;
    }
    return parsed.origin;
  } catch {
    return DEFAULT_ADMIN_ORIGIN;
  }
}

export function getAdminOrigin(configuredOrigin?: string | null): string {
  const envOrigin =
    configuredOrigin !== undefined
      ? configuredOrigin
      : (import.meta.env.VITE_ADMIN_ORIGIN as string | undefined) ||
        (import.meta.env.VITE_ADMIN_HOST as string | undefined);
  return normalizeOrigin(envOrigin);
}

export function getAdminHostname(configuredOrigin?: string | null): string {
  try {
    return new URL(getAdminOrigin(configuredOrigin)).hostname.toLowerCase();
  } catch {
    return 'golf.shimizu-technology.com';
  }
}

export function isLocalDevHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return LOCAL_DEV_HOSTS.has(normalized) || normalized.endsWith('.local');
}

/**
 * Returns true when the current hostname is allowed to load Clerk and render /admin routes:
 * either the dedicated admin host (e.g. golf.shimizu-technology.com) or local dev.
 */
export function isAdminHost(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
  configuredOrigin?: string | null
): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (isLocalDevHost(normalized)) return true;

  return normalized === getAdminHostname(configuredOrigin);
}

/**
 * Returns true ONLY on the dedicated production/staging admin host (not localhost).
 */
export function isDedicatedAdminHost(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
  configuredOrigin?: string | null
): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || isLocalDevHost(normalized)) return false;

  return normalized === getAdminHostname(configuredOrigin);
}

/**
 * Decides whether "/" shows the HafaGolf platform homepage instead of a tenant landing page.
 * The dedicated admin host always does. Local dev does unless `?org=` or a configured
 * default org slug asks for a tenant. Every other host is a tenant public site.
 */
export function shouldRenderPlatformHome(
  hostname: string,
  search = '',
  defaultOrgOverride: string | null | undefined = import.meta.env.VITE_DEFAULT_ORG_SLUG as string | undefined,
  configuredOrigin?: string | null
): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (isDedicatedAdminHost(normalized, configuredOrigin)) return true;
  if (!isLocalDevHost(normalized)) return false;

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('org')?.trim()) return false;
  return !defaultOrgOverride?.trim();
}

/** True when this URL renders the platform homepage, which needs no API and skips the service check. */
export function isPlatformHomeUrl(
  hostname: string,
  pathname: string,
  search = '',
  defaultOrgOverride: string | null | undefined = import.meta.env.VITE_DEFAULT_ORG_SLUG as string | undefined,
  configuredOrigin?: string | null
): boolean {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // Keep raw pathname when percent-encoding is malformed.
  }
  const path = decodedPath.replace(/\/+$/, '').toLowerCase() || '/';
  if (path === '/platform' || path === '/about') return true;
  return path === '/' && shouldRenderPlatformHome(hostname, search, defaultOrgOverride, configuredOrigin);
}

/** Where "Organizer Sign In" points: in-app on admin-capable hosts, the admin origin elsewhere. */
export function getOrganizerConsoleHref(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
  configuredOrigin?: string | null
): string {
  return isAdminHost(hostname, configuredOrigin) ? '/admin' : `${getAdminOrigin(configuredOrigin)}/admin`;
}

export function shouldRedirectToAdminOrigin(
  hostname: string,
  pathname: string,
  configuredOrigin?: string | null
): boolean {
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
  return isAdminPath && !isAdminHost(hostname, configuredOrigin);
}

export function buildAdminRedirectUrl(
  pathname: string,
  search = '',
  hash = '',
  configuredOrigin?: string | null,
  orgSlug?: string | null
): string {
  const origin = getAdminOrigin(configuredOrigin);
  const safePath = pathname === '/admin' || pathname.startsWith('/admin/') ? pathname : '/admin';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (orgSlug && !params.has('org')) {
    params.set('org', orgSlug);
  }
  const queryString = params.toString();
  const safeHash = hash.startsWith('#') ? hash : hash ? `#${hash}` : '';

  return `${origin}${safePath}${queryString ? `?${queryString}` : ''}${safeHash}`;
}
