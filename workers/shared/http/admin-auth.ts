async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Compare digests, never raw secrets. Both sides are hashed to fixed-length
 * hex strings first, so an attacker cannot use request timing to recover the
 * configured token byte-by-byte.
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
  return providedDigest === configuredDigest;
}
