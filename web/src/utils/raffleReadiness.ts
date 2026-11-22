export type DrawReadinessIssueReason =
  | 'failed_delivery'
  | 'missing_name'
  | 'unconfirmed_delivery'
  | 'no_contact';

export interface DrawReadinessIssue {
  ticket_id: number;
  ticket_number: string;
  raffle_sale_batch_id: number | null;
  ticket_count: number;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_phone_masked: string | null;
  buyer_email: string | null;
  buyer_email_masked: string | null;
  sms_status: string;
  email_status: string;
  sms_error: string | null;
  email_error: string | null;
  issue_reason: DrawReadinessIssueReason;
  issue_reasons: DrawReadinessIssueReason[];
}

export interface DrawReadinessReport {
  ready: boolean;
  eligible_ticket_count: number;
  paid_buyer_batch_count: number;
  confirmed_delivered_count: number;
  unconfirmed_delivery_count: number;
  failed_delivery_count: number;
  missing_name_count: number;
  remaining_prize_count: number;
  registration_tickets_included: boolean;
  unsynced_registration_count: number;
  issues_total_count: number;
  issues_truncated: boolean;
  issues: DrawReadinessIssue[];
  checked_at: string;
}

export const MIN_OVERRIDE_REASON_LENGTH = 3;

export function getTotalReadinessWarnings(report: DrawReadinessReport): number {
  return (
    report.failed_delivery_count +
    report.unconfirmed_delivery_count +
    report.missing_name_count
  );
}

export function canProceedWithDraw(
  report: DrawReadinessReport | null,
  overrideChecked: boolean,
  overrideReason: string
): boolean {
  if (!report) return false;
  if (report.eligible_ticket_count <= 0) return false;
  if (report.ready) return true;

  return overrideChecked && overrideReason.trim().length >= MIN_OVERRIDE_REASON_LENGTH;
}

export function getReadinessIssueBadge(reason: DrawReadinessIssueReason): {
  label: string;
  tone: 'error' | 'warning';
} {
  switch (reason) {
    case 'failed_delivery':
      return { label: 'Delivery Failed', tone: 'error' };
    case 'missing_name':
      return { label: 'Missing Name', tone: 'error' };
    case 'no_contact':
      return { label: 'No Contact', tone: 'error' };
    case 'unconfirmed_delivery':
    default:
      return { label: 'Unconfirmed', tone: 'warning' };
  }
}

export function summarizeReadinessHeadline(report: DrawReadinessReport): {
  title: string;
  subtitle: string;
  tone: 'ready' | 'warning' | 'blocked';
} {
  if (report.eligible_ticket_count <= 0) {
    return {
      title: 'No Eligible Tickets',
      subtitle: 'There are no paid, non-winning tickets available in the draw pool.',
      tone: 'blocked',
    };
  }

  if (report.ready) {
    const buyerWord = report.paid_buyer_batch_count === 1 ? 'paid buyer' : 'paid buyers';
    return {
      title: 'Ready to Draw',
      subtitle:
        report.paid_buyer_batch_count > 0
          ? `All ${report.paid_buyer_batch_count} ${buyerWord} have confirmed delivery and all ${report.eligible_ticket_count} eligible tickets have valid names.`
          : `${report.eligible_ticket_count} eligible tickets verified and ready for the drawing.`,
      tone: 'ready',
    };
  }

  const parts: string[] = [];
  if (report.failed_delivery_count > 0) {
    parts.push(`${report.failed_delivery_count} failed ${report.failed_delivery_count === 1 ? 'delivery' : 'deliveries'}`);
  }
  if (report.unconfirmed_delivery_count > 0) {
    parts.push(`${report.unconfirmed_delivery_count} unconfirmed`);
  }
  if (report.missing_name_count > 0) {
    parts.push(`${report.missing_name_count} missing ${report.missing_name_count === 1 ? 'name' : 'names'}`);
  }

  return {
    title: 'Action Recommended Before Drawing',
    subtitle: `Unresolved readiness warnings: ${parts.join(', ')}. Review buyers in Needs Attention or enter an audited override reason to proceed.`,
    tone: 'warning',
  };
}
