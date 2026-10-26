/**
 * The one place public surfaces read products and categories from.
 *
 * No page calls `getCollection('products')` directly. Every listing, the search
 * index, the sitemap, and the structured data read `getCatalogue()`, so the
 * published/unpublished decision exists exactly once (requirement 1.16: drafts and
 * unpublished products appear on no public surface and in no public count).
 *
 * Design: Data Models → File layout rules; Catalogue.
 * Requirements: 1.1, 1.16, 2.11, 4.1, 18.5, 26.11.
 */

import { getCollection } from 'astro:content';

import type { Category } from '@/schemas/category';
import type { Product } from '@/schemas/product';

import { filterCatalogue, filterCategories } from './catalogue-filter';
import { readOptionalCollection } from './optional-collection';

export {
  filterCatalogue,
  filterCategories,
  isCatalogueProduct,
  isPublishedCategory,
} from './catalogue-filter';

/**
 * Every product with a public status, newest first.
 *
 * `readOptionalCollection` because `data/products/` ships empty on purpose and every listing
 * renders its designed empty state — see `./optional-collection` for why that needs saying.
 */
let catalogueSnapshot: Promise<Product[]> | undefined;

async function readCatalogue(): Promise<Product[]> {
  const entries = await readOptionalCollection(() => getCollection('products'));
  const products: Product[] = entries.map((entry) => entry.data);
  return filterCatalogue(products).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.slug.localeCompare(b.slug),
  );
}

export async function getCatalogue(): Promise<Product[]> {
  // Deployed content is immutable for this build. Avoid re-reading and sorting the
  // complete catalogue for every product page, image or enquiry request.
  catalogueSnapshot ??= readCatalogue();
  return [...(await catalogueSnapshot)];
}

/** Every published category in operator order. */
export async function getPublishedCategories(): Promise<Category[]> {
  const entries = await getCollection('categories');
  const categories: Category[] = entries.map((entry) => entry.data);
  return filterCategories(categories);
}

/** The catalogue grouped by category slug — what the nine category routes read. */
export async function getCatalogueByCategory(): Promise<Map<string, Product[]>> {
  const grouped = new Map<string, Product[]>();
  for (const product of await getCatalogue()) {
    const bucket = grouped.get(product.category);
    if (bucket === undefined) grouped.set(product.category, [product]);
    else bucket.push(product);
  }
  return grouped;
}
