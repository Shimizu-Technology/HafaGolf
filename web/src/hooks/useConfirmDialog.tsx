import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmDialog, type Confirmation } from '../components/ConfirmDialog';

export function useConfirmDialog() {
  const [options, setOptions] = useState<Confirmation | null>(null);
  const pending = useRef<((result: boolean) => void) | null>(null);

  const requestConfirmation = useCallback((confirmation: Confirmation) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setOptions(confirmation);
    });
  }, []);

  useLayoutEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, []);

  const settle = (result: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(result);
  };

  return {
    requestConfirmation,
    confirmationDialog: options && (
      <ConfirmDialog {...options} onCancel={() => settle(false)} onConfirm={() => settle(true)} />
    ),
  };
}
