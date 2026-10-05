import { english } from '../../../../shared/i18n/messages';
export interface SavedComparison {
  name: string;
  fromId: string;
  toId: string;
  overnight: boolean;
}
export const SAVED_COMPARISON_LIMIT = 20;
export const comparisonKey = (entry: Pick<SavedComparison, 'fromId' | 'toId'>) =>
  JSON.stringify([entry.fromId, entry.toId]);
export function validSavedComparisons(value: unknown): value is SavedComparison[] {
  if (!Array.isArray(value) || value.length > SAVED_COMPARISON_LIMIT) return false;
  if (
    !value.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.name === 'string' &&
        entry.name.trim().length > 0 &&
        entry.name.length <= 60 &&
        typeof entry.fromId === 'string' &&
        entry.fromId.length > 0 &&
        entry.fromId.length <= 200 &&
        typeof entry.toId === 'string' &&
        entry.toId.length > 0 &&
        entry.toId.length <= 200 &&
        entry.fromId !== entry.toId &&
        typeof entry.overnight === 'boolean',
    )
  )
    return false;
  return new Set(value.map(comparisonKey)).size === value.length;
}

export function saveComparison(
  current: SavedComparison[],
  entry: SavedComparison,
): SavedComparison[] {
  if (!validSavedComparisons(current) || !validSavedComparisons([entry]))
    throw new Error(english('saved-comparisons.chooseTwoDifferentStopsAndANameOfUpTo'));
  if (current.some((item) => comparisonKey(item) === comparisonKey(entry)))
    return current;
  if (current.length >= SAVED_COMPARISON_LIMIT)
    throw new Error(
      english('saved-comparisons.your20SavedComparisonsAreFullRemoveOneToSave'),
    );
  return [...current, entry];
}
