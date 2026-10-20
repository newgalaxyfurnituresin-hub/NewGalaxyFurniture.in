import { describe, expect, it, vi } from 'vitest';
import { requestWithSession } from '../../scripts/admin-photo-enhancer';

describe('local enhancer Cloudflare session recovery', () => {
  it.each([401, 403])('refreshes an expired session reported as %s', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('expired', { status }))
      .mockResolvedValueOnce(new Response('ready'));
    const token = vi
      .fn<(refresh: boolean) => Promise<string>>()
      .mockResolvedValueOnce('test-session-a')
      .mockResolvedValueOnce('test-session-b');
    expect(
      (await requestWithSession('https://example.invalid/queue', {}, token, fetcher)).status,
    ).toBe(200);
    expect(token.mock.calls).toEqual([[false], [true]]);
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer test-session-b',
    );
    expect(fetcher.mock.calls[1]?.[1]?.redirect).toBe('error');
  });
  it('does not repeatedly retry a genuine permission denial', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 403 })));
    await expect(
      requestWithSession('https://example.invalid/queue', {}, async () => 'test-session', fetcher),
    ).rejects.toThrow('Reconnect the company account');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not refresh a healthy session or expose it in a returned response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('ready'));
    const token = vi.fn<(refresh: boolean) => Promise<string>>().mockResolvedValue('test-session');
    const response = await requestWithSession('https://example.invalid/queue', {}, token, fetcher);
    expect(token).toHaveBeenCalledTimes(1);
    expect(response.headers.get('authorization')).toBeNull();
  });
});
