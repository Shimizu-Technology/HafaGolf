// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SponsorCheckoutPage } from './SponsorCheckoutPage';
import { api } from '../services/api';

const mockOrg = {
  id: 'org-1',
  slug: 'island-club',
  name: 'Island Golf Club',
  primary_color: '#1b3a4b',
  features: { sponsors: true, sponsor_checkout: true },
};

vi.mock('../components/OrganizationProvider', () => ({
  useOrganization: () => ({
    organization: mockOrg,
    isLoading: false,
  }),
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('SponsorCheckoutPage — Reserve & Pay by Check', () => {
  it('allows reserving a sponsor tier by check and renders a printable invoice', async () => {
    vi.spyOn(api, 'getOrganizationTournament').mockResolvedValue({
      id: 77,
      name: 'Island Charity Classic 2027',
      slug: 'classic-2027',
      year: 2027,
      status: 'open',
      event_date: '2027-06-15',
      location_name: 'Country Club of the Pacific',
      features: { sponsors: true, sponsor_checkout: true },
    } as never);

    vi.spyOn(api, 'getSponsorTiers').mockResolvedValue({
      sponsor_tiers: [
        {
          id: 9,
          organization_id: 'org-1',
          tournament_id: 77,
          key: 'gold',
          label: 'Gold Sponsor',
          description: 'Includes 4-player team and banner recognition',
          price_cents: 150000,
          included_player_slots: 4,
          max_quantity: 5,
          claimed_count: 1,
          sold_count: 1,
          remaining_quantity: 4,
          sold_out: false,
          benefits: ['4 player entries', 'Tee box signage'],
          online_checkout_enabled: true,
          sort_order: 1,
        },
      ],
      payment_mode: 'platform_collect',
      external_checkout_url: null,
      allow_sponsor_check_invoice: true,
      checks_payable_to: 'Island Golf Foundation',
      tax_receipt_enabled: false,
      fmv_per_player_cents: 0,
      tax_org_name: null,
      tax_org_ein: null,
    });

    const reserveSpy = vi.spyOn(api, 'reserveSponsorTierByCheck').mockResolvedValue({
      sponsor: {
        id: 501,
        name: 'Pacific Coral Builders',
        tier: 'gold',
        tier_display: 'Gold Sponsor',
        sponsor_tier_id: 9,
        login_email: 'billing@pacificcoral.example',
        slot_count: 4,
        payment_type: 'check',
        payment_status: 'pending_check',
        payment_amount_cents: 150000,
        invoice_number: 'INV-2027-77-A1B2C3',
        invoiced_at: '2027-05-01T10:00:00Z',
        logo_url: null,
      },
      invoice: {
        invoice_number: 'INV-2027-77-A1B2C3',
        invoiced_at: '2027-05-01T10:00:00Z',
        status: 'pending_check',
        organization_name: 'Island Golf Club',
        tournament_name: 'Island Charity Classic 2027',
        event_date: '2027-06-15',
        location_name: 'Country Club of the Pacific',
        checks_payable_to: 'Island Golf Foundation',
        contact_name: 'Tournament Chair',
        contact_email: 'chair@islandgolf.example',
        contact_phone: '671-555-0199',
        sponsor_name: 'Pacific Coral Builders',
        sponsor_email: 'billing@pacificcoral.example',
        sponsor_website_url: null,
        sponsor_logo_url: null,
        tier_label: 'Gold Sponsor',
        tier_description: 'Includes 4-player team and banner recognition',
        included_player_slots: 4,
        benefits: ['4 player entries', 'Tee box signage'],
        amount_cents: 150000,
        tax_receipt: null,
      },
      message: 'Sponsorship reserved.',
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/island-club/tournaments/classic-2027/sponsor']}>
          <Routes>
            <Route path="/:orgSlug/tournaments/:tournamentSlug/sponsor" element={<SponsorCheckoutPage />} />
          </Routes>
        </MemoryRouter>
      );
    });
    await flush();

    const sponsorBtn = Array.from(mount.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Sponsor This Tier')
    );
    expect(sponsorBtn).toBeTruthy();

    await act(async () => {
      sponsorBtn!.click();
    });

    const checkRadio = Array.from(mount.querySelectorAll('button[role="radio"]')).find((b) =>
      b.textContent?.includes('Reserve & Pay by Check')
    ) as HTMLButtonElement;
    expect(checkRadio).toBeTruthy();
    await act(async () => {
      checkRadio.click();
    });

    const companyInput = mount.querySelector('input[placeholder="Acme Island Builders"]') as HTMLInputElement;
    const emailInput = mount.querySelector('input[placeholder="sponsor@company.com"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(companyInput, 'Pacific Coral Builders');
      setNativeValue(emailInput, 'billing@pacificcoral.example');
    });

    const form = mount.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(reserveSpy).toHaveBeenCalledWith(
      77,
      9,
      expect.objectContaining({
        name: 'Pacific Coral Builders',
        email: 'billing@pacificcoral.example',
      })
    );

    const invoiceEl = mount.querySelector('[data-testid="sponsor-check-invoice"]');
    expect(invoiceEl).toBeTruthy();
    expect(invoiceEl!.textContent).toContain('INV-2027-77-A1B2C3');
    expect(invoiceEl!.textContent).toContain('Island Golf Foundation');
    expect(invoiceEl!.textContent).toContain('Pacific Coral Builders');
    expect(invoiceEl!.textContent).toContain('Print / Save Invoice PDF');
  });
});
