import { useRef, useState, type ReactElement } from 'react';
import type { Product, ProductImageValue, StockStatusValue } from '@/schemas/product';
import { colorOptionsOf, imagesForColor, type ColorOption } from '@/lib/products/colors';
import { stockLabel } from '@/lib/products/labels';
import { adminFetch } from '@/lib/admin/client';
import { derivativeUrl } from '@/lib/images/srcset';
import type { ProductRevision } from '@/lib/products/revision';

export default function ColorEditor({
  product,
  disabled,
  onChange,
  canUpload = false,
  onBusyChange,
  onPhotos,
}: {
  product: Product;
  disabled: boolean;
  onChange: (colors: ColorOption[]) => void;
  canUpload?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onPhotos?: (colorId: string, images: ProductImageValue[], revision?: ProductRevision) => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const working = useRef(false);
  const options = colorOptionsOf(product);
  const update = (index: number, patch: Partial<ColorOption>): void =>
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));
  async function upload(color: ColorOption, files: FileList | null): Promise<void> {
    if (!files?.length || working.current || disabled || !canUpload) return;
    working.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setMessage(`Uploading photographs for ${color.name}…`);
    try {
      const form = new FormData();
      for (const file of files) form.append('file', file);
      form.append('colorName', color.name.trim());
      const result = await adminFetch<{
        images: ProductImageValue[];
        rejected: { filename: string; message: string }[];
      }>(`/api/admin/products/${product.id}/images`, { method: 'POST', formData: form });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      if (result.value.images.length) onPhotos?.(color.id, result.value.images, result.revision);
      setMessage(
        `${result.value.images.length} photograph(s) added for ${color.name}. ${result.value.rejected.map((entry) => `${entry.filename}: ${entry.message}`).join(' ')} Photos below 4K enter the existing enhancement queue. Save your colour choices, then review the enhanced copies in Images.`,
      );
    } finally {
      working.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-small text-walnut">
        Add only colours you offer. Set each colour’s availability separately. A product marked out
        of stock remains unavailable in every colour. Swatches are approximate; customers should
        confirm the fabric shade.
      </p>
      <p className="text-small font-medium">
        1. Name the colour. 2. Upload its real product photos or choose them below. 3. Save.
        Customers will see only that colour’s photos when they select it.
      </p>
      <p role="status" aria-live="polite" className="text-small">
        {message}
      </p>
      {options.length === 0 && (
        <p>No colour choices added. Customers can still enquire about this product normally.</p>
      )}
      {options.map((option, index) => (
        <fieldset
          key={option.id}
          className="min-w-0 border border-taupe bg-white p-4"
          disabled={disabled || busy}
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
          <div className="mt-4 border-t border-taupe pt-4">
            <p className="text-small font-medium">
              Photographs of this colour — required before publishing
            </p>
            <p className="mt-1 text-small text-walnut">
              Use actual photos of the {option.name || 'named colour'} product. Selecting a swatch
              never recolours an image.
            </p>
            {canUpload ? (
              <label className="mt-3 flex flex-col gap-2 text-small">
                Upload photos for {option.name || `colour ${index + 1}`}
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  disabled={disabled || busy || !option.name.trim()}
                  onChange={(event) => {
                    void upload(option, event.target.files);
                    event.target.value = '';
                  }}
                  className="min-h-[44px] w-full min-w-0 border border-taupe p-2"
                />
              </label>
            ) : (
              <p className="mt-2 text-small">
                Create the draft first, then upload this colour’s photos here.
              </p>
            )}
            <p className="mt-2 text-small">
              {imagesForColor(product.images, option).length} photo(s) selected. The first selected
              photo appears first.
            </p>
            {product.images.length > 0 && (
              <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                {product.images.map((image, imageIndex) => {
                  const selected = imagesForColor(product.images, option).some(
                    (entry) => entry.id === image.id,
                  );
                  const assignedElsewhere = options.some(
                    (entry) =>
                      entry.id !== option.id &&
                      imagesForColor(product.images, entry).some((photo) => photo.id === image.id),
                  );
                  return (
                    <label
                      key={image.id}
                      className="flex min-w-0 items-center gap-2 border border-taupe p-2 text-small"
                    >
                      <input
                        type="checkbox"
                        aria-label={`Use photo ${imageIndex + 1} for ${option.name || `colour ${index + 1}`}`}
                        checked={selected}
                        disabled={disabled || busy || assignedElsewhere}
                        onChange={(event) =>
                          update(index, {
                            imageIds: event.target.checked
                              ? [...(option.imageIds ?? []), image.id]
                              : (option.imageIds ?? []).filter(
                                  (id) => id !== image.id && id !== image.enhancedFrom?.id,
                                ),
                          })
                        }
                      />
                      <img
                        src={derivativeUrl(product.id, image.id, 320, 'webp')}
                        width="72"
                        height="56"
                        alt={image.alt || `Product photo ${imageIndex + 1}`}
                        className="h-14 w-18 shrink-0 object-contain"
                        loading="lazy"
                      />
                      <span className="min-w-0 break-words">
                        Photo {imageIndex + 1}
                        {assignedElsewhere ? ' · used by another colour' : ''}
                        {image.enhancedFrom ? ' · 4K enhanced' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
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
        disabled={disabled || busy || options.length >= 20}
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
