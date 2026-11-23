// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDialog } from '../test/mockDialog';
import { RaffleManagementPage } from './RaffleManagementPage';

const auth = vi.hoisted(() => ({ getToken: async () => 'example-token' }));
vi.mock('@clerk/react', () => ({ useAuth: () => auth }));
vi.mock('../components/OrganizationProvider', () => {
  const organization = { slug: 'test-org' };
  return { useOrganization: () => ({ organization }) };
});
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
mockDialog();

const tournament = {
  id: '42', name: 'Spring Open', raffle_enabled: true,
  raffle_bundles: [{ quantity: 4, price_cents: 2049, label: 'Four tickets' }],
};
const prize = {
  id: 1, name: 'Golf Bag', tier: 'gold', tier_display: 'Gold', position: 0, value_dollars: 124.5,
  won: true, claimed: false, winner: { name: 'Winning Buyer', ticket_number: 'TIX-0001' },
};

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Raffle Management', () => {
  let mount: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let router: ReturnType<typeof createMemoryRouter>;
  let mutation: ReturnType<typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>>;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
    mutation = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'POST') return mutation(url, options);
      if (url.endsWith('/tournaments/spring-open')) return Response.json({ tournament });
      if (url.endsWith('/raffle/prizes')) return Response.json({ prizes: [prize, { ...prize, id: 2, name: 'Golf Clubs' }] });
      if (url.includes('/raffle/admin/tickets')) return Response.json({ tickets: [{
        id: 11, ticket_number: 'TIX-0011', purchaser_name: 'Demo Buyer', payment_status: 'paid',
        price_cents: 500, is_winner: false,
      }] });
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    router = createMemoryRouter([{ path: '/admin/events/:tournamentSlug/raffle', element: <RaffleManagementPage /> }], {
      initialEntries: ['/admin/events/spring-open/raffle'],
    });
    await act(async () => root.render(<RouterProvider router={router} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    router.dispose();
    mount.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function button(name: string, inElement: ParentNode = mount) {
    const element = Array.from(inElement.querySelectorAll('button')).find((item) => item.textContent?.trim() === name);
    if (!element) throw new Error(`Button not found: ${name}`);
    return element;
  }

  function fill(selector: string, value: string) {
    const input = mount.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  }

  function bundleButton() {
    return Array.from(mount.querySelectorAll('button')).find((item) => item.textContent?.includes('$20.49'))!;
  }

  async function openSellTab() {
    await act(async () => button('Sell Tickets').click());
  }

  it('reviews exact sale details and submits once with the selected payment and delivery contact', async () => {
    const sale = deferredResponse();
    mutation.mockReturnValue(sale.promise);
    await openSellTab();
    expect(bundleButton().disabled).toBe(true);

    fill('#sell-buyer-name', ' Example Buyer ');
    fill('#sell-buyer-phone', '202-555-0131');
    fill('#sell-buyer-phone-confirm', '202-555-0199');
    expect(bundleButton().disabled).toBe(true);

    fill('#sell-buyer-phone-confirm', '2025550131');
    fill('#sell-buyer-email', 'buyer@example.com');
    fill('label input:not([type])', 'R-100');
    fill('textarea', 'Card receipt filed');
    act(() => mount.querySelector<HTMLInputElement>('input[value="card"]')!.click());
    expect(mount.querySelector<HTMLInputElement>('input[value="card"]')?.checked).toBe(true);

    const trigger = bundleButton();
    trigger.focus();
    act(() => trigger.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-static-flow]')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Confirm Raffle Sale');
    expect(dialog.textContent).toContain('Example Buyer');
    expect(dialog.textContent).toContain('+1 (202) 555-0131');
    expect(dialog.textContent).toContain('buyer@example.com');
    expect(dialog.textContent).toContain('Four tickets');
    expect(dialog.textContent).toContain('$20.49');
    expect(dialog.textContent).toContain('Payment methodCard');
    expect(dialog.textContent).toContain('ReceiptR-100');
    expect(dialog.textContent).toContain('NotesCard receipt filed');
    const edit = button('Go Back & Edit', dialog);
    const submit = button('Complete Sale & Send Tickets', dialog);
    expect(document.activeElement).toBe(edit);
    expect(mutation).not.toHaveBeenCalled();

    await act(async () => {
      submit.click();
      submit.click();
    });
    expect(submit.disabled).toBe(true);
    expect(edit.disabled).toBe(true);
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      dialog.click();
    });
    expect(dialog.open).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(1);
    const [url, options] = mutation.mock.calls[0];
    expect(url).toMatch(/\/tournaments\/42\/raffle\/sell$/);
    expect(JSON.parse(options.body as string)).toEqual({
      quantity: 4, price_cents: 2049, buyer_name: 'Example Buyer', buyer_email: 'buyer@example.com',
      buyer_phone: '+12025550131', payment_method: 'card', receipt_number: 'R-100', payment_notes: 'Card receipt filed',
    });

    await act(async () => sale.resolve(Response.json({ tickets: [{ ticket_number: 'TIX-0401' }] }, { status: 201 })));
    expect(document.querySelector('dialog')).toBeNull();
    expect(mount.textContent).toContain('#TIX-0401');
    const buyerName = mount.querySelector<HTMLInputElement>('#sell-buyer-name');
    expect(buyerName?.value).toBe('');
    expect(document.activeElement).toBe(buyerName);
  });

  it('returns focus and preserves the custom draft when cancelling by button, Escape, or backdrop', async () => {
    await openSellTab();
    fill('#sell-buyer-name', 'Example Buyer');
    fill('#sell-buyer-email', 'buyer@example.com');
    const quantity = fill('#raffle-custom-quantity', '3');
    const price = fill('#raffle-custom-price', '17.75');
    const trigger = button('Review Custom Sale');
    trigger.focus();

    for (const close of [
      (dialog: HTMLDialogElement) => button('Go Back & Edit', dialog).click(),
      (dialog: HTMLDialogElement) => dialog.dispatchEvent(new Event('cancel', { cancelable: true })),
      (dialog: HTMLDialogElement) => {
        dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        dialog.click();
      },
    ]) {
      act(() => trigger.click());
      const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
      expect(dialog.textContent).toContain('Custom sale');
      expect(dialog.textContent).toContain('Email delivery only');
      expect(dialog.textContent).toContain('$17.75');
      act(() => { close(dialog); });
      expect(document.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(quantity.value).toBe('3');
      expect(price.value).toBe('17.75');
    }
    expect(mutation).not.toHaveBeenCalled();
  });

  it('keeps the sale details available after a rejected request', async () => {
    mutation.mockResolvedValueOnce(Response.json({ error: 'Payment method is unavailable.' }, { status: 422 }));
    await openSellTab();
    fill('#sell-buyer-name', 'Example Buyer');
    fill('#sell-buyer-email', 'buyer@example.com');

    act(() => bundleButton().click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    const submit = button('Complete Sale & Send Tickets', dialog);
    await act(async () => submit.click());
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Payment method is unavailable.');
    expect(submit.disabled).toBe(false);
    expect(dialog.textContent).toContain('Example Buyer');
  });

  it('collects an optional void reason in the app dialog', async () => {
    mutation.mockResolvedValueOnce(Response.json({ message: 'Ticket voided' }));
    await act(async () => button('Tickets (0)').click());
    const trigger = mount.querySelector<HTMLButtonElement>('button[title="Void ticket"]')!;
    act(() => trigger.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    expect(dialog.textContent).toContain('Void ticket #TIX-0011?');
    const reason = dialog.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(reason, ' Duplicate sale ');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Void Ticket', dialog).click());
    expect(mutation.mock.calls[0][0]).toMatch(/\/raffle\/tickets\/11\/void$/);
    expect(JSON.parse(mutation.mock.calls[0][1].body as string)).toEqual({ reason: 'Duplicate sale' });
  });

  it('locks only the selected prize during a request and toggles using the returned claim state', async () => {
    const claim = deferredResponse();
    mutation.mockReturnValueOnce(claim.promise);
    const [first, second] = Array.from(mount.querySelectorAll('button')).filter((item) => item.textContent === 'Mark Claimed');

    await act(async () => {
      first.click();
      first.click();
    });
    expect(first.disabled).toBe(true);
    expect(second.disabled).toBe(false);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][0]).toMatch(/\/raffle\/prizes\/1\/claim$/);
    expect(JSON.parse(mutation.mock.calls[0][1].body as string)).toEqual({ claimed: true });

    await act(async () => claim.resolve(Response.json({ prize: { id: 1, claimed: true } })));
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.textContent).toBe('Claimed');
    expect(mount.textContent).toContain('Ticket #TIX-0001');

    mutation.mockResolvedValueOnce(Response.json({ prize: { id: 1, claimed: false } }));
    await act(async () => first.click());
    expect(JSON.parse(mutation.mock.calls[1][1].body as string)).toEqual({ claimed: false });
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(first.textContent).toBe('Mark Claimed');
  });
});
