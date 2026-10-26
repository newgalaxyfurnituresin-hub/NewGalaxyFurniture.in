import { describe, expect, it, vi } from 'vitest';
import {
  ACCESS_ORIGIN,
  PAGE_CHECKS,
  SITE,
  assessResponse,
  issueChanges,
  probePage,
  quotaIssue,
  retainUnverifiedIssues,
  websiteChecks,
  type MonitorIssue,
} from '../../scripts/monitoring-core';

const session = PAGE_CHECKS.find((check) => check.id === 'session')!;
const home = PAGE_CHECKS[0]!;
const unauthenticated = () =>
  Response.json(
    { error: 'UNAUTHENTICATED' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
const page = '<html><main>New Galaxy Furniture</main></html>';
const href = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

describe('production health monitoring', () => {
  it('detects the original empty HTTP 500 before authentication', () => {
    expect(assessResponse(session, new Response(null, { status: 500 }), '', 50)?.severity).toBe(
      'critical',
    );
    expect(
      assessResponse(session, unauthenticated(), '{"error":"UNAUTHENTICATED"}', 50),
    ).toBeNull();
    expect(assessResponse(session, new Response('{}'), '{}', 50)?.severity).toBe('critical');
    expect(
      assessResponse(session, new Response('HTML', { status: 401 }), 'HTML', 50)?.severity,
    ).toBe('critical');
  });
  it('flags missing privacy protection and an unexpected dashboard sign-in destination', () => {
    expect(
      assessResponse(
        session,
        Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 }),
        '{"error":"UNAUTHENTICATED"}',
        50,
      )?.severity,
    ).toBe('critical');
    const access = PAGE_CHECKS.find((check) => check.id === 'access')!;
    expect(
      assessResponse(
        access,
        new Response(null, {
          status: 302,
          headers: {
            location:
              ACCESS_ORIGIN + '/cdn-cgi/access/login/newgalaxyfurniture.in?private=DO-NOT-PRINT',
          },
        }),
        '',
        50,
      ),
    ).toBeNull();
    const issue = assessResponse(
      access,
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.invalid/?private=DO-NOT-PRINT' },
      }),
      '',
      50,
    );
    expect(issue?.severity).toBe('critical');
    expect(JSON.stringify(issue)).not.toContain('DO-NOT-PRINT');
  });
  it('detects templates, missing media, old canonicals and consistently slow responses', () => {
    expect(assessResponse(home, new Response('Hello world'), 'Hello world', 50)?.severity).toBe(
      'critical',
    );
    expect(assessResponse(home, new Response(page), page, 6000)?.severity).toBe('warning');
    const image = { id: 'image', path: '/img/test', expected: 200, kind: 'image' as const };
    expect(assessResponse(image, new Response('error'), 'error', 50)?.severity).toBe('critical');
    const sitemap = PAGE_CHECKS.find((check) => check.id === 'sitemap')!;
    expect(assessResponse(sitemap, new Response(SITE), SITE + '.workers.dev', 50)?.severity).toBe(
      'critical',
    );
  });
  it('confirms a failure twice, recovers from one transient failure and never submits credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(unauthenticated());
    expect((await probePage(session, fetcher)).issue).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, options] of fetcher.mock.calls) {
      expect(options?.redirect).toBe('manual');
      expect(options?.credentials).toBe('omit');
      expect(options?.body).toBeUndefined();
      expect(new Headers(options?.headers).has('cookie')).toBe(false);
    }
    const broken = vi.fn<typeof fetch>().mockRejectedValue(new Error('private-network-details'));
    const probe = await probePage(session, broken);
    expect(probe.issue?.severity).toBe('critical');
    expect(JSON.stringify(probe.issue)).not.toContain('private-network-details');
    expect(broken).toHaveBeenCalledTimes(2);
  });
  it('uses real published product URLs and media with bounded parallel requests', async () => {
    let active = 0,
      maximum = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      maximum = Math.max(maximum, ++active);
      await Promise.resolve();
      active--;
      const path = new URL(href(input)).pathname;
      if (path === '/api/admin/access')
        return new Response(null, {
          status: 302,
          headers: { location: ACCESS_ORIGIN + '/cdn-cgi/access/login/newgalaxyfurniture.in' },
        });
      if (path.startsWith('/api/admin/')) return unauthenticated();
      if (path === '/admin/login') return new Response('Sign in with Cloudflare /api/admin/access');
      if (path === '/robots.txt' || path === '/sitemap.xml') return new Response(SITE);
      if (path.startsWith('/img/'))
        return new Response('image bytes', { headers: { 'content-type': 'image/webp' } });
      return new Response(
        page +
          '<a href="/product/brown-sofa">Product</a><img src="/img/p_abcdefghij/img_abcdefghij-320.webp">',
      );
    });
    const probes = await websiteChecks(fetcher);
    expect(probes).toHaveLength(12);
    expect(probes.every((probe) => probe.issue === null)).toBe(true);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(fetcher.mock.calls.every(([url]) => href(url).startsWith(SITE + '/'))).toBe(true);
  });
  it('warns at 70%, escalates at 90% and never treats missing numbers as healthy', () => {
    expect(quotaIssue('writes', 'Writes', 699, 1000)).toBeNull();
    expect(quotaIssue('writes', 'Writes', 700, 1000)?.severity).toBe('warning');
    expect(quotaIssue('writes', 'Writes', 900, 1000)?.severity).toBe('critical');
    expect(quotaIssue('writes', 'Writes', NaN, 1000)?.id).toBe('monitor:writes');
  });
  it('suppresses repeated alerts while detecting escalation and recovery', () => {
    const warning: MonitorIssue = { id: 'quota:d1-writes', severity: 'warning', detail: '70%' };
    expect(issueChanges([], [warning])[0]?.event).toBe('new');
    expect(issueChanges([warning], [{ ...warning, detail: '80%' }])).toEqual([]);
    expect(issueChanges([warning], [{ ...warning, severity: 'critical' }])[0]?.event).toBe(
      'severity-changed',
    );
    expect(issueChanges([warning], [])[0]?.event).toBe('recovered');
  });
  it('does not announce quota recovery when analytics access disappears', () => {
    const quota: MonitorIssue = { id: 'quota:d1-writes', severity: 'warning', detail: '75%' };
    const http: MonitorIssue = { id: 'http:session', severity: 'critical', detail: 'HTTP 500' };
    const retained = retainUnverifiedIssues([quota, http], [], ['usage']);
    expect(retained).toEqual([quota]);
    expect(issueChanges([quota, http], retained).map((change) => change.id)).toEqual([
      'http:session',
    ]);
    const inaccessible: MonitorIssue = {
      id: 'monitor:usage',
      severity: 'warning',
      detail: 'Missing usage',
    };
    expect(retainUnverifiedIssues([quota, inaccessible], [], ['all'])).toEqual([
      quota,
      inaccessible,
    ]);
  });
});
