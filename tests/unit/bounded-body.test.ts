import { describe, expect, it } from 'vitest';
import {
  BodyTooLargeError,
  readBoundedBody,
  readBoundedForm,
  readBoundedJson,
} from '@/lib/security/body';

describe('actual request-body limits', () => {
  it('reads valid JSON and a body exactly at the byte limit', async () => {
    expect(
      await readBoundedJson(
        new Request('https://fixture.invalid', { method: 'POST', body: '{"ok":true}' }),
      ),
    ).toEqual({ ok: true });
    expect(
      (
        await readBoundedBody(
          new Request('https://fixture.invalid', { method: 'POST', body: 'abcd' }),
          4,
        )
      ).byteLength,
    ).toBe(4);
  });
  it('rejects a declared oversized body before reading it', async () => {
    const request = new Request('https://fixture.invalid', {
      method: 'POST',
      body: 'small',
      headers: { 'content-length': '100000' },
    });
    await expect(readBoundedBody(request, 16)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(request.bodyUsed).toBe(false);
  });
  it.each([{}, { 'content-length': '1' }])(
    'limits a chunked body even with absent or misleading length: %j',
    async (headers) => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(12));
        },
        cancel() {
          cancelled = true;
        },
      });
      const request = new Request('https://fixture.invalid', {
        method: 'POST',
        body: stream,
        headers,
        duplex: 'half',
      } as RequestInit);
      await expect(readBoundedBody(request, 20)).rejects.toBeInstanceOf(BodyTooLargeError);
      expect(cancelled).toBe(true);
    },
  );
  it('counts UTF-8 bytes rather than text characters and rejects malformed JSON', async () => {
    await expect(
      readBoundedBody(new Request('https://fixture.invalid', { method: 'POST', body: '₹₹' }), 5),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(
      readBoundedJson(new Request('https://fixture.invalid', { method: 'POST', body: '{broken' })),
    ).rejects.toThrow();
  });
  it('parses legitimate multipart forms within the limit', async () => {
    const form = new FormData();
    form.set('message', 'Local test');
    expect(
      (
        await readBoundedForm(
          new Request('https://fixture.invalid', { method: 'POST', body: form }),
          4096,
        )
      ).get('message'),
    ).toBe('Local test');
  });
});
