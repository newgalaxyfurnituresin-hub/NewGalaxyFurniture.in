import { describe, expect, it } from 'vitest';
import { demoSofa } from '../fixtures/products';
import { ProductSchema } from '@/schemas/product';
import {
  colorOptionsOf,
  colorStock,
  colorStockSummary,
  type ColorOption,
} from '@/lib/products/colors';
import { applyProductPatch, ProductPatchInput } from '@/lib/products/input';
import { toSearchDoc } from '@/lib/search/build-index';
import { imagesForColor } from '@/lib/products/colors';
import { checkPublishGate } from '@/schemas/publish-gate';
import { galleryImagesOf } from '@/lib/products/gallery-images';

const brown: ColorOption = {
  id: 'col_brown0001',
  name: 'Walnut brown',
  hex: '#8B5E3C',
  stockStatus: 'IN_STOCK',
};
const cream: ColorOption = { id: 'col_cream0001', name: 'Cream', stockStatus: 'OUT_OF_STOCK' };
const product = { ...demoSofa, colorOptions: [brown, cream] };
describe('colour inventory', () => {
  it('requires separate real photos for every structured colour before publishing', () => {
    expect(checkPublishGate(product).ok).toBe(false);
    const ready = {
      ...product,
      colorOptions: [
        { ...brown, imageIds: [demoSofa.images[0]!.id] },
        { ...cream, imageIds: [demoSofa.images[1]!.id] },
      ],
    };
    expect(checkPublishGate(ready).ok).toBe(true);
    expect(
      checkPublishGate({
        ...ready,
        colorOptions: [ready.colorOptions[0]!, { ...cream, imageIds: [demoSofa.images[0]!.id] }],
      }).ok,
    ).toBe(false);
    expect(
      ProductSchema.safeParse({
        ...ready,
        colorOptions: [{ ...brown, imageIds: ['img_foreign001'] }],
      }).success,
    ).toBe(false);
  });
  it('keeps a colour linked to its preserved original after applying the 4K copy', () => {
    const source = demoSofa.images[0]!;
    const enhanced = {
      ...source,
      id: 'img_enhanced01',
      width: 3840,
      height: 2560,
      derivativesReady: true,
      derivativeWidths: [320, 1280, 3840],
      enhancedFrom: { id: source.id, key: source.key, width: source.width, height: source.height },
    };
    const color = { ...brown, imageIds: [source.id] };
    expect(imagesForColor([enhanced], color).map((image) => image.id)).toEqual([enhanced.id]);
    const props = galleryImagesOf({
      ...demoSofa,
      images: [enhanced],
      primaryImage: enhanced.id,
    })[0]!;
    expect(props.zoomSrc).toContain('-3840.webp');
    expect(props.srcSet).toContain('3840w');
    expect(source.id).toBe(demoSofa.images[0]!.id);
  });
  it('preserves legacy colour names and their existing stock status', () => {
    expect(colorOptionsOf(demoSofa).map((option) => option.name)).toEqual(demoSofa.availableColors);
    expect(colorStockSummary(demoSofa)).toBe(demoSofa.stockStatus);
  });
  it('allows one colour to be out of stock while the other remains available', () => {
    expect(colorStock(product, cream)).toBe('OUT_OF_STOCK');
    expect(colorStock(product, brown)).toBe('IN_STOCK');
    expect(colorStockSummary(product)).toBe('IN_STOCK');
  });
  it('reports the whole product unavailable when all colours are unavailable', () => {
    expect(colorStockSummary({ ...product, colorOptions: [cream] })).toBe('OUT_OF_STOCK');
    expect(toSearchDoc({ ...product, colorOptions: [cream] }).st).toBe('OUT_OF_STOCK');
  });
  it('never overrides global or size out-of-stock restrictions', () => {
    expect(colorStock({ ...product, stockStatus: 'OUT_OF_STOCK' }, brown)).toBe('OUT_OF_STOCK');
    expect(colorStock(product, brown, 'OUT_OF_STOCK')).toBe('OUT_OF_STOCK');
    expect(colorStock(product, brown, 'LIMITED_STOCK')).toBe('LIMITED_STOCK');
    expect(colorStock(product, brown, 'MADE_TO_ORDER')).toBe('MADE_TO_ORDER');
  });
  it('retains limited-stock and made-to-order status rather than claiming immediate stock', () => {
    expect(
      colorStockSummary({ ...product, colorOptions: [{ ...brown, stockStatus: 'LIMITED_STOCK' }] }),
    ).toBe('LIMITED_STOCK');
    expect(
      colorStockSummary({
        ...product,
        colorOptions: [{ ...brown, stockStatus: 'MADE_TO_ORDER' }, cream],
      }),
    ).toBe('MADE_TO_ORDER');
  });
  it('saves options through the existing patch and derives searchable colour names', () => {
    const patch = ProductPatchInput.parse({
      patch: { colorOptions: [brown, cream] },
      expectedUpdatedAt: demoSofa.updatedAt,
    });
    const saved = applyProductPatch(demoSofa, patch.patch);
    expect(saved.availableColors).toEqual(['Walnut brown', 'Cream']);
    expect(saved.colorOptions).toEqual([brown, cream]);
    expect(ProductSchema.safeParse(saved).success).toBe(true);
    expect(toSearchDoc(saved).o).toContain('Cream');
    expect(saved.images).toEqual(demoSofa.images);
    expect(saved.sku).toBe(demoSofa.sku);
  });
  it('removes all options without resurrecting the legacy list', () => {
    const saved = applyProductPatch(product, { colorOptions: [] });
    expect(saved.availableColors).toEqual([]);
    expect(colorOptionsOf(saved)).toEqual([]);
  });
  it.each([
    [{ ...brown, name: '' }],
    [brown, { ...cream, name: ' WALNUT BROWN ' }],
    [brown, { ...cream, id: brown.id }],
    [{ ...brown, hex: 'red; background:url(https://example.test)' }],
    [{ ...brown, stockStatus: 'UNKNOWN' }],
    Array.from({ length: 21 }, (_, i) => ({
      ...brown,
      id: `col_option${String(i).padStart(4, '0')}`,
      name: `Colour ${i}`,
    })),
  ])('rejects invalid, duplicate or excessive options: %j', (...options) => {
    expect(ProductSchema.safeParse({ ...demoSofa, colorOptions: options }).success).toBe(false);
  });
});
