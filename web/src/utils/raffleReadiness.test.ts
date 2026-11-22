import { describe, expect, it } from 'vitest';
import {
  canProceedWithDraw,
  getReadinessIssueBadge,
  getTotalReadinessWarnings,
  summarizeReadinessHeadline,
  type DrawReadinessReport,
} from './raffleReadiness';

function makeReport(overrides: Partial<DrawReadinessReport> = {}): DrawReadinessReport {
  return {
    ready: true,
    eligible_ticket_count: 25,
    paid_buyer_batch_count: 8,
    confirmed_delivered_count: 8,
    unconfirmed_delivery_count: 0,
    failed_delivery_count: 0,
    missing_name_count: 0,
    remaining_prize_count: 4,
    registration_tickets_included: false,
    unsynced_registration_count: 0,
    issues_total_count: 0,
    issues_truncated: false,
    issues: [],
    checked_at: '2026-11-22T12:00:00Z',
    ...overrides,
  };
}

describe('raffleReadiness helpers', () => {
  it('allows drawing immediately when report is ready and has eligible tickets', () => {
    const report = makeReport();
    expect(canProceedWithDraw(report, false, '')).toBe(true);
    expect(getTotalReadinessWarnings(report)).toBe(0);
    expect(summarizeReadinessHeadline(report).tone).toBe('ready');
  });

  it('blocks drawing when eligible_ticket_count is zero even if override is checked', () => {
    const report = makeReport({ ready: false, eligible_ticket_count: 0 });
    expect(canProceedWithDraw(report, false, '')).toBe(false);
    expect(canProceedWithDraw(report, true, 'Verified verbally at table')).toBe(false);
    expect(summarizeReadinessHeadline(report).tone).toBe('blocked');
  });

  it('blocks drawing on unready report until override checkbox AND valid reason are provided', () => {
    const report = makeReport({
      ready: false,
      unconfirmed_delivery_count: 2,
      failed_delivery_count: 1,
      missing_name_count: 1,
    });

    expect(getTotalReadinessWarnings(report)).toBe(4);
    expect(canProceedWithDraw(report, false, '')).toBe(false);
    expect(canProceedWithDraw(report, true, '')).toBe(false);
    expect(canProceedWithDraw(report, true, 'ok')).toBe(false);
    expect(canProceedWithDraw(report, false, 'Confirmed verbally with buyer')).toBe(false);
    expect(canProceedWithDraw(report, true, 'Confirmed verbally with buyer')).toBe(true);

    const headline = summarizeReadinessHeadline(report);
    expect(headline.tone).toBe('warning');
    expect(headline.subtitle).toContain('1 failed delivery');
    expect(headline.subtitle).toContain('2 unconfirmed');
    expect(headline.subtitle).toContain('1 missing name');
  });

  it('returns null-safe false when report is still loading', () => {
    expect(canProceedWithDraw(null, true, 'Valid reason')).toBe(false);
  });

  it('maps each issue reason to the expected badge label and tone', () => {
    expect(getReadinessIssueBadge('failed_delivery')).toEqual({
      label: 'Delivery Failed',
      tone: 'error',
    });
    expect(getReadinessIssueBadge('missing_name')).toEqual({
      label: 'Missing Name',
      tone: 'error',
    });
    expect(getReadinessIssueBadge('no_contact')).toEqual({
      label: 'No Contact',
      tone: 'error',
    });
    expect(getReadinessIssueBadge('unconfirmed_delivery')).toEqual({
      label: 'Unconfirmed',
      tone: 'warning',
    });
  });
});
