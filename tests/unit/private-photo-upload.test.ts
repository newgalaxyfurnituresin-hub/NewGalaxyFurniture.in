import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { demoSofa } from '../fixtures/products';
import { fakeKeyValueStore, fakeObjectBucket } from '../fixtures/runtime';
import { hostedImageFixture } from '../fixtures/hosted-images';
import { prepareHostedPhoto } from '@/lib/images/hosted';
import { readUploadJob, uploadJobKey } from '@/lib/images/upload-jobs';
import { parseImageRequest } from '@/lib/images/delivery';
import { enhancementKey } from '@/lib/images/enhancement';
const state = vi.hoisted(() => ({
  open: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  bucket: vi.fn(),
  store: vi.fn(),
  images: vi.fn(),
}));
vi.mock('@/lib/admin/context', () => ({ openAdminContext: state.open, lockNamespace: () => ({}) }));
vi.mock('@/lib/env', () => ({ getR2: state.bucket, getKV: state.store, getImages: state.images }));
vi.mock('@/lib/auth/rate-limit', () => ({ consumeNamedLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/github/drafts', () => ({
  resolveProduct: state.resolve,
  saveProductState: state.save,
}));
vi.mock('@/lib/github/client', () => ({
  withProductLock: async (_kv: unknown, _id: string, work: () => Promise<Response>) => await work(),
}));
import { POST as stage } from '@/pages/api/admin/products/[id]/photo-uploads';
import { POST as finish } from '@/pages/api/admin/products/[id]/photo-uploads/[imageId]';
let product = structuredClone(demoSofa);
let store = fakeKeyValueStore();
let bucket = fakeObjectBucket();
const ctx = (request: Request, imageId?: string) =>
  ({ request, params: { id: product.id, imageId } }) as unknown as APIContext;
beforeEach(() => {
  vi.clearAllMocks();
  product = structuredClone(demoSofa);
  product.status = 'DRAFT';
  product.published = false;
  store = fakeKeyValueStore();
  bucket = fakeObjectBucket();
  state.open.mockResolvedValue({
    ok: true,
    context: { session: { id: 'test' }, drafts: store, client: {}, actor: {} },
  });
  state.bucket.mockReturnValue(bucket);
  state.store.mockReturnValue(store);
  state.images.mockReturnValue(hostedImageFixture());
  state.resolve.mockImplementation(async () => ({ product: structuredClone(product) }));
  state.save.mockImplementation(async (input: { product: typeof product }) => {
    product = structuredClone(input.product);
    return {};
  });
});
async function staged() {
  const bytes = await sharp({
    create: { width: 400, height: 300, channels: 3, background: '#996633' },
  })
    .withExif({ IFD0: { Artist: 'PRIVATE-TEST' } })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'source.jpg', { type: 'image/jpeg' }));
  const response = await stage(
    ctx(
      new Request('https://newgalaxyfurniture.in/api/admin/test', { method: 'POST', body: form }),
    ),
  );
  expect(response.status).toBe(202);
  const { uploadId } = (await response.json()) as { uploadId: string };
  const job = (await readUploadJob(store, product.id, uploadId))!;
  return { job, bytes };
}
async function ready() {
  const { job } = await staged();
  for (let step = 0; step < 15; step++) {
    const current = (await readUploadJob(store, product.id, job.imageId))!;
    if (current.state === 'ready') return current;
    expect(
      (
        await finish(
          ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' }), job.imageId),
        )
      ).status,
    ).toBe(202);
    expect(state.save).not.toHaveBeenCalled();
  }
  throw Error('Photo did not reach its ready checkpoint');
}
describe('private free-plan image processing', () => {
  it('keeps unvalidated bytes private and out of the product', async () => {
    const before = product.images.length;
    const service = hostedImageFixture();
    const info = vi.spyOn(service, 'info');
    const input = vi.spyOn(service, 'input');
    state.images.mockReturnValue(service);
    const { job } = await staged();
    expect(info).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
    expect(await bucket.get(job.sourceKey)).not.toBeNull();
    expect(job.sourceKey).toMatch(/^pending-uploads\//);
    expect(parseImageRequest(job.sourceKey)).toBeNull();
    expect(product.images).toHaveLength(before);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('fully decodes and strips EXIF through the hosted protocol and promotes exactly once', async () => {
    const before = product.images.length;
    const job = await ready();
    const original = await bucket.get(job.result!.key);
    const metadata = await sharp(Buffer.from(await original!.arrayBuffer())).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.width).toBe(400);
    expect(await bucket.get(`products/${product.id}/${job.imageId}/320.webp`)).not.toBeNull();
    const request = () =>
      ctx(
        new Request('https://newgalaxyfurniture.in/api/admin/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
        job.imageId,
      );
    expect((await finish(request())).status).toBe(200);
    expect((await finish(request())).status).toBe(200);
    expect(product.images).toHaveLength(before + 1);
    expect(state.save).toHaveBeenCalledOnce();
    expect(await store.get(enhancementKey(product.id, job.imageId), 'json')).toBeNull();
  });
  it('resumes an earlier private queued upload through checkpoints without attaching early', async () => {
    const { job } = await staged();
    let response: Response | undefined;
    for (let step = 0; step < 15; step++) {
      response = await finish(
        ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' }), job.imageId),
      );
      if (response.status === 200) break;
      expect(response.status).toBe(202);
      expect(state.save).not.toHaveBeenCalled();
    }
    expect(response?.status).toBe(200);
    expect(state.save).toHaveBeenCalledOnce();
  });
  it('rejects corrupt pixels without exposing an image record', async () => {
    const { job, bytes } = await staged();
    const write = vi.fn();
    await expect(
      prepareHostedPhoto(
        hostedImageFixture(),
        { ...bucket, put: write },
        job,
        bytes.subarray(0, 40),
      ),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });
  it('rejects a prepared original changed after processing', async () => {
    const job = await ready();
    await bucket.put(job.result!.key, new Uint8Array([0]));
    expect(
      (
        await finish(
          ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' }), job.imageId),
        )
      ).status,
    ).toBe(422);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('requires the existing company authorization on staging and promotion', async () => {
    state.open.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect(
      (await stage(ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' })))).status,
    ).toBe(403);
    expect(
      (
        await finish(
          ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' }), 'img_test000001'),
        )
      ).status,
    ).toBe(403);
    expect(state.save).not.toHaveBeenCalled();
  });
});

it('bounds repeated provider failures and never attaches unfinished photo data', async () => {
  const { job } = await staged();
  const request = () =>
    ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' }), job.imageId);
  expect((await finish(request())).status).toBe(202);
  const service = hostedImageFixture();
  const input = service.input.bind(service);
  service.input = (stream) => {
    const handle = input(stream);
    handle.output = async () => ({ response: () => new Response('unavailable', { status: 503 }) });
    return handle;
  };
  state.images.mockReturnValue(service);
  for (let attempt = 0; attempt < 3; attempt++)
    expect((await finish(request())).status).toBeGreaterThanOrEqual(500);
  const stopped = (await readUploadJob(store, product.id, job.imageId))!;
  expect(stopped.state).toBe('failed');
  expect(stopped.failures).toBe(3);
  expect((await finish(request())).status).toBe(422);
  expect(state.save).not.toHaveBeenCalled();
  expect(await bucket.get(job.sourceKey)).not.toBeNull();
});
it('does not recreate a deleted product when a prepared photo is ready', async () => {
  const job = await ready();
  state.resolve.mockResolvedValue(null);
  expect(
    (
      await finish(
        ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' }), job.imageId),
      )
    ).status,
  ).toBe(404);
  expect(state.save).not.toHaveBeenCalled();
});

it('stops repeatedly interrupted checkpoints without processing or attaching again', async () => {
  const { job } = await staged();
  await store.put(uploadJobKey(product.id, job.imageId), JSON.stringify({ ...job, failures: 3 }));
  const service = hostedImageFixture();
  const input = vi.spyOn(service, 'input');
  state.images.mockReturnValue(service);
  const response = await finish(
    ctx(new Request('https://newgalaxyfurniture.in', { method: 'POST' }), job.imageId),
  );
  expect(response.status).toBe(422);
  expect(input).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
  expect((await readUploadJob(store, product.id, job.imageId))?.state).toBe('failed');
  expect(await bucket.get(job.sourceKey)).not.toBeNull();
});
