import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ accessConfigured: true, bindingUnavailable: false }));
vi.mock('@/lib/auth/access', () => ({
  getAccessConfig: () =>
    state.accessConfigured ? { issuer: 'fixture', audience: 'fixture' } : null,
}));
vi.mock('@/lib/env', () => ({
  getPublicConfig: () => ({ siteUrl: 'https://newgalaxyfurniture.in' }),
  getD1: () => {
    if (state.bindingUnavailable) throw new Error('fixture binding unavailable');
    return {};
  },
  getKV: () => ({}),
}));
import { POST } from '@/pages/api/admin/login';

describe('company password fallback protection', () => {
  beforeEach(() => {
    state.accessConfigured = true;
    state.bindingUnavailable = false;
  });
  function context(): APIContext {
    return {
      request: new Request('https://newgalaxyfurniture.in/api/admin/login', {
        method: 'POST',
        headers: { origin: 'https://newgalaxyfurniture.in', 'content-type': 'application/json' },
        body: '{}',
      }),
    } as APIContext;
  }
  it('requires Access while configured and never establishes a password session', async () => {
    const response = await POST(context());
    expect(response.status).toBe(409);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
  it('fails closed if Access configuration is removed', async () => {
    state.accessConfigured = false;
    const response = await POST(context());
    expect(response.status).toBe(503);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
  it('reports unavailable bindings safely without enabling password login', async () => {
    state.accessConfigured = false;
    state.bindingUnavailable = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await POST(context());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('fixture binding');
      expect(response.headers.has('set-cookie')).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
});
