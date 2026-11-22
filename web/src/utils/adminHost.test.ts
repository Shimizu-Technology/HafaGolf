import { describe, expect, it } from 'vitest';
import {
  buildAdminRedirectUrl,
  DEFAULT_ADMIN_ORIGIN,
  getAdminHostname,
  getAdminOrigin,
  isAdminHost,
  isDedicatedAdminHost,
  isLocalDevHost,
  shouldRedirectToAdminOrigin,
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
});
