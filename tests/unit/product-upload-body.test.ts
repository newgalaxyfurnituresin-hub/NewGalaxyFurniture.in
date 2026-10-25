import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_CONSTRAINTS } from '@/lib/images/validate';
const state = vi.hoisted(() => ({ open: vi.fn(), lock: vi.fn() }));
vi.mock('@/lib/admin/context', () => ({ openAdminContext: state.open, lockNamespace: () => ({}) }));
vi.mock('@/lib/env', () => ({ getR2: () => ({}), getKV: () => ({}) }));
vi.mock('@/lib/images/codec-photon', () => ({ createWorkerCodec: () => ({}) }));
vi.mock('@/lib/auth/rate-limit', () => ({ consumeNamedLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/github/client', () => ({ withProductLock: state.lock }));
import { MAX_UPLOAD_BODY_BYTES, POST } from '@/pages/api/admin/products/[id]/images/index';

beforeEach(() => {
  vi.clearAllMocks();
  state.open.mockResolvedValue({
    ok: true,
    context: { session: { id: 'test-session' }, drafts: {}, client: {}, actor: {} },
  });
  // These tests isolate the body-size boundary before any image decode or storage write.
  state.lock.mockResolvedValue(new Response(null, { status: 204 }));
});
const context = (request: Request) =>
  ({ request, params: { id: 'p_device0001' } }) as unknown as APIContext;
describe('product photo multipart boundary', () => {
  it('allows a 12 MB photo plus multipart boundaries and a colour field to reach validation', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(UPLOAD_CONSTRAINTS.maxBytes)], 'photo.jpg', { type: 'image/jpeg' }),
    );
    form.append('colorName', 'Walnut brown');
    const request = new Request('https://newgalaxyfurniture.in/api/admin/test', {
      method: 'POST',
      body: form,
    });
    const size = (await request.clone().arrayBuffer()).byteLength;
    expect(size).toBeGreaterThan(UPLOAD_CONSTRAINTS.maxBytes);
    expect(size).toBeLessThan(MAX_UPLOAD_BODY_BYTES);
    expect((await POST(context(request))).status).toBe(204);
    expect(state.lock).toHaveBeenCalledOnce();
  });
  it('rejects an oversized streamed body with a helpful message before storage writes', async () => {
    const request = new Request('https://newgalaxyfurniture.in/api/admin/test', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: new Uint8Array(MAX_UPLOAD_BODY_BYTES + 1),
    });
    const response = await POST(context(request));
    expect(response.status).toBe(422);
    expect(((await response.json()) as { message: string }).message).toContain('12 MB per photo');
    expect(state.lock).not.toHaveBeenCalled();
  });
  it('retains authorization checks before reading uploaded data', async () => {
    state.open.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const response = await POST(
      context(
        new Request('https://newgalaxyfurniture.in/api/admin/test', {
          method: 'POST',
          body: 'private',
        }),
      ),
    );
    expect(response.status).toBe(401);
    expect(state.lock).not.toHaveBeenCalled();
  });
});
