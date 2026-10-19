import { describe, expect, it, vi } from 'vitest';
import { runAfterResponse } from '@/lib/admin/background';

describe('platform background work', () => {
  it('uses Astro Cloudflare cfContext without waiting for image processing to finish', async () => {
    let finish: () => void = () => {};
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cfContext = {
      waitUntil: vi.fn((pending: Promise<unknown>) => {
        expect(pending).toBe(work);
      }),
    };
    expect(await runAfterResponse({ cfContext }, work)).toBe(true);
    expect(cfContext.waitUntil).toHaveBeenCalledOnce();
    finish();
    await work;
  });
  it('retains the existing Netlify request-context support', async () => {
    const waitUntil = vi.fn();
    expect(await runAfterResponse({ netlify: { context: { waitUntil } } }, Promise.resolve())).toBe(
      true,
    );
    expect(waitUntil).toHaveBeenCalledOnce();
  });
  it('finishes work inline only when no supported platform context exists', async () => {
    let complete = false;
    expect(
      await runAfterResponse(
        {},
        Promise.resolve().then(() => {
          complete = true;
        }),
      ),
    ).toBe(false);
    expect(complete).toBe(true);
  });
});
