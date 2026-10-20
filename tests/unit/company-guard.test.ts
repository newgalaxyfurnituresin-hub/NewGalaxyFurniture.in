import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeKeyValueStore } from '../fixtures/runtime';
import { createSession, readSession, sessionCookieValue } from '@/lib/auth/session';
import type { AdminUser } from '@/lib/auth/users';

const state = vi.hoisted(() => ({ user: null as AdminUser | null, unavailable: false }));
const sessions = fakeKeyValueStore();
vi.mock('@/lib/env', () => ({
  getKV: () => sessions,
  getPublicConfig: () => ({ siteUrl: 'https://newgalaxyfurniture.in' }),
  getD1: () => {
    if (state.unavailable) throw new Error('Local fixture unavailable');
    return {};
  },
}));
vi.mock('@/lib/auth/users', async (original) => ({
  ...(await original<object>()),
  findAdminUserById: async () => state.user,
}));
import { requireAdmin } from '@/lib/auth/guard';

beforeEach(() => {
  state.unavailable = false;
  state.user = {
    id: 'fixture-owner',
    email: 'newgalaxyfurnitures.in@gmail.com',
    role: 'owner',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
});
async function request() {
  const session = await createSession(sessions, {
    userId: 'fixture-owner',
    role: 'owner',
    ip: '127.0.0.1',
  });
  const context = {
    request: new Request('https://newgalaxyfurniture.in/api/admin/session', {
      headers: { cookie: sessionCookieValue(session) },
    }),
  };
  return { session, context };
}
describe('production company identity revalidation on every admin API request', () => {
  it('accepts the approved active company administrator', async () => {
    expect((await requireAdmin((await request()).context)).ok).toBe(true);
  });
  it.each(['foreign', 'disabled', 'deleted', 'downgraded'])(
    'revokes an existing %s session',
    async (mode) => {
      const { session, context } = await request();
      if (mode === 'foreign') state.user!.email = 'someone@gmail.com';
      if (mode === 'disabled') state.user!.status = 'DISABLED';
      if (mode === 'deleted') state.user = null;
      if (mode === 'downgraded') state.user!.role = 'viewer';
      const result = await requireAdmin(context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
      expect(await readSession(sessions, session.id)).toBeNull();
    },
  );
  it('fails closed when account verification cannot reach the database', async () => {
    state.unavailable = true;
    const result = await requireAdmin((await request()).context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });
});
