import type { Product, ProductImageValue, StockStatusValue } from '@/schemas/product';

export type ColorProduct = Pick<Product, 'colorOptions' | 'availableColors' | 'stockStatus'>;
export type ColorOption = NonNullable<Product['colorOptions']>[number];

export function imagesForColor(
  images: readonly ProductImageValue[],
  color: ColorOption,
): ProductImageValue[] {
  return (color.imageIds ?? [])
    .flatMap((id) => {
      const image = images.find((entry) => entry.id === id || entry.enhancedFrom?.id === id);
      return image ? [image] : [];
    })
    .filter((image, index, all) => all.findIndex((entry) => entry.id === image.id) === index);
}

export function initialColorOf(product: ColorProduct): ColorOption | undefined {
  const colors = colorOptionsOf(product);
  return colors.find((color) => colorStock(product, color) !== 'OUT_OF_STOCK') ?? colors[0];
}

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
