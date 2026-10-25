import sharp from 'sharp';
import { createHash } from 'node:crypto';
import {
  UploadJob,
  quarantineKey,
  uploadJobKey,
  UPLOAD_JOB_POINTER,
  UPLOAD_JOB_PREFIX,
  type UploadJobValue,
} from '../src/lib/images/upload-jobs';
import { DERIVATIVE_WIDTHS } from '../src/lib/images/srcset';
type Api = (path: string, init?: RequestInit) => Promise<Response>;
type ReadKey = (key: string) => Promise<unknown>;
type WriteKey = (key: string, value: unknown) => Promise<void>;

/** Full decode, EXIF removal and derivatives run on the trusted company processor, never the edge. */
export async function prepareUploadedPhoto(
  job: UploadJobValue,
  bytes: Buffer,
  put: (key: string, bytes: Buffer, mime: string) => Promise<void>,
): Promise<UploadJobValue> {
  if (
    job.sourceKey !== quarantineKey(job.productId, job.imageId) ||
    bytes.length > 12 * 1024 * 1024
  )
    throw new Error('Invalid private upload reference.');
  const options = { limitInputPixels: 40_000_000, failOn: 'error' as const };
  const metadata = await sharp(bytes, options).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 256 ||
    metadata.height < 64 ||
    !['jpeg', 'png', 'webp', 'heif'].includes(metadata.format ?? '') ||
    (metadata.format === 'heif' && metadata.compression !== 'av1') ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error(
      'This photo cannot be decoded safely. Re-export it as JPEG, PNG, WebP or AVIF.',
    );
  const original = await sharp(bytes, options)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
  if (original.length > 12 * 1024 * 1024)
    throw new Error('The prepared photo exceeds 12 MB. Export a smaller photo.');
  const decoded = await sharp(original, options).metadata();
  const width = decoded.width;
  const height = decoded.height;
  const key = `products/${job.productId}/${job.imageId}/original.jpg`;
  await put(key, original, 'image/jpeg');
  const widths = DERIVATIVE_WIDTHS.filter((value) => value <= width);
  if (!widths.length) widths.push(width);
  for (const size of widths)
    await put(
      `products/${job.productId}/${job.imageId}/${size}.webp`,
      await sharp(original)
        .resize({ width: size, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer(),
      'image/webp',
    );
  const fallback = widths.filter((value) => value <= 1280).at(-1)!;
  await put(
    `products/${job.productId}/${job.imageId}/${fallback}.jpeg`,
    await sharp(original)
      .resize({ width: fallback, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer(),
    'image/jpeg',
  );
  const lqip = await sharp(original).resize({ width: 24 }).webp({ quality: 65 }).toBuffer();
  return {
    ...job,
    state: 'ready',
    updatedAt: Date.now(),
    sha256: createHash('sha256').update(original).digest('hex'),
    result: {
      id: job.imageId,
      key,
      alt: '',
      altSource: 'admin',
      width,
      height,
      mime: 'image/jpeg',
      filename: job.filename,
      order: 0,
      derivativesReady: true,
      derivativeWidths: widths,
      derivativeFormats: ['webp', 'jpeg'],
      lqip: `data:image/webp;base64,${lqip.toString('base64')}`,
    },
  };
}

export async function processUploadQueue(
  api: Api,
  readKey: ReadKey,
  writeKey: WriteKey,
  put: (key: string, bytes: Buffer, mime: string) => Promise<void>,
  sweep = false,
): Promise<void> {
  const pointer = await readKey(UPLOAD_JOB_POINTER);
  const keys = new Set<string>(
    Array.isArray(pointer)
      ? pointer.filter(
          (value): value is string =>
            typeof value === 'string' && value.startsWith(UPLOAD_JOB_PREFIX),
        )
      : [],
  );
  if (sweep) {
    let cursor = '';
    do {
      const response = await api(
        `/storage/kv/namespaces/abe3026fdaa049d3b7a8a1973405c897/keys?prefix=${encodeURIComponent(UPLOAD_JOB_PREFIX)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (!response.ok) throw new Error('Could not inspect private upload queue.');
      const page = (await response.json()) as {
        result: { name: string }[];
        result_info?: { cursor?: string };
      };
      for (const key of page.result) keys.add(key.name);
      cursor = page.result_info?.cursor ?? '';
    } while (cursor);
  }
  for (const key of keys) {
    const parsed = UploadJob.safeParse(await readKey(key));
    if (!parsed.success) continue;
    const job = parsed.data;
    if (
      uploadJobKey(job.productId, job.imageId) !== key ||
      job.sourceKey !== quarantineKey(job.productId, job.imageId)
    )
      continue;
    if (
      job.state !== 'queued' &&
      !(job.state === 'processing' && Date.now() - job.updatedAt > 10 * 60_000)
    )
      continue;
    await writeKey(key, { ...job, state: 'processing', updatedAt: Date.now() });
    try {
      const response = await api(`/r2/buckets/ngf-media/objects/${job.sourceKey}`);
      if (!response.ok) throw new Error('The private upload could not be read.');
      const ready = await prepareUploadedPhoto(job, Buffer.from(await response.arrayBuffer()), put);
      await writeKey(key, ready);
      console.log('Uploaded photo validated and prepared. Admin can now attach it.');
    } catch {
      await writeKey(key, { ...job, state: 'failed', updatedAt: Date.now() });
      console.error(
        'A private photo could not be prepared. Original retained; re-export it and upload again.',
      );
    }
  }
}
