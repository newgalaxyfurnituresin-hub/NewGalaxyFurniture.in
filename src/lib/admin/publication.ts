import { PUBLIC_STATUSES, type ProductStatusValue } from '@/schemas/product';

export interface PublicationReceipt {
  generatedAt: string;
  products: { id: string; slug: string; updatedAt: string; status: ProductStatusValue }[];
}

export interface PendingPublication {
  id: string;
  slug: string;
  updatedAt: string;
  to: ProductStatusValue;
  commitSha: string | null;
  startedAt: number;
}

/** An older deployment, or a different product, is never proof that this change is live. */
export function publicationIsLive(
  receipt: PublicationReceipt,
  pending: PendingPublication,
): boolean {
  const builtAt = Date.parse(receipt.generatedAt);
  if (!Number.isFinite(builtAt) || builtAt < Date.parse(pending.updatedAt)) return false;
  const product = receipt.products.find((entry) => entry.id === pending.id);
  return PUBLIC_STATUSES.includes(pending.to)
    ? product?.slug === pending.slug &&
        product.updatedAt === pending.updatedAt &&
        product.status === pending.to
    : product === undefined;
}

export function publicationElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
