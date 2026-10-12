import type { ApiRequest } from '../../services/http/client';
import type { RevisionConflict } from '../../../../shared/accounts/conflict';

export interface AccountDocument<T> {
  items: T;
  revision: number;
}
export interface PendingEdit<T> {
  base: T;
  items: T;
}
export interface DocumentSchema<T> {
  path: string;
  field: string;
  valid(value: unknown): value is T;
  merge(base: T, draft: T, current: T, preferDraft?: boolean): T | null;
}

export function readAccountDocument<T>(
  body: unknown,
  schema: DocumentSchema<T>,
): AccountDocument<T> | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const items = value[schema.field];
  return schema.valid(items) &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0
    ? { items, revision: Number(value.revision) }
    : null;
}

/** One safe automatic conflict retry; concurrent same-entry edits remain reviewable.
 * The caller persists its draft before entering this transport routine. */
export async function writeAccountDocument<T>(
  request: ApiRequest,
  schema: DocumentSchema<T>,
  current: AccountDocument<T>,
  pending: PendingEdit<T>,
  preferDraft = false,
  active = () => true,
  signal?: AbortSignal,
) {
  let document = current;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!active() || signal?.aborted) throw new Error('Account edit cancelled');
    const items = schema.merge(pending.base, pending.items, document.items, preferDraft);
    if (items === null) return { saved: false as const, document };
    const response = await request(schema.path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({ [schema.field]: items, revision: document.revision }),
    });
    const body = await response.json();
    if (response.status === 409) {
      const conflict = body as RevisionConflict<Record<string, unknown>>;
      const remote = readAccountDocument(conflict.current, schema);
      if (!remote || remote.revision !== conflict.revision)
        throw new Error('Invalid revision conflict');
      document = remote;
      continue;
    }
    if (
      !response.ok ||
      !Number.isSafeInteger(body.revision) ||
      body.revision !== document.revision + 1
    )
      throw new Error('Account change could not be saved');
    return { saved: true as const, document: { items, revision: Number(body.revision) } };
  }
  return { saved: false as const, document };
}
