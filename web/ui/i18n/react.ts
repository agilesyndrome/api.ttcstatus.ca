import { useSyncExternalStore } from 'react';
import { getLanguageRevision, subscribeLanguage } from './index';
/** Subscribe without remounting the map, forms, dialogs or account provider. */
export function useLanguage() {
  useSyncExternalStore(subscribeLanguage, getLanguageRevision, () => 0);
}
