import { createClerkClient } from '@clerk/backend';
import type { D1Database } from '../../shared/cloudflare';
import { journalBadges, validJournal } from '../../../web/ui/journal';

export interface AccountEnv {
  DB: D1Database;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export function authConfig(env: AccountEnv) {
  const enabled = Boolean(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
  return { enabled, publishableKey: enabled ? env.CLERK_PUBLISHABLE_KEY : null };
}
export const validUsername = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{2,29}$/.test(value);

// Only session bearer tokens are accepted. Cookies alone cannot authorize writes.
export async function authenticateAccount(request: Request, env: AccountEnv): Promise<string | Response> {
  if (!authConfig(env).enabled) return reply({ error: 'auth-unavailable' }, 503);
  if (!/^Bearer \S+$/.test(request.headers.get('authorization') ?? '')) return reply({ error: 'unauthorized' }, 401);
  try {
    const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });
    const state = await client.authenticateRequest(request, {
      acceptsToken: 'session_token',
      authorizedParties: (env.CLERK_AUTHORIZED_PARTIES ?? 'https://ttcstatus.ca').split(',').map(value => value.trim()).filter(Boolean),
    });
    const userId = state.toAuth()?.userId;
    if (state.isAuthenticated && userId) return userId;
  } catch { /* Never echo tokens or Clerk's internal error details. */ }
  return reply({ error: 'unauthorized' }, 401);
}

interface ProfileRow { username: string | null; public_badges: number }
interface JournalRow { entries: string; revision: number }
async function body(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'json-required' }, 415);
  // Bound the streamed body, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: 'invalid-body' }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_500_000) { await reader.cancel(); return reply({ error: 'body-too-large' }, 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Invalid JSON is a client error. */ }
  return reply({ error: 'invalid-body' }, 400);
}

/** userId comes exclusively from authenticateAccount, never from request data. */
export async function ownedAccountResponse(request: Request, env: AccountEnv, userId: string): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/me/profile') {
    if (request.method === 'GET') {
      const profile = await env.DB.prepare('SELECT username, public_badges FROM user_profiles WHERE user_id = ?').bind(userId).first<ProfileRow>();
      return reply({ username: profile?.username ?? '', publicBadges: profile?.public_badges === 1 });
    }
    if (request.method !== 'PUT') return reply({ error: 'method-not-allowed' }, 405);
    const value = await body(request); if (value instanceof Response) return value;
    if (Object.keys(value).some(key => !['username', 'publicBadges'].includes(key)) || !validUsername(value.username) || typeof value.publicBadges !== 'boolean') return reply({ error: 'invalid-profile' }, 400);
    try {
      await env.DB.prepare(`INSERT INTO user_profiles (user_id, username, public_badges) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, public_badges = excluded.public_badges`).bind(userId, value.username, Number(value.publicBadges)).run();
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) return reply({ error: 'username-taken' }, 409);
      throw error;
    }
    return reply({ username: value.username, publicBadges: value.publicBadges });
  }
  if (path === '/api/v1/me/journal') {
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT entries, revision FROM user_journals WHERE user_id = ?').bind(userId).first<JournalRow>();
      return reply({ entries: row ? JSON.parse(row.entries) : [], revision: row?.revision ?? 0 });
    }
    if (request.method !== 'PUT') return reply({ error: 'method-not-allowed' }, 405);
    const value = await body(request); if (value instanceof Response) return value;
    if (Object.keys(value).some(key => !['entries', 'revision'].includes(key)) || !validJournal(value.entries) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return reply({ error: 'invalid-journal' }, 400);
    const result = value.revision === 0
      ? await env.DB.prepare('INSERT INTO user_journals (user_id, entries, revision) VALUES (?, ?, 1) ON CONFLICT(user_id) DO NOTHING').bind(userId, JSON.stringify(value.entries)).run()
      : await env.DB.prepare('UPDATE user_journals SET entries = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?').bind(JSON.stringify(value.entries), userId, value.revision).run();
    if (!result.meta.changes) return reply({ error: 'journal-conflict' }, 409);
    return reply({ revision: Number(value.revision) + 1 });
  }
  return reply({ error: 'not-found' }, 404);
}

export async function publicProfileResponse(env: AccountEnv, username: string): Promise<Response> {
  if (!validUsername(username)) return reply({ error: 'profile-not-found' }, 404);
  const row = await env.DB.prepare(`SELECT p.username, j.entries FROM user_profiles p LEFT JOIN user_journals j ON j.user_id = p.user_id
    WHERE p.username = ? AND p.public_badges = 1`).bind(username).first<{ username: string; entries: string | null }>();
  if (!row) return reply({ error: 'profile-not-found' }, 404);
  const entries: unknown = row.entries ? JSON.parse(row.entries) : [];
  const badges = journalBadges(validJournal(entries) ? entries : []).filter(badge => badge.earned).map(({ name, icon, description }) => ({ name, icon, description }));
  return reply({ username: row.username, badges });
}
