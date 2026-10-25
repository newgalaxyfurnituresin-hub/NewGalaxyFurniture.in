/** Company-account queue consumer. Outbound API calls only; no public or local HTTP server. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { processUploadQueue } from './prepare-uploaded-photo';
import { z } from 'zod';
import { enhancePhoto, LOCAL_ROOT } from './enhance-photos';
import {
  EnhancementJob,
  ENHANCEMENT_PREFIX,
  ENHANCEMENT_POINTER,
  ENHANCEMENT_HEARTBEAT,
  ENHANCEMENT_TTL,
  enhancementKey,
  type EnhancementJobValue,
} from '../src/lib/images/enhancement';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ACCOUNT = '202e4307d4836b9170f546dbea1783d4';
const NAMESPACE = 'abe3026fdaa049d3b7a8a1973405c897';
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
const AUTH_ROOT = join(ROOT, '.wrangler/company-auth');
const AUTH_FILE = join(AUTH_ROOT, '.wrangler/config/default.toml');
let stopping = false;
let lastRefresh = 0;

async function token(): Promise<string> {
  if (Date.now() - lastRefresh > 15 * 60_000) {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: AUTH_ROOT };
    for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL'])
      delete env[key];
    const who = spawnSync(
      process.execPath,
      [
        join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
        'whoami',
        '--config',
        join(ROOT, 'wrangler.toml'),
      ],
      { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
    );
    if (who.status !== 0 || !who.stdout.includes(ACCOUNT))
      throw new Error(
        'Company Cloudflare sign-in is required. Ask for help reconnecting the company account; never paste credentials in chat.',
      );
    lastRefresh = Date.now();
  }
  const config = await readFile(AUTH_FILE, 'utf8');
  const value = /^oauth_token\s*=\s*"([^"\r\n]+)"/m.exec(config)?.[1];
  if (!value) throw new Error('Company Cloudflare authentication is unavailable.');
  return value;
}

/** Cloudflare may report an expired OAuth session as either 401 or 403. Refresh once. */
export async function requestWithSession(
  url: string,
  init: RequestInit,
  readToken: (refresh: boolean) => Promise<string>,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await readToken(attempt > 0)}`);
    const response = await fetcher(url, {
      ...init,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
    });
    if (response.status !== 401 && response.status !== 403) return response;
    await response.body?.cancel();
  }
  throw new Error('Company Cloudflare permission is unavailable. Reconnect the company account.');
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return await requestWithSession(BASE + path, init, async (refresh) => {
    if (refresh) lastRefresh = 0;
    return await token();
  });
}

const kvPath = (key: string): string =>
  `/storage/kv/namespaces/${NAMESPACE}/values/${encodeURIComponent(key)}`;
async function readKey(key: string): Promise<unknown> {
  const response = await api(kvPath(key));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not read photo queue (${String(response.status)}).`);
  return await response.json();
}
async function writeKey(key: string, value: unknown): Promise<void> {
  const response = await api(`${kvPath(key)}?expiration_ttl=${String(ENHANCEMENT_TTL)}`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Could not update photo queue (${String(response.status)}).`);
}
const objectPath = (key: string): string => `/r2/buckets/ngf-media/objects/${key}`;
async function upload(key: string, bytes: Buffer, mime: string): Promise<void> {
  const response = await api(objectPath(key), {
    method: 'PUT',
    headers: {
      'content-type': mime,
      'cache-control': 'public, max-age=31536000, immutable',
      'cf-r2-data-catalog-check': 'true',
    },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) throw new Error(`Could not save prepared photo (${String(response.status)}).`);
}

export function validSource(job: EnhancementJobValue): boolean {
  return new RegExp(
    `^products/${job.productId}/${job.imageId}/original\\.(jpg|png|webp|avif)$`,
  ).test(job.sourceKey);
}

async function processJob(job: EnhancementJobValue): Promise<void> {
  if (!validSource(job)) throw new Error('The queued image reference is invalid.');
  const key = enhancementKey(job.productId, job.imageId);
  const directory = join(LOCAL_ROOT, 'admin-jobs', `${job.productId}-${job.imageId}`);
  await mkdir(directory, { recursive: true });
  const next: EnhancementJobValue = { ...job, state: 'processing', updatedAt: Date.now() };
  await writeKey(key, next);
  console.log('Preparing an admin-uploaded photo. The website original stays intact.');
  try {
    const source = await api(objectPath(job.sourceKey));
    if (!source.ok) throw new Error('The original upload is no longer available.');
    const bytes = Buffer.from(await source.arrayBuffer());
    if (bytes.length > 12_582_912) throw new Error('The source exceeds the website upload limit.');
    const ext = job.sourceKey.split('.').at(-1) ?? 'jpg';
    const input = join(directory, `original.${ext}`);
    try {
      await access(input);
    } catch {
      await writeFile(input, bytes, { flag: 'wx' });
    }
    if (
      createHash('sha256')
        .update(await readFile(input))
        .digest('hex') !== createHash('sha256').update(bytes).digest('hex')
    )
      throw new Error('The source changed. Original copies were preserved for inspection.');
    const prepared = await enhancePhoto(input);
    const output = await readFile(join(prepared, 'enhanced-4k.jpg'));
    const metadata = await sharp(output).metadata();
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) !== 3840)
      throw new Error('The enhancer did not produce a 4K photo.');
    // Reuse a stable output id on retries, without ever overwriting the source image.
    const statePath = join(directory, 'output-id.txt');
    let outputId: string;
    try {
      outputId = (await readFile(statePath, 'utf8')).trim();
    } catch {
      outputId = `img_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
      await writeFile(statePath, outputId, { flag: 'wx' });
    }
    if (!/^img_[a-z0-9]{10}$/.test(outputId) || outputId === job.imageId)
      throw new Error('The prepared image reference is invalid.');
    const prefix = `products/${job.productId}/${outputId}`;
    await upload(`${prefix}/original.jpg`, output, 'image/jpeg');
    const widths = [320, 480, 640, 960, 1280, 1600, 2000, 3840].filter(
      (width) => width <= metadata.width,
    );
    for (const width of widths) {
      const webp = await sharp(output)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 })
        .toBuffer();
      await upload(`${prefix}/${String(width)}.webp`, webp, 'image/webp');
    }
    const fallbackWidth = widths.includes(1280) ? 1280 : widths.at(-1)!;
    const jpeg = await sharp(output)
      .resize({ width: fallbackWidth, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    await upload(`${prefix}/${String(fallbackWidth)}.jpeg`, jpeg, 'image/jpeg');
    const lqip = await sharp(output).resize({ width: 24 }).webp({ quality: 65 }).toBuffer();
    const ready: EnhancementJobValue = {
      ...next,
      state: 'ready',
      updatedAt: Date.now(),
      result: {
        imageId: outputId,
        width: metadata.width,
        height: metadata.height,
        sha256: createHash('sha256').update(output).digest('hex'),
        derivativeWidths: widths,
        lqip: `data:image/webp;base64,${lqip.toString('base64')}`,
      },
    };
    await writeKey(key, ready);
    await writeFile(join(directory, 'ready.json'), JSON.stringify(ready, null, 2));
    console.log('4K photo ready. Review and apply it in the website admin.');
  } catch (error) {
    await writeKey(key, {
      ...next,
      state: 'failed',
      updatedAt: Date.now(),
      message:
        'Enhancement could not finish. The original is safe. Restart the computer tool and retry in admin.',
    });
    throw error;
  }
}

async function listedKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '';
  do {
    const response = await api(
      `/storage/kv/namespaces/${NAMESPACE}/keys?prefix=${encodeURIComponent(ENHANCEMENT_PREFIX)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    if (!response.ok) throw new Error('Could not inspect queued photos.');
    const page = z
      .object({
        result: z.array(z.object({ name: z.string() })),
        result_info: z.object({ cursor: z.string().optional() }).optional(),
      })
      .parse(await response.json());
    keys.push(...page.result.map((entry) => entry.name));
    cursor = page.result_info?.cursor ?? '';
  } while (cursor && !stopping);
  return keys;
}

async function main(): Promise<void> {
  if (process.argv[2] === '--help') {
    console.log(
      'Run without arguments to watch company admin uploads, or --once for one queue sweep.',
    );
    return;
  }
  const config = await readFile(join(ROOT, 'wrangler.toml'), 'utf8');
  if (!config.includes(`account_id = "${ACCOUNT}"`))
    throw new Error('The project is not configured for the verified company account.');
  await token();
  await mkdir(LOCAL_ROOT, { recursive: true });
  const stopPath = join(LOCAL_ROOT, 'stop-admin.request');
  const lockPath = join(LOCAL_ROOT, 'process.lock');
  try {
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('The enhancer lock needs inspection.');
    let running = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') running = false;
      else throw error;
    }
    if (running)
      throw new Error(
        'Another photo enhancer window is already running. Close it before starting this one.',
      );
    await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid));
  try {
    await unlink(stopPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stop = (): void => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  let lastList = 0;
  let lastHeartbeat = 0;
  const finished = new Set<string>();
  console.log(
    'Watching company admin uploads. Keep this computer on and this window open. Ctrl+C stops after the current photo.',
  );
  try {
    do {
      let retryDelay = 10;
      try {
        if (Date.now() - lastHeartbeat > 5 * 60_000) {
          await writeKey(ENHANCEMENT_HEARTBEAT, { lastSeen: Date.now() });
          lastHeartbeat = Date.now();
        }
        const latest = z.array(z.string()).safeParse(await readKey(ENHANCEMENT_POINTER));
        const keys = new Set(latest.success ? latest.data : []);
        await processUploadQueue(
          api,
          readKey,
          writeKey,
          upload,
          Date.now() - lastList > 5 * 60_000,
        );
        if (Date.now() - lastList > 5 * 60_000) {
          for (const key of await listedKeys()) keys.add(key);
          lastList = Date.now();
        }
        for (const key of keys) {
          if (stopping || finished.has(key) || !key.startsWith(ENHANCEMENT_PREFIX)) continue;
          const parsed = EnhancementJob.safeParse(await readKey(key));
          if (!parsed.success || enhancementKey(parsed.data.productId, parsed.data.imageId) !== key)
            continue;
          const job = parsed.data;
          if (
            job.state === 'queued' ||
            (job.state === 'processing' && Date.now() - job.updatedAt > 20 * 60_000)
          ) {
            try {
              await processJob(job);
              finished.add(key);
            } catch (error) {
              console.error(
                error instanceof Error ? error.message : 'Enhancement failed; original preserved.',
              );
            }
          } else if (['ready', 'applied'].includes(job.state)) finished.add(key);
        }
      } catch (error) {
        if (process.argv[2] === '--once') throw error;
        console.error(
          error instanceof Error ? error.message : 'Photo queue connection interrupted.',
        );
        console.error('The processor will reconnect in one minute. Original photos are safe.');
        retryDelay = 60;
      }
      if (process.argv[2] === '--once') break;
      for (let second = 0; second < retryDelay && !stopping; second++) {
        try {
          await access(stopPath);
          stopping = true;
        } catch {
          /* No stop requested. */
        }
        if (!stopping) await new Promise((done) => setTimeout(done, 1000));
      }
    } while (!stopping);
  } finally {
    process.off('SIGINT', stop);
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Admin photo enhancer stopped.');
    process.exitCode = 1;
  });
}
