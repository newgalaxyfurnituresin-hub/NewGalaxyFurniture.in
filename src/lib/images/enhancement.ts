import { z } from 'zod';
import type { KeyValueStore } from '@/lib/runtime/types';
import type { ProductImageValue } from '@/schemas/product';

export const ENHANCEMENT_PREFIX = 'image-enhancement:job:';
export const ENHANCEMENT_POINTER = 'image-enhancement:latest';
export const ENHANCEMENT_HEARTBEAT = 'image-enhancement:heartbeat';
export const ENHANCEMENT_TTL = 7 * 24 * 60 * 60;
const id = z.string().regex(/^img_[a-z0-9]{10}$/);
export const EnhancementJob = z.object({
  version: z.literal(1),
  productId: z.string().regex(/^p_[a-z0-9]{10}$/),
  imageId: id,
  sourceKey: z.string().max(240),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  state: z.enum(['queued', 'processing', 'ready', 'failed', 'applied']),
  queuedAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  message: z.string().max(240).optional(),
  result: z
    .object({
      imageId: id,
      width: z.number().int().positive().max(3840),
      height: z.number().int().positive().max(3840),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      derivativeWidths: z.array(z.number().int().positive()).min(1).max(12),
      lqip: z.string().startsWith('data:image/webp;base64,').max(4000),
    })
    .optional(),
});
export type EnhancementJobValue = z.infer<typeof EnhancementJob>;

export function enhancementKey(productId: string, imageId: string): string {
  if (!/^p_[a-z0-9]{10}$/.test(productId) || !/^img_[a-z0-9]{10}$/.test(imageId)) {
    throw new Error('Invalid enhancement image reference.');
  }
  return `${ENHANCEMENT_PREFIX}${productId}:${imageId}`;
}

export async function readEnhancement(
  store: KeyValueStore,
  productId: string,
  imageId: string,
): Promise<EnhancementJobValue | null> {
  const parsed = EnhancementJob.safeParse(
    await store.get(enhancementKey(productId, imageId), 'json'),
  );
  if (!parsed.success || parsed.data.productId !== productId || parsed.data.imageId !== imageId)
    return null;
  return parsed.data;
}

export async function queueEnhancement(
  store: KeyValueStore,
  productId: string,
  image: ProductImageValue,
  wake = true,
): Promise<EnhancementJobValue | null> {
  if (Math.max(image.width, image.height) >= 3840) return null;
  const existing = await readEnhancement(store, productId, image.id);
  if (existing !== null && existing.state !== 'failed') return existing;
  const now = Date.now();
  const job: EnhancementJobValue = {
    version: 1,
    productId,
    imageId: image.id,
    sourceKey: image.key,
    sourceWidth: image.width,
    sourceHeight: image.height,
    state: 'queued',
    queuedAt: now,
    updatedAt: now,
  };
  await store.put(enhancementKey(productId, image.id), JSON.stringify(job), {
    expirationTtl: ENHANCEMENT_TTL,
  });
  if (wake) await wakeEnhancements(store, [enhancementKey(productId, image.id)]);
  return job;
}

/** One wake-up per upload batch also respects KV's same-key write-rate limit. */
export async function wakeEnhancements(
  store: KeyValueStore,
  newKeys: readonly string[],
): Promise<void> {
  if (!newKeys.length) return;
  // A cheap single-key wake-up avoids spending the free plan's list quota on rapid polling.
  const pointer = await store.get(ENHANCEMENT_POINTER, 'json');
  const previous = z.array(z.string().max(100)).max(40).safeParse(pointer);
  const keys = [...new Set([...newKeys, ...(previous.success ? previous.data : [])])].slice(0, 40);
  await store.put(ENHANCEMENT_POINTER, JSON.stringify(keys), { expirationTtl: ENHANCEMENT_TTL });
}

/** Old and enhanced originals have different immutable keys; neither is overwritten. */
export function enhancedRecord(
  source: ProductImageValue,
  job: EnhancementJobValue,
): ProductImageValue {
  const result = job.result;
  const allowed = [320, 480, 640, 960, 1280, 1600, 2000, 3840];
  if (
    job.state !== 'ready' ||
    result === undefined ||
    source.id !== job.imageId ||
    source.key !== job.sourceKey ||
    result.imageId === source.id ||
    Math.max(result.width, result.height) !== 3840 ||
    Math.abs(result.width / result.height - source.width / source.height) > 0.005 ||
    result.derivativeWidths.some((width) => !allowed.includes(width) || width > result.width)
  ) {
    throw new Error('Enhanced photo does not match its original.');
  }
  return {
    ...source,
    id: result.imageId,
    key: `products/${job.productId}/${result.imageId}/original.jpg`,
    width: result.width,
    height: result.height,
    mime: 'image/jpeg',
    lqip: result.lqip,
    derivativesReady: true,
    derivativeWidths: result.derivativeWidths,
    derivativeFormats: ['webp', 'jpeg'],
    enhancedFrom: {
      id: source.id,
      key: source.key,
      width: source.width,
      height: source.height,
      ...(source.mime === undefined ? {} : { mime: source.mime }),
    },
  };
}
