import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin/client';
import { readLocalRecovery } from '@/lib/admin/editor-recovery';
import { editorDraftHref } from '@/lib/products/editor-drafts';

interface RecoveryItem {
  scope: string;
  name: string;
  savedAt: number;
  href: string;
}

export default function EditorDraftList({ owner }: { owner: string }) {
  const [items, setItems] = useState<RecoveryItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    const local: RecoveryItem[] = [];
    try {
      const prefix = `ngf:editor-recovery:${owner}:`;
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const record = readLocalRecovery(localStorage, key);
        if (record && !record.completedId)
          local.push({
            scope: record.scope,
            name: record.patch.name?.trim() || 'Unnamed furniture draft',
            savedAt: record.savedAt,
            href: editorDraftHref(record.scope),
          });
      }
    } catch {
      /* Online recovery still works when device storage is unavailable. */
    }
    setItems(local.sort((a, b) => b.savedAt - a.savedAt).slice(0, 20));
    void adminFetch<{ drafts: RecoveryItem[] }>('/api/admin/editor-drafts', {
      timeoutMs: 15000,
    }).then((result) => {
      if (!cancelled && result.ok && Array.isArray(result.value?.drafts)) {
        const merged = new Map(result.value.drafts.map((item) => [item.scope, item]));
        for (const item of local)
          if (!merged.has(item.scope) || item.savedAt > merged.get(item.scope)!.savedAt)
            merged.set(item.scope, item);
        setItems([...merged.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, 20));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner]);
  if (!items.length) return null;
  return (
    <section className="mb-6 border border-taupe bg-white p-4" aria-label="Unfinished details">
      <h2 className="text-body font-medium">Continue unfinished details</h2>
      <p className="mt-1 text-small text-walnut">
        Your private recovery drafts. These changes are not published.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.scope}>
            <a className="block min-h-[44px] border border-taupe p-3 underline" href={item.href}>
              {item.name}
              <span className="block text-small text-walnut">
                Resume draft · {new Date(item.savedAt).toLocaleDateString()}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-small text-walnut">
        Showing up to 20 saved workspaces. Recovery copies expire after 30 days.
      </p>
    </section>
  );
}
