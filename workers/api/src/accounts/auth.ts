import { createClerkClient } from '@clerk/backend';
import type { AccountEnv } from './env';
import { accountReply as reply } from '../http/responses';
import { authorizedSessionParties } from './session-policy';

// Local dev loads `.env.local` verbatim into the Worker, so unresolved
// secret-manager references (`op://…`) must read as "unconfigured" instead of
// publishing a bogus key the browser would reject anyway (the client requires
// a `pk_` prefix). Production keys are `pk_live_…`/`sk_live_…`, development
// keys `pk_test_…`/`sk_test_…`.
const clerkKey = (value: string | undefined, prefix: 'pk_' | 'sk_') =>
  typeof value === 'string' && value.startsWith(prefix) && value.length > prefix.length
    ? value
    : undefined;

export function authConfig(env: AccountEnv) {
  const publishableKey = clerkKey(env.CLERK_PUBLISHABLE_KEY, 'pk_');
  const enabled = Boolean(
    publishableKey &&
    clerkKey(env.CLERK_SECRET_KEY, 'sk_') &&
    authorizedSessionParties(env).length,
  );
  return { enabled, publishableKey: enabled ? publishableKey : null };
}
// Only session bearer tokens are accepted. Cookies alone cannot authorize writes.
export async function authenticateAccount(
  request: Request,
  env: AccountEnv,
): Promise<string | Response> {
  if (!authConfig(env).enabled) return reply({ error: 'auth-unavailable' }, 503);
  if (!authorizedSessionParties(env).length)
    return reply({ error: 'auth-unavailable' }, 503);
  if (!/^Bearer \S+$/.test(request.headers.get('authorization') ?? ''))
    return reply({ error: 'unauthorized' }, 401);
  try {
    const client = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    });
    const state = await client.authenticateRequest(request, {
      acceptsToken: 'session_token',
      authorizedParties: authorizedSessionParties(env),
    });
    const userId = state.toAuth()?.userId;
    if (state.isAuthenticated && userId) return userId;
  } catch {
    /* Never echo tokens or Clerk's internal error details. */
  }
  return reply({ error: 'unauthorized' }, 401);
}
