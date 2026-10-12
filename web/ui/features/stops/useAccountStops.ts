import { english } from '../../../../shared/i18n/messages';
import { validSavedStops } from '../../../../shared/accounts/saved-stops';
import { useAccountDocument } from '../accounts/useAccountDocument';

const options = {
  path: '/api/v1/me/stops',
  field: 'stopIds',
  empty: [] as string[],
  valid: validSavedStops,
  unavailable: 'saved-stops.unavailable',
  conflict: english('savedStops.yourSavedStopsChangedInAnotherTabReloadThem'),
  unsaved: english('savedStops.yourChangeCouldNotBeSavedPleaseTry'),
};
export function useAccountStops() {
  const { items, ...document } = useAccountDocument(options);
  return { ...document, stopIds: items };
}
