/** Cache type-aware lint only when the entire code/type/configuration input set is unchanged. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function lintInputFingerprint(root: string): string {
  const hash = createHash('sha256').update(process.version);
  const files: string[] = [];
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const directory of ['src', 'scripts', 'tests', 'data/site', 'data/snapshots'])
    walk(join(root, directory));
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:[cm]?js|tsx?|json|lock|toml)$/.test(entry.name))
      files.push(join(root, entry.name));
  }
  for (const name of ['types.d.ts', 'content.d.ts', 'env.d.ts']) {
    const path = join(root, '.astro', name);
    if (existsSync(path)) files.push(path);
  }
  // Direct JSON imports contribute to TypeScript inference, even if they live outside src/.
  for (const path of [...files]) {
    if (!/\.(?:tsx?|[cm]?js)$/.test(path)) continue;
    for (const match of readFileSync(path, 'utf8').matchAll(
      /(?:from\s+|import\s*\()\s*['"]([^'"]+\.json)['"]/g,
    )) {
      const imported = match[1];
      if (imported?.startsWith('.')) {
        const dependency = resolve(dirname(path), imported);
        if (existsSync(dependency)) files.push(dependency);
      }
    }
  }
  for (const path of [...new Set(files)].sort()) {
    hash
      .update(relative(root, path).replaceAll('\\', '/'))
      .update('\0')
      .update(readFileSync(path))
      .update('\0');
  }
  return hash.digest('hex');
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const directory = join(root, 'node_modules/.astro/ngf-checks');
  mkdirSync(directory, { recursive: true });
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/eslint/bin/eslint.js'),
      '.',
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      join(directory, `eslint-${lintInputFingerprint(root)}.json`),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  console.log(`[lint-code] completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (result.error || result.status !== 0) process.exitCode = result.status || 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
