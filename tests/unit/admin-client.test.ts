import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminFetch } from '@/lib/admin/client';

afterEach(() => {
  vi.unstubAllGlobals();
});
function bootstrap(): void {
  vi.stubGlobal('document', {
    getElementById: () => ({ textContent: JSON.stringify({ csrfToken: 'local-test-csrf' }) }),
  });
}
describe('admin request recovery', () => {
  it('does not treat an HTML sign-in or broken JSON response as a successful API write', async () => {
    bootstrap();
    for (const body of ['<html>Sign in</html>', '{broken', 'null', '']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
      const result = await adminFetch('/api/admin/products', { method: 'POST', body: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NETWORK');
    }
  });
  it('ends a stalled request without automatically retrying a write', async () => {
    bootstrap();
    const request = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', request);
    const result = await adminFetch('/api/admin/products', {
      method: 'POST',
      body: {},
      timeoutMs: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('keeps the confirmed revision on an image deletion with no response body', async () => {
    bootstrap();
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'x-ngf-previous-updated-at': 'before', 'x-ngf-updated-at': 'after' },
      }),
    );
    vi.stubGlobal('fetch', request);
    const result = await adminFetch('/api/admin/products/test/images/test', { method: 'DELETE' });
    expect(result).toEqual({
      ok: true,
      value: undefined,
      revision: { previousUpdatedAt: 'before', updatedAt: 'after' },
    });
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'local-test-csrf',
    );
  });
  it('handles a response connection that breaks after headers arrive', async () => {
    bootstrap();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        text: () => Promise.reject(new Error('connection interrupted')),
      }),
    );
    const result = await adminFetch('/api/admin/products');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK');
  });
  it('keeps server validation failures separate from confirmed writes', async () => {
    bootstrap();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: 'VALIDATION_FAILED',
            message: 'Check the name.',
            fields: { name: ['A name is required.'] },
          },
          { status: 422 },
        ),
      ),
    );
    const result = await adminFetch('/api/admin/products', { method: 'POST', body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fields?.name).toEqual(['A name is required.']);
  });
});
