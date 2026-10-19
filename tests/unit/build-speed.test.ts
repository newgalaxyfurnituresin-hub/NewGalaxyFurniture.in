import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintInputFingerprint } from '../../scripts/lint-code';
import { runIndependentChecks } from '../../scripts/cloudflare-production';

describe('safe build acceleration', () => {
  it('invalidates type-aware lint for dependency and source changes, while product content has its own fresh validation', () => {
    const root = mkdtempSync(join(tmpdir(), 'ngf-lint-cache-'));
    try {
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, 'data/products'), { recursive: true });
      writeFileSync(join(root, 'src/example.ts'), 'export const example = 1;');
      writeFileSync(join(root, 'package-lock.json'), '{}');
      const initial = lintInputFingerprint(root);
      writeFileSync(join(root, 'data/products/example.json'), '{"status":"PUBLISHED"}');
      expect(lintInputFingerprint(root)).toBe(initial);
      writeFileSync(join(root, 'src/example.ts'), 'export const example = 2;');
      expect(lintInputFingerprint(root)).not.toBe(initial);
      const changed = lintInputFingerprint(root);
      writeFileSync(join(root, 'package-lock.json'), '{"changed":true}');
      expect(lintInputFingerprint(root)).not.toBe(changed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('invalidates lint if a directly imported product JSON changes inferred types', () => {
    const root = mkdtempSync(join(tmpdir(), 'ngf-import-cache-'));
    try {
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, 'data/products'), { recursive: true });
      writeFileSync(
        join(root, 'src/example.ts'),
        "import product from '../data/products/example.json';",
      );
      writeFileSync(join(root, 'data/products/example.json'), '{"price":1}');
      const before = lintInputFingerprint(root);
      writeFileSync(join(root, 'data/products/example.json'), '{"price":"one"}');
      expect(lintInputFingerprint(root)).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('starts independent checks together and waits for both', async () => {
    const started: number[] = [];
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = runIndependentChecks([
      async () => {
        started.push(1);
        await first;
      },
      () => {
        started.push(2);
        return Promise.resolve();
      },
    ]);
    expect(started).toEqual([1, 2]);
    release?.();
    await expect(result).resolves.toBeUndefined();
  });
  it('stops deployment if either check fails', async () => {
    await expect(
      runIndependentChecks([
        () => Promise.resolve(),
        () => Promise.reject(new Error('lint failed')),
      ]),
    ).rejects.toThrow('deployment stopped');
  });
});
