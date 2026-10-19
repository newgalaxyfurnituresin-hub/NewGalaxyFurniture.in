import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { legacyDomainRedirect } from '@/lib/seo/legacy-domain';

const legacy = 'https://newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev';
const primary = 'https://newgalaxyfurniture.in';
const browserScript = readFileSync('public/ngf-domain-migration.js', 'utf8');

describe('old public address handoff', () => {
  it('redirects the old homepage without caching another redirect', () => {
    const response = legacyDomainRedirect(new Request(legacy));
    expect(response?.status).toBe(302);
    expect(response?.headers.get('location')).toBe(primary + '/?__ngf_domain=1');
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('keeps the requested page and filters on the fixed destination', () => {
    const response = legacyDomainRedirect(
      new Request(legacy + '/collection/sofas?q=corner%20sofa'),
    );
    const target = new URL(response!.headers.get('location')!);
    expect(target.origin).toBe(primary);
    expect(target.pathname).toBe('/collection/sofas');
    expect(target.searchParams.get('q')).toBe('corner sofa');
  });
  it('does not treat a protocol-relative path as another redirect destination', () => {
    const response = legacyDomainRedirect(new Request(legacy + '//other.example/path'));
    expect(new URL(response!.headers.get('location')!).origin).toBe(primary);
  });
  it.each([primary, 'https://preview.newgalaxyfurniture.workers.dev'])('leaves %s alone', (url) => {
    expect(legacyDomainRedirect(new Request(url))).toBeNull();
  });
  it.each(['/api/admin/access', '/api/leads', '/img/product/image.webp', '/_astro/app.js'])(
    'does not forward %s across origins',
    (path) => expect(legacyDomainRedirect(new Request(legacy + path))).toBeNull(),
  );
  it('does not forward a submitted body', () => {
    expect(
      legacyDomainRedirect(new Request(legacy, { method: 'POST', body: 'private' })),
    ).toBeNull();
  });
});

async function runBrowser(url: string, ok = true, offline = false) {
  const current = new URL(url);
  const replace = vi.fn<(url: string) => void>();
  const replaceState = vi.fn();
  const fetch = offline
    ? vi.fn().mockRejectedValue(new Error('offline'))
    : vi.fn().mockResolvedValue({ ok, text: () => Promise.resolve('page') });
  runInNewContext(browserScript, {
    URL,
    document: { querySelector: () => ({ href: primary + current.pathname }) },
    location: { href: url, hash: current.hash, replace },
    history: { state: { existing: true }, replaceState },
    fetch,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { replace, replaceState, fetch };
}

describe('browser recovery from a cached registrar redirect', () => {
  it('does no network work for normal visitors to the primary domain', async () => {
    const result = await runBrowser(primary + '/');
    expect(result.fetch).not.toHaveBeenCalled();
    expect(result.replaceState).not.toHaveBeenCalled();
  });
  it('moves a bookmarked old product page to the primary domain', async () => {
    const result = await runBrowser(legacy + '/product/phone?source=bookmark#details');
    const target = new URL(result.replace.mock.calls[0]![0]);
    expect(target.origin).toBe(primary);
    expect(target.pathname).toBe('/product/phone');
    expect(target.searchParams.get('source')).toBe('bookmark');
    expect(target.hash).toBe('#details');
  });
  it('refreshes the stale cache entry before removing the one-time marker', async () => {
    const result = await runBrowser(primary + '/?source=bookmark&__ngf_domain=1#details');
    expect(result.fetch.mock.calls[0]![0]).toBe(primary + '/?source=bookmark#details');
    expect(result.fetch.mock.calls[0]![1]).toMatchObject({
      cache: 'reload',
      redirect: 'error',
      credentials: 'same-origin',
    });
    expect(result.replaceState.mock.calls[0]![2]).toBe('/?source=bookmark#details');
    expect(result.replace).not.toHaveBeenCalled();
  });
  it.each([
    { ok: false, offline: false },
    { ok: true, offline: true },
  ])(
    'keeps the working address when the original cache entry cannot be refreshed: %j',
    async ({ ok, offline }) => {
      const result = await runBrowser(primary + '/?__ngf_domain=1', ok, offline);
      expect(result.replaceState).not.toHaveBeenCalled();
      expect(result.replace).not.toHaveBeenCalled();
    },
  );
});
