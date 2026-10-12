import type { AccountEnv } from './env';

/** Exact signed-token parties, independent of CORS. A WebView Origin header
 * alone never grants account access; Clerk verifies the token's azp claim. */
export function authorizedSessionParties(env: AccountEnv): string[] {
  return (env.CLERK_AUTHORIZED_PARTIES ?? 'https://ttcstatus.ca,capacitor://localhost')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
