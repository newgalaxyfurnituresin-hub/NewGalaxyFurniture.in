import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { adminFetch } from '@/lib/admin/client';
import { derivativeUrl } from '@/lib/images/srcset';
import { formatINR, PRICE_ON_ENQUIRY_LABEL } from '@/lib/money';
import type { Product } from '@/schemas/product';
import PublicationProgress from './PublicationProgress';
import type { PendingPublication } from '@/lib/admin/publication';

export default function ProductDeletion({
  product,
  disabled,
  onDeleted,
}: {
  product: Product;
  disabled: boolean;
  onDeleted?: (pending: PendingPublication) => void;
}): ReactElement {
  const [sku, setSku] = useState('');
  const [review, setReview] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState<PendingPublication | null>(null);
  const inFlight = useRef(false);
  const buttonClass =
    'min-h-[44px] border border-espresso px-4 py-2 text-espresso disabled:opacity-50';

  async function findProduct(): Promise<void> {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setReview(null);
    try {
      const result = await adminFetch<{ product: Product }>(`/api/admin/products/${product.id}`);
      if (!result.ok) setError(result.error.message);
      else if (sku.trim() !== result.value.product.sku)
        setError('That SKU does not match this product. Check the SKU and try again.');
      else setReview(result.value.product);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (inFlight.current || disabled || review === null || sku.trim() !== review.sku) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await adminFetch<{ deletedAt: string; commitSha: string | null }>(
        `/api/admin/products/${review.id}`,
        { method: 'DELETE', body: { confirmSku: sku.trim(), expectedUpdatedAt: review.updatedAt } },
      );
      if (!result.ok) {
        setError(result.error.message);
        setReview(null);
        return;
      }
      const removal: PendingPublication = {
        id: review.id,
        slug: review.slug,
        updatedAt: result.value.deletedAt,
        to: 'UNPUBLISHED',
        commitSha: result.value.commitSha,
        startedAt: Date.now(),
      };
      setDeleted(removal);
      onDeleted?.(removal);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (deleted !== null)
    return (
      <div className="flex min-w-0 flex-col gap-3" role="region" aria-label="Product deletion">
        <p role="status">
          Product deleted from admin. We are checking its removal from the public website.
        </p>
        <PublicationProgress productId={product.id} pending={deleted} />
        <a className={buttonClass} href="/admin/products">
          Back to products
        </a>
      </div>
    );

  const photo =
    review?.images.find((image) => image.id === review.primaryImage) ?? review?.images[0];
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Delete product by SKU">
      <label htmlFor="confirm-delete" className="text-small font-medium text-espresso">
        Delete by SKU
      </label>
      <p className="text-small text-walnut">
        Enter this product’s SKU, <strong>{product.sku}</strong>, then review the item before
        confirming.
      </p>
      <div className="flex min-w-0 flex-wrap gap-2">
        <input
          id="confirm-delete"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={sku}
          disabled={busy || disabled}
          aria-describedby="delete-sku-feedback"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void findProduct();
            }
          }}
          onChange={(event) => {
            setSku(event.target.value);
            setReview(null);
            setError('');
          }}
          className="min-h-[44px] w-full min-w-0 border border-taupe px-3 py-2 sm:w-auto"
        />
        <button
          type="button"
          onClick={() => void findProduct()}
          disabled={busy || disabled || sku.trim() === ''}
          className={buttonClass}
        >
          {busy ? 'Working…' : 'Review item to delete'}
        </button>
      </div>
      <div id="delete-sku-feedback" role="status" aria-live="polite">
        {error}
      </div>
      {review !== null && (
        <div
          className="min-w-0 border border-taupe bg-white p-4"
          role="region"
          aria-label="Confirm product deletion"
        >
          <h3 className="text-body font-medium">Is this the item you want to delete?</h3>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-4">
            {photo && (
              <img
                src={derivativeUrl(review.id, photo.id, 320, 'webp')}
                width="120"
                height="100"
                alt={photo.alt || review.name}
                className="h-24 w-28 object-contain"
              />
            )}
            <div className="min-w-0 flex-1 break-words">
              <p className="font-medium">{review.name}</p>
              <p>
                SKU: <strong>{review.sku}</strong>
              </p>
              <p>{review.price === null ? PRICE_ON_ENQUIRY_LABEL : formatINR(review.price)}</p>
              <p className="text-small">
                Category: {review.category} · {review.published ? 'Published' : 'Not public'}
              </p>
            </div>
          </div>
          <p className="mt-3 text-small">
            Confirming removes this item from admin and starts a website update to remove its page,
            catalogue listings, search results and sitemap. Public removal is complete only when the
            update is verified below.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={busy || disabled}
              onClick={() => void remove()}
            >
              {busy ? 'Deleting…' : 'Confirm deletion'}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                setReview(null);
                setSku('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
