/**
 * The build-time search index asset: built once, reused by every page that needs its URL.
 *
 * Two responsibilities, both build-time only:
 *
 * 1. **Build the index once per build.** `getCatalogue()` is cheap but the serialization,
 *   hashing, and Brotli measurement are not, and every prerendered page asks for the index URL
 *   so the header search knows where to fetch from. The memo makes that one computation for a
 *   build of any size.
 * 2. **Enforce the budget.** `assertSearchIndexBudget` runs on first access, which is during
 *   the build, so a catalogue that outgrows the client-side architecture fails the build rather
 *   than degrading every visitor's search silently (Requirement 22.14).
 *
 * The URL is handed to the browser as a `data-` attribute on the document, never as an inlined
 * index: Requirement 22.8 and the design both require the index to stay out of the initial
 * payload and be fetched on first search intent.
 *
 * Requirements: 2.11, 22.7, 22.8, 22.14.
 */

import { getCatalogue } from '@/lib/content/catalogue';
import { getSiteSettings } from '@/lib/content/site';
import productCardSource from '@/components/product/ProductCard.astro?raw';
import responsiveImageSource from '@/components/ui/ResponsiveImage.astro?raw';
import { assertSearchIndexBudget } from './budget';
import type { BudgetReport } from './budget';
import {
  buildSearchIndex,
  searchIndexHash,
  searchIndexPath,
  serializeSearchIndex,
} from './build-index';
import type { SearchDoc } from './types';

export interface SearchIndexAsset {
  docs: SearchDoc[];
  serialized: string;
  hash: string;
  /** `/search-index/{hash}.json` */
  path: string;
  budget: BudgetReport;
}

let memo: Promise<SearchIndexAsset> | null = null;

async function build(): Promise<SearchIndexAsset> {
  const products = await getCatalogue();
  const docs = buildSearchIndex(products);
  const serialized = serializeSearchIndex(docs);
  const budget = assertSearchIndexBudget(serialized, docs.length);
  // Cards share this versioned namespace. Invalidate it for template/contact
  // changes and product edits not represented by search fields (alt text,
  // secondary photos), as well as ordinary price/name/category changes.
  const hash = searchIndexHash(
    serialized +
      productCardSource +
      responsiveImageSource +
      JSON.stringify(getSiteSettings()) +
      JSON.stringify(products.map((product) => [product.id, product.updatedAt])),
  );
  return { docs, serialized, hash, path: searchIndexPath(hash), budget };
}

export function getSearchIndexAsset(): Promise<SearchIndexAsset> {
  memo ??= build();
  return memo;
}

/** Just the URL — what the layout puts on the document for `SearchBox` to fetch. */
export async function getSearchIndexUrl(): Promise<string> {
  return (await getSearchIndexAsset()).path;
}
