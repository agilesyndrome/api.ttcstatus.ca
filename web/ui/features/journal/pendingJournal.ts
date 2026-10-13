/** Keep a car action through an authentication redirect in this browser tab. */
const key = 'ttc:pending-journal:v1';
const lifetimeMs = 30 * 60 * 1000;

interface PendingJournal {
  vehicleId: string;
  label: string;
  createdAt: number;
}

let memory: PendingJournal | undefined;

export function rememberPendingJournal(vehicleId: string, label: string) {
  memory = { vehicleId, label, createdAt: Date.now() };
  try {
    sessionStorage.setItem(key, JSON.stringify(memory));
  } catch {
    // The in-memory copy still handles sign-in without a page redirect.
  }
}

export function readPendingJournal(): PendingJournal | undefined {
  let value: unknown = memory;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) value = JSON.parse(stored);
  } catch {
    // A blocked storage API must not interrupt sign-in.
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('vehicleId' in value) ||
    typeof value.vehicleId !== 'string' ||
    !value.vehicleId.trim() ||
    value.vehicleId.length > 200 ||
    !('label' in value) ||
    typeof value.label !== 'string' ||
    !value.label.trim() ||
    value.label.length > 200 ||
    !('createdAt' in value) ||
    typeof value.createdAt !== 'number' ||
    value.createdAt > Date.now() ||
    Date.now() - value.createdAt > lifetimeMs
  ) {
    clearPendingJournal();
    return undefined;
  }
  return value as PendingJournal;
}

export function clearPendingJournal() {
  memory = undefined;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // The in-memory copy has already been cleared.
  }
}
