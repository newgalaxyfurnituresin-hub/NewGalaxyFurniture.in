import type { Product, ProductVariantValue } from '@/schemas/product';

/** Variant prices always derive from the canonical product; never create parallel inventory. */
export function mattressOption(
  product: Pick<Product, 'price' | 'priceOnEnquiry' | 'stockStatus'>,
  variant: ProductVariantValue,
) {
  const amount =
    product.price === null || product.priceOnEnquiry
      ? null
      : product.price + (variant.priceDelta ?? 0);
  return {
    label: variant.label,
    price: amount !== null && amount > 0 ? amount : null,
    stockStatus: variant.stockStatus ?? product.stockStatus,
    sku: variant.sku,
  };
}
