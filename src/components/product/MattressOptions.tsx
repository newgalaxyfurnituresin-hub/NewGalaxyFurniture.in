import { useState } from 'react';
import { useScopedId } from '@/lib/ui/ids';
import { formatINR } from '@/lib/money';
import { stockLabel } from '@/lib/products/labels';
import { mattressOption } from '@/lib/products/mattress-options';
import { buildWhatsAppUrl } from '@/lib/whatsapp';
import type { Product } from '@/schemas/product';

type MattressChoice = Pick<
  Product,
  'name' | 'sku' | 'price' | 'priceOnEnquiry' | 'stockStatus' | 'variants'
>;
export default function MattressOptions({
  product,
  number,
  productUrl,
}: {
  product: MattressChoice;
  number: string;
  productUrl: string;
}): React.JSX.Element | null {
  const [selected, setSelected] = useState(product.variants[0]?.id ?? '');
  const id = useScopedId('mattress-size');
  const variant = product.variants.find((entry) => entry.id === selected);
  if (!variant) return null;
  const option = mattressOption(product, variant);
  const href = buildWhatsAppUrl(
    number,
    `Hello, I would like to enquire about ${product.name} (SKU: ${product.sku}).\nSelected option: ${option.label}${option.sku ? ` (SKU: ${option.sku})` : ''}.\nPlease confirm the price and availability of this option.\n${productUrl}`,
  );
  return (
    <div className="ngf-mattress-options">
      <fieldset>
        <legend>Choose an option to enquire about</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {product.variants.map((entry) => (
            <label className="ngf-mattress-option" key={entry.id}>
              <input
                type="radio"
                name={id}
                value={entry.id}
                checked={selected === entry.id}
                onChange={() => setSelected(entry.id)}
              />
              <span>{entry.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <output aria-live="polite">
        <strong>{option.label}</strong> ·{' '}
        {option.price === null ? 'Price on enquiry' : formatINR(option.price)} ·{' '}
        {stockLabel(option.stockStatus)}
      </output>
      <a className="ngf-exp-button" href={href} target="_blank" rel="noopener">
        Enquire about {option.label}
        <span aria-hidden="true">↗</span>
      </a>
      <p className="text-small text-walnut">
        This starts an enquiry, not an order. Confirm the selected size, price and availability with
        the team.
      </p>
      <noscript>
        Enable JavaScript to change the selected option, or mention your preferred size in your
        enquiry.
      </noscript>
    </div>
  );
}
