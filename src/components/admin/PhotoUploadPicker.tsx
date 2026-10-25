import { useId, useRef, type ReactElement } from 'react';

/** The same native multi-photo picker for general and colour-specific uploads. */
export default function PhotoUploadPicker({
  label,
  buttonLabel = 'Choose files',
  disabled,
  onFiles,
}: {
  label: string;
  buttonLabel?: string;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  return (
    <div className="ngf-admin-photo-picker">
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif"
        aria-label={label}
        aria-describedby={hint}
        disabled={disabled}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (!disabled && files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-describedby={hint}
        className="ngf-admin-photo-choose"
      >
        {buttonLabel}
      </button>
      <p id={hint} className="text-small text-walnut">
        Choose one or several photos from your device. JPEG, PNG, WebP or AVIF; up to 12 MB each.
        Photos are prepared securely online at their original resolution.
      </p>
    </div>
  );
}
