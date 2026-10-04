// Fingerprint of the credential previously committed to Git. Never accept it again.
export const REVOKED_SYNC_TOKEN_SHA256 =
  'c037b73e1c553e19074a0cd9848ed8099281051a28a26093ada6fdfe9aca4640';

export async function authorizedSync(
  request: Request,
  env: { SYNC_TOKEN?: string },
): Promise<boolean> {
  if (
    !env.SYNC_TOKEN ||
    request.headers.get('authorization') !== `Bearer ${env.SYNC_TOKEN}`
  )
    return false;
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(env.SYNC_TOKEN),
  );
  const digest = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return digest !== REVOKED_SYNC_TOKEN_SHA256;
}
