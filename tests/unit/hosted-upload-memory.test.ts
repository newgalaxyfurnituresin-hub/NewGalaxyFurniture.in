import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { R2Bucket } from '@cloudflare/workers-types';
import { prepareHostedPhoto } from '@/lib/images/hosted';
import { createCloudflareObjectBucket } from '@/lib/runtime/r2';
import { hostedImageFixture } from '../fixtures/hosted-images';
import { fakeObjectBucket } from '../fixtures/runtime';
afterEach(() => vi.unstubAllGlobals());
it('prepares all sizes of a large PNG within a bounded full-photo Blob allocation budget', async () => {
  const source = new Uint8Array(
    await sharp({ create: { width: 3840, height: 2160, channels: 3, background: '#8b6240' } })
      .png()
      .toBuffer(),
  );
  const NativeBlob = globalThis.Blob;
  let allocated = 0;
  vi.stubGlobal(
    'Blob',
    class extends NativeBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        super(parts, options);
        allocated += this.size;
      }
    },
  );
  const bucket = fakeObjectBucket();
  const job = await prepareHostedPhoto(
    hostedImageFixture(),
    bucket,
    {
      version: 1,
      productId: 'p_memory0001',
      imageId: 'img_memory0001',
      sourceKey: 'pending-uploads/p_memory0001/img_memory0001/source',
      filename: 'large.png',
      colorName: '',
      state: 'queued',
      updatedAt: Date.now(),
    },
    source,
  );
  const used = allocated;
  const original = await bucket.get(job.result!.key);
  // Budget is independent of how many thumbnail widths are requested. The original remains 4K.
  expect(used).toBeLessThanOrEqual(2 * source.byteLength + 2 * original!.size);
  expect(job.state).toBe('ready');
  expect(job.result!.width).toBe(3840);
  expect(job.result!.derivativeWidths!.length).toBeGreaterThan(3);
});
it('avoids duplicating a full R2 upload buffer while isolating bytes outside a subview', async () => {
  const put = vi.fn(async (_key: string, _value: ArrayBuffer, _options?: unknown) => {});
  const bucket = createCloudflareObjectBucket({ put } as unknown as R2Bucket);
  const full = new Uint8Array([90, 1, 2, 91]);
  await bucket.put('full', full);
  expect(put.mock.calls[0]![1]).toBe(full.buffer);
  await bucket.put('view', full.subarray(1, 3));
  expect([...new Uint8Array(put.mock.calls[1]![1])]).toEqual([1, 2]);
});
