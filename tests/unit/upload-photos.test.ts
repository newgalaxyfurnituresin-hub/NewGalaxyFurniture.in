import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadPhotos } from '@/lib/admin/upload-photos';
import { demoSofa } from '../fixtures/products';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', {
    getElementById: () => ({ textContent: '{"csrfToken":"test-csrf"}' }),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const photo = (name: string, bytes = 1) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
const accepted = () =>
  Response.json(
    { images: [demoSofa.images[0]], rejected: [] },
    {
      status: 201,
      headers: { 'x-ngf-previous-updated-at': 'before', 'x-ngf-updated-at': 'after' },
    },
  );
const input = (files: File[]) => ({
  productId: demoSofa.id,
  files,
  existingCount: 0,
  onProgress: vi.fn(),
  onAccepted: vi.fn(),
});

describe('multiple admin photo uploads', () => {
  it('sends a selection larger than 12 MB as separate, serialized requests with colour and revision data', async () => {
    let active = 0;
    let maximum = 0;
    const starts: number[] = [];
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      active++;
      maximum = Math.max(maximum, active);
      starts.push(Date.now());
      const form = options?.body as FormData;
      expect(form.getAll('file')).toHaveLength(1);
      expect((form.get('file') as File).size).toBe(5 * 1024 * 1024);
      expect(form.get('colorName')).toBe('Walnut brown');
      expect(new Headers(options?.headers).get('X-CSRF-Token')).toBe('test-csrf');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      active--;
      return accepted();
    });
    vi.stubGlobal('fetch', request);
    const options = {
      ...input(['front', 'side', 'back'].map((name) => photo(`${name}.jpg`, 5 * 1024 * 1024))),
      colorName: 'Walnut brown',
    };
    const pending = uploadPhotos(options);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ added: 3, rejected: [], stopped: false });
    expect(maximum).toBe(1);
    expect(request).toHaveBeenCalledTimes(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(2600);
    expect(options.onAccepted).toHaveBeenCalledTimes(3);
    expect(options.onAccepted.mock.calls[0]?.[1]).toEqual({
      previousUpdatedAt: 'before',
      updatedAt: 'after',
    });
    expect(options.onProgress.mock.calls.at(-1)?.[0]).toContain('photo 3 of 3');
  });
  it('retains successes and continues after one invalid image', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(
        Response.json(
          { error: 'VALIDATION_FAILED', message: 'This photo is damaged.' },
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(accepted());
    vi.stubGlobal('fetch', request);
    const options = input([photo('first.jpg'), photo('damaged.jpg'), photo('last.jpg')]);
    const pending = uploadPhotos(options);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.added).toBe(2);
    expect(result.rejected).toEqual([
      { filename: 'damaged.jpg', code: 'VALIDATION_FAILED', message: 'This photo is damaged.' },
    ]);
    expect(options.onAccepted).toHaveBeenCalledTimes(2);
  });
  it.each([401, 429, 500, 524])(
    'stops without retrying or hiding prior success on status %s',
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(accepted())
        .mockResolvedValueOnce(new Response('upstream failure', { status }));
      vi.stubGlobal('fetch', request);
      const options = input([photo('saved.jpg'), photo('failed.jpg'), photo('pending.jpg')]);
      const pending = uploadPhotos(options);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.added).toBe(1);
      expect(result.stopped).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      expect(result.rejected.at(-1)?.code).toBe('NOT_ATTEMPTED');
      if (status >= 500)
        expect(result.rejected[0]?.message).toContain('may already have been saved');
    },
  );
  it('does not retry a disconnected write that may have saved a photo', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', request);
    const result = await uploadPhotos(input([photo('first.jpg'), photo('next.jpg')]));
    expect(result.stopped).toBe(true);
    expect(result.rejected[0]?.message).toContain('check the saved photos');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('checks each file size and remaining product slots before transmitting', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    vi.stubGlobal('fetch', request);
    const options = {
      ...input([
        photo('large.jpg', 12 * 1024 * 1024 + 1),
        photo('empty.jpg', 0),
        photo('valid.jpg'),
        photo('overflow.jpg'),
      ]),
      existingCount: 19,
    };
    const result = await uploadPhotos(options);
    expect(result.added).toBe(1);
    expect(result.rejected.map((entry) => entry.code)).toEqual([
      'TOO_LARGE',
      'EMPTY_FILE',
      'TOO_MANY_IMAGES',
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
