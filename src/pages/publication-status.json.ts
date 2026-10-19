import { getCatalogue } from '@/lib/content/catalogue';

export const prerender = true;

/** Generated alongside the public pages. Contains only already-public catalogue metadata. */
export async function GET(): Promise<Response> {
  const products = await getCatalogue();
  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      products: products.map(({ id, slug, updatedAt, status }) => ({
        id,
        slug,
        updatedAt,
        status,
      })),
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
}
