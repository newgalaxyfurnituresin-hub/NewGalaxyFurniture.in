import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Product } from '@/schemas/product';
import { adminFetch } from '@/lib/admin/client';
import {
  recoveryStorageKey,
  readLocalRecovery,
  restoreEditorPatch,
  type LocalEditorDraft,
} from '@/lib/admin/editor-recovery';
import { EditorScope, type EditorDraft, type EditorPatch } from '@/lib/products/editor-drafts';

export function useProductRecovery(options: {
  owner?: string;
  mode: 'create' | 'edit';
  product: Product;
  draft: Product;
  patch: EditorPatch;
  hasEdits: boolean;
  paused: boolean;
  canWrite: boolean;
  restore: (product: Product) => void;
}) {
  const current = useRef(options);
  current.current = options;
  const [scope, setScope] = useState('');
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const [stale, setStale] = useState<EditorDraft | null>(null);
  const revision = useRef<string | null>(null);
  const synced = useRef('');
  const inFlight = useRef<Promise<void> | null>(null);
  const cloudConflict = useRef(false);
  const localSafe = useRef(false);
  const lastAttempt = useRef(0);
  const failures = useRef(0);
  const generation = useRef(0);
  const key = options.owner && scope ? recoveryStorageKey(options.owner, scope) : '';

  useLayoutEffect(() => {
    if (!options.owner || !options.canWrite) return;
    let selected = options.product.id;
    if (options.mode === 'create') {
      const url = new URL(window.location.href);
      selected = url.searchParams.get('draft') ?? '';
      if (!EditorScope.safeParse(selected).success || !selected.startsWith('new_')) {
        selected = `new_${crypto.randomUUID().replaceAll('-', '')}`;
        url.searchParams.set('draft', selected);
        window.history.replaceState(null, '', url);
      }
    }
    const storageKey = recoveryStorageKey(options.owner, selected);
    setScope(selected);
    let local: LocalEditorDraft | null = null;
    try {
      local = readLocalRecovery(localStorage, storageKey);
    } catch {
      /* Cloud saving can still work. */
    }
    if (local?.completedId) {
      window.location.replace(`/admin/products/${local.completedId}`);
      return;
    }
    if (local) {
      revision.current = local.revision || null;
      if (options.mode === 'create' || local.baseUpdatedAt === options.product.updatedAt) {
        current.current.restore(
          restoreEditorPatch(options.product, local.patch, local.baseUpdatedAt),
        );
        localSafe.current = true;
        setMessage('Recovered your unfinished draft. Continue where you stopped.');
      } else setStale(local);
    }
    let cancelled = false;
    void adminFetch<{ draft: EditorDraft | null }>(`/api/admin/editor-drafts?scope=${selected}`, {
      timeoutMs: 15000,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const cloud = result.value.draft;
        if (cloud) {
          if (
            local &&
            (local.dirty ||
              JSON.stringify(current.current.patch) !== JSON.stringify(local.patch)) &&
            local.revision !== cloud.revision &&
            JSON.stringify(local.patch) !== JSON.stringify(cloud.patch)
          ) {
            cloudConflict.current = true;
            setMessage(
              'Another tab or device saved different unfinished details. Your device copy is preserved; save your current form when ready.',
            );
          } else {
            revision.current = cloud.revision;
            synced.current = local?.dirty ? '' : JSON.stringify(cloud.patch);
            if (
              (!local && !current.current.hasEdits) ||
              (local &&
                !local.dirty &&
                JSON.stringify(current.current.patch) === JSON.stringify(local.patch))
            ) {
              if (options.mode === 'create' || cloud.baseUpdatedAt === options.product.updatedAt) {
                current.current.restore(
                  restoreEditorPatch(options.product, cloud.patch, cloud.baseUpdatedAt),
                );
                setMessage('Recovered your online draft. Continue where you stopped.');
              } else setStale(cloud);
            }
          }
        } else revision.current = null;
      } else if (!local)
        setMessage('Online draft check unavailable. New edits will still be saved on this device.');
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [options.owner, options.product.id, options.mode, options.canWrite]);

  const persist = useCallback(() => {
    const value = current.current;
    if (!key || !value.hasEdits) return;
    const record: LocalEditorDraft = {
      scope,
      baseUpdatedAt: value.draft.updatedAt,
      patch: value.patch,
      revision: revision.current ?? '',
      savedAt: Date.now(),
      dirty: JSON.stringify(value.patch) !== synced.current,
    };
    try {
      localStorage.setItem(key, JSON.stringify(record));
      localSafe.current = true;
    } catch {
      localSafe.current = false;
    }
  }, [key, scope]);

  useLayoutEffect(() => {
    if (!options.hasEdits || !key) return;
    persist();
    if (!cloudConflict.current && !stale)
      setMessage(
        localSafe.current
          ? 'Draft saved on this device. Waiting to save online…'
          : 'Device storage unavailable. Keep this tab open until the online draft is saved.',
      );
  }, [options.patch, options.hasEdits, key, persist, stale]);

  useEffect(() => {
    if (!key) return;
    const retryOnline = (): void => setRetry((value) => value + 1);
    const leaving = (event: BeforeUnloadEvent): void => {
      persist();
      if (current.current.hasEdits && !localSafe.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('online', retryOnline);
    window.addEventListener('pagehide', persist);
    window.addEventListener('beforeunload', leaving);
    return () => {
      window.removeEventListener('online', retryOnline);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [key, persist]);

  useEffect(() => {
    if (!ready || !key || !options.hasEdits || options.paused || stale || cloudConflict.current)
      return;
    const serialized = JSON.stringify(options.patch);
    if (serialized === synced.current) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (inFlight.current || cancelled) return;
        lastAttempt.current = Date.now();
        const ticket = generation.current;
        setMessage(
          localSafe.current ? 'Draft saved on this device. Saving online…' : 'Saving draft online…',
        );
        const operation = async (): Promise<void> => {
          const result = await adminFetch<{ draft: EditorDraft }>('/api/admin/editor-drafts', {
            method: 'POST',
            timeoutMs: 15000,
            body: {
              scope,
              baseUpdatedAt: options.draft.updatedAt,
              patch: options.patch,
              expectedRevision: revision.current,
            },
          });
          if (ticket !== generation.current) return;
          if (result.ok) {
            failures.current = 0;
            revision.current = result.value.draft.revision;
            synced.current = serialized;
            persist();
            setMessage(
              localSafe.current
                ? 'Draft saved online and on this device. Not published.'
                : 'Draft saved online. Device storage is unavailable. Not published.',
            );
          } else if (result.error.code === 'CONFLICT') {
            cloudConflict.current = true;
            setMessage(result.error.message);
          } else {
            failures.current++;
            if (
              result.error.status === 401 ||
              result.error.status === 403 ||
              result.error.status === 422
            ) {
              cloudConflict.current = true;
              setMessage(
                localSafe.current
                  ? 'Online draft save needs attention. Your details are saved on this device. Sign in again if your session expired.'
                  : result.error.message,
              );
            } else {
              setMessage(
                localSafe.current
                  ? 'Online save unavailable. Your draft is safe on this device and will retry.'
                  : 'Draft could not be saved. Keep this tab open and use Save.',
              );
            }
          }
        };
        inFlight.current = operation().finally(() => {
          inFlight.current = null;
          if (ticket === generation.current) setRetry((value) => value + 1);
        });
      },
      Math.max(
        failures.current ? Math.min(120000, 15000 * 2 ** Math.min(failures.current - 1, 3)) : 1500,
        8000 - (Date.now() - lastAttempt.current),
      ),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, key, options.patch, options.hasEdits, options.paused, stale, scope, retry, persist]);

  const clear = useCallback(
    async (completedId?: string): Promise<void> => {
      if (!key) return;
      await inFlight.current;
      generation.current++;
      try {
        if (completedId) {
          const previous = readLocalRecovery(localStorage, key);
          if (previous)
            localStorage.setItem(key, JSON.stringify({ ...previous, completedId, dirty: false }));
        } else localStorage.removeItem(key);
      } catch {
        /* The confirmed server save still succeeded. */
      }
      const cleared = await adminFetch('/api/admin/editor-drafts', {
        method: 'DELETE',
        timeoutMs: 10000,
        body: { scope, revision: revision.current },
      });
      if (cleared.ok) {
        revision.current = null;
        cloudConflict.current = false;
        failures.current = 0;
      } else cloudConflict.current = true;
      synced.current = JSON.stringify(current.current.patch);
      setMessage(
        cleared.ok
          ? ''
          : 'The product save is separate from recovery storage. The online recovery copy could not be cleared; your saved product is unchanged.',
      );
      setStale(null);
    },
    [key, scope],
  );

  const restoreStale = (): void => {
    if (!stale) return;
    current.current.restore(
      restoreEditorPatch(current.current.product, stale.patch, stale.baseUpdatedAt),
    );
    revision.current = stale.revision || null;
    setStale(null);
    setMessage(
      'Unfinished details restored. Save will check for changes made to the stored product.',
    );
  };
  return { message, stale, restoreStale, clear };
}
