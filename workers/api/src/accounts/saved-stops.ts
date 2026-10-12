import type { AccountEnv } from './env';
import { accountReply as reply } from '../http/responses';
import { SAVED_STOPS_BODY_LIMIT, accountBody as body } from './body';
import { validSavedStops } from '../../../../shared/accounts/saved-stops';
interface SavedStopsRow {
  stop_ids: string;
  revision: number;
}

async function readSavedStops(env: AccountEnv, userId: string) {
  const row = await env.DB.prepare(
    'SELECT stop_ids, revision FROM user_saved_stops WHERE user_id = ?',
  )
    .bind(userId)
    .first<SavedStopsRow>();
  return { stopIds: row ? JSON.parse(row.stop_ids) : [], revision: row?.revision ?? 0 };
}

export async function ownedSavedStopsResponse(
  request: Request,
  env: AccountEnv,
  userId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    return reply(await readSavedStops(env, userId));
  }
  if (request.method !== 'PUT') return reply({ error: 'method-not-allowed' }, 405);
  const value = await body(request, SAVED_STOPS_BODY_LIMIT);
  if (value instanceof Response) return value;
  if (
    Object.keys(value).some((key) => !['stopIds', 'revision'].includes(key)) ||
    !validSavedStops(value.stopIds) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    return reply({ error: 'invalid-saved-stops' }, 400);
  const result =
    value.revision === 0
      ? await env.DB.prepare(
          'INSERT INTO user_saved_stops (user_id, stop_ids, revision) VALUES (?, ?, 1) ON CONFLICT(user_id) DO NOTHING',
        )
          .bind(userId, JSON.stringify(value.stopIds))
          .run()
      : await env.DB.prepare(
          'UPDATE user_saved_stops SET stop_ids = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?',
        )
          .bind(JSON.stringify(value.stopIds), userId, value.revision)
          .run();
  if (!result.meta.changes) {
    const current = await readSavedStops(env, userId);
    return reply(
      { error: 'saved-stops-conflict', revision: current.revision, current },
      409,
    );
  }
  return reply({ revision: Number(value.revision) + 1 });
}
