import { sponsorInitials } from '../../utils/sponsorTeams';

const SIZE_CLASSES = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-14 w-14 text-lg',
  lg: 'h-16 w-16 text-xl',
} as const;

/**
 * Typographic monogram shown when a sponsor has no logo yet. Uses the brand
 * palette so it reads as intentional rather than a missing image.
 */
export function SponsorMonogram({
  name,
  size = 'md',
  className = '',
}: {
  name: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${name} monogram`}
      data-testid="sponsor-monogram"
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold tracking-wide text-brand-700 ring-1 ring-inset ring-brand-200 ${SIZE_CLASSES[size]} ${className}`}
    >
      {sponsorInitials(name)}
    </span>
  );
}
