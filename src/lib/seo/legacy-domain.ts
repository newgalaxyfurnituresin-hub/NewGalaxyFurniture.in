import { applySecurityHeaders } from '@/lib/security/headers';

const LEGACY_HOST = 'newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev';
const PRIMARY_HOST = 'newgalaxyfurniture.in';

/** Only public navigation moves hosts; API bodies and media requests stay untouched. */
export function legacyDomainRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (
    url.hostname !== LEGACY_HOST ||
    !['GET', 'HEAD'].includes(request.method) ||
    /^\/(?:api|img|_astro)(?:\/|$)/.test(url.pathname)
  )
    return null;
  url.protocol = 'https:';
  url.hostname = PRIMARY_HOST;
  url.port = '';
  // Avoid the old GoDaddy 301 cached under the bare primary URL. The page removes this
  // marker after refreshing that cache entry, so the final address is clean.
  url.searchParams.set('__ngf_domain', '1');
  return applySecurityHeaders(
    new Response(null, {
      status: 302,
      headers: { location: url.href, 'cache-control': 'no-store' },
    }),
  );
}
