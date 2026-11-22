export interface ParsedEmployeeNumberEntry {
  employee_number: string;
  employee_name?: string;
}

const HEADER_TOKENS = new Set([
  'employee_number',
  'emp_number',
  'number',
  'id',
  'employee_id',
]);

export function normalizeEmployeeNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

export function calculateEffectiveEntryFeeCents(params: {
  entryFeeCents?: number | null;
  employeeEntryFeeCents?: number | null;
  employeePricingEnabled: boolean;
  isEmployeeValidated: boolean;
}): number {
  const standardFee = Math.max(0, params.entryFeeCents ?? 0);
  if (
    params.employeePricingEnabled &&
    params.isEmployeeValidated &&
    typeof params.employeeEntryFeeCents === 'number' &&
    params.employeeEntryFeeCents >= 0
  ) {
    return params.employeeEntryFeeCents;
  }
  return standardFee;
}

export function calculateEmployeeSavingsCents(params: {
  entryFeeCents?: number | null;
  employeeEntryFeeCents?: number | null;
  employeePricingEnabled: boolean;
  isEmployeeValidated: boolean;
}): number {
  const standardFee = Math.max(0, params.entryFeeCents ?? 0);
  const effectiveFee = calculateEffectiveEntryFeeCents(params);
  return Math.max(0, standardFee - effectiveFee);
}

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parses pasted lines or CSV/TSV text into deduplicated employee number entries.
 * Supports either `EMP001` or `EMP001, Jane Doe` or `EMP001\tJane Doe`.
 */
export function parseBulkEmployeeNumbersText(rawText: string): ParsedEmployeeNumberEntry[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const entries: ParsedEmployeeNumberEntry[] = [];

  lines.forEach((line, index) => {
    const match = line.match(/^([^,\t]+)(?:[,\t](.*))?$/);
    if (!match) return;

    const rawNum = match[1].trim().replace(/^["']|["']$/g, '');
    const rawName = match[2]?.trim().replace(/^["']|["']$/g, '') || '';

    if (index === 0 && HEADER_TOKENS.has(rawNum.toLowerCase())) {
      return;
    }

    const normalized = normalizeEmployeeNumber(rawNum);
    if (!normalized) return;

    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    entries.push({
      employee_number: normalized,
      ...(rawName ? { employee_name: rawName } : {}),
    });
  });

  return entries;
}
