import type { APIRoute, GetStaticPaths } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import ProductCard from '@/components/product/ProductCard.astro';
import { getCatalogue, getPublishedCategories } from '@/lib/content/catalogue';
import { getSearchIndexAsset } from '@/lib/search/index-asset';
import type { Product } from '@/schemas/product';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const [products, categories, asset] = await Promise.all([
    getCatalogue(),
    getPublishedCategories(),
    getSearchIndexAsset(),
  ]);
  const names = new Map(categories.map((category) => [category.slug, category.name]));
  return products.map((product) => ({
    params: { hash: asset.hash, slug: product.slug },
    props: { product, categoryName: names.get(product.category) },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { product, categoryName } = props as { product: Product; categoryName?: string };
  const container = await AstroContainer.create();
  // The host page already includes ResponsiveImage's CSS and delegated error
  // handler. Standalone renderers can emit source script paths: never ship those.
  const html = (
    await container.renderToString(ProductCard, { props: { product, categoryName }, partial: true })
  )
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  return new Response(JSON.stringify({ slug: product.slug, html }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
