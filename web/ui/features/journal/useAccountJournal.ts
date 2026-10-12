import { english } from '../../../../shared/i18n/messages';
import { validJournal, type JournalEntry } from '../../../../shared/accounts/journal';
import { useAccountDocument } from '../accounts/useAccountDocument';

const options = {
  path: '/api/v1/me/journal',
  field: 'entries',
  empty: [] as JournalEntry[],
  valid: validJournal,
  unavailable: 'journal.unavailable',
  conflict: english('journal.yourJournalChangedInAnotherTabReloadItBeforeEditing'),
  unsaved: english('journal.yourChangeCouldNotBeSavedPleaseTryAgain'),
};
export function useAccountJournal() {
  const { items, ...document } = useAccountDocument(options);
  return { ...document, entries: items };
}
