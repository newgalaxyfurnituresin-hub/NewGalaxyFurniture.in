import { beforeEach, describe, expect, it } from 'vitest';
import {
  ENHANCEMENT_POINTER,
  enhancedRecord,
  enhancementKey,
  queueEnhancement,
  readEnhancement,
} from '@/lib/images/enhancement';
import { fakeKeyValueStore } from '../fixtures/runtime';
import { demoSofa } from '../fixtures/products';
import { validSource } from '../../scripts/admin-photo-enhancer';
import { parseImageRequest } from '@/lib/images/delivery';
import { validateUpload } from '@/lib/images/validate';
import { fileFrom, makePng } from '../fixtures/images';

let store = fakeKeyValueStore();
const productId = demoSofa.id;
const image = {
  ...demoSofa.images[0]!,
  width: 1470,
  height: 1070,
  key: `products/${productId}/${demoSofa.images[0]!.id}/original.jpg`,
};
const result = {
  imageId: 'img_4kresult01',
  width: 3840,
  height: 2795,
  sha256: 'a'.repeat(64),
  derivativeWidths: [320, 480, 640, 960, 1280, 1600, 2000, 3840],
  lqip: 'data:image/webp;base64,AAAA',
};
beforeEach(() => {
  store = fakeKeyValueStore();
});

describe('admin photo enhancement queue', () => {
  it('accepts a lower-resolution enhancement source without changing ordinary upload constraints', async () => {
    const file = fileFrom('small.png', 'image/png', makePng(512, 384));
    expect((await validateUpload(file)).ok).toBe(false);
    expect((await validateUpload(file, undefined, { allowEnhancementSource: true })).ok).toBe(true);
    expect(
      (
        await validateUpload(fileFrom('too-small.png', 'image/png', makePng(255, 64)), undefined, {
          allowEnhancementSource: true,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateUpload(fileFrom('too-short.png', 'image/png', makePng(512, 20)), undefined, {
          allowEnhancementSource: true,
        })
      ).ok,
    ).toBe(false);
  });
  it('queues once and exposes a cheap wake-up pointer', async () => {
    const job = await queueEnhancement(store, productId, image);
    expect(job?.state).toBe('queued');
    expect(await queueEnhancement(store, productId, image)).toEqual(job);
    expect(await store.get(ENHANCEMENT_POINTER, 'json')).toEqual([
      enhancementKey(productId, image.id),
    ]);
  });
  it('does not apply AI to a photo already at 4K size', async () => {
    expect(
      await queueEnhancement(store, productId, { ...image, width: 3840, height: 2795 }),
    ).toBeNull();
    expect(await store.get(ENHANCEMENT_POINTER)).toBeNull();
  });
  it('requeues a failed attempt while preserving the source reference', async () => {
    const job = await queueEnhancement(store, productId, image);
    await store.put(
      enhancementKey(productId, image.id),
      JSON.stringify({ ...job, state: 'failed' }),
    );
    expect((await queueEnhancement(store, productId, image))?.state).toBe('queued');
  });
  it('does not return a job belonging to another product or photo', async () => {
    const job = await queueEnhancement(store, productId, image);
    await store.put(
      enhancementKey(productId, image.id),
      JSON.stringify({ ...job, productId: 'p_other00001' }),
    );
    expect(await readEnhancement(store, productId, image.id)).toBeNull();
  });
  it('rejects arbitrary keys and source paths', async () => {
    expect(() => enhancementKey('../private', image.id)).toThrow();
    const job = (await queueEnhancement(store, productId, image))!;
    expect(validSource(job)).toBe(true);
    expect(validSource({ ...job, sourceKey: 'deleted/private.jpg' })).toBe(false);
    expect(validSource({ ...job, sourceKey: `${image.key}/../../private` })).toBe(false);
  });
  it('keeps the original recoverable while preserving descriptions and order', async () => {
    const job = (await queueEnhancement(store, productId, image))!;
    const copy = enhancedRecord(image, { ...job, state: 'ready', result });
    expect(copy).toMatchObject({
      id: result.imageId,
      width: 3840,
      height: 2795,
      alt: image.alt,
      order: image.order,
      enhancedFrom: { id: image.id, key: image.key },
    });
    expect(copy.key).not.toBe(image.key);
    expect(image.id).toBe(demoSofa.images[0]?.id);
  });
  it.each(['queued', 'processing', 'failed', 'applied'] as const)(
    'refuses an unready %s result',
    async (state) => {
      const job = (await queueEnhancement(store, productId, image))!;
      expect(() => enhancedRecord(image, { ...job, state, result })).toThrow();
    },
  );
  it('rejects distorted, non-4K, reused or nonexistent derivative sizes', async () => {
    const job = (await queueEnhancement(store, productId, image))!;
    for (const patch of [
      { width: 2000 },
      { height: 1000 },
      { imageId: image.id },
      { derivativeWidths: [9000] },
    ]) {
      expect(() =>
        enhancedRecord(image, {
          ...job,
          state: 'ready',
          result: { ...result, ...patch },
        }),
      ).toThrow();
    }
  });
  it('allows the verified 4K derivative route while rejecting arbitrary large sizes', () => {
    expect(parseImageRequest(`${productId}/${result.imageId}-3840.webp`)).toMatchObject({
      width: 3840,
    });
    expect(parseImageRequest(`${productId}/${result.imageId}-99999.webp`)).toBeNull();
  });
});
