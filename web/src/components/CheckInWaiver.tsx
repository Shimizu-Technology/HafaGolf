import { useState } from 'react';
import { Check } from 'lucide-react';
import toast from 'react-hot-toast';

interface CheckInWaiverProps {
  name: string;
  acceptedAt: string | null | undefined;
  onSign: () => Promise<void>;
}

export function CheckInWaiver({ name, acceptedAt, onSign }: CheckInWaiverProps) {
  const [saving, setSaving] = useState(false);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {acceptedAt ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
          Waiver <Check className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">signed for {name}</span>
        </span>
      ) : (
        <>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Needs Waiver
          </span>
          <button
            type="button"
            disabled={saving}
            aria-label={`Mark Waiver Signed for ${name}`}
            className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-50 disabled:opacity-60"
            onClick={async (event) => {
              event.stopPropagation();
              setSaving(true);
              try {
                await onSign();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Could not record the waiver');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving waiver…' : 'Mark Waiver Signed'}
          </button>
        </>
      )}
    </div>
  );
}
