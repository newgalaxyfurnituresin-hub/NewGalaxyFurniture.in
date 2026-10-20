import type { ReactElement } from 'react';
import type { Product, StockStatusValue } from '@/schemas/product';
import { colorOptionsOf, type ColorOption } from '@/lib/products/colors';
import { stockLabel } from '@/lib/products/labels';

export default function ColorEditor({
  product,
  disabled,
  onChange,
}: {
  product: Product;
  disabled: boolean;
  onChange: (colors: ColorOption[]) => void;
}): ReactElement {
  const options = colorOptionsOf(product);
  const update = (index: number, patch: Partial<ColorOption>): void =>
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-small text-walnut">
        Add only colours you offer. Set each colour’s availability separately. A product marked out
        of stock remains unavailable in every colour. Swatches are approximate; customers should
        confirm the fabric shade.
      </p>
      {options.length === 0 && (
        <p>No colour choices added. Customers can still enquire about this product normally.</p>
      )}
      {options.map((option, index) => (
        <fieldset
          key={option.id}
          className="min-w-0 border border-taupe bg-white p-4"
          disabled={disabled}
        >
          <legend className="px-2 text-small font-medium">Colour {index + 1}</legend>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-small">
              Colour name
              <input
                className="min-h-[44px] min-w-0 border border-taupe px-3 py-2"
                maxLength={60}
                value={option.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="For example, Walnut brown"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-small">
              Availability for this colour
              <select
                aria-label="Availability for this colour"
                className="min-h-[44px] min-w-0 border border-taupe px-3 py-2"
                value={option.stockStatus}
                onChange={(event) =>
                  update(index, { stockStatus: event.target.value as StockStatusValue })
                }
              >
                {(['IN_STOCK', 'LIMITED_STOCK', 'OUT_OF_STOCK', 'MADE_TO_ORDER'] as const).map(
                  (status) => (
                    <option key={status} value={status}>
                      {stockLabel(status)}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <label className="mt-3 flex flex-wrap items-center gap-3 text-small">
            <input
              type="checkbox"
              checked={option.hex !== undefined}
              onChange={(event) =>
                update(index, { hex: event.target.checked ? '#8B5E3C' : undefined })
              }
            />
            Show an approximate colour swatch (optional)
          </label>
          {option.hex !== undefined && (
            <label className="mt-3 flex min-h-[44px] flex-wrap items-center gap-3 text-small">
              Swatch for {option.name || `colour ${index + 1}`}
              <input
                type="color"
                className="h-11 w-16 cursor-pointer border border-taupe"
                value={option.hex}
                onChange={(event) => update(index, { hex: event.target.value })}
              />
              <span>{option.hex.toUpperCase()}</span>
            </label>
          )}
          <button
            className="mt-3 min-h-[44px] border border-espresso px-4 py-2 text-small"
            type="button"
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            Remove colour {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={disabled || options.length >= 20}
        className="min-h-[44px] self-start border border-espresso px-4 py-2 disabled:opacity-50"
        onClick={() =>
          onChange([
            ...options,
            {
              id: `col_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
              name: '',
              stockStatus: 'IN_STOCK',
            },
          ])
        }
      >
        Add colour
      </button>
      <p className="text-small text-walnut">
        Up to 20 colours. Save your changes to update availability on the website. Size options have
        their own availability; no size-by-colour inventory is assumed.
      </p>
    </div>
  );
}
