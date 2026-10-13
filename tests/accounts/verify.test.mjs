import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { compileModules } from '../helpers/compile.mjs';

const { verifySessionToken, fetchJwks } = await compileModules(
  `export { verifySessionToken, fetchJwks } from './workers/api/src/accounts/verify';`,
);

// A real RSA key pair plays Clerk: the JWKS is the public half, fixture
// session tokens are signed with the private half. Tampering must fail.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const jwks = { keys: [{ kty: 'RSA', kid: 'test-key', n: publicJwk.n, e: publicJwk.e }] };
const b64url = (buffer) =>
  Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const encode = (value) => b64url(JSON.stringify(value));
const signToken = (header, claims) => {
  const input = `${encode(header)}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey);
  return `${input}.${b64url(signature)}`;
};
const header = { alg: 'RS256', kid: 'test-key', typ: 'JWT' };
const now = Date.parse('2026-10-12T12:00:00Z');
const validClaims = {
  sub: 'user_fixture',
  exp: (now + 60_000) / 1000,
  nbf: (now - 60_000) / 1000,
  iss: 'https://solid-lemur-42.clerk.accounts.dev',
  azp: 'https://ttcstatus.ca',
  sid: 'sess_fixture',
};
const options = {
  now,
  issuer: validClaims.iss,
  authorizedParties: ['https://ttcstatus.ca'],
};
const token = signToken(header, validClaims);

test('a correctly signed session token verifies locally and returns its claims', async () => {
  const claims = await verifySessionToken(token, jwks, options);
  assert.equal(claims.sub, 'user_fixture');
  assert.equal(claims.sid, 'sess_fixture');
});

test('tampering with any segment fails closed', async () => {
  // Payload tampering: claim a different subject with the original signature.
  const [head, , signature] = token.split('.');
  const forgedSub = signToken(header, { ...validClaims, sub: 'user_attacker' }).split(
    '.',
  );
  const tamperedPayload = `${head}.${forgedSub[1]}.${signature}`;
  assert.equal(await verifySessionToken(tamperedPayload, jwks, options), null);
  // Signature tampering.
  const badSignature = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(await verifySessionToken(badSignature, jwks, options), null);
  // Expired, not-yet-valid, wrong issuer, wrong party, missing sub.
  assert.equal(
    await verifySessionToken(
      signToken(header, { ...validClaims, exp: (now - 1000) / 1000 }),
      jwks,
      options,
    ),
    null,
  );
  assert.equal(
    await verifySessionToken(
      signToken(header, { ...validClaims, nbf: (now + 60_000) / 1000 }),
      jwks,
      options,
    ),
    null,
  );
  assert.equal(
    await verifySessionToken(
      signToken(header, { ...validClaims, iss: 'https://attacker.example' }),
      jwks,
      options,
    ),
    null,
  );
  assert.equal(
    await verifySessionToken(
      signToken(header, { ...validClaims, azp: 'https://attacker.example' }),
      jwks,
      options,
    ),
    null,
  );
  assert.equal(
    await verifySessionToken(
      signToken(header, { ...validClaims, sub: '' }),
      jwks,
      options,
    ),
    null,
  );
  // alg=none and unsigned tokens never verify.
  assert.equal(
    await verifySessionToken(
      `${encode({ alg: 'none' })}.${encode(validClaims)}.x`,
      jwks,
      options,
    ),
    null,
  );
  assert.equal(await verifySessionToken('not-a-token', jwks, options), null);
});

test('JWKS is fetched once and cached per interval', async () => {
  let calls = 0;
  const cache = {};
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify(jwks));
  };
  const keys = await fetchJwks(
    'https://clerk.example/.well-known/jwks.json',
    fetcher,
    cache,
    1000,
  );
  assert.equal(keys.keys.length, 1);
  await fetchJwks('https://clerk.example/.well-known/jwks.json', fetcher, cache, 2000);
  assert.equal(calls, 1, 'cached within the TTL window');
  await fetchJwks(
    'https://clerk.example/.well-known/jwks.json',
    fetcher,
    cache,
    3_601_001,
  );
  assert.equal(calls, 2, 'refetched after the TTL expires');
});
