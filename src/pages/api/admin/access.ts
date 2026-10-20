import type { APIContext } from 'astro';
import { getAccessConfig, safeAdminNext, verifyAccessToken } from '@/lib/auth/access';
import { checkOrigin, clientAddress } from '@/lib/auth/guard';
import { createSession, sessionCookieValue } from '@/lib/auth/session';
import { findAdminUserWithHash, recordSuccessfulLogin } from '@/lib/auth/users';
import { consumeLoginAttemptForIp } from '@/lib/auth/rate-limit';
import { getD1, getKV, getPublicConfig } from '@/lib/env';
import { ERROR_CODES, errorResponse, logServerError } from '@/lib/errors';
import { COMPANY_ADMIN_EMAIL, isCompanySite } from '@/lib/auth/company-policy';

export const prerender = false;
const privateHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };

/** Access establishes identity; this explicit same-origin POST establishes the app session. */
async function signIn(context: APIContext, submit: boolean): Promise<Response> {
  try {
    const config = getAccessConfig(context);
    if (!config)
      return new Response('Email sign-in is not configured.', {
        status: 503,
        headers: privateHeaders,
      });
    if (submit && !checkOrigin(context.request, getPublicConfig(context).siteUrl)) {
      return new Response('Request origin refused.', { status: 403, headers: privateHeaders });
    }
    const limit = await consumeLoginAttemptForIp(
      getKV(context, 'RATELIMIT'),
      clientAddress(context.request),
    );
    if (!limit.allowed)
      return new Response('Please try again later.', { status: 429, headers: privateHeaders });
    const email = await verifyAccessToken(
      context.request.headers.get('cf-access-jwt-assertion') ?? '',
      config,
    );
    if (
      !email ||
      (isCompanySite(getPublicConfig(context).siteUrl) && email !== COMPANY_ADMIN_EMAIL)
    )
      return new Response('Verified email sign-in required.', {
        status: 403,
        headers: privateHeaders,
      });
    const found = await findAdminUserWithHash(getD1(context), email);
    if (!found || found.user.role !== 'owner' || found.user.status !== 'ACTIVE')
      return new Response('Administrator access refused.', {
        status: 403,
        headers: privateHeaders,
      });
    if (!submit) {
      // Relative action preserves the validated next query. No assertion or identity is rendered.
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin sign in</title><link rel="stylesheet" href="/ngf-admin-access.css"></head><body><main><a class="brand" href="/" aria-label="New Galaxy Furniture home"><img src="/brand/logo-96.webp" width="48" height="48" alt=""><span>New Galaxy Furniture<small>Website manager</small></span></a><div class="verified" aria-hidden="true">✓</div><h1>Your sign-in is verified</h1><p>Continue to your dashboard to manage products, photographs and website content.</p><form method="post"><button type="submit">Continue to dashboard <span aria-hidden="true">→</span></button></form><a class="back" href="/">Back to the website</a><p class="privacy">Administrator access only. Keep your company account secure.</p></main></body></html>`,
        {
          headers: { ...privateHeaders, 'content-type': 'text/html; charset=utf-8' },
        },
      );
    }
    const session = await createSession(getKV(context, 'SESSIONS'), {
      userId: found.user.id,
      role: found.user.role,
      ip: clientAddress(context.request),
      userAgent: context.request.headers.get('user-agent') ?? '',
    });
    await recordSuccessfulLogin(getD1(context), found.user.id);
    return new Response(null, {
      status: 303,
      headers: {
        ...privateHeaders,
        'set-cookie': sessionCookieValue(session),
        location: safeAdminNext(context.url.searchParams.get('next')),
      },
    });
  } catch (error) {
    logServerError('access: administrator sign-in could not complete', error);
    return errorResponse(ERROR_CODES.CONFIGURATION_INCOMPLETE, { headers: privateHeaders });
  }
}

export const GET = (context: APIContext): Promise<Response> => signIn(context, false);
export const POST = (context: APIContext): Promise<Response> => signIn(context, true);
