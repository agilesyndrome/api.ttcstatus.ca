import { useMemo, useState } from 'react';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { ViewerData } from '../../../../shared/map/model';
import { t } from '../../i18n';
import { vehicleJourney, type JourneyStop } from './vehicle-journey';

function StopRows({
  stops,
  previous = false,
}: {
  stops: JourneyStop[];
  previous?: boolean;
}) {
  return (
    <ol
      className={`vehicle-journey__stops${previous ? ' vehicle-journey__stops--previous' : ''}`}
    >
      {stops.map((stop, index) => (
        <li
          key={`${stop.id}-${stop.sequence}`}
          className={index === 0 && !previous ? 'is-next' : undefined}
        >
          <span className="vehicle-journey__node" aria-hidden="true" />
          <span>{stop.name}</span>
        </li>
      ))}
    </ol>
  );
}

export function VehicleJourney({ data, car }: { data: ViewerData; car: PlottedVehicle }) {
  const [expanded, setExpanded] = useState(false);
  const journey = useMemo(() => vehicleJourney(data, car), [data, car]);
  const upcoming = journey?.upcoming ?? [];
  const visible = expanded ? upcoming : upcoming.slice(0, 7);
  return (
    <section
      className="vehicle-journey"
      aria-label={t('vehicleJourney.title')}
      aria-live="off"
    >
      <div className="vehicle-journey__heading">
        <span className="eyebrow">{t('vehicleJourney.title')}</span>
        {journey?.headsign && (
          <p>{t('vehicleJourney.patternHint', { value1: journey.headsign })}</p>
        )}
      </div>
      {!journey ? (
        <p className="microcopy">{t('vehicleJourney.unavailable')}</p>
      ) : (
        <>
          {journey.previous.length > 0 && (
            <div className="vehicle-journey__group">
              <h2>{t('vehicleJourney.earlier')}</h2>
              <StopRows stops={journey.previous} previous />
            </div>
          )}
          <div className="vehicle-journey__group">
            <h2>{t('vehicleJourney.upNext')}</h2>
            {upcoming[0] && (
              <span className="sr-only" aria-live="polite">
                {t('vehicleJourney.nextStop', { value1: upcoming[0].name })}
              </span>
            )}
            <StopRows stops={visible} />
            {upcoming.length > 7 && (
              <button
                className="vehicle-journey__more"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? t('vehicleJourney.fewerStops')
                  : t('vehicleJourney.moreStops', { value1: upcoming.length - 7 })}
              </button>
            )}
          </div>
          <p className="vehicle-journey__note">{t('vehicleJourney.estimateNote')}</p>
        </>
      )}
    </section>
  );
}
