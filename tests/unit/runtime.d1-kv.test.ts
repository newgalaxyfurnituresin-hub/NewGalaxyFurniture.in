import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createD1KeyValueStore } from '@/lib/runtime/d1-kv';
import { fakeSqlDatabase } from '../fixtures/runtime';
import { consumeWindow } from '@/lib/auth/rate-limit';
import { createSession, readSession } from '@/lib/auth/session';
const schema = readFileSync('migrations/0004_runtime_kv.sql', 'utf8');

describe('quota-safe private runtime storage', () => {
  it('keeps the rate ceiling active after more than 1,000 writes', async () => {
    const store = createD1KeyValueStore(fakeSqlDatabase(schema), 'RATELIMIT');
    const now = Date.now();
    for (let i = 0; i < 1200; i++)
      expect((await consumeWindow(store, 'test-window', 1200, 60000, now)).allowed).toBe(true);
    expect((await consumeWindow(store, 'test-window', 1200, 60000, now)).allowed).toBe(false);
  });
  it('creates and reads an ordinary opaque admin session through the SQL store', async () => {
    const store = createD1KeyValueStore(fakeSqlDatabase(schema), 'SESSIONS');
    const session = await createSession(store, { userId: 'fixture-owner', role: 'owner' });
    expect((await readSession(store, session.id))?.userId).toBe('fixture-owner');
    expect(await readSession(store, 'unknown-session')).toBeNull();
  });
  it('isolates namespaces, overwrites immediately and deletes without a KV write', async () => {
    const db = fakeSqlDatabase(schema);
    const sessions = createD1KeyValueStore(db, 'SESSIONS');
    const drafts = createD1KeyValueStore(db, 'DRAFTS');
    await sessions.put('same-key', 'private-session');
    await drafts.put('same-key', '{"name":"unfinished"}');
    expect(await sessions.get('same-key')).toBe('private-session');
    expect(await drafts.get('same-key', 'json')).toEqual({ name: 'unfinished' });
    await sessions.put('same-key', 'replacement');
    expect(await sessions.get('same-key')).toBe('replacement');
    await sessions.delete('same-key');
    expect(await sessions.get('same-key')).toBeNull();
    expect(await drafts.get('same-key')).not.toBeNull();
    expect(await drafts.get('absent', 'json')).toBeNull();
    await drafts.put('invalid-json', 'invalid');
    expect(await drafts.get('invalid-json', 'json')).toBeNull();
  });
  it('enforces expiry on reads and lists without delete-on-read writes', async () => {
    let now = 1000;
    const store = createD1KeyValueStore(fakeSqlDatabase(schema), 'SESSIONS', () => now);
    await store.put('short', 'session', { expirationTtl: 1 });
    now += 59999;
    expect(await store.get('short')).toBe('session');
    now++;
    expect(await store.get('short')).toBeNull();
    expect((await store.list()).keys).toEqual([]);
    await store.put('short', 'renewed');
    now += 1000000;
    expect(await store.get('short')).toBe('renewed');
    await expect(store.put('bad', 'x', { expirationTtl: NaN })).rejects.toThrow('expiry');
  });
  it('paginates 1,005 entries without duplicates and keeps cursor/prefix boundaries', async () => {
    const store = createD1KeyValueStore(fakeSqlDatabase(schema), 'DRAFTS');
    for (let i = 0; i < 1005; i++)
      await store.put(`owner-a:${String(i).padStart(4, '0')}`, 'draft');
    await store.put('owner-b:secret', 'private');
    const first = await store.list({ prefix: 'owner-a:' });
    expect(first.keys).toHaveLength(1000);
    expect(first.list_complete).toBe(false);
    const last = await store.list({ prefix: 'owner-a:', cursor: first.cursor! });
    expect(last.keys).toHaveLength(5);
    expect(last.list_complete).toBe(true);
    expect(new Set([...first.keys, ...last.keys].map((key) => key.name)).size).toBe(1005);
    await expect(store.list({ prefix: 'owner-a:', cursor: 'owner-b:secret' })).rejects.toThrow(
      'cursor',
    );
    for (const name of ['literal_%:x', 'literalAB:x', '🛋:brown', '🛌:white'])
      await store.put(name, 'draft');
    expect((await store.list({ prefix: 'literal_%:' })).keys.map((key) => key.name)).toEqual([
      'literal_%:x',
    ]);
    expect((await store.list({ prefix: '🛋:' })).keys.map((key) => key.name)).toEqual(['🛋:brown']);
  });
});
