import { describe, expect, it } from 'vitest';
import { getChannelBadgeMeta, isChannelFailed } from './raffleDelivery';

describe('raffleDelivery', () => {
  it('maps delivered status to delivered tone', () => {
    expect(
      getChannelBadgeMeta(
        { status: 'delivered', error_text: null, last_event_at: '2026-11-22T01:00:00Z', recipient: '+16715551234' },
        true
      )
    ).toEqual({ label: 'Delivered', tone: 'delivered', detail: null });
  });

  it('maps accepted, pending, and delayed to pending tone', () => {
    expect(
      getChannelBadgeMeta(
        { status: 'accepted', error_text: null, last_event_at: null, recipient: '+16715551234' },
        true
      )
    ).toEqual({ label: 'Pending', tone: 'pending', detail: null });

    expect(
      getChannelBadgeMeta(
        { status: 'delayed', error_text: 'Carrier delay', last_event_at: null, recipient: '+16715551234' },
        true
      )
    ).toEqual({ label: 'Delayed', tone: 'pending', detail: 'Carrier delay' });
  });

  it('maps failed, bounced, and complained to failed tone with error text', () => {
    const failed = { status: 'failed', error_text: 'Invalid destination', last_event_at: null, recipient: '+16715551234' };
    expect(getChannelBadgeMeta(failed, true)).toEqual({
      label: 'Failed',
      tone: 'failed',
      detail: 'Invalid destination',
    });
    expect(isChannelFailed(failed)).toBe(true);

    const bounced = { status: 'bounced', error_text: 'Mailbox unavailable', last_event_at: null, recipient: 'bad@example.com' };
    expect(getChannelBadgeMeta(bounced, true)).toEqual({
      label: 'Bounced',
      tone: 'failed',
      detail: 'Mailbox unavailable',
    });
    expect(isChannelFailed(bounced)).toBe(true);
  });

  it('hides absent channels when contact is missing and shows Not sent when contact exists', () => {
    expect(
      getChannelBadgeMeta({ status: 'none', error_text: null, last_event_at: null, recipient: null }, false)
    ).toBeNull();
    expect(
      getChannelBadgeMeta({ status: 'none', error_text: null, last_event_at: null, recipient: null }, true)
    ).toEqual({ label: 'Not sent', tone: 'neutral', detail: null });
  });
});
