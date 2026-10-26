/** Only fetch published, build-addressed cards, with bounded network concurrency. */
export async function loadResultCards(
  grid: HTMLElement,
  slugs: readonly string[],
  indexUrl: string,
  signal: AbortSignal,
): Promise<void> {
  const match = /^\/search-index\/([a-z0-9-]+)\.json$/.exec(indexUrl);
  if (!match) throw new Error('Invalid catalogue version');
  const existing = new Set(
    [...grid.querySelectorAll<HTMLElement>('[data-product-card]')].map((card) => card.dataset.slug),
  );
  const missing = slugs.filter((slug) => !existing.has(slug));
  const cards = new Map<string, HTMLElement>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, missing.length) }, async () => {
      while (next < missing.length) {
        const slug = missing[next++]!;
        if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid product address');
        const response = await fetch(`/catalogue-cards/${match[1]}/${slug}.json`, { signal });
        if (!response.ok) throw new Error('Could not load product cards');
        const value = (await response.json()) as { slug?: string; html?: string };
        if (value.slug !== slug || typeof value.html !== 'string')
          throw new Error('Invalid product card');
        const parsed = new DOMParser().parseFromString(value.html, 'text/html');
        const card = parsed.querySelector<HTMLElement>('[data-product-card]');
        if (!card || card.dataset.slug !== slug || parsed.querySelector('script'))
          throw new Error('Invalid product card');
        const item = document.createElement('li');
        item.append(document.importNode(card, true));
        cards.set(slug, item);
      }
    }),
  );
  if (signal.aborted) return;
  // Commit together only after every card is ready. A failed request preserves the
  // previous page, including its working enquiry links.
  for (const item of cards.values()) grid.append(item);
}
