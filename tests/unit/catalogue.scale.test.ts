import { describe, expect, it, vi } from 'vitest';
import { GitHubContentClient } from '@/lib/github/client';
import {
  listProductSummariesWithRepositoryFallback,
  rehydrateFromRepository,
} from '@/lib/github/drafts';
import { summarize } from '@/lib/products/index-store';
import { pageOfProducts } from '@/lib/products/query';
import { cataloguePage } from '@/lib/products/catalogue-page';
import { buildSearchIndex, serializeSearchIndex } from '@/lib/search/build-index';
import { assertSearchIndexBudget } from '@/lib/search/budget';
import { createIndex, candidatesFor } from '@/lib/search/query';
import { filter, neutralState } from '@/lib/search/filter';
import { sortDocs, SORT_KEYS } from '@/lib/search/sort';
import { MemoryKV } from '../fixtures/github-api';
import { demoSofa } from '../fixtures/products';

const products = Array.from({ length: 1000 }, (_, i) => ({
  ...demoSofa,
  id: `p_${String(i).padStart(10, '0')}`,
  sku: `NGF-SCALE-${String(i).padStart(5, '0')}`,
  slug: `scale-product-${i}`,
  name: `Scale product ${i}`,
  category: ['sofas', 'beds', 'mattresses', 'dining-tables'][i % 4]!,
  price: 1000 + i,
}));

describe('catalogue capacity at 1,000 listings', () => {
  it('paginates every admin record without omissions or duplicates', () => {
    const summaries = products.map(summarize);
    const ids = Array.from(
      { length: 40 },
      (_, i) => pageOfProducts(summaries, { page: i + 1 }).items,
    )
      .flat()
      .map((row) => row.id);
    expect(new Set(ids).size).toBe(1000);
    expect(ids).toHaveLength(1000);
    expect(pageOfProducts(summaries, { q: 'NGF-SCALE-00999' }).items[0]?.id).toBe(
      products[999]!.id,
    );
    expect(pageOfProducts(summaries, { category: 'mattresses' }).total).toBe(250);
    expect(cataloguePage(products, 1).items).toHaveLength(18);
    expect(cataloguePage(products, 56).items).toHaveLength(10);
  });

  it('searches exact SKUs, filters categories and keeps all six sorts complete', async () => {
    const docs = buildSearchIndex(products);
    expect(assertSearchIndexBudget(serializeSearchIndex(docs), docs.length).ok).toBe(true);
    const index = await createIndex(docs);
    const found = candidatesFor('NGF-SCALE-00999', { docs, index, categoryNames: {} });
    expect(found[0]?.k).toBe('NGF-SCALE-00999');
    expect(found).toHaveLength(1);
    expect(filter(docs, { ...neutralState(), category: ['mattresses'] })).toHaveLength(250);
    for (const key of SORT_KEYS) {
      const sorted = sortDocs(docs, key, {
        manual: { trending: [], bestSeller: [], mostViewed: [] },
        snapshot: null,
      });
      expect(sorted).toHaveLength(1000);
      expect(new Set(sorted.map((doc) => doc.i)).size).toBe(1000);
    }
    expect(
      sortDocs(docs, 'priceAsc', {
        manual: { trending: [], bestSeller: [], mostViewed: [] },
        snapshot: null,
      })[0]?.p,
    ).toBe(1000);
  });

  it('recovers 1,000 deployed summaries using one listing, without 1,000 file reads', async () => {
    const listProductSlugs = vi.fn(async () => products.map((product) => product.slug));
    const readJson = vi.fn();
    const client = {
      listProductSlugs,
      readJson,
    } as unknown as GitHubContentClient;
    const result = await listProductSummariesWithRepositoryFallback({
      drafts: new MemoryKV(),
      client,
      snapshot: async () => products.map(summarize),
    });
    expect(result).toHaveLength(1000);
    expect(listProductSlugs).toHaveBeenCalledTimes(1);
    expect(readJson).not.toHaveBeenCalled();
  });

  it('bounds repository recovery to 20 file reads and provides a continuation', async () => {
    const readJson = vi.fn(async () => null);
    const client = { readJson } as unknown as GitHubContentClient;
    const result = await rehydrateFromRepository({
      drafts: new MemoryKV(),
      client,
      slugs: products.map((product) => product.slug),
    });
    expect(readJson).toHaveBeenCalledTimes(20);
    expect(result.nextOffset).toBe(20);
    expect(result.remaining).toBe(980);
  });

  it('lists beyond the Contents API 1,000-file boundary without truncation', async () => {
    const calls: string[] = [];
    const client = new GitHubContentClient({
      token: 'test',
      repo: 'fixture/catalogue',
      branch: 'main',
      fetchImpl: async (input) => {
        const path = new URL(input).pathname;
        calls.push(path);
        const json = path.includes('/contents/')
          ? Array.from({ length: 1000 }, (_, i) => ({ name: `scale-${i}.json`, type: 'file' }))
          : {
              tree: path.endsWith('/main')
                ? [{ path: 'data', type: 'tree', sha: 'data-tree' }]
                : path.endsWith('/data-tree')
                  ? [{ path: 'products', type: 'tree', sha: 'products-tree' }]
                  : Array.from({ length: 1250 }, (_, i) => ({
                      path: `scale-${i}.json`,
                      type: 'blob',
                      sha: `file-${i}`,
                    })),
            };
        return new Response(JSON.stringify(json), { status: 200 });
      },
    });
    expect(await client.listProductSlugs()).toHaveLength(1250);
    expect(calls).toHaveLength(4);
  });
});
