/** Bound both initial HTML and the number of interactive cards on a device. */
export const CATALOGUE_PAGE_SIZE = 18;
export const GALLERY_PAGE_SIZE = 2;

export function cataloguePage<T>(items: readonly T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / CATALOGUE_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  return {
    items: items.slice((page - 1) * CATALOGUE_PAGE_SIZE, page * CATALOGUE_PAGE_SIZE),
    page,
    pageCount,
    total: items.length,
  };
}
