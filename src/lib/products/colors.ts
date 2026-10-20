import type { Product, StockStatusValue } from '@/schemas/product';

export type ColorProduct = Pick<Product, 'colorOptions' | 'availableColors' | 'stockStatus'>;
export type ColorOption = NonNullable<Product['colorOptions']>[number];

/** Legacy names keep their existing product availability until explicitly edited. */
export function colorOptionsOf(product: ColorProduct): ColorOption[] {
  if (product.colorOptions !== undefined) return product.colorOptions;
  return [...new Set(product.availableColors.map((name) => name.trim()).filter(Boolean))].map(
    (name, index) => ({
      id: `col_legacy${String(index).padStart(4, '0')}`,
      name,
      stockStatus: product.stockStatus,
    }),
  );
}

/** A product-wide or size-specific restriction cannot be overridden by a colour. */
export function colorStock(
  product: ColorProduct,
  color: ColorOption,
  variantStock?: StockStatusValue,
): StockStatusValue {
  const statuses = [product.stockStatus, color.stockStatus, variantStock];
  if (statuses.includes('OUT_OF_STOCK')) return 'OUT_OF_STOCK';
  if (statuses.includes('MADE_TO_ORDER')) return 'MADE_TO_ORDER';
  if (statuses.includes('LIMITED_STOCK')) return 'LIMITED_STOCK';
  return 'IN_STOCK';
}

/** Keep catalogue, filters and structured data honest when every colour is unavailable. */
export function colorStockSummary(product: ColorProduct): StockStatusValue {
  const options = colorOptionsOf(product);
  if (product.stockStatus === 'OUT_OF_STOCK' || options.length === 0) return product.stockStatus;
  const states = options.map((option) => colorStock(product, option));
  if (states.includes('IN_STOCK')) return 'IN_STOCK';
  if (states.includes('LIMITED_STOCK')) return 'LIMITED_STOCK';
  if (states.includes('MADE_TO_ORDER')) return 'MADE_TO_ORDER';
  return 'OUT_OF_STOCK';
}
