import type { D1Database } from '../../../shared/cloudflare/bindings';

export interface AccountEnv {
  DB: D1Database;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
}
