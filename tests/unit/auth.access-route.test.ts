import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeKeyValueStore } from '../fixtures/runtime';
import { readSession, readSessionCookie } from '@/lib/auth/session';

const state = vi.hoisted(() => ({
  identity: null as string | null,
  owner: null as {
    user: { id: string; role: string; status: string };
    passwordHash: string;
  } | null,
  configured: true,
  siteUrl: 'https://site.example.invalid',
  lastLogin: vi.fn(),
}));
const sessions = fakeKeyValueStore();
const rateLimit = fakeKeyValueStore();
vi.mock('@/lib/env', () => ({
  getD1: () => ({}),
  getKV: (_context: unknown, name: string) => (name === 'SESSIONS' ? sessions : rateLimit),
  getPublicConfig: () => ({ siteUrl: state.siteUrl }),
}));
vi.mock('@/lib/auth/access', async (original) => ({
  ...(await original<object>()),
  getAccessConfig: () =>
    state.configured
      ? { issuer: 'https://fixture.cloudflareaccess.com', audience: 'fixture' }
      : null,
  verifyAccessToken: async () => state.identity,
}));
vi.mock('@/lib/auth/users', () => ({
  findAdminUserWithHash: async () => state.owner,
  recordSuccessfulLogin: state.lastLogin,
}));
import { GET, POST } from '@/pages/api/admin/access';

function context(
  method = 'GET',
  origin = 'https://site.example.invalid',
  next = '/admin/products',
): APIContext {
  const url = new URL('https://site.example.invalid/api/admin/access');
  url.searchParams.set('next', next);
  return {
    url,
    request: new Request(url, {
      method,
      headers: { origin, 'cf-connecting-ip': crypto.randomUUID() },
    }),
  } as APIContext;
}
beforeEach(() => {
  state.identity = 'owner@example.invalid';
  state.owner = {
    user: { id: 'fixture-owner', role: 'owner', status: 'ACTIVE' },
    passwordHash: 'unchanged',
  };
  state.configured = true;
  state.siteUrl = 'https://site.example.invalid';
  state.lastLogin.mockClear();
});
describe('Access to application-session exchange', () => {
  it('rejects a verified foreign owner on the company deployment before creating a session', async () => {
    state.siteUrl = 'https://newgalaxyfurniture.in';
    const result = await GET(context());
    expect(result.status).toBe(403);
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(state.lastLogin).not.toHaveBeenCalled();
    state.identity = 'newgalaxyfurnitures.in@gmail.com';
    expect((await GET(context())).status).toBe(200);
  });
  it('fails closed when unconfigured or identity is unverified', async () => {
    state.configured = false;
    expect((await GET(context())).status).toBe(503);
    state.configured = true;
    state.identity = null;
    const result = await POST(context('POST'));
    expect(result.status).toBe(403);
    expect(result.headers.has('set-cookie')).toBe(false);
    expect(state.lastLogin).not.toHaveBeenCalled();
  });
  it('does not create a session on navigation or on a cross-origin POST', async () => {
    const initial = await GET(context());
    expect(initial.status).toBe(200);
    expect(initial.headers.has('set-cookie')).toBe(false);
    expect((await POST(context('POST', 'https://attacker.invalid'))).status).toBe(403);
    expect(state.lastLogin).not.toHaveBeenCalled();
  });
  it('refuses unknown, disabled and non-owner identities', async () => {
    state.owner = null;
    expect((await POST(context('POST'))).status).toBe(403);
    state.owner = {
      user: { id: 'fixture', role: 'owner', status: 'DISABLED' },
      passwordHash: 'unchanged',
    };
    expect((await POST(context('POST'))).status).toBe(403);
    state.owner.user.status = 'ACTIVE';
    state.owner.user.role = 'viewer';
    expect((await POST(context('POST'))).status).toBe(403);
    expect(state.lastLogin).not.toHaveBeenCalled();
  });
  it('creates the existing opaque session with CSRF protection and secure cookie only after POST', async () => {
    const result = await POST(context('POST'));
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/admin/products');
    const cookie = result.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    const session = await readSession(sessions, readSessionCookie(cookie));
    expect(session?.userId).toBe('fixture-owner');
    expect(session?.role).toBe('owner');
    expect(session?.csrfToken.length).toBeGreaterThan(32);
    expect(state.owner?.passwordHash).toBe('unchanged');
    expect(state.lastLogin).toHaveBeenCalledOnce();
  });
});
