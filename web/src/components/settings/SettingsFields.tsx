import type { ChangeEvent, ComponentProps, ReactNode } from 'react';

export const settingsInput = 'block min-h-[48px] w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';
export const settingsButton = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50';

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl bg-white p-4 shadow-sm sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
      </div>
      {children}
    </section>
  );
}

interface FieldProps extends Omit<ComponentProps<'input'>, 'onChange' | 'value' | 'size'> {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  help?: string;
}

export function SettingsInput({ label, value, onChange, help, ...props }: FieldProps) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block text-sm font-medium text-gray-800">{label}</span>
      <input className={settingsInput} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
      {help && <span className="block text-sm text-gray-600">{help}</span>}
    </label>
  );
}

export function SettingsTextarea({ label, value, onChange, help, ...props }: Omit<ComponentProps<'textarea'>, 'onChange' | 'value'> & {
  label: string; value: string; onChange: (value: string) => void; help?: string;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block text-sm font-medium text-gray-800">{label}</span>
      <textarea className={settingsInput} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
      {help && <span className="block text-sm text-gray-600">{help}</span>}
    </label>
  );
}

export function SettingsCheckbox({ label, checked, onChange, help }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; help?: string;
}) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg text-base text-gray-800">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-brand-600" />
      <span>
        {label}
        {help && <span className="block text-sm text-gray-600">{help}</span>}
      </span>
    </label>
  );
}

export function SettingsSelect({ label, value, onChange, children }: {
  label: string; value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void; children: ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block text-sm font-medium text-gray-800">{label}</span>
      <select className={settingsInput} value={value} onChange={onChange}>{children}</select>
    </label>
  );
}
