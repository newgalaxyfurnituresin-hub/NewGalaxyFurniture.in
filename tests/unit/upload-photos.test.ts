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
  it('keeps an offline-computer upload pending without claiming it was added', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ uploadId: 'img_pending001', images: [], rejected: [] }, { status: 202 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          computerOnline: false,
          uploads: [{ imageId: 'img_pending001', state: 'queued' }],
        }),
      );
    vi.stubGlobal('fetch', request);
    const options = input([photo('pending.jpg')]);
    const result = await uploadPhotos(options);
    expect(result).toEqual({ added: 0, pending: 1, rejected: [], stopped: false });
    expect(options.onAccepted).not.toHaveBeenCalled();
  });
  it('attaches a staged image only after the trusted processor marks it ready', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ uploadId: 'img_pending001', images: [], rejected: [] }, { status: 202 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          computerOnline: true,
          uploads: [{ imageId: 'img_pending001', state: 'ready' }],
        }),
      )
      .mockResolvedValueOnce(accepted());
    vi.stubGlobal('fetch', request);
    const options = input([photo('ready.jpg')]);
    expect((await uploadPhotos(options)).added).toBe(1);
    expect(request.mock.calls[2]?.[0]).toContain('/photo-uploads/img_pending001');
    expect(options.onAccepted).toHaveBeenCalledOnce();
  });
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
      expect((form.get('file') as File).size).toBe(15 * 1024 * 1024);
      expect(form.get('colorName')).toBe('Walnut brown');
      expect(new Headers(options?.headers).get('X-CSRF-Token')).toBe('test-csrf');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      active--;
      return accepted();
    });
    vi.stubGlobal('fetch', request);
    const options = {
      ...input(['front', 'side', 'back'].map((name) => photo(`${name}.jpg`, 15 * 1024 * 1024))),
      colorName: 'Walnut brown',
    };
    const pending = uploadPhotos(options);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ added: 3, pending: 0, rejected: [], stopped: false });
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
        photo('large.jpg', 15 * 1024 * 1024 + 1),
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

it('serializes fifteen 15 MB photos through checkpoint requests and safely resumes one interrupted checkpoint', async () => {
  let current = '';
  let remaining = 0;
  let staged = 0;
  let statusReads = 0;
  let interrupted = false;
  const completed: string[] = [];
  const request = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
    const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (options?.method === 'POST' && path.endsWith('/photo-uploads')) {
      expect(remaining).toBe(0);
      expect((options.body as FormData).getAll('file')).toHaveLength(1);
      current = 'img_batch' + String(staged++).padStart(5, '0');
      remaining = 8;
      return Response.json({ uploadId: current, images: [], rejected: [] }, { status: 202 });
    }
    if (!options?.method || options.method === 'GET') {
      statusReads++;
      return Response.json({
        computerOnline: true,
        uploads: [{ imageId: current, state: 'queued' }],
      });
    }
    expect(path.endsWith('/' + current)).toBe(true);
    if (staged === 2 && remaining === 5 && !interrupted) {
      interrupted = true;
      return new Response('temporary', { status: 503 });
    }
    if (--remaining > 0)
      return Response.json(
        { uploadId: current, images: [], rejected: [], progress: 'Preparing the next size' },
        { status: 202 },
      );
    completed.push(current);
    return Response.json({ images: [{ ...demoSofa.images[0], id: current }], rejected: [] });
  });
  vi.stubGlobal('fetch', request);
  const options = input(
    Array.from({ length: 15 }, (_, i) => photo('large-' + i + '.png', 5 * 1024 * 1024)),
  );
  const work = uploadPhotos(options);
  await vi.runAllTimersAsync();
  const result = await work;
  expect(result).toEqual({ added: 15, pending: 0, rejected: [], stopped: false });
  expect(staged).toBe(15);
  expect(statusReads).toBe(15);
  expect(new Set(completed).size).toBe(15);
  expect(options.onAccepted).toHaveBeenCalledTimes(15);
  expect(interrupted).toBe(true);
  expect(
    options.onProgress.mock.calls.some(([message]) =>
      String(message).includes('Resuming the same private photo checkpoint'),
    ),
  ).toBe(true);
});

it('rejects a sixteenth photo before any transmission', async () => {
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  const result = await uploadPhotos(input(Array.from({ length: 16 }, (_, i) => photo(i + '.jpg'))));
  expect(result.stopped).toBe(true);
  expect(result.rejected).toHaveLength(16);
  expect(request).not.toHaveBeenCalled();
});
