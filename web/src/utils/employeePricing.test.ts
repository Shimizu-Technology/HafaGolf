import { describe, it, expect } from 'vitest';
import {
  normalizeEmployeeNumber,
  calculateEffectiveEntryFeeCents,
  calculateEmployeeSavingsCents,
  parseBulkEmployeeNumbersText,
  formatUsdFromCents,
} from './employeePricing';

describe('employeePricing', () => {
  it('normalizes employee numbers by trimming and uppercasing', () => {
    expect(normalizeEmployeeNumber('  emp-042 ')).toBe('EMP-042');
    expect(normalizeEmployeeNumber('')).toBe('');
  });

  it('applies employee entry fee only when feature is enabled and number is validated', () => {
    expect(
      calculateEffectiveEntryFeeCents({
        entryFeeCents: 12500,
        employeeEntryFeeCents: 5000,
        employeePricingEnabled: true,
        isEmployeeValidated: true,
      })
    ).toBe(5000);

    expect(
      calculateEmployeeSavingsCents({
        entryFeeCents: 12500,
        employeeEntryFeeCents: 5000,
        employeePricingEnabled: true,
        isEmployeeValidated: true,
      })
    ).toBe(7500);

    // Disabled feature falls back to standard fee
    expect(
      calculateEffectiveEntryFeeCents({
        entryFeeCents: 12500,
        employeeEntryFeeCents: 5000,
        employeePricingEnabled: false,
        isEmployeeValidated: true,
      })
    ).toBe(12500);

    // Unvalidated employee number falls back to standard fee
    expect(
      calculateEffectiveEntryFeeCents({
        entryFeeCents: 12500,
        employeeEntryFeeCents: 5000,
        employeePricingEnabled: true,
        isEmployeeValidated: false,
      })
    ).toBe(12500);
  });

  it('parses CSV/TSV/newline bulk input, skips header rows, and deduplicates case-insensitively', () => {
    const input = `
      employee_number,employee_name
      emp-001, Alice Santos
      EMP-001, Duplicate Alice
      "EMP-002"\t"Bob Cruz"
      EMP-003
    `;

    expect(parseBulkEmployeeNumbersText(input)).toEqual([
      { employee_number: 'EMP-001', employee_name: 'Alice Santos' },
      { employee_number: 'EMP-002', employee_name: 'Bob Cruz' },
      { employee_number: 'EMP-003' },
    ]);
  });

  it('formats USD amounts cleanly', () => {
    expect(formatUsdFromCents(5000)).toBe('$50');
    expect(formatUsdFromCents(12550)).toBe('$125.50');
  });
});
