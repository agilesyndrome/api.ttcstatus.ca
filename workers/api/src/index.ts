import type { Env } from './env';
import type {
  ScheduledControllerLike,
  ExecutionContextLike,
} from '../../shared/cloudflare/bindings';
import { routeRequest } from './http/router';
import { json } from './http/responses';
import { syncStaticGtfs } from './sync/sync';
// The recorder singleton Durable Object (docs/sla.md §4.4) — exported so the
// wrangler binding can instantiate it.
export { ServiceRecorder } from './service/service-recorder';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    try {
      return await routeRequest(request, env, ctx);
    } catch (error) {
      // The full failure detail (message, stack, request) belongs in Workers
      // Logs; the client only ever sees the opaque 500 below.
      console.error('unhandled request failure', {
        method: request.method,
        url: request.url,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      });
      return json({ error: 'internal-error' }, 500, { 'cache-control': 'no-store' });
    }
  },
  async scheduled(
    _controller: ScheduledControllerLike,
    env: Env,
    _ctx: ExecutionContextLike,
  ): Promise<void> {
    const result = await syncStaticGtfs(env);
    console.log('static GTFS sync result', result);
  },
};
