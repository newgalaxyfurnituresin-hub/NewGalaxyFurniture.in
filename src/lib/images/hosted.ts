import { MAX_PHOTO_BYTES } from '@/lib/images/upload-limits';
import { AppError, ERROR_CODES } from '@/lib/errors';
import type { ObjectBucket } from '@/lib/runtime/types';
import { DERIVATIVE_WIDTHS } from './srcset';
import type { UploadJobValue } from './upload-jobs';

/** Cloudflare decodes pixels outside the Worker CPU/memory budget; input stays in the company account. */
export interface HostedImageService {
  info(stream: ReadableStream<Uint8Array>): Promise<{ width: number; height: number }>;
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: {
      width?: number;
      height?: number;
      metadata?: 'none';
      fit?: 'scale-down';
    }): ReturnType<HostedImageService['input']>;
    output(options: {
      format: 'image/jpeg' | 'image/webp';
      quality: number;
      anim: false;
    }): Promise<{ response(): Response }>;
  };
}
// A Blob is immutable and can provide independent streams without copying the photo for each size.
const photoBlob = (bytes: Uint8Array): Blob => new Blob([bytes as Uint8Array<ArrayBuffer>]);
export async function hostedOriginal(
  service: HostedImageService,
  bytes: Uint8Array,
  minWidth = 256,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const source = photoBlob(bytes);
  const info = await service.info(source.stream());
  if (info.width < minWidth || info.height < 64 || info.width * info.height > 40_000_000)
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'This photo has unsupported dimensions. Use a photo under 40 megapixels.',
    });
  const converted = await service
    .input(source.stream())
    .transform({ metadata: 'none' })
    .output({ format: 'image/jpeg', quality: 92, anim: false });
  const response = converted.response();
  if (!response.ok)
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'This photo could not be prepared. Re-export it as JPEG and try again.',
    });
  const sanitized = new Uint8Array(await response.arrayBuffer());
  if (sanitized.byteLength > MAX_PHOTO_BYTES)
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'The prepared photo exceeds 15 MB. Export a smaller image.',
    });
  const result = await service.info(photoBlob(sanitized).stream());
  return { bytes: sanitized, width: result.width, height: result.height };
}
export async function prepareHostedPhoto(
  service: HostedImageService,
  bucket: ObjectBucket,
  job: UploadJobValue,
  bytes: Uint8Array,
): Promise<UploadJobValue> {
  const original = await hostedOriginal(service, bytes);
  const sanitizedPhoto = photoBlob(original.bytes);
  const prefix = `products/${job.productId}/${job.imageId}`;
  const key = `${prefix}/original.jpg`;
  const put = async (key: string, bytes: Uint8Array, contentType: string): Promise<void> => {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: 'private, no-store' },
    });
  };
  await put(key, original.bytes, 'image/jpeg');
  const widths = DERIVATIVE_WIDTHS.filter((value) => value <= original.width);
  if (!widths.length) widths.push(original.width);
  for (const width of widths) {
    const result = await service
      .input(sanitizedPhoto.stream())
      .transform({ width, fit: 'scale-down', metadata: 'none' })
      .output({ format: 'image/webp', quality: 82, anim: false });
    await put(
      `${prefix}/${width}.webp`,
      new Uint8Array(await result.response().arrayBuffer()),
      'image/webp',
    );
  }
  const lqip = await service
    .input(sanitizedPhoto.stream())
    .transform({ width: 24, height: 24, fit: 'scale-down', metadata: 'none' })
    .output({ format: 'image/webp', quality: 65, anim: false });
  const tiny = new Uint8Array(await lqip.response().arrayBuffer());
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', original.bytes as Uint8Array<ArrayBuffer>),
  );
  return {
    ...job,
    state: 'ready',
    updatedAt: Date.now(),
    sha256: Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    result: {
      id: job.imageId,
      key,
      width: original.width,
      height: original.height,
      alt: '',
      altSource: 'admin',
      filename: job.filename,
      mime: 'image/jpeg',
      order: 0,
      derivativesReady: true,
      derivativeWidths: widths,
      derivativeFormats: ['webp'],
      lqip: `data:image/webp;base64,${btoa(String.fromCharCode(...tiny))}`,
    },
  };
}

/** Advance one durable photo checkpoint per request. Never generate all sizes in one Worker invocation. */
export async function advanceHostedPhoto(
  service: HostedImageService,
  bucket: ObjectBucket,
  job: UploadJobValue,
): Promise<UploadJobValue> {
  const prefix = `products/${job.productId}/${job.imageId}`;
  const key = `${prefix}/original.jpg`;
  const put = async (path: string, bytes: Uint8Array, contentType: string): Promise<void> => {
    await bucket.put(path, bytes, {
      httpMetadata: { contentType, cacheControl: 'private, no-store' },
    });
  };
  if (!job.result) {
    const source = await bucket.get(job.sourceKey);
    if (!source || source.size > MAX_PHOTO_BYTES)
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        message: 'The private source photo is unavailable or too large.',
      });
    const original = await hostedOriginal(service, new Uint8Array(await source.arrayBuffer()));
    await put(key, original.bytes, 'image/jpeg');
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', original.bytes as Uint8Array<ArrayBuffer>),
    );
    return {
      ...job,
      state: 'processing',
      updatedAt: Date.now(),
      sha256: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''),
      result: {
        id: job.imageId,
        key,
        width: original.width,
        height: original.height,
        alt: '',
        altSource: 'admin',
        filename: job.filename,
        mime: 'image/jpeg',
        order: 0,
        derivativesReady: false,
        derivativeWidths: [],
        derivativeFormats: ['webp'],
      },
    };
  }
  const image = job.result;
  if (
    image.id !== job.imageId ||
    image.key !== key ||
    image.mime !== 'image/jpeg' ||
    image.enhancedFrom
  )
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'The private photo checkpoint could not be verified.',
    });
  const widths = DERIVATIVE_WIDTHS.filter((width) => width <= image.width);
  if (!widths.length) widths.push(image.width);
  const completed = image.derivativeWidths ?? [];
  const next = widths.find((width) => !completed.includes(width));
  const stored = await bucket.get(key);
  if (!stored || stored.size > MAX_PHOTO_BYTES)
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'The prepared photo is unavailable.',
    });
  // Native R2 streams avoid loading and copying the full-resolution photo into JS for each size.
  const source =
    (stored.body as ReadableStream<Uint8Array> | null) ??
    photoBlob(new Uint8Array(await stored.arrayBuffer())).stream();
  const transformed = await service
    .input(source)
    .transform(
      next === undefined
        ? { width: 24, height: 24, fit: 'scale-down', metadata: 'none' }
        : { width: next, fit: 'scale-down', metadata: 'none' },
    )
    .output({ format: 'image/webp', quality: next === undefined ? 65 : 82, anim: false });
  const response = transformed.response();
  if (!response.ok)
    throw new AppError(ERROR_CODES.CONFIGURATION_INCOMPLETE, {
      message:
        'Image preparation is temporarily unavailable. The private photo checkpoint is preserved.',
    });
  const output = new Uint8Array(await response.arrayBuffer());
  if (next !== undefined) {
    await put(`${prefix}/${next}.webp`, output, 'image/webp');
    return {
      ...job,
      state: 'processing',
      updatedAt: Date.now(),
      result: { ...image, derivativeWidths: [...completed, next] },
    };
  }
  if (output.byteLength > 2900)
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'The photo preview could not be prepared safely.',
    });
  return {
    ...job,
    state: 'ready',
    updatedAt: Date.now(),
    result: {
      ...image,
      derivativesReady: true,
      lqip: `data:image/webp;base64,${btoa(String.fromCharCode(...output))}`,
    },
  };
}
