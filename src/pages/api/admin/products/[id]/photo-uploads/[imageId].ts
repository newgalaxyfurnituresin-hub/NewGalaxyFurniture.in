import type { APIContext } from 'astro';
import { lockNamespace, openAdminContext } from '@/lib/admin/context';
import { getImages, getR2 } from '@/lib/env';
import { advanceHostedPhoto } from '@/lib/images/hosted';
import {
  AppError,
  ERROR_CODES,
  errorResponse,
  jsonResponse,
  logServerError,
  toClientErrorResponse,
} from '@/lib/errors';
import { resolveProduct, saveProductState } from '@/lib/github/drafts';
import { withProductLock } from '@/lib/github/client';
import { validateProduct } from '@/lib/products/input';
import { productRevisionHeaders } from '@/lib/products/revision';
import {
  readUploadJob,
  uploadJobKey,
  uploadIndexKey,
  UPLOAD_JOB_TTL,
} from '@/lib/images/upload-jobs';
export const prerender = false;
export async function POST(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'product.write');
  if (!opened.ok) return opened.response;
  const { drafts, client, actor } = opened.context;
  const productId = context.params.id ?? '';
  const imageId = context.params.imageId ?? '';
  try {
    return await withProductLock(lockNamespace(context), productId, async () => {
      let job = await readUploadJob(drafts, productId, imageId);
      if (!job) return errorResponse(ERROR_CODES.NOT_FOUND);
      if (job.state === 'failed')
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message:
            'Photo preparation stopped after repeated failures. Check saved photos before retrying this file. The source remains private.',
        });
      if (job.state === 'queued' || job.state === 'processing') {
        const service = getImages(context);
        if (!service) return errorResponse(ERROR_CODES.CONFIGURATION_INCOMPLETE);
        if ((job.failures ?? 0) >= 3) {
          await drafts.put(
            uploadJobKey(productId, imageId),
            JSON.stringify({ ...job, state: 'failed', updatedAt: Date.now() }),
            { expirationTtl: UPLOAD_JOB_TTL },
          );
          return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
            message:
              'Photo preparation stopped after repeated interruptions. Check saved photos before retrying this file. The source remains private.',
          });
        }
        const failures = Math.min(3, (job.failures ?? 0) + 1);
        job = { ...job, failures, updatedAt: Date.now() };
        // Persist the attempt before processing: resource-limit termination cannot be caught.
        await drafts.put(uploadJobKey(productId, imageId), JSON.stringify(job), {
          expirationTtl: UPLOAD_JOB_TTL,
        });
        try {
          job = { ...(await advanceHostedPhoto(service, getR2(context), job)), failures: 0 };
        } catch (error) {
          await drafts.put(
            uploadJobKey(productId, imageId),
            JSON.stringify({
              ...job,
              failures,
              updatedAt: Date.now(),
              state:
                failures >= 3 ||
                (error instanceof AppError && error.code === ERROR_CODES.VALIDATION_FAILED)
                  ? 'failed'
                  : job.state,
            }),
            { expirationTtl: UPLOAD_JOB_TTL },
          );
          throw error;
        }
        await drafts.put(uploadJobKey(productId, imageId), JSON.stringify(job), {
          expirationTtl: UPLOAD_JOB_TTL,
        });
        return jsonResponse(
          {
            uploadId: imageId,
            images: [],
            rejected: [],
            progress:
              job.state === 'ready'
                ? 'Photo sizes are ready. Verifying and attaching the photo next.'
                : 'Preparing photo sizes: ' +
                  (job.result?.derivativeWidths?.length ?? 0) +
                  ' completed. Keep this page open.',
          },
          { status: 202 },
        );
      }

      // Partial work only touches private job objects. Read the latest product once, at promotion,
      // so each thumbnail does not trigger a repository read. A deleted product cannot be recreated.
      const resolved = await resolveProduct({ drafts, client }, productId);
      if (!resolved) return errorResponse(ERROR_CODES.NOT_FOUND);
      const product = resolved.product;
      const existing = product.images.find((image) => image.id === imageId);
      if (existing) {
        if (job.state !== 'applied')
          await drafts.put(
            uploadJobKey(productId, imageId),
            JSON.stringify({ ...job, state: 'applied', updatedAt: Date.now() }),
            { expirationTtl: UPLOAD_JOB_TTL },
          );
        return jsonResponse({ images: [existing], rejected: [], colorName: job.colorName });
      }
      const image = job.result;
      if (job.state !== 'ready' || !image || !job.sha256)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message:
            'This photo is still being prepared. Keep this page open or reopen the draft to continue.',
        });
      if (
        product.images.length >= 20 ||
        image.id !== imageId ||
        image.key !== `products/${productId}/${imageId}/original.jpg` ||
        image.mime !== 'image/jpeg' ||
        image.enhancedFrom
      )
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message: 'The prepared photo could not be verified.',
        });
      const object = await getR2(context).get(image.key);
      if (!object || object.size > 12 * 1024 * 1024)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message: 'The prepared photo is unavailable.',
        });
      const hash = new Uint8Array(
        await crypto.subtle.digest('SHA-256', await object.arrayBuffer()),
      );
      if (Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('') !== job.sha256)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
          message: 'The prepared photo failed verification.',
        });
      const added = {
        ...image,
        order: product.images.length,
        alt: (job.colorName
          ? `${product.name} — ${job.colorName}`
          : `${product.name} — photograph ${product.images.length + 1}`
        ).slice(0, 180),
      };
      const candidate = validateProduct({
        ...product,
        images: [...product.images, added],
        primaryImage: product.primaryImage ?? imageId,
        updatedAt: new Date().toISOString(),
        colorOptions: product.colorOptions?.map((color) =>
          color.name === job.colorName
            ? { ...color, imageIds: [...new Set([...(color.imageIds ?? []), imageId])] }
            : color,
        ),
      });
      if (!candidate.ok)
        return errorResponse(ERROR_CODES.VALIDATION_FAILED, { fields: candidate.fields });
      await saveProductState({
        drafts,
        client,
        actor,
        product: candidate.product,
        from: product.status,
        action: 'add prepared photo',
      });
      await drafts.put(
        uploadJobKey(productId, imageId),
        JSON.stringify({ ...job, state: 'applied', updatedAt: Date.now() }),
        { expirationTtl: UPLOAD_JOB_TTL },
      );
      const index = await drafts.get(uploadIndexKey(productId), 'json');
      if (Array.isArray(index))
        await drafts.put(
          uploadIndexKey(productId),
          JSON.stringify(index.filter((value) => typeof value === 'string' && value !== imageId)),
          { expirationTtl: UPLOAD_JOB_TTL },
        );
      return jsonResponse(
        { images: [added], rejected: [], colorName: job.colorName },
        { headers: productRevisionHeaders(product.updatedAt, candidate.product.updatedAt) },
      );
    });
  } catch (error) {
    logServerError('photo uploads: promotion failed', error);
    return toClientErrorResponse(error);
  }
}
