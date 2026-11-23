// @vitest-environment jsdom
import { useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDialog } from '../test/mockDialog';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
mockDialog();

describe('ConfirmDialog', () => {
  let root: ReturnType<typeof createRoot>;
  let mount: HTMLDivElement;

  function Fixture() {
    const { requestConfirmation, confirmationDialog } = useConfirmDialog();
    const [result, setResult] = useState('');
    return (
      <>
        <button onClick={async () => setResult(await requestConfirmation({
          title: 'Delete prize?', description: 'The prize will be removed.', confirmLabel: 'Delete prize', tone: 'danger',
        }) ? 'confirmed' : 'cancelled')}>Remove</button>
        <output>{result}</output>
        {confirmationDialog}
      </>
    );
  }

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.append(mount);
    root = createRoot(mount);
    act(() => root.render(<Fixture />));
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
  });

  function open() {
    const trigger = mount.querySelector('button')!;
    trigger.focus();
    act(() => trigger.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog[role="alertdialog"]')!;
    return { trigger, dialog, cancel: dialog.querySelector('button')!, approve: dialog.querySelectorAll('button')[1] };
  }

  it('opens a modal with its accessible name, description, danger tone, and focus on Cancel', () => {
    const { dialog, cancel, approve } = open();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Delete prize?');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('The prize will be removed.');
    expect(document.activeElement).toBe(cancel);
    expect(approve.dataset.tone).toBe('danger');
  });

  it('confirms and restores focus to the trigger', async () => {
    const { trigger, approve } = open();
    await act(async () => approve.click());
    expect(mount.querySelector('output')?.textContent).toBe('confirmed');
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels using the Cancel button', async () => {
    const { trigger, cancel } = open();
    await act(async () => cancel.click());
    expect(mount.querySelector('output')?.textContent).toBe('cancelled');
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels on the browser dialog event fired by Escape', async () => {
    const { trigger, dialog } = open();
    await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
    expect(mount.querySelector('output')?.textContent).toBe('cancelled');
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels on a backdrop click', async () => {
    const { dialog } = open();
    await act(async () => {
      dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      dialog.click();
    });
    expect(mount.querySelector('output')?.textContent).toBe('cancelled');
    expect(document.querySelector('dialog')).toBeNull();
  });
});
