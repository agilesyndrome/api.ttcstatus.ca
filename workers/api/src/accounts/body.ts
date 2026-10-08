import { BodyTooLargeError, readLimitedBytes } from '../../../shared/http/streams';
import { accountReply as reply } from '../http/responses';

// A profile is a <=30-character username plus a boolean; a journal is at most
// 500 entries of bounded fields (< ~1.1 MB of ASCII at the theoretical limit).
// Neither endpoint needs the generic 1.5 MB reader ceiling, so each request is
// capped to what its own schema can legitimately contain.
export const PROFILE_BODY_LIMIT = 2_000;
export const JOURNAL_BODY_LIMIT = 1_200_000;
// Saved stops are at most 100 ids of <= 200 characters each (< ~21 KB).
export const SAVED_STOPS_BODY_LIMIT = 32_000;

export async function accountBody(
  request: Request,
  maximumBytes: number,
): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return reply({ error: 'json-required' }, 415);
  if (!request.body) return reply({ error: 'invalid-body' }, 400);
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBytes(request.body, maximumBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return reply({ error: 'body-too-large' }, 413);
    throw error;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* Invalid JSON is a client error. */
  }
  return reply({ error: 'invalid-body' }, 400);
}
