/** Additive 409 contract: the submitted draft stays on the device; this is the
 * owner's current server document to compare/merge before a revision-checked retry. */
export interface RevisionConflict<T> {
  error: string;
  revision: number;
  current: T & { revision: number };
}
