import { useId, useRef, useState, type ReactElement } from 'react';

/** Keep native tablet selections intact until the operator explicitly starts the upload. */
export default function PhotoUploadPicker({
  label,
  buttonLabel = 'Choose files',
  disabled,
  onFiles,
}: {
  label: string;
  buttonLabel?: string;
  disabled: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
}): ReactElement {
  const hint = useId();
  const input = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [selected, setSelected] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const select = (element: HTMLInputElement): void => {
    const files = Array.from(element.files ?? []);
    setSelected(files);
    setMessage(
      files.length
        ? `${files.length} photo(s) selected. Tap Upload selected photos to add them.`
        : 'No photos selected. Choose photos from Files on your device.',
    );
  };
  const upload = async (): Promise<void> => {
    if (disabled || sending.current) return;
    // Read the native control again: some Android document providers omit the change event.
    const files = Array.from(input.current?.files ?? []);
    const photos = files.length ? files : selected;
    if (!photos.length) {
      setMessage(
        'No photos were received from the selector. Choose files again and use Files or Downloads on your device.',
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    setMessage(`${photos.length} photo(s) selected. Uploading; keep this page open.`);
    try {
      await onFiles(photos);
      // Clear only once the upload handler has finished reading the files.
      if (input.current) input.current.value = '';
      setSelected([]);
      setMessage(
        'Selection processed. Check the upload results below before selecting these photos again.',
      );
    } catch {
      setMessage(
        'The photos could not be uploaded. Your selection is still here. Check saved photos before retrying.',
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="ngf-admin-photo-picker">
      <label className="text-small font-medium">
        1. {buttonLabel}
        <input
          ref={input}
          type="file"
          // Use the general document picker. An image-only accept filter can route Android
          // through its Photos provider instead. File types are verified from bytes on the server.
          multiple
          aria-label={label}
          aria-describedby={hint}
          disabled={disabled || busy}
          className="ngf-admin-photo-input"
          onInput={(event) => select(event.currentTarget)}
          onChange={(event) => select(event.currentTarget)}
        />
      </label>
      {selected.length > 0 && (
        <ul className="text-left text-small break-words" aria-label="Selected photo filenames">
          {selected.map((file, index) => (
            <li key={index}>{file.name}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="ngf-admin-photo-choose"
        disabled={disabled || busy}
        onClick={() => void upload()}
      >
        {busy ? 'Uploading photos…' : '2. Upload selected photos'}
      </button>
      <p role="status" aria-live="polite" className="text-small break-words">
        {message}
      </p>
      <p id={hint} className="text-small text-walnut">
        Choose photos, then tap Upload selected photos. JPEG, PNG, WebP or AVIF; up to 12 MB each.
        On tablets, choose Files or Downloads, then select your JPGs. If your photos are only in a
        photo app, save a copy to this device first. The file browser shows all file types; only
        supported images are accepted. Photos are prepared securely online at their original
        resolution. For HEIC photos, export a JPEG copy first.
      </p>
    </div>
  );
}
