import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { demoSofa } from '../fixtures/products';
import { fakeObjectBucket } from '../fixtures/runtime';
import { hostedImageFixture } from '../fixtures/hosted-images';
import { storeHostedEnquiryImage } from '@/lib/leads/image';
import { parseImageRequest } from '@/lib/images/delivery';
const state = vi.hoisted(() => ({ guard: vi.fn(), bucket: vi.fn(), lead: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: state.guard }));
vi.mock('@/lib/env', () => ({ getR2: state.bucket, getD1: () => ({}) }));
vi.mock('@/lib/content/catalogue', async () => {
  const { demoSofa } = await import('../fixtures/products');
  return { getCatalogue: async () => [{ ...demoSofa, status: 'PUBLISHED', published: true }] };
});
vi.mock('@/lib/leads/store', () => ({ getLead: state.lead }));
import { GET as publicImage } from '@/pages/img/[...path]';
import { GET as privateImage } from '@/pages/api/admin/products/[id]/media/[file]';
import { GET as enquiryImage } from '@/pages/api/admin/leads/[id]/image';
let bucket = fakeObjectBucket();
const context = (params: Record<string, string>) =>
  ({ params, request: new Request('https://newgalaxyfurniture.in/test') }) as unknown as APIContext;
beforeEach(() => {
  vi.clearAllMocks();
  bucket = fakeObjectBucket();
  state.bucket.mockReturnValue(bucket);
  state.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
});
describe('hosted image privacy', () => {
  it('strips customer EXIF through the hosted service and stores only in private enquiry storage', async () => {
    const source = await sharp({
      create: { width: 900, height: 700, channels: 3, background: '#996633' },
    })
      .withExif({ IFD0: { Artist: 'PRIVATE CUSTOMER METADATA' } })
      .jpeg()
      .toBuffer();
    const result = await storeHostedEnquiryImage(
      bucket,
      hostedImageFixture(),
      'lead_private',
      new File([new Uint8Array(source)], 'home.jpg', { type: 'image/jpeg' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.key).toMatch(/^quarantine\/leads\//);
    expect(parseImageRequest(result.key)).toBeNull();
    const stored = (await bucket.get(result.key))!;
    expect(stored.httpMetadata?.cacheControl).toBe('private, no-store');
    expect((await sharp(Buffer.from(await stored.arrayBuffer())).metadata()).exif).toBeUndefined();
  });
  it('does not expose an unpublished or unlisted photo through its public-looking URL', async () => {
    const result = await publicImage(context({ path: 'p_private001/img_private001-original.jpg' }));
    expect(result.status).toBe(307);
    expect(result.headers.get('location')).toContain('/api/admin/products/p_private001/media/');
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(state.bucket).not.toHaveBeenCalled();
    expect(
      (await privateImage(context({ id: 'p_private001', file: 'img_private001-original.jpg' })))
        .status,
    ).toBe(401);
    expect(state.bucket).not.toHaveBeenCalled();
  });
  it('serves a photo publicly only when attached to the published catalogue', async () => {
    const image = demoSofa.images[0]!;
    await bucket.put(
      `products/${demoSofa.id}/${image.id}/original.jpg`,
      new Uint8Array([255, 216, 255, 217]),
      { httpMetadata: { contentType: 'image/jpeg' } },
    );
    const result = await publicImage(context({ path: `${demoSofa.id}/${image.id}-original.jpg` }));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('public');
  });
  it('requires company authorization before reading private product photos', async () => {
    expect(
      (
        await privateImage(
          context({ id: demoSofa.id, file: `${demoSofa.images[0]!.id}-original.jpg` }),
        )
      ).status,
    ).toBe(401);
    expect(state.bucket).not.toHaveBeenCalled();
    state.guard.mockResolvedValue({ ok: true });
    const image = demoSofa.images[0]!;
    await bucket.put(`products/${demoSofa.id}/${image.id}/original.jpg`, new Uint8Array([1]), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    const result = await privateImage(
      context({ id: demoSofa.id, file: `${image.id}-original.jpg` }),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
  });
  it('does not let anonymous customers read another enquiry attachment', async () => {
    expect((await enquiryImage(context({ id: 'another-customer' }))).status).toBe(401);
    expect(state.lead).not.toHaveBeenCalled();
    expect(state.bucket).not.toHaveBeenCalled();
  });
});
