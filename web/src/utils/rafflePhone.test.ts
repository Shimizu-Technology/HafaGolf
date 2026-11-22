import { describe, expect, it } from 'vitest';
import {
  extractPhoneDigits,
  formatPhoneReadback,
  isBarePhonePrefix,
  normalizeRafflePhone,
  phonesMatch,
  validateRafflePhonePair,
} from './rafflePhone';

describe('rafflePhone', () => {
  it('extracts digits cleanly', () => {
    expect(extractPhoneDigits('+1 (671) 555-1234')).toBe('16715551234');
    expect(extractPhoneDigits('671.555.9876')).toBe('6715559876');
  });

  it('detects bare area-code and country prefixes', () => {
    for (const prefix of ['+1671', '1671', '671', '+1670', '1670', '670', '+1', '1', '  +1671  ']) {
      expect(isBarePhonePrefix(prefix)).toBe(true);
      expect(normalizeRafflePhone(prefix)).toBeNull();
    }
    expect(isBarePhonePrefix('')).toBe(false);
    expect(isBarePhonePrefix('+16715551234')).toBe(false);
  });

  it('normalizes valid 10-digit, 11-digit NANP, and international numbers', () => {
    expect(normalizeRafflePhone('671-555-1234')).toBe('+16715551234');
    expect(normalizeRafflePhone('(671) 555-1234')).toBe('+16715551234');
    expect(normalizeRafflePhone('6715551234')).toBe('+16715551234');
    expect(normalizeRafflePhone('1-671-555-1234')).toBe('+16715551234');
    expect(normalizeRafflePhone('+16715551234')).toBe('+16715551234');
    expect(normalizeRafflePhone('+81 90-1234-5678')).toBe('+819012345678');
  });

  it('rejects numbers with fewer than 10 full digits or invalid NANP lengths', () => {
    expect(normalizeRafflePhone('555-1234')).toBeNull();
    expect(normalizeRafflePhone('671-555-12')).toBeNull();
    expect(normalizeRafflePhone('+1671555123')).toBeNull();
    expect(normalizeRafflePhone('+167155512345')).toBeNull();
    expect(normalizeRafflePhone('not-a-phone')).toBeNull();
  });

  it('matches equivalent phone formats after digit normalization', () => {
    expect(phonesMatch('671-555-1234', '6715551234')).toBe(true);
    expect(phonesMatch('671-555-1234', '+16715551234')).toBe(true);
    expect(phonesMatch('(671) 555-1234', '1-671-555-1234')).toBe(true);
    expect(phonesMatch('671-555-1234', '671-555-1235')).toBe(false);
    expect(phonesMatch('+1671', '+1671')).toBe(false);
  });

  it('formats NANP numbers clearly for read-back', () => {
    expect(formatPhoneReadback('6715551234')).toBe('+1 (671) 555-1234');
    expect(formatPhoneReadback('+16715551234')).toBe('+1 (671) 555-1234');
    expect(formatPhoneReadback('+81 90-1234-5678')).toBe('+819012345678');
  });

  it('validates double-entry phone pairs cleanly', () => {
    expect(validateRafflePhonePair('', '')).toEqual({
      status: 'empty',
      error: null,
      normalized: null,
      formatted: null,
    });

    const bare = validateRafflePhonePair('+1671', '+1671');
    expect(bare.status).toBe('incomplete');
    expect(bare.error).toMatch(/incomplete/i);

    const short = validateRafflePhonePair('555-1234', '555-1234');
    expect(short.status).toBe('incomplete');

    const missingConfirm = validateRafflePhonePair('671-555-1234', '');
    expect(missingConfirm.status).toBe('mismatch');
    expect(missingConfirm.error).toMatch(/re-enter/i);

    const mismatch = validateRafflePhonePair('671-555-1234', '671-555-1239');
    expect(mismatch.status).toBe('mismatch');
    expect(mismatch.error).toMatch(/do not match/i);

    const confirmOnly = validateRafflePhonePair('', '671-555-1234');
    expect(confirmOnly.status).toBe('mismatch');

    const valid = validateRafflePhonePair('671-555-1234', '+16715551234');
    expect(valid).toEqual({
      status: 'valid',
      error: null,
      normalized: '+16715551234',
      formatted: '+1 (671) 555-1234',
    });
  });
});
