import { getCollection } from 'astro:content';
import { summarize, type ProductSummary } from '@/lib/products/index-store';

let snapshot: Promise<ProductSummary[]> | undefined;

/** Private build snapshot: never imported by a public page or browser component. */
export function getAdminCatalogueSnapshot(): Promise<ProductSummary[]> {
  snapshot ??= getCollection('products').then((entries) =>
    entries.map((entry) => summarize(entry.data)),
  );
  return snapshot;
}
