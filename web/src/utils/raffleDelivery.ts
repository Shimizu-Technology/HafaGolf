export type DeliveryChannelState =
  | 'delivered'
  | 'accepted'
  | 'pending'
  | 'delayed'
  | 'failed'
  | 'bounced'
  | 'complained'
  | 'skipped'
  | 'none';

export interface ChannelDeliveryStatus {
  status: DeliveryChannelState | string;
  error_text: string | null;
  last_event_at: string | null;
  recipient: string | null;
}

export interface TicketDeliveryStatus {
  sms: ChannelDeliveryStatus;
  email: ChannelDeliveryStatus;
  needs_attention: boolean;
  attention_reason: 'failed' | 'unconfirmed' | 'no_contact' | null;
}

export type DeliveryBadgeTone = 'delivered' | 'pending' | 'failed' | 'neutral';

export interface DeliveryBadgeMeta {
  label: string;
  tone: DeliveryBadgeTone;
  detail: string | null;
}

const FAILED_STATES = new Set(['failed', 'bounced', 'complained']);
const PENDING_STATES = new Set(['pending', 'accepted', 'delayed']);

export function getChannelBadgeMeta(
  channel: ChannelDeliveryStatus | undefined,
  hasContactValue: boolean
): DeliveryBadgeMeta | null {
  const status = channel?.status || 'none';

  if (status === 'delivered') {
    return { label: 'Delivered', tone: 'delivered', detail: null };
  }

  if (FAILED_STATES.has(status)) {
    const label =
      status === 'bounced' ? 'Bounced' : status === 'complained' ? 'Complained' : 'Failed';
    return {
      label,
      tone: 'failed',
      detail: channel?.error_text || null,
    };
  }

  if (PENDING_STATES.has(status)) {
    const label = status === 'delayed' ? 'Delayed' : 'Pending';
    return {
      label,
      tone: 'pending',
      detail: channel?.error_text || null,
    };
  }

  if (status === 'skipped') {
    if (!hasContactValue) return null;
    return {
      label: 'Skipped',
      tone: 'neutral',
      detail: channel?.error_text || null,
    };
  }

  if (hasContactValue) {
    return { label: 'Not sent', tone: 'neutral', detail: null };
  }

  return null;
}

export function isChannelFailed(channel: ChannelDeliveryStatus | undefined): boolean {
  return Boolean(channel && FAILED_STATES.has(channel.status));
}
