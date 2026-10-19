/**
 * Lifecycle controls: the transitions that are legal right now, and an honest account of what
 * happens after one is taken.
 *
 * Saving a publication starts the persistent progress panel. It checks the public build's
 * catalogue receipt for this exact product revision; a repository commit or an earlier
 * successful deployment is never presented as proof that this change is live.
 *
 * Only transitions legal from the current status are rendered, from the same
 * `availableTransitions` the server enforces. When the publish gate would refuse, the reason
 * is shown against the fields that fail rather than as a disabled button with no explanation
 * (14.5).
 *
 * Requirements: 12.5, 12.7, 14.2, 14.4, 14.5, 14.12, 14.13, 26.6.
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import { adminFetch, type FieldErrors } from '@/lib/admin/client';
import { availableTransitions } from '@/lib/products/transitions';
import { labelFor } from '@/lib/products/form-validation';
import type { Product, ProductStatusValue } from '@/schemas/product';
import type { Role } from '@/lib/auth/permissions';
import PublicationProgress, { rememberPublication } from './PublicationProgress';
import type { PendingPublication } from '@/lib/admin/publication';

export interface PublishPanelProps {
  product: Product;
  /** Publish-gate failures for the current draft, keyed by field. */
  blockers: FieldErrors;
  canWrite: boolean;
  canPublish: boolean;
  canDelete: boolean;
  disabled?: boolean;
  onProduct: (product: Product) => void;
}

const STATUS_LABELS: Record<ProductStatusValue, string> = {
  DRAFT: 'Draft',
  REVIEW: 'In review',
  PUBLISHED: 'Published',
  UNPUBLISHED: 'Unpublished',
  OUT_OF_STOCK: 'Published — out of stock',
};

const ACTION_LABELS: Record<ProductStatusValue, string> = {
  DRAFT: 'Return to draft',
  REVIEW: 'Submit for review',
  PUBLISHED: 'Publish',
  UNPUBLISHED: 'Unpublish',
  OUT_OF_STOCK: 'Mark out of stock',
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; to: ProductStatusValue }
  | { kind: 'gate'; fields: FieldErrors }
  | { kind: 'error'; message: string }
  | { kind: 'done'; to: ProductStatusValue }
  | { kind: 'deploying' };

export default function PublishPanel(props: PublishPanelProps): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [confirmDelete, setConfirmDelete] = useState('');
  const [pending, setPending] = useState<PendingPublication | null>(null);

  // The role is not read from the session here: the panel is told what the operator may do,
  // and the server re-derives it anyway. `role` is reconstructed only to ask the transition
  // machine which targets to draw.
  const role: Role = props.canPublish ? 'owner' : props.canWrite ? 'editor' : 'viewer';
  const targets = availableTransitions(props.product.status, role);

  const blockerEntries = Object.entries(props.blockers);

  const transition = useCallback(
    async (to: ProductStatusValue) => {
      setPhase({ kind: 'working', to });
      const result = await adminFetch<{
        product: Product;
        deployTriggered: boolean;
        commitSha: string | null;
      }>(`/api/admin/products/${props.product.id}/transition`, { method: 'POST', body: { to } });

      if (!result.ok) {
        if (result.error.code === 'PUBLISH_GATE_FAILED') {
          setPhase({ kind: 'gate', fields: result.error.fields ?? {} });
          return;
        }
        setPhase({ kind: 'error', message: result.error.message });
        return;
      }

      props.onProduct(result.value.product);
      if (result.value.deployTriggered) {
        const next: PendingPublication = {
          id: result.value.product.id,
          slug: result.value.product.slug,
          updatedAt: result.value.product.updatedAt,
          to,
          commitSha: result.value.commitSha,
          startedAt: Date.now(),
        };
        rememberPublication(next);
        setPending(next);
        setPhase({ kind: 'deploying' });
      } else {
        setPhase({ kind: 'done', to });
      }
    },
    [props],
  );

  const duplicate = useCallback(async () => {
    setPhase({ kind: 'working', to: props.product.status });
    const result = await adminFetch<{ id: string }>(
      `/api/admin/products/${props.product.id}/duplicate`,
      { method: 'POST' },
    );
    if (!result.ok) {
      setPhase({ kind: 'error', message: result.error.message });
      return;
    }
    window.location.assign(`/admin/products/${result.value.id}?duplicated=1`);
  }, [props.product.id, props.product.status]);

  const remove = useCallback(async () => {
    setPhase({ kind: 'working', to: props.product.status });
    const result = await adminFetch<undefined>(`/api/admin/products/${props.product.id}`, {
      method: 'DELETE',
      body: { confirmSlug: confirmDelete },
    });
    if (!result.ok) {
      setPhase({ kind: 'error', message: result.error.message });
      return;
    }
    window.location.assign('/admin/products?deleted=1');
  }, [confirmDelete, props.product.id, props.product.status]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body">
        Current status: <strong>{STATUS_LABELS[props.product.status]}</strong>
        {props.product.published && (
          <>
            {' — '}
            <span className="text-walnut">public after the website update finishes</span>
          </>
        )}
      </p>

      {blockerEntries.length > 0 && (
        <div className="border border-taupe bg-white px-4 py-3">
          <h3 className="text-body font-medium text-espresso">Before this can be published</h3>
          <ul className="mt-2 flex flex-col gap-1 text-small">
            {blockerEntries.map(([path, messages]) => (
              <li key={path}>
                <strong>{labelFor(path)}</strong>: {messages.join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {targets.length === 0 ? (
        <p className="text-small text-walnut">
          Your role cannot change this product&rsquo;s status.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {targets.map((to) => (
            <button
              key={to}
              type="button"
              disabled={phase.kind === 'working' || props.disabled === true}
              onClick={() => void transition(to)}
              className="min-h-[44px] border border-espresso px-4 py-2 text-espresso hover:bg-espresso hover:text-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne disabled:opacity-60"
            >
              {ACTION_LABELS[to]}
            </button>
          ))}
        </div>
      )}

      {/* Status of the last action. `aria-live` so it is announced, not just drawn. */}
      <div aria-live="polite" className="text-small">
        {phase.kind === 'working' && <span>Working…</span>}
        {phase.kind === 'gate' && (
          <div className="border border-espresso bg-white px-4 py-3">
            <p className="font-medium text-espresso">This product is not ready to publish yet.</p>
            <ul className="mt-2 flex flex-col gap-1">
              {Object.entries(phase.fields).map(([path, messages]) => (
                <li key={path}>
                  <strong>{labelFor(path)}</strong>: {messages.join(' ')}
                </li>
              ))}
            </ul>
          </div>
        )}
        {phase.kind === 'error' && <span className="text-espresso">{phase.message}</span>}
        {phase.kind === 'done' && (
          <span>
            Saved as {STATUS_LABELS[phase.to]}. This status is not visible to customers, so no site
            build was started.
          </span>
        )}
      </div>

      <PublicationProgress productId={props.product.id} pending={pending} />

      <div className="flex flex-col gap-3 border-t border-taupe pt-4">
        {props.canWrite && (
          <div>
            <button
              type="button"
              onClick={() => void duplicate()}
              className="min-h-[44px] border border-espresso px-4 py-2 text-espresso"
            >
              Duplicate this product
            </button>
            <p className="mt-1 text-small text-walnut">
              Creates a new draft with a new SKU and web address. This product is untouched.
            </p>
          </div>
        )}

        {props.canDelete && (
          <div className="flex flex-col gap-2">
            <label htmlFor="confirm-delete" className="text-small font-medium text-espresso">
              Delete this product
            </label>
            <p className="text-small text-walnut">
              Type its web address <code>{props.product.slug}</code> to confirm. This removes the
              page, the listing, the search entry and the sitemap entry at the next build.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="confirm-delete"
                type="text"
                value={confirmDelete}
                onChange={(event) => setConfirmDelete(event.target.value)}
                className="min-h-[44px] border border-taupe px-3 py-2"
              />
              <button
                type="button"
                disabled={confirmDelete !== props.product.slug || props.disabled === true}
                onClick={() => void remove()}
                className="min-h-[44px] border border-espresso px-4 py-2 text-espresso disabled:opacity-50"
              >
                Delete permanently
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
