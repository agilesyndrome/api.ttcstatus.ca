import { abortable } from './cancellation';

/** Existing endpoints return bounded JSON, not streams. Finish receiving the body
 * before releasing the timeout and caller-abort subscription. */
export async function completedResponse(response: Response, signal: AbortSignal) {
  if (!response.body) return response;
  const body = await abortable(response.arrayBuffer(), signal);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
