import type { ReactNode } from 'react';

export type BannerTone = 'neutral' | 'positive' | 'warning' | 'negative';

export interface BannerProps {
  title: ReactNode;
  detail?: ReactNode;
  tone?: BannerTone;
  ariaLabel?: string;
  className?: string;
}

/** A compact, status-aware message surface. The content is deliberately
 * generic so features can supply their own domain language and metrics. */
export function Banner({
  title,
  detail,
  tone = 'neutral',
  ariaLabel,
  className,
}: BannerProps) {
  return (
    <section
      className={['banner', `banner--${tone}`, className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      <p className="banner__title">{title}</p>
      {detail !== undefined && <p className="banner__detail">{detail}</p>}
    </section>
  );
}
