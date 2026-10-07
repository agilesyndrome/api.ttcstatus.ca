import type { AccountEnv } from './env';
import { accountReply as reply } from '../http/responses';
import { JOURNAL_BODY_LIMIT, accountBody as body } from './body';
import { validJournal } from '../../../../shared/accounts/journal';
interface JournalRow {
  entries: string;
  revision: number;
}

export async function ownedJournalResponse(
  request: Request,
  env: AccountEnv,
  userId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT entries, revision FROM user_journals WHERE user_id = ?',
    )
      .bind(userId)
      .first<JournalRow>();
    return reply({
      entries: row ? JSON.parse(row.entries) : [],
      revision: row?.revision ?? 0,
    });
  }
  if (request.method !== 'PUT') return reply({ error: 'method-not-allowed' }, 405);
  const value = await body(request, JOURNAL_BODY_LIMIT);
  if (value instanceof Response) return value;
  if (
    Object.keys(value).some((key) => !['entries', 'revision'].includes(key)) ||
    !validJournal(value.entries) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    return reply({ error: 'invalid-journal' }, 400);
  const result =
    value.revision === 0
      ? await env.DB.prepare(
          'INSERT INTO user_journals (user_id, entries, revision) VALUES (?, ?, 1) ON CONFLICT(user_id) DO NOTHING',
        )
          .bind(userId, JSON.stringify(value.entries))
          .run()
      : await env.DB.prepare(
          'UPDATE user_journals SET entries = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?',
        )
          .bind(JSON.stringify(value.entries), userId, value.revision)
          .run();
  if (!result.meta.changes) return reply({ error: 'journal-conflict' }, 409);
  return reply({ revision: Number(value.revision) + 1 });
}
