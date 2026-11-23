import { describe, expect, it } from 'vitest';
import {
  selectAdminOrganization,
  shouldShowPublicOrganizationLoading,
} from '../OrganizationProvider';
import { getSafeHttpUrl } from '../../pages/OffseasonPage';
import type { Organization } from '../../stores/organizationStore';

const alpha: Organization = { id: 'org-1', name: 'Alpha Golf', slug: 'alpha-golf' };
const beta: Organization = { id: 'org-2', name: 'Beta Charity', slug: 'beta-charity' };

describe('selectAdminOrganization', () => {
  it('prefers an explicit slug when accessible', () => {
    expect(selectAdminOrganization([alpha, beta], 'alpha-golf', 'beta-charity')).toEqual(beta);
  });

  it('keeps the persisted organization when still accessible', () => {
    expect(selectAdminOrganization([alpha, beta], 'beta-charity', null)).toEqual(beta);
  });

  it('falls back to the first accessible organization when persisted slug is stale', () => {
    expect(selectAdminOrganization([alpha, beta], 'removed-org', null)).toEqual(alpha);
  });

  it('returns null cleanly when no organizations exist yet', () => {
    expect(selectAdminOrganization([], 'alpha-golf', null)).toBeNull();
  });
});

describe('shouldShowPublicOrganizationLoading', () => {
  it('holds rendering before initial host-based tenant resolution completes, even with cached org', () => {
    expect(shouldShowPublicOrganizationLoading('host:fd-golf.example.com', null, false)).toBe(true);
    expect(shouldShowPublicOrganizationLoading('host:fd-golf.example.com', null, true)).toBe(true);
  });

  it('releases loading once resolution completes for the current host or slug', () => {
    expect(shouldShowPublicOrganizationLoading('host:fd-golf.example.com', 'host:fd-golf.example.com', false)).toBe(false);
    expect(shouldShowPublicOrganizationLoading('slug:alpha-golf', 'slug:alpha-golf', false)).toBe(false);
  });

  it('holds rendering when navigating to a different explicit org slug or host target', () => {
    expect(shouldShowPublicOrganizationLoading('slug:beta-charity', 'slug:alpha-golf', false)).toBe(true);
    expect(shouldShowPublicOrganizationLoading('host:other.example.com', 'host:fd-golf.example.com', false)).toBe(true);
  });

  it('keeps loading active if store reports isLoading while refetching the same target', () => {
    expect(shouldShowPublicOrganizationLoading('slug:alpha-golf', 'slug:alpha-golf', true)).toBe(true);
  });
});

describe('getSafeHttpUrl', () => {
  it('allows valid http and https URLs', () => {
    expect(getSafeHttpUrl('https://example.org/events')).toBe('https://example.org/events');
    expect(getSafeHttpUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
  });

  it('rejects javascript:, data:, and malformed URLs', () => {
    expect(getSafeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeHttpUrl('data:text/html,<h1>x</h1>')).toBeNull();
    expect(getSafeHttpUrl('not a url')).toBeNull();
    expect(getSafeHttpUrl('')).toBeNull();
    expect(getSafeHttpUrl(null)).toBeNull();
  });
});
