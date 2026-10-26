import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type * as GuardModule from '@/lib/auth/guard';
import { demoSofa } from '../fixtures/products';
import { fakeKeyValueStore } from '../fixtures/runtime';
import {
  readLocalRecovery,
  recoveryStorageKey,
  restoreEditorPatch,
  serializeEditorPatch,
} from '@/lib/admin/editor-recovery';
import { EditorDraftInput, EDITOR_DRAFT_TTL_SECONDS } from '@/lib/products/editor-drafts';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), kv: vi.fn() }));
vi.mock('@/lib/env', () => ({ getKV: mocks.kv }));
vi.mock('@/lib/auth/guard', async (importOriginal) => ({
  ...(await importOriginal<typeof GuardModule>()),
  requireAdmin: mocks.guard,
}));
import { GET, POST, DELETE } from '@/pages/api/admin/editor-drafts';
let store = fakeKeyValueStore();
const scope = 'new_' + 'a'.repeat(32);
const json = async (
  response: Response,
): Promise<{ draft: { revision: string } | null; drafts: unknown[] }> =>
  (await response.json()) as { draft: { revision: string } | null; drafts: unknown[] };
const ctx = (method = 'GET', body?: unknown, query = '') =>
  ({
    url: new URL('https://newgalaxyfurniture.in/api/admin/editor-drafts' + query),
    request: new Request('https://newgalaxyfurniture.in/api/admin/editor-drafts', {
      method,
      ...(body
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    }),
  }) as APIContext;
const payload = {
  scope,
  baseUpdatedAt: demoSofa.updatedAt,
  expectedRevision: null,
  patch: { name: 'A', category: '', price: 0, dimensions: { widthCm: 0 } },
};
beforeEach(() => {
  store = fakeKeyValueStore();
  mocks.kv.mockReturnValue(store);
  mocks.guard.mockResolvedValue({ ok: true, session: { userId: 'owner-a' } });
});
describe('private editor recovery', () => {
  it('compares validated colour fields independently of object key order', () => {
    const first = {
      colorOptions: [
        { id: 'col_12345678', name: 'Brown', stockStatus: 'IN_STOCK' as const, imageIds: [] },
      ],
      dimensions: { widthCm: 0, depthCm: 1 },
    };
    const second = {
      dimensions: { depthCm: 1, widthCm: 0 },
      colorOptions: [
        { imageIds: [], stockStatus: 'IN_STOCK' as const, name: 'Brown', id: 'col_12345678' },
      ],
    };
    expect(serializeEditorPatch(first)).toBe(serializeEditorPatch(second));
    expect(serializeEditorPatch({ tags: ['one', 'two'] })).not.toBe(
      serializeEditorPatch({ tags: ['two', 'one'] }),
    );
  });
  it('accepts incomplete details but forbids identity, image bytes and publishing', () => {
    expect(EditorDraftInput.safeParse(payload).success).toBe(true);
    for (const field of ['id', 'status', 'images', 'sku', 'published']) {
      expect(
        EditorDraftInput.safeParse({ ...payload, patch: { [field]: 'unauthorized' } }).success,
      ).toBe(false);
    }
  });
  it('isolates drafts by authenticated owner and supports idempotent retries', async () => {
    const response = await POST(ctx('POST', payload));
    expect(response.status).toBe(200);
    const { draft } = await json(response);
    expect((await POST(ctx('POST', payload))).status).toBe(200);
    expect((await POST(ctx('POST', { ...payload, patch: { name: 'Changed' } }))).status).toBe(409);
    expect((await json(await GET(ctx()))).drafts).toHaveLength(1);
    mocks.guard.mockResolvedValue({ ok: true, session: { userId: 'owner-b' } });
    expect((await json(await GET(ctx('GET', undefined, '?scope=' + scope)))).draft).toBeNull();
    expect((await json(await GET(ctx()))).drafts).toHaveLength(0);
    mocks.guard.mockResolvedValue({ ok: true, session: { userId: 'owner-a' } });
    expect((await DELETE(ctx('DELETE', { scope, revision: 'old' }))).status).toBe(409);
    expect((await DELETE(ctx('DELETE', { scope, revision: draft?.revision }))).status).toBe(204);
    expect((await json(await GET(ctx()))).drafts).toHaveLength(0);
  });
  it('honours authentication refusals on every operation', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    for (const handler of [GET, POST, DELETE]) expect((await handler(ctx())).status).toBe(401);
    expect(mocks.guard).toHaveBeenCalledWith(expect.anything(), 'product.write');
  });
  it('recovers unfinished values without changing identity, publication or server photos', () => {
    const restored = restoreEditorPatch(
      demoSofa,
      {
        name: 'A',
        price: 0,
        originalPrice: 1,
        dimensions: { widthCm: 0 },
        primaryImage: 'removed',
      },
      'old-version',
    );
    expect(restored.name).toBe('A');
    expect(restored.price).toBe(0);
    expect(restored.updatedAt).toBe('old-version');
    expect(restored.images).toEqual(demoSofa.images);
    expect(restored.primaryImage).toBe(demoSofa.primaryImage);
    expect(restored.id).toBe(demoSofa.id);
    expect(restored.status).toBe(demoSofa.status);
  });
  it('rejects corrupt and expired local copies and scopes storage to the owner', () => {
    const record = {
      scope,
      baseUpdatedAt: demoSofa.updatedAt,
      revision: '',
      savedAt: 1000,
      patch: payload.patch,
      dirty: true,
    };
    expect(
      readLocalRecovery({ getItem: () => JSON.stringify(record) }, 'key', 1001)?.patch.name,
    ).toBe('A');
    expect(
      readLocalRecovery(
        { getItem: () => JSON.stringify(record) },
        'key',
        1001 + EDITOR_DRAFT_TTL_SECONDS * 1000,
      ),
    ).toBeNull();
    expect(readLocalRecovery({ getItem: () => '{invalid' }, 'key')).toBeNull();
    expect(recoveryStorageKey('a', scope)).not.toBe(recoveryStorageKey('b', scope));
  });
});
