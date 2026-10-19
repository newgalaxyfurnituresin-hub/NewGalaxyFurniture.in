import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { adminFetch } from '@/lib/admin/client';
import {
  publicationElapsed,
  publicationIsLive,
  type PendingPublication,
  type PublicationReceipt,
} from '@/lib/admin/publication';
import { PUBLIC_STATUSES } from '@/schemas/product';

const storageKey = (id: string): string => `ngf:publication:${id}`;

export function rememberPublication(pending: PendingPublication): void {
  try {
    sessionStorage.setItem(storageKey(pending.id), JSON.stringify(pending));
  } catch {
    // Tracking still works in this tab when browser storage is unavailable.
  }
}

export default function PublicationProgress({
  productId,
  pending,
}: {
  productId: string;
  pending: PendingPublication | null;
}): ReactElement | null {
  const [tracked, setTracked] = useState<PendingPublication | null>(null);
  const [state, setState] = useState<'checking' | 'live' | 'failed' | 'waiting'>('checking');
  const [elapsed, setElapsed] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (pending !== null) {
      rememberPublication(pending);
      setTracked(pending);
      return;
    }
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey(productId)) ?? 'null');
      if (typeof saved !== 'object' || saved === null) return;
      const value = saved as PendingPublication;
      if (
        value.id === productId &&
        typeof value.slug === 'string' &&
        typeof value.updatedAt === 'string' &&
        typeof value.to === 'string' &&
        Number.isFinite(Date.parse(value.updatedAt)) &&
        Number.isFinite(value.startedAt) &&
        Date.now() - value.startedAt < 24 * 60 * 60 * 1000
      )
        setTracked(value);
    } catch {
      // A damaged or unavailable session entry must not block the editor.
    }
  }, [pending, productId]);

  useEffect(() => {
    if (tracked === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let providerAvailable = true;
    const startedChecking = Date.now();
    setState('checking');
    const tick = (): void =>
      setElapsed(Math.max(0, Math.floor((Date.now() - tracked.startedAt) / 1000)));
    tick();
    const clock = setInterval(tick, 1000);
    const check = async (): Promise<void> => {
      try {
        const response = await fetch(`/publication-status.json?check=${Date.now()}`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          headers: { accept: 'application/json' },
        });
        if (response.ok) {
          const receipt = (await response.json()) as PublicationReceipt;
          if (Array.isArray(receipt.products) && publicationIsLive(receipt, tracked)) {
            if (cancelled) return;
            setState('live');
            clearInterval(clock);
            try {
              sessionStorage.removeItem(storageKey(productId));
            } catch {
              /* Optional storage. */
            }
            return;
          }
        }
        // Optional provider diagnostics. Its last successful deployment is never proof of this publish.
        const provider = providerAvailable
          ? await adminFetch<{ state: string; commitSha: string | null }>(
              '/api/admin/deploy-status',
              { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) },
            )
          : null;
        if (cancelled) return;
        if (provider !== null && !provider.ok && provider.error.code === 'CONFIGURATION_INCOMPLETE')
          providerAvailable = false;
        if (
          provider?.ok &&
          tracked.commitSha !== null &&
          provider.value.commitSha === tracked.commitSha &&
          provider.value.state === 'failure'
        ) {
          setState('failed');
          clearInterval(clock);
          return;
        }
      } catch {
        // A brief connection failure is not a failed publish. Keep checking without resubmitting.
      }
      if (cancelled) return;
      if (Date.now() - startedChecking >= 10 * 60 * 1000) {
        setState('waiting');
        clearInterval(clock);
        return;
      }
      timer = setTimeout(() => void check(), 5000);
    };
    void check();
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(clock);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [tracked, productId, retry]);

  if (tracked === null) return null;
  const visible = PUBLIC_STATUSES.includes(tracked.to);
  const complete = state === 'live';
  return (
    <section
      className="min-w-0 border border-taupe bg-white p-4 sm:p-5"
      aria-label="Website update progress"
    >
      <div role="status" aria-live="polite">
        <p className="text-body font-medium text-espresso">
          {complete
            ? 'Website updated'
            : state === 'failed'
              ? 'Website update needs attention'
              : 'Your website is updating'}
        </p>
        <p className="mt-2 text-small text-walnut">
          {complete
            ? visible
              ? 'Confirmed on the public website. Customers can now see this version.'
              : 'Confirmed: this product is no longer in the public catalogue.'
            : state === 'failed'
              ? 'Publish committed but the site build failed. The previous version of the site is still serving. Your saved product is safe.'
              : state === 'waiting'
                ? 'This is taking longer than usual. Your changes are saved, but we have not confirmed them live. Check again without publishing twice.'
                : 'Your changes are saved. Allow around 2–5 minutes for the website to rebuild; busy periods can take longer. We are checking automatically.'}
        </p>
      </div>
      <ol className="mt-4 grid gap-3 text-small sm:grid-cols-3" aria-label="Publishing steps">
        <li className="border-l-2 border-espresso pl-3">1. Changes saved</li>
        <li
          className={`border-l-2 pl-3 ${complete ? 'border-espresso' : 'border-champagne'}`}
          aria-current={!complete ? 'step' : undefined}
        >
          2. Updating website{!complete ? '…' : ''}
        </li>
        <li
          className={`border-l-2 pl-3 ${complete ? 'border-espresso' : 'border-taupe text-walnut'}`}
          aria-current={complete ? 'step' : undefined}
        >
          3. {complete ? 'Verified live' : 'Verify live version'}
        </li>
      </ol>
      {!complete && state === 'checking' && (
        <div
          className="mt-4 h-1 overflow-hidden bg-ivory"
          role="progressbar"
          aria-label="Waiting for the website update"
          aria-valuetext="Changes saved; checking the live website"
        >
          <div className="h-full w-1/3 bg-espresso motion-safe:animate-pulse" />
        </div>
      )}
      {!complete && (
        <p className="mt-3 text-small tabular-nums text-walnut">
          Time since saved: <span aria-live="off">{publicationElapsed(elapsed)}</span>
        </p>
      )}
      <p className="mt-3 text-small text-walnut">
        You can keep working or refresh this page. There is no need to press Publish again.
      </p>
      {complete && visible && (
        <a
          className="mt-4 inline-flex min-h-[44px] items-center border border-espresso px-4 py-2 text-small text-espresso underline underline-offset-4"
          href={`/product/${tracked.slug}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View live product ↗
        </a>
      )}
      {(state === 'waiting' || state === 'failed') && (
        <button
          type="button"
          className="mt-4 min-h-[44px] border border-espresso px-4 py-2 text-small text-espresso"
          onClick={() => setRetry((value) => value + 1)}
        >
          Check website again
        </button>
      )}
    </section>
  );
}
