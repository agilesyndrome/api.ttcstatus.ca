// Fingerprint of the credential previously committed to Git. Never accept it again.
export const REVOKED_SYNC_TOKEN_SHA256 =
  'c037b73e1c553e19074a0cd9848ed8099281051a28a26093ada6fdfe9aca4640';

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Compare digests, never raw secrets. Both sides are hashed to fixed-length
 * hex strings first, so an attacker cannot use request timing to recover the
 * configured token byte-by-byte, and the revoked fingerprint is checked on
 * the digest of the configured secret before any match is honored.
 */
export async function authorizedSync(
  request: Request,
  env: { SYNC_TOKEN?: string },
): Promise<boolean> {
  const header = request.headers.get('authorization');
  if (!env.SYNC_TOKEN || !header?.startsWith('Bearer ')) return false;
  const [providedDigest, configuredDigest] = await Promise.all([
    sha256Hex(header.slice('Bearer '.length)),
    sha256Hex(env.SYNC_TOKEN),
  ]);
  if (configuredDigest === REVOKED_SYNC_TOKEN_SHA256) return false;
  return providedDigest === configuredDigest;
}
