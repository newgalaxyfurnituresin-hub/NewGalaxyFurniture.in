/** Build-only Astro renderer used by the static product-card JSON endpoint. */
declare module '@/components/product/ProductCard.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
  const component: AstroComponentFactory;
  export default component;
}
