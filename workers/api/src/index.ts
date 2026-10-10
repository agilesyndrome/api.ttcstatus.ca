import type { Env } from './env';
import type {
  ScheduledControllerLike,
  ExecutionContextLike,
} from '../../shared/cloudflare/bindings';
import { routeRequest } from './http/router';
import { json } from './http/responses';
import { syncStaticGtfs } from './sync/sync';
import { runSlaRollup } from './sla/fold';
import { serviceConfig } from '../../../shared/service/config';
// The recorder singleton Durable Object (docs/sla.md §4.4) — exported so the
// wrangler binding can instantiate it.
export { ServiceRecorder } from './service/service-recorder';

/** Hourly SLA rollup cron (Epic 8, E8S3): folds completed Toronto days from
 * the 5-minute rollup tier into the daily/weekly SLA tables before the
 * 36-hour retention can prune them, and refreshes the today-so-far partial.
 * Idempotent and self-healing — a missed run backfills any day whose data
 * still survives. */
const SLA_ROLLUP_CRON = '41 * * * *';

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
    controller: ScheduledControllerLike,
    env: Env,
    _ctx: ExecutionContextLike,
  ): Promise<void> {
    if (controller.cron === SLA_ROLLUP_CRON) {
      const result = await runSlaRollup(env.DB, serviceConfig(env), Date.now());
      console.log('SLA rollup result', result);
      return;
    }
    const result = await syncStaticGtfs(env);
    console.log('static GTFS sync result', result);
  },
};
