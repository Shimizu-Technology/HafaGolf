import { describe, expect, it } from 'vitest';
import {
  buildAdminRedirectUrl,
  DEFAULT_ADMIN_ORIGIN,
  getAdminHostname,
  getAdminOrigin,
  getOrganizerConsoleHref,
  isPlatformHomeUrl,
  isAdminHost,
  isDedicatedAdminHost,
  isLocalDevHost,
  shouldRedirectToAdminOrigin,
  shouldRenderPlatformHome,
} from './adminHost';

describe('adminHost utilities', () => {
  it('defaults to golf.shimizu-technology.com when env is unset', () => {
    expect(getAdminOrigin('')).toBe(DEFAULT_ADMIN_ORIGIN);
    expect(getAdminHostname('')).toBe('golf.shimizu-technology.com');
  });

  it('normalizes bare hostnames and rejects unsafe protocols', () => {
    expect(getAdminOrigin('staging-golf.shimizu-technology.com')).toBe(
      'https://staging-golf.shimizu-technology.com'
    );
    expect(getAdminOrigin('javascript:alert(1)')).toBe(DEFAULT_ADMIN_ORIGIN);
  });

  it('recognizes localhost as dev admin host but not dedicated admin host', () => {
    expect(isLocalDevHost('localhost')).toBe(true);
    expect(isLocalDevHost('127.0.0.1')).toBe(true);
    expect(isAdminHost('localhost', DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(isDedicatedAdminHost('localhost', DEFAULT_ADMIN_ORIGIN)).toBe(false);
  });

  it('treats dedicated admin host as admin and client public domains as non-admin', () => {
    expect(isAdminHost('golf.shimizu-technology.com', DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(isDedicatedAdminHost('golf.shimizu-technology.com', DEFAULT_ADMIN_ORIGIN)).toBe(true);

    expect(isAdminHost('events.example.org', DEFAULT_ADMIN_ORIGIN)).toBe(false);
    expect(isDedicatedAdminHost('events.example.org', DEFAULT_ADMIN_ORIGIN)).toBe(false);
    expect(shouldRedirectToAdminOrigin('events.example.org', '/admin', DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(shouldRedirectToAdminOrigin('events.example.org', '/admin/events', DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(shouldRedirectToAdminOrigin('events.example.org', '/summer-open', DEFAULT_ADMIN_ORIGIN)).toBe(false);
    expect(shouldRedirectToAdminOrigin('golf.shimizu-technology.com', '/admin', DEFAULT_ADMIN_ORIGIN)).toBe(false);
  });

  it('builds safe redirect URLs preserving query, hash, and org context', () => {
    expect(
      buildAdminRedirectUrl('/admin/events', '?tab=open', '#top', DEFAULT_ADMIN_ORIGIN, 'island-club')
    ).toBe('https://golf.shimizu-technology.com/admin/events?tab=open&org=island-club#top');

    // Never overwrites an explicit ?org= parameter
    expect(
      buildAdminRedirectUrl('/admin', '?org=other-org', '', DEFAULT_ADMIN_ORIGIN, 'island-club')
    ).toBe('https://golf.shimizu-technology.com/admin?org=other-org');
  });

  it('shows the platform homepage at / on the admin host and bare local dev only', () => {
    expect(shouldRenderPlatformHome('golf.shimizu-technology.com', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(shouldRenderPlatformHome('golf.shimizu-technology.com', '?org=island-club', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(true);

    expect(shouldRenderPlatformHome('localhost', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(shouldRenderPlatformHome('127.0.0.1', '', '', DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(shouldRenderPlatformHome('localhost', '?org=sample-club', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(false);
    expect(shouldRenderPlatformHome('localhost', '', 'sample-club', DEFAULT_ADMIN_ORIGIN)).toBe(false);

    expect(shouldRenderPlatformHome('club.example.com', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(false);
    expect(shouldRenderPlatformHome('', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(false);
  });

  it('points organizer sign-in at /admin on admin hosts and the admin origin elsewhere', () => {
    expect(getOrganizerConsoleHref('golf.shimizu-technology.com', DEFAULT_ADMIN_ORIGIN)).toBe('/admin');
    expect(getOrganizerConsoleHref('localhost', DEFAULT_ADMIN_ORIGIN)).toBe('/admin');
    expect(getOrganizerConsoleHref('club.example.com', DEFAULT_ADMIN_ORIGIN)).toBe(
      'https://golf.shimizu-technology.com/admin'
    );
  });

  it('recognizes platform homepage URLs so they can skip the API service check', () => {
    expect(isPlatformHomeUrl('club.example.com', '/platform', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(isPlatformHomeUrl('club.example.com', '/about/', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(isPlatformHomeUrl('golf.shimizu-technology.com', '/', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(true);
    expect(isPlatformHomeUrl('golf.shimizu-technology.com', '/admin', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(false);
    expect(isPlatformHomeUrl('club.example.com', '/', '', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(false);
    expect(isPlatformHomeUrl('localhost', '/', '?org=sample-club', undefined, DEFAULT_ADMIN_ORIGIN)).toBe(false);
  });
});
