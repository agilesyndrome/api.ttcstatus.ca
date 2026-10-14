/** Stable cohort assignment for progressive feature rollout.
 *
 * The subject is the verified Clerk user id. FNV-1a is small, deterministic,
 * and independent of runtime or platform locale; the modulo result is a
 * bucket in [0, 99]. This function deliberately has no I/O so it can be used
 * by the Worker and its tests without a database or browser globals.
 */
export function featureCohortBucket(flag: string, subject: string): number {
  let hash = 2166136261;
  for (const character of `${flag}:${subject}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}

export function featureCohortIncludes(
  flag: string,
  subject: string,
  percentage: number,
): boolean {
  return (
    Number.isInteger(percentage) &&
    percentage > 0 &&
    percentage <= 100 &&
    featureCohortBucket(flag, subject) < percentage
  );
}
