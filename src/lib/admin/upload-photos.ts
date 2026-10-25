import { adminFetch } from './client';
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
}

/** One photo per request bounds multipart size, decoded pixels and Worker CPU per upload. */
export async function uploadPhotos(input: {
  productId: string;
  files: readonly File[];
  existingCount: number;
  colorName?: string;
  onProgress: (message: string) => void;
  onAccepted: (images: ProductImageValue[], revision?: ProductRevision) => void;
}): Promise<{ added: number; rejected: PhotoRejection[]; stopped: boolean }> {
  const rejected: PhotoRejection[] = [];
  let added = 0;
  let previousFinished = 0;
  let stopped = false;
  for (const [index, file] of input.files.entries()) {
    if (input.existingCount + added >= 20) {
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
    const result = await adminFetch<PhotoResponse>(
      `/api/admin/products/${input.productId}/images`,
      { method: 'POST', formData: form },
    );
    previousFinished = Date.now();
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
  return { added, rejected, stopped };
}
