interface BrandMarkProps {
  className?: string;
}

/**
 * Geometric "S" rendered as a 3-row stack of bars. Sharper and more distinctive
 * than a generic compass icon. Designed to read clearly at 24px or smaller.
 */
export const BrandMark = ({ className }: BrandMarkProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="SyncTrip"
    className={className}
    fill="none"
  >
    <rect x="3" y="3" width="18" height="4" rx="1" fill="currentColor" />
    <rect x="3" y="10" width="18" height="4" rx="1" fill="currentColor" opacity="0.85" />
    <rect x="3" y="17" width="18" height="4" rx="1" fill="currentColor" opacity="0.55" />
    <rect x="17" y="3" width="4" height="11" rx="1" fill="currentColor" opacity="0" />
    <rect x="3" y="10" width="4" height="11" rx="1" fill="currentColor" opacity="0" />
  </svg>
);
