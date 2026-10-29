import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_CONSTRAINTS } from '@/lib/images/validate';
import { BodyTooLargeError, readBoundedForm } from '@/lib/security/body';
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
  it('allows a 15 MB photo plus multipart boundaries and a colour field to reach validation', async () => {
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
    const parsed = await readBoundedForm(request, MAX_UPLOAD_BODY_BYTES);
    expect((parsed.get('file') as File).size).toBe(UPLOAD_CONSTRAINTS.maxBytes);
  });
  it('rejects an oversized streamed body with a helpful message before storage writes', async () => {
    const request = new Request('https://newgalaxyfurniture.in/api/admin/test', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: new Uint8Array(MAX_UPLOAD_BODY_BYTES + 1),
    });
    await expect(readBoundedForm(request, MAX_UPLOAD_BODY_BYTES)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
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
