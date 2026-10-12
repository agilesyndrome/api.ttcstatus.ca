import { getLocale } from './i18n';
export * from '../../shared/transit/types';
export * from '../../shared/transit/filters';
export * from '../../shared/transit/nearby';
export * from '../../shared/transit/links';
export { validSavedStops } from '../../shared/accounts/saved-stops';

/** Locale-aware presentation stays at the UI boundary. */
export function formatDistance(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres / 10) * 10} m`
    : `${new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(metres / 1000)} km`;
}
