import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { demoSofa } from '../fixtures/products';
import { fakeKeyValueStore, fakeObjectBucket } from '../fixtures/runtime';
import { enhancementKey, queueEnhancement } from '@/lib/images/enhancement';

const state = vi.hoisted(() => ({
  open: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  bucket: vi.fn(),
}));
vi.mock('@/lib/admin/context', () => ({ openAdminContext: state.open, lockNamespace: () => ({}) }));
vi.mock('@/lib/env', () => ({ getR2: state.bucket }));
vi.mock('@/lib/github/drafts', () => ({
  resolveProduct: state.resolve,
  saveProductState: state.save,
}));
vi.mock('@/lib/github/client', () => ({
  withProductLock: async (_store: unknown, _id: string, work: () => Promise<Response>) =>
    await work(),
}));
import { GET, POST } from '@/pages/api/admin/products/[id]/images/[imageId]/enhancement';

let store = fakeKeyValueStore();
let bucket = fakeObjectBucket();
let product = structuredClone(demoSofa);
const bytes = new Uint8Array([255, 216, 255, 217]);
const outputId = 'img_4kresult01';
const ctx = (action = 'queue'): APIContext =>
  ({
    params: { id: product.id, imageId: product.images[0]?.id },
    request: new Request('https://newgalaxyfurniture.in/api/admin/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    url: new URL('https://newgalaxyfurniture.in/api/admin/test'),
  }) as unknown as APIContext;

beforeEach(() => {
  vi.clearAllMocks();
  store = fakeKeyValueStore();
  bucket = fakeObjectBucket();
  product = structuredClone(demoSofa);
  product.images[0] = {
    ...product.images[0]!,
    width: 1470,
    height: 1070,
    key: `products/${product.id}/${product.images[0]!.id}/original.jpg`,
  };
  state.open.mockResolvedValue({ ok: true, context: { drafts: store, client: {}, actor: {} } });
  state.resolve.mockImplementation(() => Promise.resolve({ product: structuredClone(product) }));
  state.save.mockResolvedValue({});
  state.bucket.mockReturnValue(bucket);
});

async function ready(): Promise<void> {
  const image = product.images[0]!;
  const job = await queueEnhancement(store, product.id, image);
  await bucket.put(`products/${product.id}/${outputId}/original.jpg`, bytes, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await store.put(
    enhancementKey(product.id, image.id),
    JSON.stringify({
      ...job,
      state: 'ready',
      result: {
        imageId: outputId,
        width: 3840,
        height: 2795,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        derivativeWidths: [320, 640, 960, 1280],
        lqip: 'data:image/webp;base64,AAAA',
      },
    }),
  );
}

describe('admin enhancement operations', () => {
  it('requires the existing company-admin guard for reads and writes', async () => {
    state.open.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(ctx())).status).toBe(403);
    expect((await POST(ctx())).status).toBe(403);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });
  it('queues an image without altering the product', async () => {
    expect((await POST(ctx())).status).toBe(200);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('does not apply an unready job', async () => {
    expect((await POST(ctx('apply'))).status).toBe(422);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('applies the reviewed copy and updates the primary reference without deleting the original', async () => {
    await ready();
    product.primaryImage = product.images[0]?.id;
    expect((await POST(ctx('apply'))).status).toBe(200);
    const input = state.save.mock.calls[0]?.[0] as { product: typeof product };
    expect(input.product.primaryImage).toBe(outputId);
    expect(input.product.images[0]?.enhancedFrom?.id).toBe(product.images[0]?.id);
    expect(input.product.images[0]?.alt).toBe(product.images[0]?.alt);
    expect(product.images[0]?.width).toBe(1470);
  });
  it('refuses a corrupted result before saving anything', async () => {
    await ready();
    await bucket.put(`products/${product.id}/${outputId}/original.jpg`, new Uint8Array([1, 2, 3]));
    expect((await POST(ctx('apply'))).status).toBe(422);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('does not allow operations on an image outside the selected product', async () => {
    const request = ctx();
    request.params.imageId = 'img_other00001';
    expect((await POST(request)).status).toBe(404);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('serves a protected, uncached preview only after processing', async () => {
    const request = ctx();
    request.url.searchParams.set('preview', '1');
    expect((await GET(request)).status).toBe(404);
    await ready();
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
