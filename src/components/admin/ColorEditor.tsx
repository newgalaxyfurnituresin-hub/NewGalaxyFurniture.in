import { useRef, useState, type ReactElement } from 'react';
import type { Product, ProductImageValue, StockStatusValue } from '@/schemas/product';
import { colorOptionsOf, imagesForColor, type ColorOption } from '@/lib/products/colors';
import { stockLabel } from '@/lib/products/labels';
import { uploadPhotos } from '@/lib/admin/upload-photos';
import { derivativeUrl } from '@/lib/images/srcset';
import type { ProductRevision } from '@/lib/products/revision';
import PhotoUploadPicker from './PhotoUploadPicker';

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
  async function upload(color: ColorOption, files: File[]): Promise<void> {
    if (!files?.length || working.current || disabled || !canUpload) return;
    working.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setMessage(`Uploading photographs for ${color.name}…`);
    const list = [...files];
    try {
      const result = await uploadPhotos({
        productId: product.id,
        files: list,
        existingCount: product.images.length,
        colorName: color.name,
        onProgress: setMessage,
        onAccepted: (images, revision) => onPhotos?.(color.id, images, revision),
      });
      setMessage(
        `${result.added} of ${list.length} photograph(s) added for ${color.name}. ${result.pending ? `${result.pending} being prepared securely online. Prepared photos appear in Images automatically.` : ''} ${result.rejected.map((entry) => `${entry.filename}: ${entry.message}`).join(' ')} ${result.added ? 'Save your colour choices. Original resolution is preserved; photographs stay private until the product is published.' : ''}`,
      );
    } catch {
      setMessage(
        'Colour photo upload was interrupted. Your product details are still here. Check saved photos before retrying. If a gallery photo will not open, save a JPEG copy to Files on this device and select it again.',
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
      <p role="status" aria-live="polite" className="break-words text-small">
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
              <div className="mt-3">
                <PhotoUploadPicker
                  label={`Upload photos for ${option.name || `colour ${index + 1}`}`}
                  buttonLabel={`Choose photos for ${option.name || `colour ${index + 1}`}`}
                  disabled={disabled || busy || !option.name.trim()}
                  onFiles={(files) => upload(option, files)}
                />
                {!option.name.trim() && (
                  <p className="mt-2 text-small text-walnut">
                    Enter a colour name to add its photos.
                  </p>
                )}
              </div>
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
                        src={derivativeUrl(product.id, image.id, 320, 'webp').replace(
                          `/img/${product.id}/`,
                          `/api/admin/products/${product.id}/media/`,
                        )}
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
