import type { Product } from '@/schemas/product';
import { applyProductPatch } from '@/lib/products/input';
import { retainColorPhotos } from '@/lib/products/colors';
import {
  EditorDraftRecord,
  EDITOR_DRAFT_TTL_SECONDS,
  type EditorDraft,
  type EditorPatch,
} from '@/lib/products/editor-drafts';

export interface LocalEditorDraft extends EditorDraft {
  dirty: boolean;
  completedId?: string;
}
/** Object key order can change during server validation; array order is meaningful. */
export function serializeEditorPatch(patch: EditorPatch): string {
  return JSON.stringify(patch, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return value;
  });
}
export function recoveryStorageKey(owner: string, scope: string): string {
  return `ngf:editor-recovery:${owner}:${scope}`;
}
export function readLocalRecovery(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  now = Date.now(),
): LocalEditorDraft | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as unknown;
    if (!value || typeof value !== 'object') return null;
    const { dirty, completedId, ...record } = value as Record<string, unknown>;
    const parsed = EditorDraftRecord.safeParse(record);
    if (!parsed.success || now - parsed.data.savedAt > EDITOR_DRAFT_TTL_SECONDS * 1000) return null;
    return {
      ...parsed.data,
      dirty: dirty === true,
      ...(typeof completedId === 'string' && /^p_[a-z0-9]{10}$/.test(completedId)
        ? { completedId }
        : {}),
    };
  } catch {
    return null;
  }
}
export function restoreEditorPatch(
  base: Product,
  patch: EditorPatch,
  baseUpdatedAt: string,
): Product {
  const product = applyProductPatch(base, patch, new Date(base.updatedAt));
  // Recovery preserves unfinished input, including temporarily inconsistent prices.
  // Canonical validation and normalization still run when the operator clicks Save.
  if (patch.price !== undefined) product.price = patch.price;
  if (patch.originalPrice !== undefined) product.originalPrice = patch.originalPrice;
  if (patch.stockStatus !== undefined) product.stockStatus = patch.stockStatus;
  product.updatedAt = baseUpdatedAt;
  // Photo bytes and storage keys are never restored from browser input. Keep the
  // server's current images, and drop references to photos removed in another tab.
  if (product.colorOptions)
    product.colorOptions = retainColorPhotos(product.colorOptions, base.images);
  if (!base.images.some((image) => image.id === product.primaryImage))
    product.primaryImage = base.primaryImage;
  return product;
}
