import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface Confirmation {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'default';
  children?: ReactNode;
}

interface ConfirmDialogProps extends Confirmation {
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title, description, confirmLabel, tone = 'default', children, onCancel, onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const backdropPressed = useRef(false);
  const Icon = tone === 'danger' ? AlertTriangle : CheckCircle2;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      data-static-flow
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-2xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-gray-950/55"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (backdropPressed.current && event.target === event.currentTarget) onCancel();
        backdropPressed.current = false;
      }}
    >
      <div className="p-5 sm:p-6">
        <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        <p id={descriptionId} className="mt-2 break-words text-base text-gray-600">{description}</p>
        {children}
        <div className="mt-5 grid gap-2 sm:flex sm:justify-end">
          <button type="button" ref={cancelRef} onClick={onCancel}
            className="min-h-[48px] rounded-xl border border-gray-300 px-4 font-semibold hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} data-tone={tone}
            className={`min-h-[48px] rounded-xl px-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${tone === 'danger' ? 'bg-red-700 text-white hover:bg-red-800' : 'bg-brand-600 text-brand-foreground hover:bg-brand-700'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
