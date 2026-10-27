import { describe, expect, it } from 'vitest';
import { heroSlidesFrom, selectHeroProducts } from '@/lib/site/hero-showcase';
import { demoSofa } from '../fixtures/products';
import type { Product } from '@/schemas/product';

function product(index: number, category = 'sofas'): Product {
  const key = index.toString(36).padStart(10, '0');
  return {
    ...structuredClone(demoSofa),
    id: `p_${key}`,
    slug: `product-${index}`,
    category,
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString(),
    primaryImage: `img_${key}`,
    images: [{ ...demoSofa.images[0]!, id: `img_${key}`, key: `originals/${key}.jpg` }],
  };
}

describe('category-first homepage hero', () => {
  it('shows exactly one newest product for each of eight populated categories', () => {
    const products = Array.from({ length: 8 }, (_, n) => [
      product(n, `category-${n}`),
      product(n + 20, `category-${n}`),
    ]).flat();
    const selected = selectHeroProducts(products);
    expect(selected).toHaveLength(8);
    expect(new Set(selected.map((p) => p.category)).size).toBe(8);
    expect(selected.every((p) => Number(p.slug.replace('product-', '')) >= 20)).toBe(true);
  });
  it('uses a spare from other categories when one category has no usable photograph', () => {
    const representatives = Array.from({ length: 7 }, (_, n) => product(n + 20, `category-${n}`));
    const spare = product(1, 'category-0');
    const empty = { ...product(99, 'shoe-stands'), images: [] };
    const selected = selectHeroProducts([spare, empty, ...representatives]);
    expect(selected).toHaveLength(8);
    expect(new Set(selected.slice(0, 7).map((p) => p.category)).size).toBe(7);
    expect(selected[7]?.id).toBe(spare.id);
    expect(selected.some((p) => p.category === 'shoe-stands')).toBe(false);
  });
  it('replaces the older representative when a new product is published', () => {
    const originals = Array.from({ length: 8 }, (_, n) => product(n, `category-${n}`));
    const newest = product(100, 'category-2');
    const draft = { ...newest, status: 'DRAFT' as const, published: false };
    expect(selectHeroProducts([...originals, draft])).toHaveLength(8);
    expect(selectHeroProducts([...originals, draft]).some((p) => p.id === newest.id)).toBe(false);
    const selected = selectHeroProducts([...originals, newest]);
    expect(selected.some((p) => p.id === newest.id)).toBe(true);
    expect(selected.some((p) => p.id === originals[2]!.id)).toBe(false);
  });
  it('uses added date, so editing an old product does not displace a newer one', () => {
    const old = { ...product(1), updatedAt: '2030-01-01T00:00:00.000Z' };
    expect(selectHeroProducts([old, product(2)])[0]?.id).toBe(product(2).id);
  });
  it('skips private, missing and processing photos and deduplicates products and media', () => {
    const ready = product(1);
    const duplicate = { ...product(2), images: ready.images };
    const processing = product(3);
    processing.images[0]!.derivativesReady = false;
    const candidates: Product[] = [
      ready,
      ready,
      duplicate,
      processing,
      { ...product(4), images: [] },
      ...(['DRAFT', 'REVIEW', 'UNPUBLISHED'] as const).map((status) => ({
        ...product(5),
        status,
        published: false,
      })),
    ];
    expect(selectHeroProducts(candidates).map((p) => p.id)).toEqual([duplicate.id]);
  });
  it('never invents slides when fewer than eight distinct photos exist', () => {
    expect(heroSlidesFrom([])).toEqual([]);
    expect(heroSlidesFrom([product(1)])).toHaveLength(1);
    expect(heroSlidesFrom([product(1)])[0]?.src).toContain(product(1).id);
  });
  it('caps large catalogues at eight, prioritising category coverage over spare products', () => {
    const large = Array.from({ length: 1000 }, (_, n) => product(n, `category-${n % 8}`));
    const selected = selectHeroProducts(large);
    expect(selected).toHaveLength(8);
    expect(new Set(selected.map((p) => p.category)).size).toBe(8);
    expect(selected.map((p) => p.id)).toEqual(
      large
        .slice(-8)
        .reverse()
        .map((p) => p.id),
    );
    expect(large[0]?.slug).toBe('product-0');
  });
  it('limits more than eight populated categories to the eight newest representatives', () => {
    const products = Array.from({ length: 12 }, (_, n) => product(n, `category-${n}`));
    expect(selectHeroProducts(products).map((p) => p.id)).toEqual(
      products
        .slice(-8)
        .reverse()
        .map((p) => p.id),
    );
  });
});
