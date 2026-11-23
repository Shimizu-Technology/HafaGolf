// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SponsorAdminCard } from './SponsorAdminCard';
import type { AdminSponsor } from './sponsorAdminTypes';

const mockGetToken = async () => 'tok';
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

let mount: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('SponsorAdminCard — Pending Check Activation', () => {
  const pendingSponsor: AdminSponsor = {
    id: 88,
    name: 'Coral Reef Motors',
    tier: 'gold',
    tier_display: 'Gold Sponsor',
    logo_url: null,
    raw_logo_url: null,
    has_uploaded_logo: false,
    website_url: 'https://coralreef.example',
    description: null,
    course_key: null,
    course_name: null,
    hole_number: null,
    position: 0,
    active: false,
    major: true,
    display_label: 'Gold Sponsor',
    slot_count: 4,
    login_email: 'ap@coralreef.example',
    slots_filled: 0,
    has_active_portal_link: false,
    portal_link_issued_at: null,
    payment_type: 'check',
    payment_status: 'pending_check',
    payment_amount_cents: 150000,
    invoice_number: 'INV-2027-10-AA11BB',
    check_number: null,
    check_notes: null,
    invoiced_at: '2027-05-01T10:00:00Z',
    paid_at: null,
  };

  it('shows Pending Check badge, invoice number, and triggers Mark Paid & Activate with check details', async () => {
    const onMarkCheckPaid = vi.fn().mockResolvedValue(true);

    await act(async () => {
      root.render(
        <SponsorAdminCard
          sponsor={pendingSponsor}
          tournamentId={10}
          teamSize={2}
          courseConfigs={[]}
          expanded={false}
          onToggleExpand={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onSendInvite={vi.fn().mockResolvedValue(undefined)}
          onQuickSave={vi.fn().mockResolvedValue(true)}
          onMarkCheckPaid={onMarkCheckPaid}
          onSlotsFilledChange={vi.fn()}
        />
      );
    });

    const badge = mount.querySelector('[data-testid="sponsor-pending-check-badge"]');
    expect(badge?.textContent).toContain('Pending Check');
    expect(mount.textContent).toContain('INV-2027-10-AA11BB');

    const markBtn = mount.querySelector('[data-testid="mark-check-paid-btn"]') as HTMLButtonElement;
    expect(markBtn).toBeTruthy();

    await act(async () => {
      markBtn.click();
    });

    const checkNumInput = mount.querySelector('#check-num-88') as HTMLInputElement;
    const notesInput = mount.querySelector('#check-notes-88') as HTMLInputElement;
    await act(async () => {
      setNativeValue(checkNumInput, '4512');
      setNativeValue(notesInput, 'Deposited by chair');
    });

    const form = mount.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onMarkCheckPaid).toHaveBeenCalledWith({
      check_number: '4512',
      check_notes: 'Deposited by chair',
    });
  });
});
