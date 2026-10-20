import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSofa } from '../fixtures/products';
const state = vi.hoisted(() => ({
  open: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock('@/lib/admin/context', () => ({ openAdminContext: state.open, lockNamespace: () => ({}) }));
vi.mock('@/lib/github/drafts', () => ({
  resolveProduct: state.resolve,
  saveProductState: state.save,
  deleteProductState: vi.fn(),
}));
vi.mock('@/lib/github/client', () => ({
  withProductLock: async (_store: unknown, _id: string, work: () => Promise<Response>) => work(),
}));
vi.mock('@/lib/products/index-store', () => ({
  takenIdentifiers: async () => ({ slugs: new Set(), skus: new Set() }),
}));
vi.mock('@/lib/env', () => ({ getR2: () => ({}) }));
vi.mock('@/lib/images/store', () => ({ softDeleteImage: state.deleted }));
import { PATCH } from '@/pages/api/admin/products/[id]';
import { DELETE as DELETE_IMAGE } from '@/pages/api/admin/products/[id]/images/[imageId]';
const colors = [
  {
    id: 'col_brown0001',
    name: 'Brown',
    stockStatus: 'IN_STOCK' as const,
    imageIds: [demoSofa.images[0]!.id],
  },
  {
    id: 'col_cream0001',
    name: 'Cream',
    stockStatus: 'OUT_OF_STOCK' as const,
    imageIds: [demoSofa.images[1]!.id],
  },
];
function ctx(patch: unknown): APIContext {
  return {
    params: { id: demoSofa.id, imageId: demoSofa.images[0]!.id },
    request: new Request('https://example.test/api/admin/products/' + demoSofa.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: demoSofa.updatedAt, patch }),
    }),
  } as unknown as APIContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.open.mockResolvedValue({ ok: true, context: { drafts: {}, client: {}, actor: {} } });
  state.resolve.mockResolvedValue({ product: structuredClone(demoSofa) });
  state.save.mockResolvedValue({ deployTriggered: true });
});
describe('mandatory colour photo API boundary', () => {
  it('refuses public colour choices without photos', async () => {
    const response = await PATCH(
      ctx({ colorOptions: colors.map(({ imageIds: _, ...color }) => color) }),
    );
    expect(response.status).toBe(422);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('refuses reuse of one photograph for two different colours', async () => {
    expect(
      (
        await PATCH(
          ctx({ colorOptions: [colors[0], { ...colors[1], imageIds: colors[0]!.imageIds }] }),
        )
      ).status,
    ).toBe(422);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('saves valid colour photo assignments through the existing pipeline', async () => {
    expect((await PATCH(ctx({ colorOptions: colors }))).status).toBe(200);
    const saved = state.save.mock.calls[0]?.[0] as { product: typeof demoSofa };
    expect(saved.product.colorOptions).toEqual(colors);
  });
  it('allows incomplete drafts to be saved before photographs are uploaded', async () => {
    state.resolve.mockResolvedValue({
      product: { ...demoSofa, status: 'DRAFT', published: false },
    });
    expect(
      (await PATCH(ctx({ colorOptions: colors.map(({ imageIds: _, ...color }) => color) }))).status,
    ).toBe(200);
  });
  it('does not remove the last assigned photograph from a public colour', async () => {
    state.resolve.mockResolvedValue({ product: { ...demoSofa, colorOptions: colors } });
    expect((await DELETE_IMAGE(ctx({}))).status).toBe(422);
    expect(state.save).not.toHaveBeenCalled();
    expect(state.deleted).not.toHaveBeenCalled();
  });
});
