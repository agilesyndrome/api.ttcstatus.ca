export function cors(headers = new Headers()): Headers {
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
  headers.set(
    'access-control-allow-headers',
    'Authorization, Content-Type, If-None-Match',
  );
  headers.set(
    'access-control-expose-headers',
    'ETag, X-Live-Update-Seconds, X-Live-Next-Update-At, Retry-After',
  );
  return headers;
}

export function json(
  value: unknown,
  status = 200,
  extra?: Record<string, string>,
): Response {
  const headers = cors(
    new Headers({ 'content-type': 'application/json; charset=utf-8' }),
  );
  if (extra) for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(value), { status, headers });
}

export const accountReply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
