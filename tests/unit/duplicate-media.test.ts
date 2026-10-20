import { describe, expect, it } from 'vitest';
import { demoSofa } from '../fixtures/products';
import { fakeObjectBucket } from '../fixtures/runtime';
import { duplicateProductMedia } from '@/lib/images/duplicate';
import { softDeleteImage } from '@/lib/images/store';
import { imagesForColor, retainColorPhotos } from '@/lib/products/colors';
import type { Product } from '@/schemas/product';

function products(): { source: Product; copy: Product } {
  const source = structuredClone(demoSofa);
  source.images = source.images.slice(0, 1);
  const image = source.images[0]!;
  image.key = `products/${source.id}/${image.id}/original.jpg`;
  image.enhancedFrom = {
    id: 'img_original01',
    key: `products/${source.id}/img_original01/original.jpg`,
    width: 1470,
    height: 1070,
  };
  source.colorOptions = [
    {
      id: 'col_brown0001',
      name: 'Brown',
      stockStatus: 'IN_STOCK',
      imageIds: [image.enhancedFrom.id],
    },
  ];
  const copy = {
    ...structuredClone(source),
    id: 'p_copy000001',
    status: 'DRAFT' as const,
    published: false,
  };
  return { source, copy };
}
describe('independent duplicated product photographs', () => {
  it('copies originals, derivatives and preserved 4K sources without changing the source', async () => {
    const bucket = fakeObjectBucket();
    const { source, copy } = products();
    const snapshot = structuredClone(source);
    const original = source.images[0]!;
    const keys = [
      original.key,
      `products/${source.id}/${original.id}/3840.webp`,
      original.enhancedFrom!.key,
    ];
    for (const key of keys)
      await bucket.put(key, new Uint8Array([1, 2, 3]), {
        httpMetadata: { contentType: 'image/jpeg' },
      });
    const result = await duplicateProductMedia(bucket, source.id, copy);
    expect(source).toEqual(snapshot);
    expect(copy.images[0]!.key).toContain(source.id);
    for (const key of keys) {
      expect(await bucket.get(key)).not.toBeNull();
      expect(await bucket.get(key.replace(source.id, copy.id))).not.toBeNull();
    }
    expect(result.images[0]!.key).toContain(copy.id);
    expect(result.images[0]!.enhancedFrom!.key).toContain(copy.id);
    expect(imagesForColor(result.images, result.colorOptions![0]!)).toHaveLength(1);
    await softDeleteImage(bucket, copy.id, original.id);
    expect(await bucket.get(original.key)).not.toBeNull();
  });
  it('refuses an occupied destination instead of overwriting any object', async () => {
    const bucket = fakeObjectBucket();
    const { source, copy } = products();
    await bucket.put(`products/${copy.id}/keep.txt`, new Uint8Array([9]));
    await expect(duplicateProductMedia(bucket, source.id, copy)).rejects.toThrow(
      'already occupied',
    );
    expect(
      new Uint8Array(await (await bucket.get(`products/${copy.id}/keep.txt`))!.arrayBuffer()),
    ).toEqual(new Uint8Array([9]));
  });
  it('refuses missing source files before creating any product media', async () => {
    const bucket = fakeObjectBucket();
    const { source, copy } = products();
    await expect(duplicateProductMedia(bucket, source.id, copy)).rejects.toThrow('missing');
    expect((await bucket.list({ prefix: `products/${copy.id}/` })).objects).toEqual([]);
  });
  it('refuses a source key belonging to another product', async () => {
    const bucket = fakeObjectBucket();
    const { source, copy } = products();
    copy.images[0]!.key = 'products/p_foreign001/img_original01/original.jpg';
    await expect(duplicateProductMedia(bucket, source.id, copy)).rejects.toThrow(
      'not in this product',
    );
  });
  it('clears deleted selections in the editor and retains associations after 4K replacement', () => {
    const { source } = products();
    expect(retainColorPhotos(source.colorOptions!, [])[0]!.imageIds).toEqual([]);
    expect(retainColorPhotos(source.colorOptions!, source.images)[0]!.imageIds).toEqual(
      source.colorOptions![0]!.imageIds,
    );
  });
});
