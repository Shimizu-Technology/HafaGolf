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
 * Returns true ONLY on the dedicated production/staging admin host (not localhost),
 * so visiting "/" on golf.shimizu-technology.com redirects cleanly into /admin.
 */
export function isDedicatedAdminHost(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
  configuredOrigin?: string | null
): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || isLocalDevHost(normalized)) return false;

  return normalized === getAdminHostname(configuredOrigin);
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
  const safePath = pathname.startsWith('/admin') ? pathname : '/admin';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (orgSlug && !params.has('org')) {
    params.set('org', orgSlug);
  }
  const queryString = params.toString();
  const safeHash = hash.startsWith('#') ? hash : hash ? `#${hash}` : '';

  return `${origin}${safePath}${queryString ? `?${queryString}` : ''}${safeHash}`;
}
