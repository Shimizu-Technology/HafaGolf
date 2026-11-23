// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentAddOnsPanel } from './TournamentAddOnsPanel';
import { api, type TournamentAddOn } from '../../services/api';

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TournamentAddOnsPanel', () => {
  it('loads add-ons and allows one-click starter template creation', async () => {
    const created: TournamentAddOn = {
      id: 101,
      organization_id: 'org-1',
      tournament_id: 42,
      name: 'Mulligan Pack',
      description: '2 mulligans to use anytime during the round',
      price_cents: 2000,
      max_quantity_per_order: 4,
      max_total_quantity: null,
      remaining_quantity: null,
      sold_out: false,
      sold_quantity: 0,
      revenue_cents: 0,
      category: 'mulligans',
      active: true,
      sort_order: 0,
    };

    vi.spyOn(api, 'getTournamentAddOns').mockResolvedValue({ add_ons: [] });
    const createSpy = vi.spyOn(api, 'createTournamentAddOn').mockResolvedValue({
      add_on: created,
      message: 'Add-on created',
    });

    await act(async () => {
      root.render(<TournamentAddOnsPanel tournamentId={42} />);
    });
    await flush();

    expect(mount.textContent).toContain('No add-ons yet');

    const tplBtn = Array.from(mount.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Mulligan Pack ($20)')
    );
    expect(tplBtn).toBeTruthy();

    await act(async () => {
      tplBtn!.click();
    });
    await flush();

    expect(createSpy).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        name: 'Mulligan Pack',
        price_cents: 2000,
        category: 'mulligans',
      })
    );
    expect(mount.textContent).toContain('2 mulligans to use anytime');
  });

  it('deactivates add-ons with purchases instead of removing them', async () => {
    const existing: TournamentAddOn = {
      id: 202,
      organization_id: 'org-1',
      tournament_id: 42,
      name: 'Super Ticket Bundle',
      description: 'All contests included',
      price_cents: 5000,
      max_quantity_per_order: 4,
      max_total_quantity: 50,
      remaining_quantity: 45,
      sold_out: false,
      sold_quantity: 5,
      revenue_cents: 25000,
      category: 'super_ticket',
      active: true,
      sort_order: 0,
    };

    vi.spyOn(api, 'getTournamentAddOns').mockResolvedValue({ add_ons: [existing] });
    vi.spyOn(api, 'deleteTournamentAddOn').mockResolvedValue({
      deactivated: true,
      add_on: { ...existing, active: false },
      message: 'Add-on has existing purchases and was deactivated instead of deleted.',
    });

    await act(async () => {
      root.render(<TournamentAddOnsPanel tournamentId={42} />);
    });
    await flush();

    expect(mount.textContent).toContain('Super Ticket Bundle');
    const delBtn = mount.querySelector('button[aria-label="Delete Super Ticket Bundle"]') as HTMLButtonElement;
    expect(delBtn).toBeTruthy();

    await act(async () => {
      delBtn.click();
    });
    await flush();

    expect(mount.textContent).toContain('Hidden');
  });
});
