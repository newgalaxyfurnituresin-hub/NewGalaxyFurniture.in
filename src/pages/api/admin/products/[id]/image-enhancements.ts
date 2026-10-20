import type { APIContext } from 'astro';
import { z } from 'zod';
import { openAdminContext } from '@/lib/admin/context';
import {
  ERROR_CODES,
  errorResponse,
  jsonResponse,
  logServerError,
  toClientErrorResponse,
} from '@/lib/errors';
import { resolveProduct } from '@/lib/github/drafts';
import { ENHANCEMENT_HEARTBEAT, readEnhancement } from '@/lib/images/enhancement';

export const prerender = false;
export async function GET(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'product.write');
  if (!opened.ok) return opened.response;
  const { drafts, client } = opened.context;
  try {
    const resolved = await resolveProduct({ drafts, client }, context.params.id ?? '');
    if (!resolved) return errorResponse(ERROR_CODES.NOT_FOUND);
    const heartbeat = z
      .object({ lastSeen: z.number() })
      .safeParse(await drafts.get(ENHANCEMENT_HEARTBEAT, 'json'));
    const images = await Promise.all(
      resolved.product.images.map(async (image) => {
        const job =
          Math.max(image.width, image.height) >= 3840
            ? null
            : await readEnhancement(drafts, resolved.product.id, image.id);
        return {
          imageId: image.id,
          state: Math.max(image.width, image.height) >= 3840 ? '4k' : (job?.state ?? 'none'),
          queuedAt: job?.queuedAt,
          updatedAt: job?.updatedAt,
        };
      }),
    );
    return jsonResponse(
      {
        images,
        computerOnline: heartbeat.success && Date.now() - heartbeat.data.lastSeen < 10 * 60_000,
      },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    logServerError('images: enhancement status unavailable', error);
    return toClientErrorResponse(error);
  }
}
