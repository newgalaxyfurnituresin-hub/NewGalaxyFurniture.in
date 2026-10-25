/**
 * The image manager: upload, order, designate a primary, write alt text, remove.
 *
 * Four things it deliberately does:
 *
 * - **Reports each file's own outcome.** The upload endpoint answers with an accepted list and
 *   a rejected list, and the rejected reasons are shown per file — "narrower than 800 pixels"
 *   next to the file it applies to, with the other eleven photographs unaffected (26.8).
 * - **Reorders from the keyboard.** Drag-and-drop is offered, and every reorder is also a pair
 *   of buttons, because a drag-only interaction is unusable without a pointer (24.5). Either
 *   way the server renumbers `order` contiguously from 0.
 * - **Shows "optimizing" honestly.** While `derivativesReady` is false the row says so and the
 *   original is what serves — the image is usable, just not yet in every size (15.13).
 * - **Records who wrote the alt text.** Editing it here sets `altSource: 'admin'`; only the AI
 *   assistant sets `ai`. The badge reflects the stored value rather than a guess (15.15).
 *
 * Requirements: 13.8, 14.14, 14.15, 15.13, 15.14, 15.15, 15.16, 24.5, 26.8, 26.14.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, ReactElement } from 'react';

import { adminFetch } from '@/lib/admin/client';
import {
  completePhotoUpload,
  uploadPhotos,
  type PendingPhotos,
  type PhotoRejection,
} from '@/lib/admin/upload-photos';
import { originalUrl, derivativeUrl, extFromMime } from '@/lib/images/srcset';
import type { ProductImageValue } from '@/schemas/product';
import type { ProductRevision } from '@/lib/products/revision';
import { DropZoneGlyph } from '@/components/ui/EmptyState';
import PhotoUploadPicker from './PhotoUploadPicker';

export interface ImageManagerProps {
  productId: string;
  images: readonly ProductImageValue[];
  primaryImage: string | null;
  canWrite: boolean;
  onBusyChange?: (busy: boolean) => void;
  onPreparedPhoto?: (
    image: ProductImageValue,
    colorName?: string,
    revision?: ProductRevision,
  ) => void;
  onChange: (
    images: ProductImageValue[],
    primaryImage: string | null,
    revision?: ProductRevision,
  ) => void;
}

interface EnhancementStatus {
  imageId: string;
  state: 'none' | 'queued' | 'processing' | 'ready' | 'failed' | 'applied' | '4k';
  queuedAt?: number;
}

/** The thumbnail source: a small derivative once it exists, the original until then. */
function thumbnailFor(productId: string, image: ProductImageValue): string {
  if (image.derivativesReady === true && (image.derivativeWidths ?? []).length > 0) {
    const width = [...(image.derivativeWidths ?? [])].sort((a, b) => a - b)[0] ?? 320;
    return derivativeUrl(productId, image.id, width, 'webp').replace(
      `/img/${productId}/`,
      `/api/admin/products/${productId}/media/`,
    );
  }
  return originalUrl(productId, image.id, extFromMime(image.mime)).replace(
    `/img/${productId}/`,
    `/api/admin/products/${productId}/media/`,
  );
}

export default function ImageManager(props: ImageManagerProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<PhotoRejection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [enhancements, setEnhancements] = useState<Record<string, EnhancementStatus>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewImage, setReviewImage] = useState<string | null>(null);
  const imageIds = props.images.map((image) => image.id).join(',');
  const dragFrom = useRef<number | null>(null);
  const working = useRef(false);
  const currentProps = useRef(props);
  currentProps.current = props;
  const begin = (): boolean => {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    return true;
  };
  const finish = (): void => {
    working.current = false;
    setBusy(false);
  };
  useEffect(() => {
    props.onBusyChange?.(busy);
  }, [busy, props.onBusyChange]);

  useEffect(() => {
    if (!props.canWrite) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      if (!working.current && !document.hidden) {
        const result = await adminFetch<PendingPhotos>(
          `/api/admin/products/${props.productId}/photo-uploads`,
        );
        if (!cancelled && result.ok) {
          setPendingCount(result.value.uploads.filter((job) => job.state !== 'failed').length);
          for (const job of result.value.uploads) {
            if (working.current || cancelled) break;
            if (job.state === 'failed') {
              setMessage(
                `${job.filename}: preparation failed. Re-export the photo and upload it again.`,
              );
              continue;
            }
            if (
              !['ready', 'queued', 'processing'].includes(job.state) ||
              !result.value.computerOnline ||
              !begin()
            )
              continue;
            try {
              const prepared = await completePhotoUpload(props.productId, job.imageId);
              if (!cancelled && prepared.ok) {
                for (const image of prepared.value.images)
                  currentProps.current.onPreparedPhoto?.(
                    image,
                    prepared.value.colorName,
                    prepared.revision,
                  );
                setMessage(
                  'Prepared photo added. Smaller sizes are ready and original resolution is preserved.',
                );
              } else if (!cancelled && !prepared.ok) setMessage(prepared.error.message);
            } finally {
              finish();
            }
          }
        }
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 15000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [props.productId, props.canWrite]);

  useEffect(() => {
    if (!props.canWrite || !imageIds) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      if (!document.hidden) {
        const result = await adminFetch<{ images: EnhancementStatus[]; computerOnline: boolean }>(
          `/api/admin/products/${props.productId}/image-enhancements`,
        );
        if (!cancelled && result.ok) {
          setEnhancements(
            Object.fromEntries(result.value.images.map((image) => [image.imageId, image])),
          );
        }
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 15_000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [props.productId, props.canWrite, imageIds]);

  const enhance = async (imageId: string, action: 'queue' | 'apply'): Promise<void> => {
    if (!begin()) return;
    const result = await adminFetch<{
      images?: ProductImageValue[];
      primaryImage?: string | null;
      state?: EnhancementStatus['state'];
    }>(`/api/admin/products/${props.productId}/images/${imageId}/enhancement`, {
      method: 'POST',
      body: { action },
    });
    finish();
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    if (action === 'apply' && result.value.images) {
      props.onChange(result.value.images, result.value.primaryImage ?? null, result.revision);
      setReviewImage(null);
      setMessage(
        'Reviewed 4K photo applied. The original is preserved. Published products update on the website after deployment finishes.',
      );
    } else {
      setEnhancements((current) => ({
        ...current,
        [imageId]: { imageId, state: result.value.state ?? 'queued', queuedAt: Date.now() },
      }));
      setMessage(
        'Automatic cloud AI enhancement is not configured. Original resolution is preserved.',
      );
    }
  };

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files];
      if (list.length === 0 || !begin()) return;
      setMessage(`Uploading ${String(list.length)} file${list.length === 1 ? '' : 's'}…`);
      setRejected([]);

      let next = [...props.images];
      try {
        const result = await uploadPhotos({
          productId: props.productId,
          files: list,
          existingCount: props.images.length,
          onProgress: setMessage,
          onAccepted: (accepted, revision) => {
            next = [...next, ...accepted].map((image, index) => ({ ...image, order: index }));
            props.onChange(next, props.primaryImage ?? next[0]?.id ?? null, revision);
          },
        });
        setRejected(result.rejected);
        setMessage(
          `${result.added} of ${list.length} photos added.${result.pending ? ` ${result.pending} being prepared securely online; prepared photos appear here automatically.` : ''}${result.rejected.length ? ' Check the file messages below.' : ''} ${result.added ? 'Check the photo descriptions below. Original resolution is preserved and smaller sizes are ready.' : ''}`,
        );
      } finally {
        finish();
      }
    },
    [props],
  );

  const commitOrder = useCallback(
    async (images: ProductImageValue[]) => {
      if (!begin()) return;
      // Renumbered locally for an immediate redraw, and renumbered again by the server, which
      // is the copy that counts.
      const renumbered = images.map((image, index) => ({ ...image, order: index }));
      const result = await adminFetch<{ images: ProductImageValue[] }>(
        `/api/admin/products/${props.productId}/images/order`,
        { method: 'PATCH', body: { orderedIds: renumbered.map((image) => image.id) } },
      );
      finish();
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      props.onChange(result.value.images, props.primaryImage, result.revision);
    },
    [props],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= props.images.length || from === to) return;
      const next = [...props.images];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return;
      next.splice(to, 0, moved);
      void commitOrder(next);
    },
    [commitOrder, props.images],
  );

  const setAlt = useCallback(
    async (imageId: string, alt: string) => {
      if (!begin()) return;
      const result = await adminFetch<{ images: ProductImageValue[]; primaryImage: string | null }>(
        `/api/admin/products/${props.productId}/images/${imageId}`,
        { method: 'PATCH', body: { alt } },
      );
      finish();
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      props.onChange(result.value.images, result.value.primaryImage, result.revision);
    },
    [props],
  );

  const setPrimary = useCallback(
    async (imageId: string) => {
      if (!begin()) return;
      const result = await adminFetch<{ images: ProductImageValue[]; primaryImage: string | null }>(
        `/api/admin/products/${props.productId}/images/${imageId}`,
        { method: 'PATCH', body: { primary: true } },
      );
      finish();
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      props.onChange(result.value.images, result.value.primaryImage, result.revision);
    },
    [props],
  );

  const remove = useCallback(
    async (imageId: string) => {
      if (!begin()) return;
      const result = await adminFetch<undefined>(
        `/api/admin/products/${props.productId}/images/${imageId}`,
        { method: 'DELETE' },
      );
      finish();
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      const next = props.images
        .filter((image) => image.id !== imageId)
        .map((image, index) => ({ ...image, order: index }));
      props.onChange(
        next,
        props.primaryImage === imageId ? (next[0]?.id ?? null) : props.primaryImage,
        result.revision,
      );
      setMessage('Image removed. It can be recovered for 30 days.');
    },
    [props],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOver(false);
    if (!props.canWrite || working.current) return;
    void upload(event.dataTransfer.files);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy={busy}>
      {props.canWrite && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={[
            'flex flex-col items-center gap-2 border-2 border-dashed px-6 py-8 text-center',
            dragOver ? 'border-champagne bg-white' : 'border-taupe',
          ].join(' ')}
        >
          {/*
            The designed "no images" empty state Requirement 26.14 asks for is this drop zone, with
            the drop-zone illustration the design names. The glyph appears only when there is nothing
            yet: above a list of photographs it would be decoration competing with the content.
          */}
          {props.images.length === 0 && <DropZoneGlyph />}
          <p className="text-body text-espresso">
            {props.images.length === 0
              ? 'Add your product photographs'
              : 'Add more product photographs'}
          </p>
          <p className="max-w-[46ch] text-small text-walnut">
            JPEG, PNG, WebP or AVIF. At least 256 pixels wide and 64 pixels high, up to 12 MB each.
            Up to 20 images per product.
          </p>
          <p className="max-w-[52ch] text-small text-walnut">
            Select several photos together. They upload one at a time, with progress shown below.
          </p>
          <p className="max-w-[52ch] text-small text-walnut">
            Photos are prepared securely online. No personal computer needs to stay on. Original
            resolution is preserved; only published product photos are public. AI enhancement is not
            enabled.
          </p>
          <PhotoUploadPicker
            label="Product photographs"
            buttonLabel="Choose files"
            disabled={busy}
            onFiles={(files) => void upload(files)}
          />
        </div>
      )}

      <div aria-live="polite" className="break-words text-small">
        {pendingCount > 0 && (
          <p>
            {pendingCount} photo(s) being prepared securely online. This page checks automatically.
          </p>
        )}
        {message !== null && <p>{message}</p>}
        {rejected.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {rejected.map((rejection) => (
              <li key={`${rejection.filename}-${rejection.code}`} className="text-espresso">
                <strong>{rejection.filename}</strong>: {rejection.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {props.images.length === 0 ? (
        <p className="text-small text-walnut">
          A product needs at least one photograph with alt text before it can be published.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {props.images
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((image, index) => {
              const isPrimary = (props.primaryImage ?? props.images[0]?.id) === image.id;
              return (
                <li
                  key={image.id}
                  draggable={props.canWrite}
                  onDragStart={() => {
                    dragFrom.current = index;
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragFrom.current !== null) move(dragFrom.current, index);
                    dragFrom.current = null;
                  }}
                  className="ngf-admin-photo-row"
                >
                  <div className="relative">
                    <img
                      src={thumbnailFor(props.productId, image)}
                      alt={image.alt === '' ? 'Product photograph awaiting alt text' : image.alt}
                      width={96}
                      height={Math.max(1, Math.round((image.height * 96) / image.width))}
                      loading="lazy"
                      decoding="async"
                      className="w-24 bg-cream object-cover"
                      style={
                        image.lqip === undefined
                          ? undefined
                          : { backgroundImage: `url(${image.lqip})`, backgroundSize: 'cover' }
                      }
                    />
                    {image.derivativesReady !== true && (
                      <span className="mt-1 block text-small text-walnut">
                        Original photo ready
                      </span>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-col gap-2 break-words">
                    <label
                      htmlFor={`alt-${image.id}`}
                      className="text-small font-medium text-espresso"
                    >
                      Photo description
                      <span className="ml-2 font-normal text-walnut">
                        {image.altSource === 'ai' ? 'AI suggestion' : 'Written by you'}
                      </span>
                    </label>
                    <input
                      id={`alt-${image.id}`}
                      type="text"
                      defaultValue={image.alt}
                      maxLength={180}
                      disabled={!props.canWrite || busy}
                      onBlur={(event) => {
                        if (event.target.value !== image.alt)
                          void setAlt(image.id, event.target.value);
                      }}
                      className="min-h-[44px] border border-taupe px-3 py-2"
                      aria-describedby={`alt-hint-${image.id}`}
                    />
                    <p id={`alt-hint-${image.id}`} className="text-small text-walnut">
                      Briefly describe what is in the photograph. This helps customers using a
                      screen reader and is required to publish.
                      {image.filename === undefined ? '' : ` Uploaded as “${image.filename}”.`}{' '}
                      {image.width}×{image.height} pixels.
                    </p>
                    {props.canWrite && (
                      <div
                        className="border border-taupe bg-cream p-3 text-small"
                        aria-live="polite"
                      >
                        {Math.max(image.width, image.height) >= 3840 ? (
                          <p>
                            {image.enhancedFrom
                              ? '4K copy applied · original preserved'
                              : '4K-size original photo'}
                          </p>
                        ) : (
                          <>
                            <p>
                              {enhancements[image.id]?.state === 'ready'
                                ? 'Your 4K copy is ready to review.'
                                : 'Original-resolution photo. Automatic cloud AI enhancement is not enabled.'}
                            </p>
                            {enhancements[image.id]?.state === 'ready' ? (
                              <button
                                type="button"
                                className="mt-2 min-h-[44px] border border-espresso px-3"
                                disabled={busy}
                                aria-expanded={reviewImage === image.id}
                                onClick={() =>
                                  setReviewImage(reviewImage === image.id ? null : image.id)
                                }
                              >
                                Review 4K photo
                              </button>
                            ) : (
                              !['queued', 'processing'].includes(
                                enhancements[image.id]?.state ?? '',
                              ) && (
                                <button
                                  type="button"
                                  className="mt-2 min-h-[44px] border border-espresso px-3"
                                  disabled
                                >
                                  Cloud AI enhancement not configured
                                </button>
                              )
                            )}
                          </>
                        )}
                        {reviewImage === image.id && enhancements[image.id]?.state === 'ready' && (
                          <section
                            aria-label="Compare original and enhanced photo"
                            className="mt-3 flex min-w-0 flex-col gap-3"
                          >
                            <p>
                              Compare fabric, colour, stitching and shape. AI estimates detail; use
                              this copy only if it accurately represents the product.
                            </p>
                            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                              <figure className="min-w-0">
                                <img
                                  src={originalUrl(
                                    props.productId,
                                    image.id,
                                    extFromMime(image.mime),
                                  )}
                                  alt="Original uploaded photograph"
                                  width={768}
                                  height={576}
                                  className="aspect-[4/3] w-full object-contain"
                                />
                                <figcaption>Original</figcaption>
                              </figure>
                              <figure className="min-w-0">
                                <a
                                  href={`/api/admin/products/${props.productId}/images/${image.id}/enhancement?preview=1`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <img
                                    src={`/api/admin/products/${props.productId}/images/${image.id}/enhancement?preview=1`}
                                    alt="AI-enhanced 4K preview awaiting approval"
                                    width={768}
                                    height={576}
                                    className="aspect-[4/3] w-full object-contain"
                                  />
                                </a>
                                <figcaption>4K preview · tap to inspect full size</figcaption>
                              </figure>
                            </div>
                            <button
                              type="button"
                              className="min-h-[44px] border border-espresso px-3 py-2"
                              disabled={busy}
                              onClick={() => {
                                void enhance(image.id, 'apply');
                              }}
                            >
                              Use reviewed 4K photo
                            </button>
                          </section>
                        )}
                      </div>
                    )}
                  </div>

                  {props.canWrite && (
                    <div className="ngf-admin-photo-actions">
                      <span className="text-small text-walnut">Position {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => move(index, index - 1)}
                        disabled={index === 0 || busy}
                        className="min-h-[44px] border border-taupe px-3 text-small disabled:opacity-40"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, index + 1)}
                        disabled={index === props.images.length - 1 || busy}
                        className="min-h-[44px] border border-taupe px-3 text-small disabled:opacity-40"
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        onClick={() => void setPrimary(image.id)}
                        disabled={isPrimary || busy}
                        className="min-h-[44px] border border-taupe px-3 text-small disabled:opacity-40"
                      >
                        {isPrimary ? 'Main photograph' : 'Make main'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(image.id)}
                        disabled={busy}
                        className="min-h-[44px] border border-espresso px-3 text-small text-espresso"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
        </ol>
      )}
    </div>
  );
}
