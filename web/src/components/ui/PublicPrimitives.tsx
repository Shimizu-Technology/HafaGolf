import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { ThemePackDefinition } from '../../utils/themePacks';

export type StatusTone = 'open' | 'waitlist' | 'closed' | 'coming_soon' | 'in_progress';

export interface StatusPillProps {
  label: string;
  tone: StatusTone;
  onDark?: boolean;
  className?: string;
}

const LIGHT_TONES: Record<StatusTone, string> = {
  open: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20',
  waitlist: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-600/25',
  in_progress: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-600/25',
  coming_soon: 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-600/20',
  closed: 'bg-neutral-100 text-neutral-700 ring-1 ring-inset ring-neutral-300',
};

const DARK_TONES: Record<StatusTone, string> = {
  open: 'bg-emerald-400/20 text-emerald-100 ring-1 ring-inset ring-emerald-300/40',
  waitlist: 'bg-amber-400/25 text-amber-100 ring-1 ring-inset ring-amber-300/45',
  in_progress: 'bg-amber-400/25 text-amber-100 ring-1 ring-inset ring-amber-300/45',
  coming_soon: 'bg-white/15 text-white ring-1 ring-inset ring-white/30',
  closed: 'bg-white/90 text-slate-800 ring-1 ring-inset ring-white/40',
};

const DOT_TONES: Record<StatusTone, string> = {
  open: 'bg-emerald-500',
  waitlist: 'bg-amber-500',
  in_progress: 'bg-amber-500',
  coming_soon: 'bg-brand-500',
  closed: 'bg-neutral-400',
};

/**
 * Uniform eyebrow status pill. Always placed ABOVE headlines — never beside interactive CTA buttons.
 */
export function StatusPill({ label, tone, onDark = false, className = '' }: StatusPillProps) {
  const palette = onDark ? DARK_TONES[tone] : LIGHT_TONES[tone];
  return (
    <span
      data-status-pill={tone}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold tracking-wide ${palette} ${className}`.trim()}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONES[tone]}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export type ActionButtonVariant = 'primary' | 'secondary' | 'amber' | 'on-dark-primary' | 'on-dark-secondary';

export interface ActionButtonProps {
  to?: string;
  onClick?: () => void;
  variant?: ActionButtonVariant;
  pack?: ThemePackDefinition;
  fullWidth?: boolean;
  icon?: ReactNode;
  showArrow?: boolean;
  children: ReactNode;
  className?: string;
}

function radiusForPack(pack?: ThemePackDefinition): string {
  if (!pack) return 'rounded-xl';
  if (pack.id === 'memorial-formal' || pack.id === 'crest-classic') return 'rounded-lg';
  return 'rounded-full';
}

const VARIANT_CLASSES: Record<ActionButtonVariant, string> = {
  primary: 'bg-brand-700 hover:bg-brand-800 text-brand-foreground shadow-sm',
  secondary: 'border border-brand-700/80 bg-white hover:bg-brand-50 text-brand-800',
  amber: 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm',
  'on-dark-primary': 'bg-white text-brand-900 hover:bg-white/95 shadow-sm',
  'on-dark-secondary': 'border border-white/45 bg-white/10 text-white hover:bg-white/20 backdrop-blur-xs',
};

/**
 * Uniform interactive button used across all public heroes and cards (identical 44px min height & consistent radius).
 */
export function ActionButton({
  to,
  onClick,
  variant = 'primary',
  pack,
  fullWidth = false,
  icon,
  showArrow = true,
  children,
  className = '',
}: ActionButtonProps) {
  const radius = radiusForPack(pack);
  const classes = [
    'inline-flex min-h-[44px] items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
    radius,
    VARIANT_CLASSES[variant],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {icon}
      <span>{children}</span>
      {showArrow && <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}

export interface ActionCardProps {
  to: string;
  pack: ThemePackDefinition;
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  iconTone?: 'brand' | 'accent';
  title: string;
  description: string;
  ctaLabel: string;
  ctaIcon?: ComponentType<{ className?: string; strokeWidth?: number | string }>;
}

/**
 * Uniform action card for Play & Support / Support the Cause grids:
 * identical tinted icon chip inline with heading, flex-1 description, and bottom-aligned CTA.
 */
export function ActionCard({
  to,
  pack,
  icon: Icon,
  iconTone = 'brand',
  title,
  description,
  ctaLabel,
  ctaIcon: CtaIcon,
}: ActionCardProps) {
  const chipClass =
    iconTone === 'accent'
      ? 'bg-accent-500/12 text-accent-700'
      : 'bg-brand-600/10 text-brand-700';

  return (
    <Link
      to={to}
      data-action-card="true"
      className={`group flex h-full flex-col ${pack.surfaces.cardClass} p-6`}
    >
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${chipClass}`}>
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h3 className={`${pack.typography.cardTitleClass} text-lg leading-snug`}>{title}</h3>
      </div>
      <p className="mb-5 flex-1 text-sm leading-relaxed text-neutral-600">{description}</p>
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors group-hover:text-brand-800">
        {CtaIcon && <CtaIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
        <span>{ctaLabel}</span>
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
