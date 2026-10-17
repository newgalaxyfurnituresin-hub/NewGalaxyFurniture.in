import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { safeAdminNext, verifyAccessToken } from '@/lib/auth/access';

const config = { issuer: 'https://fixture.cloudflareaccess.com', audience: 'fixture-audience' };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  resolver = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'fixture' }],
  });
});
async function assertion(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ email: 'Owner@Example.invalid', type: 'app', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject('fixture-owner')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(keys.privateKey);
}
describe('Access identity verification', () => {
  it('accepts a correctly signed human identity with matching issuer and audience', async () => {
    expect(await verifyAccessToken(await assertion(), config, resolver)).toBe(
      'owner@example.invalid',
    );
  });
  it('rejects missing, forged, and tampered assertions', async () => {
    const token = await assertion();
    expect(await verifyAccessToken('', config, resolver)).toBeNull();
    expect(await verifyAccessToken('forged', config, resolver)).toBeNull();
    const parts = token.split('.');
    parts[1] = Buffer.from(
      JSON.stringify({ email: 'attacker@example.invalid', type: 'app' }),
    ).toString('base64url');
    expect(await verifyAccessToken(parts.join('.'), config, resolver)).toBeNull();
  });
  it('rejects tokens for another application or team', async () => {
    const token = await assertion();
    expect(
      await verifyAccessToken(token, { ...config, audience: 'another-app' }, resolver),
    ).toBeNull();
    expect(
      await verifyAccessToken(
        token,
        { ...config, issuer: 'https://other.cloudflareaccess.com' },
        resolver,
      ),
    ).toBeNull();
  });
  it('rejects service identities and absent email', async () => {
    expect(
      await verifyAccessToken(await assertion({ type: 'service' }), config, resolver),
    ).toBeNull();
    expect(await verifyAccessToken(await assertion({ email: null }), config, resolver)).toBeNull();
  });
  it('rejects expired and future-issued identities', async () => {
    const token = await new SignJWT({ email: 'owner@example.invalid', type: 'app' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject('fixture')
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(keys.privateKey);
    expect(await verifyAccessToken(token, config, resolver)).toBeNull();
    const future = await new SignJWT({ email: 'owner@example.invalid', type: 'app' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject('fixture')
      .setIssuedAt(Math.floor(Date.now() / 1000) + 3600)
      .setExpirationTime('2h')
      .sign(keys.privateKey);
    expect(await verifyAccessToken(future, config, resolver)).toBeNull();
  });
  it('allows only local admin redirects', () => {
    for (const value of [
      'https://evil.invalid',
      '//evil.invalid',
      '/administrator',
      '/admin\\evil',
      '/admin/login',
      '/admin\r\nX: 1',
    ]) {
      expect(safeAdminNext(value)).toBe('/admin');
    }
    expect(safeAdminNext('/admin/products?status=DRAFT')).toBe('/admin/products?status=DRAFT');
  });
});
