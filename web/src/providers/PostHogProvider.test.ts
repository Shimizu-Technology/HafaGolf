import { describe, expect, it } from 'vitest';
import {
  isSensitiveAnalyticsRoute,
  sanitizePostHogProperties,
  sanitizeSearchForAnalytics,
  sanitizeUrlForAnalytics,
} from './PostHogProvider';

describe('PostHogProvider URL sanitization', () => {
  it('flags sponsor portal and credential-bearing query strings as sensitive', () => {
    expect(isSensitiveAnalyticsRoute('/sponsor-portal', '?token=secret123')).toBe(true);
    expect(isSensitiveAnalyticsRoute('/sponsor-portal/login', '')).toBe(true);
    expect(isSensitiveAnalyticsRoute('/score/verify', '?token=abc')).toBe(true);
    expect(isSensitiveAnalyticsRoute('/summer-open', '?token=abc')).toBe(true);
    expect(isSensitiveAnalyticsRoute('/summer-open', '?org=highland')).toBe(false);
  });

  it('strips token parameters while keeping safe query parameters', () => {
    expect(sanitizeUrlForAnalytics('https://club.example.com/sponsor-portal?token=secret123&org=highland'))
      .toBe('https://club.example.com/sponsor-portal?org=highland');
    expect(sanitizeSearchForAnalytics('?token=secret123&session_token=abc&tab=info'))
      .toBe('?tab=info');
    expect(sanitizePostHogProperties({
      $current_url: 'https://club.example.com/sponsor-portal?token=secret123',
      $referrer: 'https://club.example.com/sponsor-portal?access_token=xyz',
      $search: '?token=secret123',
      area: 'public',
    })).toEqual({
      $current_url: 'https://club.example.com/sponsor-portal',
      $referrer: 'https://club.example.com/sponsor-portal',
      $search: '',
      area: 'public',
    });
  });
});
