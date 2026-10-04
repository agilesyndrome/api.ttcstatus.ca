import { createClerkClient } from '@clerk/backend';
import type { AccountEnv } from './env';
import { accountReply as reply } from '../http/responses';

export function authConfig(env: AccountEnv) {
  const enabled = Boolean(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
  return { enabled, publishableKey: enabled ? env.CLERK_PUBLISHABLE_KEY : null };
}
// Only session bearer tokens are accepted. Cookies alone cannot authorize writes.
export async function authenticateAccount(
  request: Request,
  env: AccountEnv,
): Promise<string | Response> {
  if (!authConfig(env).enabled) return reply({ error: 'auth-unavailable' }, 503);
  if (!/^Bearer \S+$/.test(request.headers.get('authorization') ?? ''))
    return reply({ error: 'unauthorized' }, 401);
  try {
    const client = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    });
    const state = await client.authenticateRequest(request, {
      acceptsToken: 'session_token',
      authorizedParties: (env.CLERK_AUTHORIZED_PARTIES ?? 'https://ttcstatus.ca')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    });
    const userId = state.toAuth()?.userId;
    if (state.isAuthenticated && userId) return userId;
  } catch {
    /* Never echo tokens or Clerk's internal error details. */
  }
  return reply({ error: 'unauthorized' }, 401);
}
