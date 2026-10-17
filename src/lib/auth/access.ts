import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { optionalConfig, type RuntimeCarrier } from '@/lib/env';

export interface AccessConfig {
  issuer: string;
  audience: string;
}

/** Public identifiers, read only on the server. Never derive trust from request headers. */
export function getAccessConfig(context: RuntimeCarrier): AccessConfig | null {
  const domain = optionalConfig(context, 'CF_ACCESS_TEAM_DOMAIN');
  const audience = optionalConfig(context, 'CF_ACCESS_AUD');
  if (!domain || !audience) return null;
  const issuer = domain.replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(issuer)) return null;
  return { issuer, audience };
}

const resolvers = new Map<string, JWTVerifyGetKey>();

/** Verify signature, exact issuer/audience, expiry and human-user identity before DB lookup. */
export async function verifyAccessToken(
  token: string,
  config: AccessConfig,
  keyResolver?: JWTVerifyGetKey,
): Promise<string | null> {
  if (!token || token.length > 16_384) return null;
  try {
    let keys = keyResolver ?? resolvers.get(config.issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`));
      resolvers.set(config.issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'],
      maxTokenAge: '12h',
    });
    if (payload.type !== 'app' || typeof payload.email !== 'string' || !payload.email.trim())
      return null;
    return payload.email.trim().toLowerCase();
  } catch {
    // Never log assertion tokens or detailed failures to an unauthenticated client.
    return null;
  }
}

export function safeAdminNext(value: string | null): string {
  return value &&
    /^\/admin(?:\/|$)/.test(value) &&
    !value.includes('\\') &&
    !/[\r\n]/.test(value) &&
    !value.startsWith('/admin/login')
    ? value
    : '/admin';
}
