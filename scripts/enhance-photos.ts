/** Local-only AI photo preparation. No credentials, cloud writes or automatic publication. */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LOCAL_ROOT = join(ROOT, '.wrangler/image-enhancer');
const ENGINE = join(LOCAL_ROOT, 'engine/realesrgan-ncnn-vulkan.exe');
const MODEL = 'realesrgan-x4plus';
export const TARGET_EDGE = 3840;
const MAX_PIXELS = 40_000_000;
const MAX_FILE_BYTES = 12_582_912;
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
let stopping = false;

/** Preserve aspect ratio: 4K long edge, never stretch a photo into a 16:9 frame. */
export function targetDimensions(width: number, height: number): { width: number; height: number } {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Invalid photo dimensions.');
  }
  const scale = TARGET_EDGE / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

async function runEngine(input: string, output: string): Promise<void> {
  await access(ENGINE);
  console.log('  AI enhancement running on this computer…');
  await new Promise<void>((resolveJob, reject) => {
    const child = spawn(
      ENGINE,
      [
        '-i',
        input,
        '-o',
        output,
        '-m',
        join(LOCAL_ROOT, 'engine/models'),
        '-n',
        MODEL,
        '-s',
        '4',
        '-t',
        '128',
        '-j',
        '1:1:1',
        '-f',
        'png',
      ],
      {
        cwd: join(LOCAL_ROOT, 'engine'),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: false,
      },
    );
    let lastProgress = -1;
    let diagnostics = '';
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      diagnostics = (diagnostics + text).slice(-2000);
      for (const match of text.matchAll(/(\d+(?:\.\d+)?)%/g)) {
        const progress = Math.floor(Number(match[1]) / 10) * 10;
        if (progress > lastProgress) {
          lastProgress = progress;
          console.log(`  Processing: ${String(progress)}%`);
        }
      }
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error('Enhancement exceeded 15 minutes. The original is safe; check the GPU driver.'),
      );
    }, 15 * 60_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      process.off('SIGINT', interrupt);
      clearTimeout(timer);
      if (code === 0) resolveJob();
      else
        reject(
          new Error(
            `AI enhancer exited with ${String(code)}. ${diagnostics.replace(/\s+/g, ' ').slice(-400)}`,
          ),
        );
    });
    const interrupt = (): void => {
      child.kill();
    };
    process.once('SIGINT', interrupt);
  });
}

interface PhotoRecord {
  source: string;
  sourceSha256: string;
  sourceDimensions: { width: number; height: number };
  outputDimensions: { width: number; height: number };
  outputBytes: number;
  model: string;
  aiPasses: number;
  seconds: number;
  createdAt: string;
  reviewRequired: true;
}

export async function enhancePhoto(input: string): Promise<string> {
  const started = Date.now();
  const source = resolve(input);
  if (!EXTENSIONS.has(extname(source).toLowerCase()))
    throw new Error('Choose a JPEG, PNG, WebP or AVIF photo.');
  const info = await stat(source);
  if (!info.isFile() || info.size > 50 * 1024 * 1024)
    throw new Error('Choose a photo smaller than 50 MB.');
  const sourceBytes = await readFile(source);
  const hash = createHash('sha256').update(sourceBytes).digest('hex');
  const key = `${hash.slice(0, 20)}-4k-v1`;
  const destination = join(LOCAL_ROOT, 'review', key);
  try {
    await access(join(destination, 'complete.json'));
    await access(join(destination, 'enhanced-4k.jpg'));
    console.log(`Already prepared: ${basename(source)}`);
    await writeReviewIndex();
    return destination;
  } catch {
    /* An unfinished job is retried in its own temporary directory. */
  }
  const work = join(LOCAL_ROOT, 'work', randomUUID());
  await mkdir(work, { recursive: true });
  await mkdir(destination, { recursive: true });
  // Preserve the exact input bytes. The normalized working copy strips location metadata.
  const originalName = `original${extname(source).toLowerCase()}`;
  await writeFile(join(destination, originalName), sourceBytes, { flag: 'wx' }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    },
  );
  let current = join(work, 'normalized.png');
  await sharp(sourceBytes, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .png()
    .toFile(current);
  const normalized = await sharp(current).metadata();
  const width = normalized.width;
  const height = normalized.height;
  if (width === undefined || height === undefined || Math.min(width, height) < 64)
    throw new Error(
      'This photo is too small to enhance reliably. Use a photo at least 64 pixels on each side.',
    );
  console.log(`Preparing ${basename(source)} (${String(width)} × ${String(height)})`);
  let edge = Math.max(width, height);
  let aiPasses = 0;
  // Large inputs are reduced only for the model; untouched originals stay in the review folder.
  // Tiny inputs may need two neural passes. No ordinary enlargement is labelled AI enhancement.
  while (edge < TARGET_EDGE && aiPasses < 3) {
    if (edge > 1920) {
      const bounded = join(work, `bounded-${String(aiPasses)}.png`);
      await sharp(current, { limitInputPixels: MAX_PIXELS * 4 })
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .png()
        .toFile(bounded);
      current = bounded;
    }
    const next = join(work, `ai-${String(aiPasses + 1)}.png`);
    const modelInput = await sharp(current, { limitInputPixels: MAX_PIXELS * 4 }).metadata();
    await runEngine(current, next);
    const actual = await sharp(next, { limitInputPixels: MAX_PIXELS * 4 }).metadata();
    if (actual.width === undefined || actual.height === undefined)
      throw new Error('The enhancer produced an unreadable photo.');
    if (
      actual.width !== (modelInput.width ?? 0) * 4 ||
      actual.height !== (modelInput.height ?? 0) * 4
    ) {
      throw new Error('The AI model did not produce the expected enlargement. Original preserved.');
    }
    edge = Math.max(actual.width, actual.height);
    current = next;
    aiPasses += 1;
  }
  const target = targetDimensions(width, height);
  let output: Buffer | undefined;
  for (const quality of [94, 90, 86]) {
    output = await sharp(current, { limitInputPixels: MAX_PIXELS * 4 })
      .resize(target.width, target.height, { fit: 'fill', kernel: 'lanczos3' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (output.length <= MAX_FILE_BYTES) break;
  }
  if (output === undefined || output.length > MAX_FILE_BYTES)
    throw new Error(
      'The enhanced file exceeds the website’s 12 MB upload limit. Original preserved.',
    );
  const outputStats = await sharp(output).stats();
  const sourceStats = await sharp(join(work, 'normalized.png')).stats();
  if (
    sourceStats.channels.some((channel) => channel.stdev > 5) &&
    outputStats.channels.every((channel) => channel.stdev < 1)
  ) {
    throw new Error(
      'The GPU produced an unexpectedly blank image. Original preserved; check the graphics driver.',
    );
  }
  await writeFile(join(destination, 'enhanced-4k.jpg'), output);
  await sharp(join(work, 'normalized.png'))
    .resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toFile(join(destination, 'before.jpg'));
  const record: PhotoRecord = {
    source: basename(source),
    sourceSha256: hash,
    sourceDimensions: { width, height },
    outputDimensions: target,
    outputBytes: output.length,
    model: aiPasses ? MODEL : 'Already high resolution; no AI applied',
    aiPasses,
    seconds: Math.round((Date.now() - started) / 1000),
    createdAt: new Date().toISOString(),
    reviewRequired: true,
  };
  await writeFile(join(destination, 'review.html'), reviewPage(record, originalName));
  // A completion marker is written last; partial jobs are never reported as ready.
  await writeFile(join(destination, 'complete.json'), JSON.stringify(record, null, 2));
  await writeReviewIndex();
  console.log(
    `Ready for review: ${join(destination, 'review.html')} (${String(record.seconds)} seconds)`,
  );
  return destination;
}

async function writeReviewIndex(): Promise<void> {
  const directory = join(LOCAL_ROOT, 'review');
  const cards: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^[a-f0-9]{20}-4k-v1$/.test(item.name)) continue;
    try {
      const record = JSON.parse(
        await readFile(join(directory, item.name, 'complete.json'), 'utf8'),
      ) as PhotoRecord;
      cards.push(
        `<article><a href="${item.name}/review.html"><img src="${item.name}/enhanced-4k.jpg" alt="Enhanced photo awaiting review" loading="lazy"><h2>${escapeHtml(record.source)}</h2></a><p>${String(record.outputDimensions.width)} × ${String(record.outputDimensions.height)} · Ready to review</p></article>`,
      );
    } catch {
      /* Incomplete jobs are deliberately excluded from the ready list. */
    }
  }
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New Galaxy Furniture · Photo review</title><style>body{background:#faf7f2;color:#302a24;font:16px/1.6 system-ui;margin:0}main{padding:24px;max-width:1200px;margin:auto}h1{font:36px Georgia}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:24px}article{padding:16px;background:white;border:1px solid #d8cbbd;border-radius:12px}img{width:100%;aspect-ratio:4/3;object-fit:contain}a{color:inherit}h2{font-size:16px;overflow-wrap:anywhere}</style><main><p>NEW GALAXY FURNITURE</p><h1>Your prepared photos</h1><p>Compare every photo with its original before uploading. Nothing here has been published.</p><section>${cards.join('')}</section></main></html>`,
  );
}

function reviewPage(record: PhotoRecord, originalName: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review enhanced photo</title><style>body{margin:0;background:#faf7f2;color:#302a24;font:16px/1.6 system-ui}main{max-width:1400px;margin:auto;padding:24px}h1{font:clamp(26px,4vw,40px) Georgia}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:24px}figure{margin:0}img{width:100%;height:auto;display:block;border-radius:12px}a{color:#754a26}p{max-width:75ch}.note{padding:16px;border:1px solid #b9a28a;border-radius:12px}button{font:inherit;padding:12px}</style><main><p>NEW GALAXY FURNITURE · PRIVATE LOCAL REVIEW</p><h1>${escapeHtml(record.source)}</h1><p class="note">AI-enhanced preview, not proof of recovered detail. Compare fabric, stitching, edges and colour with the original. Use the enhanced photo only if it still accurately represents your furniture. Nothing has been uploaded or published.</p><section><figure><a href="${escapeHtml(originalName)}"><img src="before.jpg" alt="Original photograph preview"></a><figcaption>Original: ${String(record.sourceDimensions.width)} × ${String(record.sourceDimensions.height)}. Click for the untouched file.</figcaption></figure><figure><a href="enhanced-4k.jpg"><img src="enhanced-4k.jpg" alt="AI-enhanced photograph for comparison"></a><figcaption>Prepared: ${String(record.outputDimensions.width)} × ${String(record.outputDimensions.height)} · ${String(record.aiPasses)} AI passes. Click to inspect full size.</figcaption></figure></section><p><a href="enhanced-4k.jpg" download>Save enhanced photo for admin upload</a> · <a href="${escapeHtml(originalName)}" download>Save original</a></p><p>Review at full size before uploading. Use the existing website admin photo uploader after approval. Original photos remain unchanged.</p></main></html>`;
}

async function inbox(watch: boolean): Promise<void> {
  const directory = join(LOCAL_ROOT, 'inbox');
  await mkdir(directory, { recursive: true });
  const seen = new Map<string, string>();
  console.log(`Put new photos here: ${directory}`);
  do {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (stopping) break;
      if (!file.isFile() || !EXTENSIONS.has(extname(file.name).toLowerCase())) continue;
      const path = join(directory, file.name);
      const before = await stat(path);
      const signature = `${String(before.size)}:${String(before.mtimeMs)}`;
      if (seen.get(path) === signature) continue;
      // Copying a large photo into the inbox must finish before the decoder opens it.
      if (watch) await new Promise((done) => setTimeout(done, 2000));
      const after = await stat(path);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) continue;
      seen.set(path, signature);
      try {
        await enhancePhoto(path);
      } catch (error) {
        console.error(
          `${file.name}: ${error instanceof Error ? error.message : 'Enhancement failed; original preserved.'}`,
        );
        if (!watch) process.exitCode = 1;
      }
    }
    if (watch) await new Promise((done) => setTimeout(done, 3000));
  } while (watch && !stopping);
}

async function prepareCatalogue(): Promise<void> {
  const directory = join(ROOT, 'data/products');
  const inboxDirectory = join(LOCAL_ROOT, 'inbox');
  await mkdir(inboxDirectory, { recursive: true });
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.json')) continue;
    const product = JSON.parse(await readFile(join(directory, file), 'utf8')) as {
      id: string;
      status: string;
      images: { id: string; mime: string }[];
    };
    if (product.status !== 'PUBLISHED' || !/^p_[a-z0-9]{10}$/.test(product.id)) continue;
    for (const image of product.images) {
      if (!/^img_[a-z0-9]{10}$/.test(image.id)) continue;
      const ext = (
        {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
          'image/avif': 'avif',
        } as Record<string, string>
      )[image.mime];
      if (!ext) continue;
      const path = join(inboxDirectory, `${product.id}-${image.id}.${ext}`);
      try {
        await access(path);
      } catch {
        const response = await fetch(
          `https://newgalaxyfurniture.in/img/${product.id}/${image.id}-original.${ext}`,
          { signal: AbortSignal.timeout(60_000), redirect: 'error' },
        );
        if (!response.ok)
          throw new Error(`Original photo download failed (${String(response.status)}).`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 50 * 1024 * 1024)
          throw new Error('Original photo download exceeded the local limit.');
        await writeFile(path, bytes, { flag: 'wx' });
      }
      await enhancePhoto(path);
    }
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command) {
    console.log(
      'Local photo enhancement: pass a photo path, --inbox, --watch, or --catalogue. See docs/PHOTO-ENHANCEMENT.md.',
    );
    return;
  }
  await mkdir(LOCAL_ROOT, { recursive: true });
  const lockPath = join(LOCAL_ROOT, 'process.lock');
  // A single local queue prevents two windows from competing for the GPU or writing one job.
  try {
    const owner = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(owner) || owner <= 0)
      throw new Error('The local process lock needs inspection.');
    let running = true;
    try {
      process.kill(owner, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') running = false;
      else throw error;
    }
    if (running)
      throw new Error(
        'The photo enhancer is already running. Use that window or close it before starting another.',
      );
    await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  const stop = (): void => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  try {
    if (command === '--watch') await inbox(true);
    else if (command === '--inbox') await inbox(false);
    else if (command === '--catalogue') await prepareCatalogue();
    else if (command && !command.startsWith('--')) await enhancePhoto(command);
    else
      console.log(
        'Local photo enhancement: pass a photo path, --inbox, --watch, or --catalogue. See docs/PHOTO-ENHANCEMENT.md.',
      );
  } finally {
    process.off('SIGINT', stop);
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Enhancement failed. Original photos are safe.',
    );
    process.exitCode = 1;
  });
}
