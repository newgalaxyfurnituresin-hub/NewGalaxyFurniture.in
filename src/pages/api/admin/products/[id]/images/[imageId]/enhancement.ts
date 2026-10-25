import type { APIContext } from 'astro';
import { z } from 'zod';
import { lockNamespace, openAdminContext } from '@/lib/admin/context';
import { readValidatedJson } from '@/lib/auth/guard';
import { getR2 } from '@/lib/env';
import {
  ERROR_CODES,
  errorResponse,
  jsonResponse,
  logServerError,
  toClientErrorResponse,
} from '@/lib/errors';
import { resolveProduct, saveProductState } from '@/lib/github/drafts';
import { withProductLock } from '@/lib/github/client';
import {
  ENHANCEMENT_HEARTBEAT,
  ENHANCEMENT_TTL,
  enhancedRecord,
  enhancementKey,
  readEnhancement,
} from '@/lib/images/enhancement';
import { originalKey } from '@/lib/images/srcset';
import { validateProduct } from '@/lib/products/input';
import { productRevisionHeaders } from '@/lib/products/revision';

export const prerender = false;
const Action = z.object({ action: z.enum(['queue', 'apply']) }).strict();

export async function GET(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'product.write');
  if (!opened.ok) return opened.response;
  const { drafts, client } = opened.context;
  const productId = context.params.id ?? '';
  const imageId = context.params.imageId ?? '';
  try {
    const resolved = await resolveProduct({ drafts, client }, productId);
    const image = resolved?.product.images.find((entry) => entry.id === imageId);
    if (!image) return errorResponse(ERROR_CODES.NOT_FOUND);
    const job = await readEnhancement(drafts, productId, imageId);
    if (context.url.searchParams.get('preview') === '1') {
      if (job?.state !== 'ready' || !job.result) return errorResponse(ERROR_CODES.NOT_FOUND);
      const object = await getR2(context).get(originalKey(productId, job.result.imageId, 'jpg'));
      if (!object) return errorResponse(ERROR_CODES.NOT_FOUND);
      return new Response(object.body, {
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    const heartbeat = z
      .object({ lastSeen: z.number() })
      .safeParse(await drafts.get(ENHANCEMENT_HEARTBEAT, 'json'));
    return jsonResponse(
      {
        state: Math.max(image.width, image.height) >= 3840 ? '4k' : (job?.state ?? 'none'),
        queuedAt: job?.queuedAt,
        updatedAt: job?.updatedAt,
        computerOnline: heartbeat.success && Date.now() - heartbeat.data.lastSeen < 10 * 60_000,
      },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    logServerError('images: enhancement status unavailable', error);
    return toClientErrorResponse(error);
  }
}

export async function POST(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'product.write');
  if (!opened.ok) return opened.response;
  const body = await readValidatedJson(context.request, Action);
  if (!body.ok) return body.response;
  const { drafts, client, actor } = opened.context;
  const productId = context.params.id ?? '';
  const imageId = context.params.imageId ?? '';
  try {
    return await withProductLock(lockNamespace(context), productId, async () => {
      const resolved = await resolveProduct({ drafts, client }, productId);
      if (!resolved) return errorResponse(ERROR_CODES.NOT_FOUND);
      const product = resolved.product;
      const job = await readEnhancement(drafts, productId, imageId);
      if (
        body.value.action === 'apply' &&
        (job?.state === 'applied' || job?.state === 'ready') &&
        job.result &&
        product.images.some((image) => image.id === job.result?.imageId)
      ) {
        return jsonResponse({ images: product.images, primaryImage: product.primaryImage });
      }
      const image = product.images.find((entry) => entry.id === imageId);
      if (!image) return errorResponse(ERROR_CODES.NOT_FOUND);
      if (body.value.action === 'queue') {
        return errorResponse(ERROR_CODES.CONFIGURATION_INCOMPLETE, {
          message:
            'Automatic cloud AI enhancement is not configured. Photo uploads and online optimization work normally at the original resolution.',
        });
      }
      if (!job || job.state !== 'ready' || !job.result)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message: 'The 4K photo is not ready yet. The original is safe.',
        });
      const enhanced = enhancedRecord(image, job);
      if (product.images.some((entry) => entry.id === enhanced.id))
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message: 'This photo reference is already in use.',
        });
      const object = await getR2(context).get(enhanced.key);
      if (!object || object.size > 12_582_912)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message: 'The prepared photo is unavailable. The original is safe.',
        });
      const digest = await crypto.subtle.digest('SHA-256', await object.arrayBuffer());
      const hex = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      if (hex !== job.result.sha256)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message: 'The prepared photo failed verification. Please retry enhancement.',
        });
      const candidate = validateProduct({
        ...product,
        images: product.images.map((entry) => (entry.id === imageId ? enhanced : entry)),
        primaryImage: product.primaryImage === imageId ? enhanced.id : product.primaryImage,
        updatedAt: new Date().toISOString(),
      });
      if (!candidate.ok)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, { fields: candidate.fields });
      await saveProductState({
        drafts,
        client,
        actor,
        product: candidate.product,
        from: product.status,
        action: 'apply reviewed 4K photo',
      });
      await drafts.put(
        enhancementKey(productId, imageId),
        JSON.stringify({ ...job, state: 'applied', updatedAt: Date.now() }),
        { expirationTtl: ENHANCEMENT_TTL },
      );
      return jsonResponse(
        { images: candidate.product.images, primaryImage: candidate.product.primaryImage },
        { headers: productRevisionHeaders(product.updatedAt, candidate.product.updatedAt) },
      );
    });
  } catch (error) {
    logServerError('images: enhancement operation failed', error);
    return toClientErrorResponse(error);
  }
}
