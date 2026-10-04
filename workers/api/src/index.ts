import type { Env } from './env';
import type {
  ScheduledControllerLike,
  ExecutionContextLike,
} from '../../shared/cloudflare/bindings';
import { routeRequest } from './http/router';
import { syncStaticGtfs } from './sync/sync';

export default {
  fetch: routeRequest,
  async scheduled(
    _controller: ScheduledControllerLike,
    env: Env,
    _ctx: ExecutionContextLike,
  ): Promise<void> {
    const result = await syncStaticGtfs(env);
    console.log('static GTFS sync result', result);
  },
};
