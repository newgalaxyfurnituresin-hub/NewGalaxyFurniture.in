import { useState } from 'react';
import { colorOptionsOf, colorStock, type ColorProduct } from '@/lib/products/colors';
import { stockLabel } from '@/lib/products/labels';
import { mattressOption } from '@/lib/products/mattress-options';
import { formatINR } from '@/lib/money';
import { buildWhatsAppUrl } from '@/lib/whatsapp';
import { useScopedId } from '@/lib/ui/ids';
import type { Product } from '@/schemas/product';

type ChoiceProduct = ColorProduct &
  Pick<Product, 'name' | 'sku' | 'price' | 'priceOnEnquiry' | 'variants'>;
export default function ColorOptions({
  product,
  number,
  productUrl,
}: {
  product: ChoiceProduct;
  number?: string;
  productUrl: string;
}): React.JSX.Element | null {
  const colors = colorOptionsOf(product);
  const [selected, setSelected] = useState(
    colors.find((color) => colorStock(product, color) !== 'OUT_OF_STOCK')?.id ??
      colors[0]?.id ??
      '',
  );
  const [size, setSize] = useState(product.variants[0]?.id ?? '');
  const group = useScopedId('product-colour');
  const color = colors.find((option) => option.id === selected);
  const variant = product.variants.find((option) => option.id === size);
  if (!color) return null;
  const option = variant ? mattressOption(product, variant) : null;
  const stock = colorStock(product, color, variant?.stockStatus);
  const unavailable = stock === 'OUT_OF_STOCK';
  const message = `Hello, I would like to ${unavailable ? 'ask about restocking' : 'enquire about'} ${product.name} (SKU: ${product.sku}).\nSelected colour: ${color.name}.\n${variant ? `Selected option: ${variant.label}${variant.sku ? ` (SKU: ${variant.sku})` : ''}.\n` : ''}Availability shown: ${stockLabel(stock)}.\nPlease confirm the selected colour${variant ? ' and size' : ''}, price and availability.\n${productUrl}`;
  const price = option ? option.price : product.priceOnEnquiry ? null : product.price;
  return (
    <div className="ngf-color-options min-w-0">
      <fieldset>
        <legend className="mb-3 text-body font-medium">Choose a colour</legend>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {colors.map((entry) => (
            <label
              key={entry.id}
              className="flex min-h-[56px] min-w-0 cursor-pointer items-center gap-3 border border-taupe p-3 text-small has-checked:border-espresso has-checked:bg-cream"
            >
              <input
                type="radio"
                name={group}
                value={entry.id}
                checked={selected === entry.id}
                onChange={() => setSelected(entry.id)}
              />
              {entry.hex && (
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 28 28"
                  className="shrink-0"
                  aria-hidden="true"
                >
                  <circle
                    cx="14"
                    cy="14"
                    r="12"
                    fill={entry.hex}
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
              )}
              <span className="min-w-0 break-words">
                <strong>{entry.name}</strong>
                <span className="block text-small">
                  {stockLabel(colorStock(product, entry, variant?.stockStatus))}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {product.variants.length > 0 && (
        <label className="mt-4 flex min-w-0 flex-col gap-2 text-small">
          Size or configuration
          <select
            className="min-h-[44px] w-full min-w-0 border border-taupe bg-white p-3"
            value={size}
            onChange={(event) => setSize(event.target.value)}
          >
            {product.variants.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="mt-3 text-small text-walnut">
        Swatches are approximate. Confirm the fabric shade with our team.
      </p>
      <output className="mt-3 block text-body" aria-live="polite">
        <strong>{color.name}</strong>
        {variant ? ` · ${variant.label}` : ''} · {stockLabel(stock)} ·{' '}
        {price === null ? 'Price on enquiry' : formatINR(price)}
      </output>
      {unavailable && (
        <p className="mt-2 text-small">
          This selection is out of stock. Choose another colour or ask when it may be available.
        </p>
      )}
      {number && (
        <a
          className="mt-4 inline-flex min-h-[44px] items-center justify-center bg-espresso px-4 py-3 text-center text-small text-ivory"
          href={buildWhatsAppUrl(number, message)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {unavailable ? 'Ask about restocking' : 'Enquire about this colour'} ↗
        </a>
      )}
      <noscript>
        <p>
          Mention your preferred colour and size when you contact us. Enable JavaScript to change
          the selection here.
        </p>
      </noscript>
    </div>
  );
}
