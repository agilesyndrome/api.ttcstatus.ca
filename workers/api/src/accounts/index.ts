import type { AccountEnv } from './env';
import { accountReply } from '../http/responses';
import { ownedProfileResponse } from './profiles';
import { ownedJournalResponse } from './journal';
export { authenticateAccount, authConfig } from './auth';
export { publicProfileResponse } from './profiles';
export { validUsername } from '../../../../shared/accounts/profile';
export type { AccountEnv } from './env';

// Identity comes exclusively from authentication, never from request data.
export async function ownedAccountResponse(
  request: Request,
  env: AccountEnv,
  userId: string,
): Promise<Response> {
  switch (new URL(request.url).pathname) {
    case '/api/v1/me/profile':
      return ownedProfileResponse(request, env, userId);
    case '/api/v1/me/journal':
      return ownedJournalResponse(request, env, userId);
    default:
      return accountReply({ error: 'not-found' }, 404);
  }
}
