import { BodyTooLargeError, readLimitedBytes } from '../../../shared/http/streams';
import { accountReply as reply } from '../http/responses';

export async function accountBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return reply({ error: 'json-required' }, 415);
  if (!request.body) return reply({ error: 'invalid-body' }, 400);
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBytes(request.body, 1_500_000);
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
