// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomepageStudio } from './HomepageStudio';
import type { HomepageConfig } from '../../utils/homepageConfig';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

function renderStudio(props: {
  orgConfig?: HomepageConfig;
  eventConfig?: HomepageConfig;
  onChangeOrgConfig?: (next: HomepageConfig) => void;
  onChangeEventConfig?: (next: HomepageConfig, preset?: string) => void;
}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <HomepageStudio
        orgName="Guam Charity Classic"
        orgConfig={props.orgConfig ?? {}}
        eventConfig={props.eventConfig ?? {}}
        themePreset="charity-bright"
        primaryColor="#0057B8"
        accentColor="#F5A623"
        eventName="Golf for Wishes 2026"
        eventDate="May 2, 2026"
        locationName="LeoPalace Resort"
        entryFeeLabel="$300/team"
        onChangeOrgConfig={props.onChangeOrgConfig ?? vi.fn()}
        onChangeEventConfig={props.onChangeEventConfig ?? vi.fn()}
      />
    );
  });
  return container;
}

describe('HomepageStudio', () => {
  it('switches theme archetype and updates event config + themePreset', async () => {
    const onChangeEventConfig = vi.fn();
    const mount = renderStudio({ onChangeEventConfig });

    const ceremonialBtn = Array.from(mount.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ceremonial Light')
    );
    expect(ceremonialBtn).toBeTruthy();

    await act(async () => {
      ceremonialBtn!.click();
    });

    expect(onChangeEventConfig).toHaveBeenCalledTimes(1);
    const [nextConfig, nextPreset] = onChangeEventConfig.mock.calls[0];
    expect(nextConfig.archetype).toBe('ceremonial-light');
    expect(nextConfig.hero_surface).toBe('light_airy');
    expect(nextPreset).toBe('memorial-formal');
  });

  it('toggles desktop and mobile live preview widths', async () => {
    const mount = renderStudio({});
    const preview = mount.querySelector('[data-testid="homepage-studio-preview"]');
    expect(preview?.getAttribute('data-preview-device')).toBe('desktop');

    const mobileBtn = mount.querySelector('button[aria-label="Mobile preview"]') as HTMLButtonElement;
    await act(async () => {
      mobileBtn.click();
    });
    expect(preview?.getAttribute('data-preview-device')).toBe('mobile');
  });

  it('updates org landing_mode when Landing Behavior changes', async () => {
    const onChangeOrgConfig = vi.fn();
    const onChangeEventConfig = vi.fn();
    const mount = renderStudio({ onChangeOrgConfig, onChangeEventConfig });

    const landingSelect = Array.from(mount.querySelectorAll('select'))[0] as HTMLSelectElement;
    await act(async () => {
      landingSelect.value = 'direct_to_active_event';
      landingSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChangeOrgConfig).toHaveBeenCalledWith(expect.objectContaining({ landing_mode: 'direct_to_active_event' }));
  });
});
