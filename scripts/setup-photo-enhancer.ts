/** Install a pinned official release locally, without changing Windows execution policy. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_ROOT } from './enhance-photos';

const URL =
  'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip';
const SHA256 = 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d';

async function setup(): Promise<void> {
  if (process.platform !== 'win32')
    throw new Error('This installer is for the Windows local photo tool.');
  await mkdir(LOCAL_ROOT, { recursive: true });
  const archive = join(LOCAL_ROOT, 'realesrgan-20220424-windows.zip');
  try {
    await access(archive);
  } catch {
    console.log('Downloading the official free Real-ESRGAN Windows release…');
    const response = await fetch(URL, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Download failed (${String(response.status)}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== SHA256)
      throw new Error('Download integrity check failed; nothing was executed.');
    await writeFile(archive, bytes, { flag: 'wx' });
  }
  if (
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') !== SHA256
  )
    throw new Error(
      'Archive integrity check failed; nothing was executed. Keep it for inspection.',
    );
  const engine = join(LOCAL_ROOT, 'engine');
  try {
    await access(engine);
  } catch {
    const stage = join(LOCAL_ROOT, `install-${randomUUID()}`);
    await mkdir(stage);
    const extraction = spawnSync('tar.exe', ['-xf', archive, '-C', stage], {
      windowsHide: true,
      stdio: 'inherit',
      shell: false,
    });
    if (extraction.error || extraction.status !== 0)
      throw new Error(
        'Could not extract the archive with Windows tar. No system settings were changed.',
      );
    await rename(stage, engine);
  }
  await access(join(engine, 'realesrgan-ncnn-vulkan.exe'));
  await access(join(engine, 'models/realesrgan-x4plus.bin'));
  await access(join(engine, 'models/realesrgan-x4plus.param'));
  for (const folder of ['inbox', 'review', 'work'])
    await mkdir(join(LOCAL_ROOT, folder), { recursive: true });
  console.log('Free local photo enhancer ready. No paid service or Windows policy change.');
  console.log('Double-click Enhance Photos.cmd, then review before uploading.');
}

void setup().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Setup failed.');
  process.exitCode = 1;
});
