import { abortable } from './cancellation';

/** Existing endpoints return bounded JSON, not streams. Finish receiving the body
 * before releasing the timeout and caller-abort subscription. */
export async function completedResponse(response: Response, signal: AbortSignal) {
  // Statuses without a response body must pass through untouched. In
  // particular, some browser/dev-proxy combinations expose a body stream on
  // 304 responses even though rebuilding a Response with status 304 and a
  // body is invalid. The caller needs to inspect the 304 status itself.
  if (
    !response.body ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  )
    return response;
  const body = await abortable(response.arrayBuffer(), signal);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
