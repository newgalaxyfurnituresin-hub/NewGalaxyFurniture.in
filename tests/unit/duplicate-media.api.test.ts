import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSofa } from '../fixtures/products';
import { fakeObjectBucket } from '../fixtures/runtime';
import type { Product } from '@/schemas/product';
const state = vi.hoisted(() => ({
  open: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  bucket: vi.fn(),
}));
vi.mock('@/lib/admin/context', () => ({ openAdminContext: state.open }));
vi.mock('@/lib/github/drafts', () => ({
  resolveProduct: state.resolve,
  saveProductState: state.save,
}));
vi.mock('@/lib/products/index-store', () => ({
  takenIdentifiers: async () => ({ slugs: new Set<string>(), skus: new Set<string>() }),
}));
vi.mock('@/lib/env', () => ({ getR2: state.bucket }));
import { POST } from '@/pages/api/admin/products/[id]/duplicate';
const ctx = { params: { id: demoSofa.id } } as unknown as APIContext;
let bucket = fakeObjectBucket();
let source = structuredClone(demoSofa);
beforeEach(async () => {
  vi.clearAllMocks();
  bucket = fakeObjectBucket();
  source = structuredClone(demoSofa);
  source.images = source.images.slice(0, 1);
  source.images[0]!.key = `products/${source.id}/${source.images[0]!.id}/original.jpg`;
  source.colorOptions = [
    {
      id: 'col_brown0001',
      name: 'Brown',
      stockStatus: 'IN_STOCK',
      imageIds: [source.images[0]!.id],
    },
  ];
  await bucket.put(source.images[0]!.key, new Uint8Array([1, 2, 3]));
  state.bucket.mockReturnValue(bucket);
  state.resolve.mockResolvedValue({ product: source });
  state.save.mockResolvedValue({});
  state.open.mockResolvedValue({ ok: true, context: { drafts: {}, client: {}, actor: {} } });
});
describe('duplicate endpoint with colour media', () => {
  it('creates the draft only after its own photo objects exist', async () => {
    const before = structuredClone(source);
    const response = await POST(ctx);
    expect(response.status).toBe(201);
    const saved = state.save.mock.calls[0]?.[0] as { product: Product };
    expect(saved.product.id).not.toBe(source.id);
    expect(saved.product.status).toBe('DRAFT');
    expect(await bucket.get(saved.product.images[0]!.key)).not.toBeNull();
    expect(saved.product.colorOptions).toEqual(source.colorOptions);
    expect(source).toEqual(before);
  });
  it('does not save a broken duplicate when a source photo is missing', async () => {
    await bucket.delete(source.images[0]!.key);
    expect((await POST(ctx)).status).toBe(422);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('retains the existing permission guard before any media access', async () => {
    state.open.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(ctx)).status).toBe(403);
    expect(state.bucket).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });
});
