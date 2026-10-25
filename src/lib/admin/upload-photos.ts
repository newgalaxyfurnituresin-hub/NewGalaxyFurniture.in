import { adminFetch, type ApiResult } from './client';
import type { ProductRevision } from '@/lib/products/revision';
import type { ProductImageValue } from '@/schemas/product';

export interface PhotoRejection {
  filename: string;
  code: string;
  message: string;
}

interface PhotoResponse {
  images: ProductImageValue[];
  rejected: PhotoRejection[];
  uploadId?: string;
}
export interface PendingPhoto {
  imageId: string;
  filename: string;
  colorName: string;
  state: string;
}
export interface PendingPhotos {
  computerOnline: boolean;
  uploads: PendingPhoto[];
}
export const completePhotoUpload = (
  productId: string,
  imageId: string,
): Promise<ApiResult<PhotoResponse & { colorName?: string }>> =>
  adminFetch(`/api/admin/products/${productId}/photo-uploads/${imageId}`, {
    method: 'POST',
    body: {},
  });
async function waitForPhoto(
  productId: string,
  imageId: string,
  progress: (message: string) => void,
): Promise<ApiResult<PhotoResponse> | null> {
  for (let attempt = 0; attempt < 45; attempt++) {
    const result = await adminFetch<PendingPhotos>(
      `/api/admin/products/${productId}/photo-uploads`,
    );
    if (!result.ok) return result;
    const job = result.value.uploads.find((upload) => upload.imageId === imageId);
    if (job?.state === 'ready') return await completePhotoUpload(productId, imageId);
    if (job?.state === 'failed')
      return {
        ok: false,
        error: {
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'This photo could not be decoded safely. Re-export it and upload it again.',
        },
      };
    if (!result.value.computerOnline) return null;
    progress(
      'Photo received privately. The company computer is validating it and preparing smaller sizes. Keep this page open.',
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

/** One photo per request bounds multipart size, decoded pixels and Worker CPU per upload. */
export async function uploadPhotos(input: {
  productId: string;
  files: readonly File[];
  existingCount: number;
  colorName?: string;
  onProgress: (message: string) => void;
  onAccepted: (images: ProductImageValue[], revision?: ProductRevision) => void;
}): Promise<{ added: number; pending: number; rejected: PhotoRejection[]; stopped: boolean }> {
  const rejected: PhotoRejection[] = [];
  let added = 0;
  let pending = 0;
  let previousFinished = 0;
  let stopped = false;
  for (const [index, file] of input.files.entries()) {
    if (input.existingCount + added + pending >= 20) {
      rejected.push({
        filename: file.name,
        code: 'TOO_MANY_IMAGES',
        message: 'This product has reached its limit of 20 photos.',
      });
      continue;
    }
    if (file.size > 12 * 1024 * 1024 || file.size === 0) {
      rejected.push({
        filename: file.name,
        code: file.size === 0 ? 'EMPTY_FILE' : 'TOO_LARGE',
        message:
          file.size === 0
            ? 'This file is empty.'
            : 'This photo is larger than 12 MB. Export a smaller file and try again.',
      });
      continue;
    }
    input.onProgress(
      `Uploading photo ${index + 1} of ${input.files.length}: ${file.name}. ${added} added so far. Keep this page open.`,
    );
    // KV counters and enhancement pointers allow one write per key per second.
    const remaining = previousFinished + 1100 - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    const form = new FormData();
    form.append('file', file);
    if (input.colorName) form.append('colorName', input.colorName.trim());
    let result = await adminFetch<PhotoResponse>(
      `/api/admin/products/${input.productId}/photo-uploads`,
      { method: 'POST', formData: form },
    );
    previousFinished = Date.now();
    if (result.ok && result.value.uploadId) {
      const prepared = await waitForPhoto(input.productId, result.value.uploadId, input.onProgress);
      if (prepared === null) {
        pending++;
        continue;
      }
      result = prepared;
    }
    if (!result.ok) {
      const uncertain = result.error.status === 0 || result.error.status >= 500;
      const detail =
        result.error.code === 'INTERNAL_ERROR'
          ? 'The server could not finish this photo.'
          : result.error.message;
      rejected.push({
        filename: file.name,
        code: result.error.code,
        message: uncertain
          ? `${detail} Refresh and check the saved photos before retrying this file; it may already have been saved.`
          : detail,
      });
      // Never blindly retry a write, or continue after an expired session/server failure.
      if (result.error.status !== 422 && result.error.status !== 413) {
        stopped = true;
        for (const pending of input.files.slice(index + 1))
          rejected.push({
            filename: pending.name,
            code: 'NOT_ATTEMPTED',
            message: 'Not uploaded. Resolve the previous error, then select this file again.',
          });
        break;
      }
      continue;
    }
    rejected.push(...result.value.rejected);
    if (result.value.images.length) {
      added += result.value.images.length;
      input.onAccepted(result.value.images, result.revision);
    }
  }
  return { added, pending, rejected, stopped };
}
