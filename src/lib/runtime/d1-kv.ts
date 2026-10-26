import type { KeyValuePutOptions, KeyValueStore, SqlDatabase } from './types';

/** Exclusive upper bound for a prefix, including Unicode keys without LIKE wildcards. */
function prefixEnd(prefix: string): string | null {
  const points = Array.from(prefix);
  while (points.length) {
    const point = points.pop()!.codePointAt(0)!;
    if (point < 0x10ffff) return points.join('') + String.fromCodePoint(point + 1);
  }
  return null;
}

class D1KeyValueStore implements KeyValueStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly namespace: string,
    private readonly now: () => number,
  ) {}

  async get(key: string, type?: 'text'): Promise<string | null>;
  async get(key: string, type: 'json'): Promise<unknown>;
  async get(key: string, type: 'text' | 'json' = 'text'): Promise<unknown> {
    const row = await this.db
      .prepare(
        'SELECT value FROM runtime_kv WHERE namespace = ? AND entry_key = ? AND (expires_at IS NULL OR expires_at > ?)',
      )
      .bind(this.namespace, key, this.now())
      .first<{ value: string }>();
    if (!row) return null;
    if (type === 'text') return row.value;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return null;
    }
  }

  async put(key: string, value: string, options?: KeyValuePutOptions): Promise<void> {
    const ttl = options?.expirationTtl;
    if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0))
      throw new Error('Invalid storage expiry.');
    const expires = ttl === undefined ? null : this.now() + Math.max(60, Math.floor(ttl)) * 1000;
    const result = await this.db
      .prepare(
        'INSERT INTO runtime_kv (namespace, entry_key, value, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(namespace, entry_key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
      )
      .bind(this.namespace, key, value, expires)
      .run();
    if (!result.success) throw new Error('Runtime storage write failed.');
  }

  async delete(key: string): Promise<void> {
    const result = await this.db
      .prepare('DELETE FROM runtime_kv WHERE namespace = ? AND entry_key = ?')
      .bind(this.namespace, key)
      .run();
    if (!result.success) throw new Error('Runtime storage deletion failed.');
  }

  async list(options?: { prefix?: string; cursor?: string }) {
    const prefix = options?.prefix ?? '';
    const cursor = options?.cursor ?? '';
    // A cursor cannot move a private prefix into another owner's range.
    if (cursor && !cursor.startsWith(prefix)) throw new Error('Invalid storage cursor.');
    const end = prefixEnd(prefix);
    const { results } = await this.db
      .prepare(
        'SELECT entry_key AS name FROM runtime_kv WHERE namespace = ? AND entry_key >= ? AND entry_key > ? AND (? IS NULL OR entry_key < ?) AND (expires_at IS NULL OR expires_at > ?) ORDER BY entry_key LIMIT 1001',
      )
      .bind(this.namespace, prefix, cursor, end, end, this.now())
      .all<{ name: string }>();
    const keys = results.slice(0, 1000);
    return results.length <= 1000
      ? { keys, list_complete: true }
      : { keys, list_complete: false, cursor: keys.at(-1)!.name };
  }
}

/** Same private storage contract, with indexed SQL reads and no dependency on KV write quota. */
export function createD1KeyValueStore(
  db: SqlDatabase,
  namespace: string,
  now = Date.now,
): KeyValueStore {
  return new D1KeyValueStore(db, namespace, now);
}
