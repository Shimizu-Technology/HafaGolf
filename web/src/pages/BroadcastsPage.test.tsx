// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastsPage } from './BroadcastsPage';

const mockGetToken = async () => 'tok_bcast';
vi.mock('../hooks/useAuthToken', () => ({
  useAuthToken: () => ({ getToken: mockGetToken }),
}));

const mockOrg = {
  id: 'org-1',
  slug: 'island-golf',
  name: 'Island Golf Club',
};

vi.mock('../components/OrganizationProvider', () => ({
  useOrganization: () => ({ organization: mockOrg }),
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
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
    };
  }
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('BroadcastsPage', () => {
  it('loads preview counts, applies templates, requires ConfirmDialog, and updates history on dry-run submit', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.endsWith('/api/v1/admin/organizations/island-golf/tournaments/classic-2027/broadcasts') && (!opts?.method || opts.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            tournament: { id: 88, name: 'Island Classic 2027', slug: 'classic-2027' },
            announcements: [],
            groups: [{ id: 1, group_number: 1, hole_number: 1, hole_position_label: '1A' }],
            config: { email_configured: false, sms_configured: false, local_dry_run_mode: true },
          }),
        };
      }
      if (url.endsWith('/api/v1/tournaments/88/broadcasts/preview')) {
        return {
          ok: true,
          json: async () => ({
            audience: 'all_confirmed',
            channel: 'both',
            recipient_count: 14,
            email_recipients: 14,
            sms_recipients: 12,
            dry_run: true,
            email_configured: false,
            sms_configured: false,
          }),
        };
      }
      if (url.endsWith('/api/v1/tournaments/88/broadcasts') && opts?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            announcement: {
              id: 301,
              audience: 'all_confirmed',
              target_group_ids: [],
              channel: 'both',
              subject: '15-Minute Shotgun Start Call',
              message: 'Players, please head to your assigned golf carts now. The shotgun start begins in 15 minutes!',
              recipient_count: 14,
              email_recipient_count: 14,
              sms_recipient_count: 12,
              sent_count: 0,
              failed_count: 0,
              dry_run: true,
              status: 'dry_run',
              sender_name: 'Club Admin',
              sent_at: '2027-06-15T07:15:00Z',
              created_at: '2027-06-15T07:15:00Z',
            },
            message: 'Dry run recorded for 14 recipients.',
          }),
        };
      }
      return { ok: false, json: async () => ({ error: 'Not found' }) };
    });

    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/classic-2027/announcements']}>
          <Routes>
            <Route path="/admin/events/:tournamentSlug/announcements" element={<BroadcastsPage />} />
          </Routes>
        </MemoryRouter>
      );
    });
    await flush();

    expect(mount.querySelector('[data-testid="broadcast-dry-run-banner"]')).toBeTruthy();
    expect(mount.querySelector('[data-testid="broadcast-recipient-count"]')?.textContent).toContain('14 recipients');

    // Click 15-Minute Shotgun Call template
    const tplBtn = Array.from(mount.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('15-Minute Shotgun Call')
    );
    expect(tplBtn).toBeTruthy();
    await act(async () => {
      tplBtn!.click();
    });

    // Submit form -> opens ConfirmDialog (POST must NOT fire yet)
    const form = mount.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    const postCallsBeforeConfirm = fetchMock.mock.calls.filter(
      ([u, o]) => typeof u === 'string' && u.endsWith('/broadcasts') && o?.method === 'POST'
    );
    expect(postCallsBeforeConfirm.length).toBe(0);

    // Confirm inside dialog
    const confirmBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Record Dry Run') && b.closest('[role="dialog"], [role="alertdialog"]')
    ) as HTMLButtonElement | undefined;
    const fallbackConfirm = confirmBtn || Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Record Dry Run'
    );
    expect(fallbackConfirm).toBeTruthy();

    await act(async () => {
      fallbackConfirm!.click();
    });
    await flush();

    const postCallsAfterConfirm = fetchMock.mock.calls.filter(
      ([u, o]) => typeof u === 'string' && u.endsWith('/broadcasts') && o?.method === 'POST'
    );
    expect(postCallsAfterConfirm.length).toBe(1);

    const history = mount.querySelector('[data-testid="broadcast-history-list"]');
    expect(history?.textContent).toContain('15-Minute Shotgun Start Call');
    expect(history?.textContent).toContain('Dry Run');
  });

  it('clears stale preview and disables submit while a channel preview request fails or is pending', async () => {
    let previewCall = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.endsWith('/api/v1/admin/organizations/island-golf/tournaments/classic-2027/broadcasts') && (!opts?.method || opts.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            tournament: { id: 88, name: 'Island Classic 2027', slug: 'classic-2027' },
            announcements: [],
            groups: [],
            config: { email_configured: true, sms_configured: false, local_dry_run_mode: false },
          }),
        };
      }
      if (url.endsWith('/api/v1/tournaments/88/broadcasts/preview')) {
        previewCall += 1;
        if (previewCall === 1) {
          return {
            ok: true,
            json: async () => ({
              audience: 'all_confirmed',
              channel: 'both',
              effective_channel: 'email',
              skipped_channel: 'sms',
              recipient_count: 5,
              email_recipients: 5,
              sms_recipients: 0,
              dry_run: false,
              email_configured: true,
              sms_configured: false,
            }),
          };
        }
        return { ok: false, status: 500, json: async () => ({ error: 'Preview failed' }) };
      }
      return { ok: false, json: async () => ({ error: 'Not found' }) };
    });

    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin/events/classic-2027/announcements']}>
          <Routes>
            <Route path="/admin/events/:tournamentSlug/announcements" element={<BroadcastsPage />} />
          </Routes>
        </MemoryRouter>
      );
    });
    await flush();

    // Partial channel readiness banner shown for initial both preview
    expect(mount.querySelector('[data-testid="broadcast-partial-channel-banner"]')).toBeTruthy();
    const submitBtn = mount.querySelector('[data-testid="broadcast-submit-btn"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);

    // Switch channel to email -> second preview fails -> submit MUST be disabled (stale preview cleared)
    const emailRadio = Array.from(mount.querySelectorAll('button[role="radio"]')).find((b) =>
      b.textContent?.includes('Email Only')
    ) as HTMLButtonElement;
    await act(async () => {
      emailRadio.click();
    });
    await flush();

    expect(submitBtn.disabled).toBe(true);
  });
});
