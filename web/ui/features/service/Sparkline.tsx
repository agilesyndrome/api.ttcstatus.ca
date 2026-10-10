import type { ServiceHistoryResponse } from '../../../../shared/service/contracts';

/** The stop's "today so far" sparkline (sla.md story 5.4): per-bucket touches
 * and gaps across the 36-hour window, at the 5-minute grain. Bars show
 * touches; a bucket whose worst gap is egregious tints toward the void
 * colour — the day view as honest geometry. */
export function Sparkline({ history }: { history: ServiceHistoryResponse }) {
  const series = history.bucketSeries ?? [];
  if (series.length === 0) return null;
  const width = 480;
  const height = 90;
  const span = Math.max(1, history.to - history.from);
  const maxTouches = Math.max(
    1,
    ...series.flatMap((entry) => entry.buckets.map((bucket) => bucket.n)),
  );
  return (
    <svg
      className="service-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Touches per 5-minute bucket over the last 36 hours"
    >
      {series.flatMap((entry, entryIndex) =>
        entry.buckets.map((bucket) => {
          const x = ((bucket.bucketStart - history.from) / span) * width;
          const barHeight = Math.max(2, (bucket.n / maxTouches) * (height - 10));
          const egregious = bucket.maxGapSeconds >= 900;
          return (
            <rect
              key={`${entry.stopId}-${bucket.bucketStart}-${entryIndex}`}
              className={
                egregious
                  ? 'service-sparkline__bar service-sparkline__bar--gap'
                  : 'service-sparkline__bar'
              }
              x={x}
              y={height - barHeight}
              width={Math.max(1.2, width / 432 - 0.4)}
              height={barHeight}
            >
              <title>{`${new Date(bucket.bucketStart).toLocaleString()}: ${bucket.n} touches, worst gap ${Math.round(bucket.maxGapSeconds / 60)} min${bucket.backToBack > 0 ? `, ${bucket.backToBack} back-to-back` : ''}`}</title>
            </rect>
          );
        }),
      )}
      <line
        x1={0}
        x2={width}
        y1={height - 0.5}
        y2={height - 0.5}
        stroke="var(--border)"
      />
    </svg>
  );
}
