export interface MapFilterValues {
  live: boolean;
  labels: boolean;
  overnight: boolean;
}
interface Props {
  value: MapFilterValues;
  onChange(value: MapFilterValues): void;
}
export function MapFilters({ value, onChange }: Props) {
  return (
    <section className="map-filters" aria-label="Map filters">
      <h2>Map layers</h2>
      {(
        [
          ['live', 'Show live streetcars'],
          ['labels', 'More stop labels'],
          ['overnight', 'Include overnight routes'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
          />
          {label}
        </label>
      ))}
    </section>
  );
}
