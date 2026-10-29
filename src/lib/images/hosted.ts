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
  if (sanitized.byteLength > 12 * 1024 * 1024)
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'The prepared photo exceeds 12 MB. Export a smaller image.',
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
