// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactPage } from './ContactPage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('ContactPage', () => {
  it('validates required fields and submits inquiries to the platform API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ submitted: true }), { status: 201 })
    );

    act(() => {
      root.render(<ContactPage />);
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain('Please enter your name.');
    expect(fetchMock).not.toHaveBeenCalled();

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;

    act(() => {
      setInputValue(inputs[0], 'Jordan Reyes');
      setInputValue(inputs[1], 'jordan@example.test');
      setInputValue(inputs[2], 'Island Charity Club');
      setInputValue(textarea, 'We are planning a charity tournament and want a quick walkthrough.');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/api/v1/platform/inquiries');
    expect(container.textContent).toContain('Message received');
  });

  it('offers a direct mailto fallback when the API is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));

    act(() => {
      root.render(<ContactPage />);
    });

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
    const form = container.querySelector('form')!;

    act(() => {
      setInputValue(inputs[0], 'Jordan Reyes');
      setInputValue(inputs[1], 'jordan@example.test');
      setInputValue(textarea, 'Testing fallback when the server is paused.');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Open in your email app instead');
  });

  it('disables all fields while submitting and confirms the submitted email', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
    );

    act(() => {
      root.render(<ContactPage />);
    });

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
    const form = container.querySelector('form')!;

    act(() => {
      setInputValue(inputs[0], 'Jordan Reyes');
      setInputValue(inputs[1], 'submitted@example.test');
      setInputValue(textarea, 'Testing pending state while submitting an inquiry.');
    });

    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const fieldset = container.querySelector('fieldset')!;
    expect(fieldset.disabled).toBe(true);

    // Even if a script mutates state mid-flight, confirmation shows the submitted snapshot
    act(() => {
      setInputValue(inputs[1], 'changed-mid-flight@example.test');
    });

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ submitted: true }), { status: 201 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('submitted@example.test');
    expect(container.textContent).not.toContain('changed-mid-flight@example.test');
  });
});
