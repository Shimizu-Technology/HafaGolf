import { describe, expect, it } from 'vitest';
import { selectAdminOrganization } from '../OrganizationProvider';
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
