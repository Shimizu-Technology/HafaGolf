// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from './appRoutes';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./pages/PlatformHomePage', () => ({ PlatformHomePage: () => <h1>Platform homepage</h1> }));
vi.mock('./pages/OrganizationLandingPage', () => ({ OrganizationLandingPage: () => <h1>Tenant landing page</h1> }));
vi.mock('./admin/AdminRoutesApp', () => ({ default: () => <h1>Admin console</h1> }));
vi.mock('./providers/PostHogProvider', () => ({ PostHogPageView: () => null }));
vi.mock('./components/OrganizationProvider', () => ({
  OrganizationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useOrganization: () => ({ organization: null, isLoading: false, error: null }),
}));

declare const jsdom: { reconfigure: (options: { url: string }) => void };

let container: HTMLDivElement;
let root: Root;

async function visit(url: string) {
  const parsed = new URL(url);
  jsdom.reconfigure({ url: parsed.origin + '/' });
  const router = createMemoryRouter(appRoutes, { initialEntries: [parsed.pathname + parsed.search] });
  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });
  for (let attempt = 0; attempt < 20 && !container.querySelector('h1'); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  return container.querySelector('h1')?.textContent;
}

beforeEach(() => {
  vi.stubEnv('VITE_DEFAULT_ORG_SLUG', '');
  vi.stubEnv('VITE_ADMIN_ORIGIN', 'https://golf.shimizu-technology.com');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  jsdom.reconfigure({ url: 'http://localhost:3000/' });
});

describe('root and platform routing', () => {
  it('renders the platform homepage at / on the admin host instead of redirecting to /admin', async () => {
    expect(await visit('https://golf.shimizu-technology.com/')).toBe('Platform homepage');
  });

  it('keeps /admin routable to the console on the admin host and localhost', async () => {
    expect(await visit('https://golf.shimizu-technology.com/admin')).toBe('Admin console');
    act(() => root.unmount());
    root = createRoot(container);
    expect(await visit('http://localhost:5173/admin/events')).toBe('Admin console');
  });

  it('renders the platform homepage on bare localhost', async () => {
    expect(await visit('http://localhost:5173/')).toBe('Platform homepage');
  });

  it('renders the tenant landing page on localhost when ?org= picks a tenant', async () => {
    expect(await visit('http://localhost:5173/?org=sample-club')).toBe('Tenant landing page');
  });

  it('renders the tenant landing page on localhost when a default org slug is configured', async () => {
    vi.stubEnv('VITE_DEFAULT_ORG_SLUG', 'sample-club');
    expect(await visit('http://localhost:5173/')).toBe('Tenant landing page');
  });

  it('leaves tenant custom domains on their own landing page', async () => {
    expect(await visit('https://club.example.com/')).toBe('Tenant landing page');
  });

  it.each(['/platform', '/about'])('renders the platform homepage at %s on any host', async (path) => {
    expect(await visit(`https://club.example.com${path}`)).toBe('Platform homepage');
  });

  it('renders legal and contact pages on /privacy, /terms, and /contact', async () => {
    expect(await visit('https://golf.shimizu-technology.com/privacy')).toBe('Privacy Policy');
    act(() => root.unmount());
    root = createRoot(container);
    expect(await visit('https://golf.shimizu-technology.com/terms')).toBe('Terms of Service');
    act(() => root.unmount());
    root = createRoot(container);
    expect(await visit('https://golf.shimizu-technology.com/contact')).toBe('Talk with the HafaGolf team.');
  });
});
