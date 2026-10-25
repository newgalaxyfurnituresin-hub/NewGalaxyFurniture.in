import type { APIContext } from 'astro';
import { requireAdmin } from '@/lib/auth/guard';
import { getR2 } from '@/lib/env';
import { errorResponse, ERROR_CODES, logServerError, toClientErrorResponse } from '@/lib/errors';
import { keyCandidates, parseImageRequest } from '@/lib/images/delivery';
export const prerender = false;
export async function GET(context: APIContext): Promise<Response> {
  const guard = await requireAdmin(context, 'product.write');
  if (!guard.ok) return guard.response;
  const image = parseImageRequest(`${context.params.id ?? ''}/${context.params.file ?? ''}`);
  if (!image) return errorResponse(ERROR_CODES.NOT_FOUND);
  try {
    for (const candidate of keyCandidates(image, context.request.headers.get('accept'))) {
      const object = await getR2(context).get(candidate.key);
      if (object)
        return new Response(object.body, {
          headers: {
            'content-type': object.httpMetadata?.contentType ?? candidate.contentType,
            'cache-control': 'private, no-store',
            'x-robots-tag': 'noindex, nofollow',
            'x-content-type-options': 'nosniff',
            vary: 'Cookie',
          },
        });
    }
    return errorResponse(ERROR_CODES.NOT_FOUND);
  } catch (error) {
    logServerError('private product media: read failed', error);
    return toClientErrorResponse(error);
  }
}
