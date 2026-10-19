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
