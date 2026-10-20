import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSofa } from '../fixtures/products';

const state = vi.hoisted(() => ({ open: vi.fn(), resolve: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/admin/context', () => ({ openAdminContext: state.open, lockNamespace: () => ({}) }));
vi.mock('@/lib/github/drafts', () => ({
  resolveProduct: state.resolve,
  deleteProductState: state.remove,
  saveProductState: vi.fn(),
}));
vi.mock('@/lib/github/client', () => ({
  withProductLock: async (_store: unknown, _id: string, work: () => Promise<Response>) => work(),
}));
import { DELETE } from '@/pages/api/admin/products/[id]';

function context(body: unknown): APIContext {
  return {
    params: { id: demoSofa.id },
    request: new Request('https://example.test/api/admin/products/' + demoSofa.id, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as APIContext;
}
const valid = () => ({ confirmSku: demoSofa.sku, expectedUpdatedAt: demoSofa.updatedAt });
beforeEach(() => {
  vi.clearAllMocks();
  state.open.mockResolvedValue({ ok: true, context: { drafts: {}, client: {}, actor: {} } });
  state.resolve.mockResolvedValue({ product: structuredClone(demoSofa) });
  state.remove.mockResolvedValue({ commitSha: 'delete-commit', deployTriggered: true });
});

describe('SKU-confirmed product deletion', () => {
  it('retains the product.delete permission guard', async () => {
    state.open.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await DELETE(context(valid()))).status).toBe(403);
    expect(state.open).toHaveBeenCalledWith(expect.anything(), 'product.delete');
    expect(state.remove).not.toHaveBeenCalled();
  });
  it.each([{ confirmSlug: demoSofa.slug }, { confirmSku: demoSofa.sku }, {}])(
    'refuses missing SKU/revision confirmation: %j',
    async (body) => {
      expect((await DELETE(context(body))).status).toBe(422);
      expect(state.remove).not.toHaveBeenCalled();
    },
  );
  it('refuses a different SKU even when the product ID is correct', async () => {
    expect((await DELETE(context({ ...valid(), confirmSku: 'WRONG-SKU' }))).status).toBe(409);
    expect(state.remove).not.toHaveBeenCalled();
  });
  it('refuses deletion when the reviewed item has changed', async () => {
    state.resolve.mockResolvedValue({
      product: { ...demoSofa, updatedAt: '2026-10-20T10:00:00.000Z' },
    });
    expect((await DELETE(context(valid()))).status).toBe(409);
    expect(state.remove).not.toHaveBeenCalled();
  });
  it('returns a deletion receipt for public-removal tracking after a matching review', async () => {
    const response = await DELETE(context(valid()));
    expect(response.status).toBe(200);
    expect(state.remove).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ product: demoSofa }),
    );
    expect(await response.json()).toMatchObject({
      deleted: true,
      commitSha: 'delete-commit',
      deployTriggered: true,
    });
  });
  it('does not delete a missing product', async () => {
    state.resolve.mockResolvedValue(null);
    expect((await DELETE(context(valid()))).status).toBe(404);
    expect(state.remove).not.toHaveBeenCalled();
  });
});
