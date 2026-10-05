import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useId, useMemo } from 'react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import { formatDistance } from '../../commute';
import { compareStops } from './comparison';

export type PickingStop = 'from' | 'to';
interface Props {
  data: ViewerData;
  fromId?: string;
  toId?: string;
  picking?: PickingStop;
  includeOvernight: boolean;
  onChange(fromId?: string, toId?: string): void;
  onPick(value?: PickingStop): void;
  onOvernight(value: boolean): void;
  onRoute(id: string): void;
}
const boarding = (feature?: Feature) =>
  feature?.accessible
    ? t('viewer.listedAtOneOrMoreBoardingPoints')
    : t('stopComparison.notConfirmedInThisMap');
export function StopComparison({
  data,
  fromId,
  toId,
  picking,
  includeOvernight,
  onChange,
  onPick,
  onOvernight,
  onRoute,
}: Props) {
  useLanguage();
  const id = useId();
  const stops = useMemo(
    () =>
      data.features
        .filter((feature) => feature.boardingPoints > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const from = stops.find((stop) => stop.id === fromId),
    to = stops.find((stop) => stop.id === toId);
  const comparison = useMemo(
    () => (from && to ? compareStops(data, from, to, includeOvernight) : undefined),
    [data, from, to, includeOvernight],
  );
  function change(nextFrom?: string, nextTo?: string) {
    onPick(undefined);
    onChange(nextFrom, nextTo);
  }
  return (
    <section className="stop-comparison" aria-label={t('stopComparison.stopComparison')}>
      <p className="eyebrow">{t('stopComparison.twoStopsOneCity')}</p>
      <h1>{t('stopComparison.compareStops')}</h1>
      <p className="helper">
        {t(
          'stopComparison.chooseTwoBoardingStopsToCompareDistanceAccessibilityAndScheduled',
        )}
      </p>
      <div className="tool-form">
        <div className="form-control">
          <label htmlFor={`${id}-start`}>{t('stopComparison.startStop')}</label>
          <select
            id={`${id}-start`}
            value={from?.id ?? ''}
            onChange={(event) => change(event.target.value || undefined, toId)}
          >
            <option value="">{t('stopComparison.chooseAStart')}</option>
            {stops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="action-button"
          aria-pressed={picking === 'from'}
          onClick={() => onPick(picking === 'from' ? undefined : 'from')}
        >
          {t('stopComparison.pickStartStopOnMap')}
        </button>
        <div className="form-control">
          <label htmlFor={`${id}-destination`}>
            {t('stopComparison.destinationStop')}
          </label>
          <select
            id={`${id}-destination`}
            value={to?.id ?? ''}
            onChange={(event) => change(fromId, event.target.value || undefined)}
          >
            <option value="">{t('stopComparison.chooseADestination')}</option>
            {stops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="action-button"
          aria-pressed={picking === 'to'}
          onClick={() => onPick(picking === 'to' ? undefined : 'to')}
        >
          {t('stopComparison.pickDestinationStopOnMap')}
        </button>
        <div className="comparison-actions">
          <button
            className="action-button"
            disabled={!from && !to}
            onClick={() => change(toId, fromId)}
          >
            {t('stopComparison.swapStops')}
          </button>
          <button
            className="text-button"
            disabled={!fromId && !toId && !picking}
            onClick={() => change()}
          >
            {t('stopComparison.clearComparison')}
          </button>
        </div>
        <label className="accessible-filter">
          <input
            type="checkbox"
            checked={includeOvernight}
            onChange={(event) => onOvernight(event.target.checked)}
          />{' '}
          {t('stopComparison.includeOvernightConnections')}
        </label>
      </div>
      {picking && (
        <p role="status" className="tip">
          {t('stopComparison.chooseAValueBoardingStopOnTheMapOrUse', {
            end:
              picking === 'from'
                ? t('stopComparison.start')
                : t('stopComparison.destination'),
          })}{' '}
          <button className="text-button" onClick={() => onPick(undefined)}>
            {t('stopComparison.cancelPicking')}
          </button>
        </p>
      )}
      {comparison && from && to ? (
        <div className="comparison-result" aria-live="polite">
          <div className="comparison-summary">
            <strong>{formatDistance(comparison.metres)}</strong>
            <small>{t('stopComparison.straightLineDistance')}</small>
          </div>
          <dl className="stop-facts">
            <dt>
              {t('stopComparison.a')} {from.name}
            </dt>
            <dd>
              {t('stopComparison.accessibleBoarding')} {boarding(from)}
            </dd>
            <dt>
              {t('stopComparison.b')} {to.name}
            </dt>
            <dd>
              {t('stopComparison.accessibleBoarding')} {boarding(to)}
            </dd>
          </dl>
          <h2>{t('stopComparison.scheduledConnections')}</h2>
          {comparison.sameStop ? (
            <p className="tip">
              {t('stopComparison.youVeChosenTheSameStopTwiceChooseADifferent')}
            </p>
          ) : !comparison.available ? (
            <p className="tip">
              {t(
                'stopComparison.routeConnectionsAreUnavailableForThisMapDistanceAndBoarding',
              )}
            </p>
          ) : comparison.connections.length ? (
            <div className="connection-list">
              {comparison.connections.map((connection) => (
                <article key={connection.route.id} className="connection-card">
                  <button
                    className="action-button"
                    onClick={() => onRoute(connection.route.id)}
                  >
                    {t('stopComparison.highlight')} {connection.route.number}{' '}
                    {connection.route.name}
                  </button>
                  <p>
                    {connection.minimumStopsBetween === connection.maximumStopsBetween
                      ? connection.minimumStopsBetween
                      : `${connection.minimumStopsBetween}–${connection.maximumStopsBetween}`}{' '}
                    {connection.maximumStopsBetween === 1
                      ? t('commute.stop')
                      : t('commute.stops')}{' '}
                    {t('stopComparison.betweenTheseBoardingPoints')}
                    {connection.route.overnight && t('stopComparison.overnight')}
                  </p>
                  {connection.headsigns.length > 0 && (
                    <details>
                      <summary>{t('viewer.scheduledDestinations')}</summary>
                      <ul>
                        {connection.headsigns.map((headsign) => (
                          <li key={headsign}>{headsign}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="tip">
              {t('stopComparison.noDirectRailConnectionIsListedInThisDirection')}
              {includeOvernight ? '' : t('stopComparison.onDaytimeRoutes')}
              {t('stopComparison.trySwappingStopsOrIncludingOvernightConnections')}
            </p>
          )}
          <p className="microcopy">
            {t('stopComparison.connectionsUseRoutesInThisMapThatServeTheStart')}
          </p>
        </div>
      ) : (
        <p className="tip">
          {t('stopComparison.startAndDestinationWillAppearAsAAndBOn')}
        </p>
      )}
    </section>
  );
}
