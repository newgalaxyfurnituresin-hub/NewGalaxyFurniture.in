import { useId, type ReactElement } from 'react';

/** A directly activated native picker also works with tablet photo-library providers. */
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
  const hint = useId();
  return (
    <div className="ngf-admin-photo-picker">
      <label className="text-small font-medium">
        {buttonLabel}
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif"
          aria-label={label}
          aria-describedby={hint}
          disabled={disabled}
          className="ngf-admin-photo-input"
          onClick={(event) => {
            // Reset before opening, never while the tablet is handing off selected files.
            // Choosing the same photo again must still fire change.
            event.currentTarget.value = '';
          }}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            if (!disabled && files.length) onFiles(files);
          }}
        />
      </label>
      <p id={hint} className="text-small text-walnut">
        Choose one or several photos from your device. JPEG, PNG, WebP or AVIF; up to 12 MB each.
        Photos are prepared securely online at their original resolution. For HEIC photos, export or
        share a JPEG copy first. Keep this page open until upload finishes.
      </p>
    </div>
  );
}
