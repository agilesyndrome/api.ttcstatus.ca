import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { MapFilterValues } from '../../../../shared/transit/types';
export type { MapFilterValues } from '../../../../shared/transit/types';
interface Props {
  value: MapFilterValues;
  onChange(value: MapFilterValues): void;
}
export function MapFilters({ value, onChange }: Props) {
  useLanguage();
  return (
    <section className="map-filters" aria-label={t('mapFilters.mapFilters')}>
      <h2>{t('mapFilters.mapLayers')}</h2>
      {(
        [
          ['live', t('mapFilters.showLiveVehicles')],
          ['overnight', t('mapFilters.includeOvernightRoutes')],
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
