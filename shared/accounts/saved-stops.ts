/** Saved stops are a bounded list of opaque map feature ids, shared by API and UI. */
export const SAVED_STOPS_LIMIT = 100;

export function validSavedStops(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= SAVED_STOPS_LIMIT &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
  );
}
