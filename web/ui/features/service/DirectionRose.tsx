import type { CompassKey } from './wave-field';

export interface RoseOption {
  stopId: string;
  compass: CompassKey;
}

const WORD: Record<CompassKey, string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
};
const ARROW: Record<CompassKey, string> = {
  north: '↑',
  east: '→',
  south: '↓',
  west: '←',
};

/** The compass rose (the street test): every direction sits at its own
 * compass position — East right of West, North above South — and NEVER
 * moves. Selection is a highlight on the button that was already there,
 * never a reorder: fast hands learn one layout, and a button that jumps
 * is a lie to them. East/West-only stops get the horizontal pair (no
 * large rose), North/South-only the vertical pair; a mixed intersection
 * gets the full rose. */
export function DirectionRose({
  options,
  value,
  onChange,
  label = 'Boarding direction',
}: {
  options: RoseOption[];
  value: string;
  onChange: (stopId: string) => void;
  label?: string;
}) {
  if (options.length === 0) return null;
  const vertical = options.every(
    (option) => option.compass === 'north' || option.compass === 'south',
  );
  const horizontal = options.every(
    (option) => option.compass === 'east' || option.compass === 'west',
  );
  // The fixed position order — the whole point is that it never varies.
  const order: readonly CompassKey[] = vertical
    ? ['north', 'south']
    : horizontal
      ? ['west', 'east']
      : ['north', 'west', 'east', 'south'];
  const entries = order.flatMap((key) => options.filter((option) => option.compass === key));
  const layout = vertical ? 'pair-column' : horizontal ? 'pair-row' : 'full';
  return (
    <div
      className={`direction-rose direction-rose--${layout}`}
      role="group"
      aria-label={label}
    >
      {entries.map((option) => (
        <button
          type="button"
          key={option.stopId}
          data-compass={option.compass}
          aria-pressed={option.stopId === value}
          onClick={() => onChange(option.stopId)}
        >
          {ARROW[option.compass]} {WORD[option.compass]}
        </button>
      ))}
    </div>
  );
}