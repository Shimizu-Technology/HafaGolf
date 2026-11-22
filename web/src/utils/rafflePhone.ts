const BARE_PREFIX_DIGITS = new Set(['1', '671', '1671', '670', '1670']);
const MIN_FULL_DIGITS = 10;
const NANP_FULL_DIGITS = 11;
const MAX_E164_DIGITS = 15;

export type PhoneValidationStatus = 'empty' | 'incomplete' | 'mismatch' | 'valid';

export interface PhoneValidationResult {
  status: PhoneValidationStatus;
  error: string | null;
  normalized: string | null;
  formatted: string | null;
}

export function extractPhoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function isBarePhonePrefix(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const digits = extractPhoneDigits(trimmed);
  return digits.length === 0 || BARE_PREFIX_DIGITS.has(digits);
}

export function normalizeRafflePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = extractPhoneDigits(trimmed);
  if (digits.length === 0 || BARE_PREFIX_DIGITS.has(digits)) {
    return null;
  }

  if (digits.length > MAX_E164_DIGITS) {
    return null;
  }

  if (digits.startsWith('1')) {
    if (digits.length !== NANP_FULL_DIGITS) {
      return null;
    }
    return `+${digits}`;
  }

  if (digits.length < MIN_FULL_DIGITS) {
    return null;
  }

  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }

  if (digits.length === MIN_FULL_DIGITS) {
    return `+1${digits}`;
  }

  return `+${digits}`;
}

export function phonesMatch(phone: string, confirmPhone: string): boolean {
  const normalizedPhone = normalizeRafflePhone(phone);
  const normalizedConfirm = normalizeRafflePhone(confirmPhone);
  if (!normalizedPhone || !normalizedConfirm) {
    return false;
  }
  return normalizedPhone === normalizedConfirm;
}

export function formatPhoneReadback(raw: string): string {
  const normalized = normalizeRafflePhone(raw);
  if (!normalized) {
    return raw.trim();
  }

  const digits = extractPhoneDigits(normalized);
  if (digits.length === NANP_FULL_DIGITS && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return `+1 (${area}) ${prefix}-${line}`;
  }

  return normalized;
}

export function validateRafflePhonePair(phone: string, confirmPhone: string): PhoneValidationResult {
  const trimmedPhone = phone.trim();
  const trimmedConfirm = confirmPhone.trim();

  if (!trimmedPhone && !trimmedConfirm) {
    return { status: 'empty', error: null, normalized: null, formatted: null };
  }

  if (!trimmedPhone && trimmedConfirm) {
    return {
      status: 'mismatch',
      error: 'Enter the phone number in both fields.',
      normalized: null,
      formatted: null,
    };
  }

  if (isBarePhonePrefix(trimmedPhone)) {
    return {
      status: 'incomplete',
      error: 'Phone number is incomplete — enter all 10 digits (e.g., 671-555-1234).',
      normalized: null,
      formatted: null,
    };
  }

  const normalized = normalizeRafflePhone(trimmedPhone);
  if (!normalized) {
    return {
      status: 'incomplete',
      error: 'Enter a complete 10-digit phone number with area code (e.g., 671-555-1234).',
      normalized: null,
      formatted: null,
    };
  }

  if (!trimmedConfirm) {
    return {
      status: 'mismatch',
      error: 'Re-enter the phone number to confirm it matches.',
      normalized: null,
      formatted: null,
    };
  }

  if (!phonesMatch(trimmedPhone, trimmedConfirm)) {
    return {
      status: 'mismatch',
      error: 'Phone numbers do not match — double-check with the buyer.',
      normalized: null,
      formatted: null,
    };
  }

  return {
    status: 'valid',
    error: null,
    normalized,
    formatted: formatPhoneReadback(normalized),
  };
}
