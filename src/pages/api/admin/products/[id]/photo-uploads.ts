import type { APIContext } from 'astro';
import { openAdminContext } from '@/lib/admin/context';
import { getR2 } from '@/lib/env';
import {
  ERROR_CODES,
  errorResponse,
  jsonResponse,
  logServerError,
  toClientErrorResponse,
} from '@/lib/errors';
import { resolveProduct } from '@/lib/github/drafts';
import { consumeNamedLimit } from '@/lib/auth/rate-limit';
import { getKV } from '@/lib/env';
import { BodyTooLargeError, readBoundedForm } from '@/lib/security/body';
import { generateImageId, validateUpload } from '@/lib/images/validate';
import { ENHANCEMENT_HEARTBEAT } from '@/lib/images/enhancement';
import {
  listUploadJobs,
  quarantineKey,
  uploadJobKey,
  uploadIndexKey,
  UPLOAD_JOB_POINTER,
  UPLOAD_JOB_TTL,
  type UploadJobValue,
} from '@/lib/images/upload-jobs';
export const prerender = false;
export const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024 + 64 * 1024;
export async function GET(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'product.write');
  if (!opened.ok) return opened.response;
  try {
    const { drafts, client } = opened.context;
    const productId = context.params.id ?? '';
    if (!(await resolveProduct({ drafts, client }, productId)))
      return errorResponse(ERROR_CODES.NOT_FOUND);
    const jobs = await listUploadJobs(drafts, productId);
    const heartbeat = (await drafts.get(ENHANCEMENT_HEARTBEAT, 'json')) as {
      lastSeen?: number;
    } | null;
    return jsonResponse({
      computerOnline:
        typeof heartbeat?.lastSeen === 'number' && Date.now() - heartbeat.lastSeen < 10 * 60_000,
      uploads: jobs.map((job) => ({
        imageId: job.imageId,
        filename: job.filename,
        colorName: job.colorName,
        state: job.state,
      })),
    });
  } catch (error) {
    logServerError('photo uploads: status unavailable', error);
    return toClientErrorResponse(error);
  }
}
export async function POST(context: APIContext): Promise<Response> {
  const opened = await openAdminContext(context, 'product.write');
  if (!opened.ok) return opened.response;
  try {
    const { drafts, client } = opened.context;
    const productId = context.params.id ?? '';
    const resolved = await resolveProduct({ drafts, client }, productId);
    if (!resolved) return errorResponse(ERROR_CODES.NOT_FOUND);
    const limit = await consumeNamedLimit(
      getKV(context, 'RATELIMIT'),
      'imageUpload',
      opened.context.session.id,
    );
    if (!limit.allowed)
      return errorResponse(ERROR_CODES.RATE_LIMITED, {
        message: 'Upload limit reached. Please wait before uploading more photos.',
      });
    const pending = await listUploadJobs(drafts, productId);
    if (
      resolved.product.images.length + pending.filter((job) => job.state !== 'failed').length >=
      20
    )
      return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
        message:
          'This product has 20 photos or pending uploads. Wait for preparation to finish before adding more.',
      });
    const form = await readBoundedForm(context.request, MAX_UPLOAD_BODY_BYTES);
    const files = form.getAll('file');
    const color = form.get('colorName');
    if (
      files.length !== 1 ||
      !(files[0] instanceof File) ||
      (color !== null && (typeof color !== 'string' || color.trim().length > 60))
    )
      return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
        message: 'Choose one photo per upload request and a valid colour name.',
      });
    // Header checks only at the edge. Full decode and metadata stripping happen before promotion.
    const validation = await validateUpload(files[0], undefined, { allowEnhancementSource: true });
    if (!validation.ok)
      return errorResponse(ERROR_CODES.VALIDATION_FAILED, { message: validation.error.message });
    const imageId = generateImageId();
    const sourceKey = quarantineKey(productId, imageId);
    await getR2(context).put(sourceKey, validation.image.bytes, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
    });
    const job: UploadJobValue = {
      version: 1,
      productId,
      imageId,
      sourceKey,
      filename: validation.image.label,
      colorName: typeof color === 'string' ? color.trim() : '',
      state: 'queued',
      updatedAt: Date.now(),
    };
    const key = uploadJobKey(productId, imageId);
    await drafts.put(key, JSON.stringify(job), { expirationTtl: UPLOAD_JOB_TTL });
    await drafts.put(
      uploadIndexKey(productId),
      JSON.stringify(
        [
          ...pending.filter((entry) => entry.state !== 'failed').map((entry) => entry.imageId),
          imageId,
        ].slice(-20),
      ),
      { expirationTtl: UPLOAD_JOB_TTL },
    );
    const pointer = await drafts.get(UPLOAD_JOB_POINTER, 'json');
    const previous = Array.isArray(pointer)
      ? pointer.filter(
          (entry): entry is string =>
            typeof entry === 'string' && entry.startsWith('photo-upload:'),
        )
      : [];
    await drafts.put(
      UPLOAD_JOB_POINTER,
      JSON.stringify([...new Set([key, ...previous])].slice(0, 80)),
      { expirationTtl: UPLOAD_JOB_TTL },
    );
    return jsonResponse({ uploadId: imageId, images: [], rejected: [] }, { status: 202 });
  } catch (error) {
    logServerError('photo uploads: staging failed', error);
    if (error instanceof BodyTooLargeError)
      return errorResponse(ERROR_CODES.VALIDATION_FAILED, {
        message: 'Each photo can be up to 12 MB.',
      });
    return toClientErrorResponse(error);
  }
}
