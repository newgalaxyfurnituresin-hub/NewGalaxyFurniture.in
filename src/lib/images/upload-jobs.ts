import { z } from 'zod';
import { ProductImage } from '@/schemas/product';
import type { KeyValueStore } from '@/lib/runtime/types';
export const UPLOAD_JOB_PREFIX = 'photo-upload:';
export const UPLOAD_JOB_POINTER = 'photo-upload-pointer';
export const uploadIndexKey = (productId: string): string => `photo-upload-index:${productId}`;
export const UPLOAD_JOB_TTL = 7 * 24 * 60 * 60;
export const UploadJob = z.object({
  version: z.literal(1),
  productId: z.string().regex(/^p_[a-z0-9]{10}$/),
  imageId: z.string().regex(/^img_[a-z0-9]{10}$/),
  sourceKey: z.string().max(180),
  filename: z.string().max(180),
  colorName: z.string().max(60),
  state: z.enum(['queued', 'processing', 'ready', 'failed', 'applied']),
  updatedAt: z.number(),
  failures: z.number().int().min(0).max(3).optional(),
  result: ProductImage.optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type UploadJobValue = z.infer<typeof UploadJob>;
export const uploadJobKey = (productId: string, imageId: string): string =>
  `${UPLOAD_JOB_PREFIX}${productId}:${imageId}`;
export const quarantineKey = (productId: string, imageId: string): string =>
  `pending-uploads/${productId}/${imageId}/source`;
export async function readUploadJob(
  store: KeyValueStore,
  productId: string,
  imageId: string,
): Promise<UploadJobValue | null> {
  const parsed = UploadJob.safeParse(await store.get(uploadJobKey(productId, imageId), 'json'));
  return parsed.success &&
    parsed.data.productId === productId &&
    parsed.data.imageId === imageId &&
    parsed.data.sourceKey === quarantineKey(productId, imageId)
    ? parsed.data
    : null;
}
export async function listUploadJobs(
  store: KeyValueStore,
  productId: string,
): Promise<UploadJobValue[]> {
  if (!/^p_[a-z0-9]{10}$/.test(productId)) return [];
  const parsed = z
    .array(z.string().regex(/^img_[a-z0-9]{10}$/))
    .max(20)
    .safeParse(await store.get(uploadIndexKey(productId), 'json'));
  if (!parsed.success) return [];
  const jobs: UploadJobValue[] = [];
  for (const imageId of parsed.data) {
    const job = await readUploadJob(store, productId, imageId);
    if (job && job.state !== 'applied') jobs.push(job);
  }
  return jobs;
}
