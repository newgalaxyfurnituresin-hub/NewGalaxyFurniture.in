import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubContentClient } from '@/lib/github/client';
import { GitHubApiStub } from '../fixtures/github-api';
import { experiences } from '@/lib/content/experiences';

const state = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/lib/admin/context', () => ({ openAdminContext: state.open }));
import { GET, PATCH } from '@/pages/api/admin/experiences';

let stub: GitHubApiStub;
const path = 'data/site/experiences.json';
function context(body: unknown): APIContext {
  return {
    request: new Request('https://local.example.invalid/api/admin/experiences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as APIContext;
}
beforeEach(() => {
  stub = new GitHubApiStub({ files: { [path]: JSON.stringify(experiences) } });
  stub.files.get(path)!.sha = 'a'.repeat(40);
  const client = new GitHubContentClient({
    token: 'local-fixture-only',
    repo: stub.repo,
    branch: stub.branch,
    fetchImpl: stub.fetch,
  });
  state.open.mockReset().mockResolvedValue({
    ok: true,
    context: {
      client,
      actor: { email: 'owner@local.invalid', role: 'owner', sessionId: 'local-test' },
    },
  });
});
describe('experience content writes over the real repository client and a local protocol stub', () => {
  it('returns the stored blob revision for optimistic concurrency', async () => {
    const response = await GET(context({}));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sha: string };
    expect(body.sha).toBe('a'.repeat(40));
    expect(stub.commits).toHaveLength(0);
  });
  it('writes a valid owner edit as one audited commit that can rebuild', async () => {
    const next = structuredClone(experiences);
    next.repair.heading = 'A thoughtful next chapter for your favourite sofa.';
    const response = await PATCH(context({ sha: 'a'.repeat(40), experiences: next }));
    expect(response.status).toBe(200);
    expect(stub.commits).toHaveLength(1);
    expect(stub.commits[0]!.paths).toEqual([path]);
    expect(stub.commits[0]!.message).not.toContain('[skip ci]');
    const saved = JSON.parse(stub.files.get(path)!.content) as { repair: { heading: string } };
    expect(saved.repair.heading).toBe(next.repair.heading);
  });
  it('refuses stale edits and leaves all stored bytes unchanged', async () => {
    const original = stub.files.get(path)!.content;
    const response = await PATCH(context({ sha: 'b'.repeat(40), experiences }));
    expect(response.status).toBe(409);
    expect(stub.commits).toHaveLength(0);
    expect(stub.files.get(path)!.content).toBe(original);
  });
  it('rejects unsafe images and malformed payloads before writing', async () => {
    const invalid = structuredClone(experiences);
    invalid.repair.hero.src = '/img/quarantine/private.webp';
    expect((await PATCH(context({ sha: 'a'.repeat(40), experiences: invalid }))).status).toBe(422);
    expect(stub.commits).toHaveLength(0);
  });
  it('does not read or write when the existing permission guard refuses access', async () => {
    state.open.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await PATCH(context({ sha: 'a'.repeat(40), experiences }))).status).toBe(403);
    expect(stub.requests).toHaveLength(0);
  });
});
