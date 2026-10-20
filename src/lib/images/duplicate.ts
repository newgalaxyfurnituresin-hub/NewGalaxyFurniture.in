import { AppError, ERROR_CODES } from '@/lib/errors';
import type { ObjectBucket } from '@/lib/runtime/types';
import type { Product } from '@/schemas/product';
import { IMAGE_CACHE_CONTROL, imagePrefix } from './srcset';
import { listImageKeys } from './store';

/** A new product needs independent media: sharing keys would make deletion unsafe. */
export async function duplicateProductMedia(
  bucket: ObjectBucket,
  sourceId: string,
  copy: Product,
): Promise<Product> {
  if (
    sourceId === copy.id ||
    !/^p_[a-z0-9]{10}$/.test(sourceId) ||
    !/^p_[a-z0-9]{10}$/.test(copy.id)
  )
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'The duplicate must have its own product identity.',
    });
  const existing = await bucket.list({ prefix: `products/${copy.id}/` });
  if (existing.objects.length)
    throw new AppError(ERROR_CODES.CONFLICT, {
      message: 'The new media location is already occupied. Try duplicating again.',
    });
  const groups = new Map<string, Set<string>>();
  for (const image of copy.images) {
    for (const reference of [image, image.enhancedFrom].filter((entry) => entry !== undefined)) {
      const prefix = imagePrefix(sourceId, reference.id);
      if (
        !reference.key.startsWith(prefix) ||
        !/^original\.(jpg|png|webp|avif)$/.test(reference.key.slice(prefix.length))
      )
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          message:
            'A source photograph is not in this product’s media. Re-upload it before duplicating.',
        });
      const required = groups.get(reference.id) ?? new Set<string>();
      required.add(reference.key);
      groups.set(reference.id, required);
    }
  }
  const plan: { from: string; to: string }[] = [];
  for (const [imageId, required] of groups) {
    const prefix = imagePrefix(sourceId, imageId);
    const keys = await listImageKeys(bucket, sourceId, imageId);
    if ([...required].some((key) => !keys.includes(key)))
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        message: 'A source photograph is missing. No duplicate product was created.',
      });
    for (const key of keys) {
      const suffix = key.slice(prefix.length);
      if (!/^(original\.(jpg|png|webp|avif)|\d{1,4}\.(webp|jpeg|avif))$/.test(suffix)) continue;
      plan.push({ from: key, to: imagePrefix(copy.id, imageId) + suffix });
    }
  }
  // Sequential copies keep peak image memory bounded. Originals are never changed or deleted.
  for (const item of plan) {
    const object = await bucket.get(item.from);
    if (!object)
      throw new AppError(ERROR_CODES.CONFLICT, {
        message: 'A source photograph changed while copying. Please try again.',
      });
    await bucket.put(item.to, await object.arrayBuffer(), {
      httpMetadata: { ...object.httpMetadata, cacheControl: IMAGE_CACHE_CONTROL },
      ...(object.customMetadata ? { customMetadata: object.customMetadata } : {}),
    });
  }
  const result = structuredClone(copy);
  for (const image of result.images) {
    image.key = image.key.replace(`products/${sourceId}/`, `products/${copy.id}/`);
    if (image.enhancedFrom)
      image.enhancedFrom.key = image.enhancedFrom.key.replace(
        `products/${sourceId}/`,
        `products/${copy.id}/`,
      );
  }
  return result;
}
