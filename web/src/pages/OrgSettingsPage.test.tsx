// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgSettingsPage } from './OrgSettingsPage';
import { mockDialog } from '../test/mockDialog';
import { useOrganizationStore } from '../stores/organizationStore';

const mocks = vi.hoisted(() => ({
  organization: { id: 'test-org', slug: 'test-org', name: 'Test Organization' },
  getToken: async () => 'test-session',
  refreshTournaments: vi.fn(async () => {}),
}));
vi.mock('../hooks/useAuthToken', () => ({ useAuthToken: () => mocks }));
vi.mock('../contexts', () => ({ useTournament: () => mocks }));
vi.mock('../components/OrgFeaturesPanel', () => ({ OrgFeaturesPanel: () => null }));
vi.mock('../components/OrgPaymentConfigPanel', () => ({ OrgPaymentConfigPanel: () => null }));
vi.mock('../components/SponsorTiersAdminPanel', () => ({ SponsorTiersAdminPanel: () => null }));

const path = '/admin/events/spring-open/settings';
const eventSettings = { id: 12, slug: 'spring-open', name: 'Spring Open', event_date: '2027-04-15',
  registration_open: true, waiver_enabled: true, entry_fee: 12500, capacity_unit: 'teams', team_size: 2 };
const tabNames = ['Event Info', 'Look & Photos', 'Registration & Waiver', 'Sponsors & Portal', 'Payments & Payouts', 'Raffle'];

mockDialog();

describe('OrgSettingsPage', () => {
  let root: ReturnType<typeof createRoot>;
  let mount: HTMLDivElement;
  let router: ReturnType<typeof createMemoryRouter>;
  let fetchMock: ReturnType<typeof vi.fn<(url: string, options?: RequestInit) => Promise<Response>>>;
  let finishUpload: (response: Response) => void;

  function buttons() { return [...mount.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; }
  function action(label: string) {
    return [...mount.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)!;
  }
  function input(label: string) {
    return [...mount.querySelectorAll('input, textarea')].find((field) =>
      [...((field as HTMLInputElement).labels ?? [])].some((node) => node.textContent?.trim().startsWith(label))
    ) as HTMLInputElement;
  }
  function type(field: HTMLInputElement, value: string) {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useOrganizationStore.getState().setOrganization(mocks.organization);
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
    const uploadResponse = new Promise<Response>((resolve) => { finishUpload = resolve; });
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/uploads')) return uploadResponse;
      if (options?.method === 'PATCH') return Response.json({ saved: true });
      if (url.endsWith('/members')) return Response.json({ members: [] });
      if (url.endsWith('/tournaments/spring-open')) return Response.json({ tournament: eventSettings });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    router = createMemoryRouter([
      { path: '/admin/events/:tournamentSlug/settings', element: <OrgSettingsPage /> },
      { path: '/admin', element: <h1>Dashboard</h1> },
    ], { initialEntries: [path] });
    await act(async () => root.render(<RouterProvider router={router} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    router.dispose();
    mount.remove();
    useOrganizationStore.getState().clearOrganization();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows six tabs, handles keyboard arrows and wrapping, and retains edits across tabs', async () => {
    expect(buttons().map((tab) => tab.textContent)).toEqual(tabNames);
    expect(mount.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    await act(async () => type(input('Event name'), 'Summer Open'));
    expect(mount.textContent).toContain('Unsaved changes');
    await act(async () => buttons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement).toBe(buttons()[1]);
    expect(buttons()[1].getAttribute('aria-selected')).toBe('true');
    await act(async () => buttons()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    await act(async () => buttons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(document.activeElement).toBe(buttons()[5]);
    expect(buttons()[5].getAttribute('aria-selected')).toBe('true');
    for (const tab of buttons()) {
      await act(async () => tab.click());
      const panel = mount.querySelector('[role="tabpanel"]:not([hidden])');
      expect(panel?.id).toBe(tab.getAttribute('aria-controls'));
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    await act(async () => buttons()[0].click());
    expect(input('Event name').value).toBe('Summer Open');
    expect(mount.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  });

  it('waits for the upload across tabs, then saves the uploaded story URL and previous edits', async () => {
    await act(async () => type(input('Event name'), 'Summer Open'));
    expect(action('Save changes').disabled).toBe(false);
    await act(async () => buttons()[1].click());
    const randomUUID = Object.getOwnPropertyDescriptor(window.crypto, 'randomUUID');
    Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      await act(async () => action('Add story photo').click());
    } finally {
      if (randomUUID) Object.defineProperty(window.crypto, 'randomUUID', randomUUID);
      else Reflect.deleteProperty(window.crypto, 'randomUUID');
    }
    const photoInput = input('Story Photo 1');
    const fileInput = photoInput.closest('div')?.parentElement?.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    Object.defineProperty(fileInput!, 'files', { configurable: true, value: [new File(['image'], 'story.png', { type: 'image/png' })] });
    await act(async () => fileInput!.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => buttons()[2].click());

    expect(action('Save changes').disabled).toBe(true);
    expect(mount.textContent).toContain('Uploading images');
    await act(async () => action('Save changes').click());
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);

    await act(async () => finishUpload(Response.json({ url: '/uploads/story.png' })));
    expect(action('Save changes').disabled).toBe(false);
    await act(async () => action('Save changes').click());
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patch?.[0]).toMatch(/\/api\/v1\/tournaments\/12$/);
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ tournament: {
      name: 'Summer Open', story_photos: [{ url: '/uploads/story.png', caption: null }],
    } });
    expect(action('Save changes').disabled).toBe(true);
  });

  it('lets admins cancel leaving with edits or discard them and continue to the requested context', async () => {
    await act(async () => type(input('Event name'), 'Unsaved event'));
    await act(async () => { await router.navigate(`${path}?org=another-org`); });
    const dialog = () => document.querySelector('dialog[role="alertdialog"]');
    expect(dialog()?.textContent).toContain('Leave settings?');
    await act(async () => dialog()!.querySelector('button')!.click());
    expect(router.state.location.search).toBe('');
    expect(input('Event name').value).toBe('Unsaved event');

    await act(async () => mount.querySelector('a[href="/admin"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await act(async () => dialog()!.querySelectorAll('button')[1].click());
    expect(router.state.location.pathname).toBe('/admin');
    expect(mount.textContent).toContain('Dashboard');
  });

  it('opens the requested tab directly when ?tab=look is provided in the URL', async () => {
    await act(async () => {
      root.unmount();
    });
    router.dispose();
    router = createMemoryRouter([
      { path: '/admin/events/:tournamentSlug/settings', element: <OrgSettingsPage /> },
    ], { initialEntries: [`${path}?tab=look`] });
    root = createRoot(mount);
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(buttons()[1].textContent).toBe('Look & Photos');
    expect(buttons()[1].getAttribute('aria-selected')).toBe('true');
  });
});
