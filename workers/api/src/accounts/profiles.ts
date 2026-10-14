import type { AccountEnv } from './env';
import { accountReply as reply } from '../http/responses';
import { accountBody as body, PROFILE_BODY_LIMIT } from './body';
import { journalBadges, validJournal } from '../../../../shared/accounts/journal';
import { validUsername } from '../../../../shared/accounts/profile';
interface ProfileRow {
  username: string | null;
  public_badges: number;
  color_mode: 'standard' | 'redgreen' | 'full';
}

const COLOUR_MODES = ['standard', 'redgreen', 'full'] as const;
type ColourMode = (typeof COLOUR_MODES)[number];
const validColourMode = (value: unknown): value is ColourMode =>
  typeof value === 'string' && COLOUR_MODES.includes(value as ColourMode);

export async function ownedProfileResponse(
  request: Request,
  env: AccountEnv,
  userId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    const profile = await env.DB.prepare(
      'SELECT username, public_badges, color_mode FROM user_profiles WHERE user_id = ?',
    )
      .bind(userId)
      .first<ProfileRow>();
    return reply({
      username: profile?.username ?? '',
      publicBadges: profile?.public_badges === 1,
      colorMode: profile?.color_mode ?? 'standard',
    });
  }
  if (request.method !== 'PUT') return reply({ error: 'method-not-allowed' }, 405);
  const value = await body(request, PROFILE_BODY_LIMIT);
  if (value instanceof Response) return value;
  const colorMode = value.colorMode ?? 'standard';
  if (
    Object.keys(value).some(
      (key) => !['username', 'publicBadges', 'colorMode'].includes(key),
    ) ||
    !validUsername(value.username) ||
    typeof value.publicBadges !== 'boolean' ||
    !validColourMode(colorMode)
  )
    return reply({ error: 'invalid-profile' }, 400);
  try {
    await env.DB.prepare(
      `INSERT INTO user_profiles (user_id, username, public_badges, color_mode) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET username = excluded.username,
          public_badges = excluded.public_badges, color_mode = excluded.color_mode`,
    )
      .bind(userId, value.username, Number(value.publicBadges), colorMode)
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed'))
      return reply({ error: 'username-taken' }, 409);
    throw error;
  }
  return reply({
    username: value.username,
    publicBadges: value.publicBadges,
    colorMode,
  });
}

export async function publicProfileResponse(
  env: AccountEnv,
  username: string,
): Promise<Response> {
  if (!validUsername(username)) return reply({ error: 'profile-not-found' }, 404);
  const row = await env.DB.prepare(
    `SELECT p.username, j.entries FROM user_profiles p LEFT JOIN user_journals j ON j.user_id = p.user_id
    WHERE p.username = ? AND p.public_badges = 1`,
  )
    .bind(username)
    .first<{ username: string; entries: string | null }>();
  if (!row) return reply({ error: 'profile-not-found' }, 404);
  const entries: unknown = row.entries ? JSON.parse(row.entries) : [];
  const badges = journalBadges(validJournal(entries) ? entries : [])
    .filter((badge) => badge.earned)
    .map(({ name, icon, description }) => ({ name, icon, description }));
  return reply({ username: row.username, badges });
}
