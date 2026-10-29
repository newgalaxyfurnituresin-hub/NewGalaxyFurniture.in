import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { advanceHostedPhoto } from '@/lib/images/hosted';
import { UploadJob, type UploadJobValue } from '@/lib/images/upload-jobs';
import { fakeObjectBucket } from '../fixtures/runtime';
import { hostedImageFixture } from '../fixtures/hosted-images';
it('checkpoints a 4K PNG one image output at a time and streams stored originals for every smaller size', async () => {
  const bucket = fakeObjectBucket();
  const source = new Uint8Array(
    await sharp(randomBytes(3840 * 2160), { raw: { width: 3840, height: 2160, channels: 1 } })
      .toColourspace('b-w')
      .png()
      .toBuffer(),
  );
  expect(source.byteLength).toBeGreaterThan(5 * 1024 * 1024);
  expect(source.byteLength).toBeLessThanOrEqual(12 * 1024 * 1024);
  let job: UploadJobValue = {
    version: 1,
    productId: 'p_stepwise01',
    imageId: 'img_stepwise01',
    sourceKey: 'pending-uploads/p_stepwise01/img_stepwise01/source',
    filename: 'high-quality.png',
    colorName: 'Brown',
    state: 'queued',
    updatedAt: Date.now(),
  };
  await bucket.put(job.sourceKey, source);
  const service = hostedImageFixture();
  const originalInput = service.input.bind(service);
  let outputs = 0;
  service.input = (stream) => {
    const handle = originalInput(stream);
    const output = handle.output.bind(handle);
    handle.output = async (options) => {
      outputs++;
      return output(options);
    };
    return handle;
  };
  const get = bucket.get.bind(bucket);
  const forbiddenBufferRead = vi.fn(async () => {
    throw Error('Derivative request must use the R2 stream');
  });
  bucket.get = async (key) => {
    const object = await get(key);
    return object && key.endsWith('/original.jpg')
      ? { ...object, arrayBuffer: forbiddenBufferRead }
      : object;
  };
  let steps = 0;
  while (job.state !== 'ready' && steps < 15) {
    const before = outputs;
    job = await advanceHostedPhoto(service, bucket, job);
    expect(outputs - before).toBe(1);
    job = UploadJob.parse(JSON.parse(JSON.stringify(job)));
    expect(job.result?.width).toBe(3840);
    steps++;
  }
  expect(job.state).toBe('ready');
  expect(steps).toBeGreaterThan(3);
  expect(job.result?.derivativeWidths).toHaveLength(7);
  expect(job.result?.derivativesReady).toBe(true);
  expect(job.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(forbiddenBufferRead).not.toHaveBeenCalled();
}, 30000);
