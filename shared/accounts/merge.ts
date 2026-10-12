import { validSavedStops } from './saved-stops';
import { validJournal, type JournalEntry } from './journal';

/** Three-way set merge: retain remote edits, apply local additions/removals. */
export function mergeSavedStops(
  base: string[],
  draft: string[],
  current: string[],
): string[] | null {
  const removed = new Set(base.filter((id) => !draft.includes(id)));
  const additions = draft.filter((id) => !base.includes(id));
  const merged = [
    ...new Set([...current.filter((id) => !removed.has(id)), ...additions]),
  ];
  return validSavedStops(merged) ? merged : null;
}

const same = (a: JournalEntry | undefined, b: JournalEntry | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    JSON.stringify(a, Object.keys(a).sort()) ===
      JSON.stringify(b, Object.keys(b).sort()));

/** Merge by canonical vehicle identity. Concurrent edits to the same entry need
 * an explicit choice; unrelated remote entries are retained even with that choice. */
export function mergeJournal(
  base: JournalEntry[],
  draft: JournalEntry[],
  current: JournalEntry[],
  preferDraft = false,
): JournalEntry[] | null {
  const original = new Map(base.map((entry) => [entry.vehicleId, entry]));
  const local = new Map(draft.map((entry) => [entry.vehicleId, entry]));
  const remote = new Map(current.map((entry) => [entry.vehicleId, entry]));
  const merged: JournalEntry[] = [];
  for (const id of new Set([...remote.keys(), ...local.keys(), ...original.keys()])) {
    const before = original.get(id),
      mine = local.get(id),
      theirs = remote.get(id);
    const localChanged = !same(before, mine);
    const remoteChanged = !same(before, theirs);
    if (localChanged && remoteChanged && !same(mine, theirs) && !preferDraft) return null;
    const entry = localChanged ? mine : theirs;
    if (entry) merged.push(entry);
  }
  return validJournal(merged) ? merged : null;
}
