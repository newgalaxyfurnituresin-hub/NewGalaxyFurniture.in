/** Read-only checks. Never include response bodies, cookies or signed URLs in reports. */
export const SITE = 'https://newgalaxyfurniture.in';
export const ACCESS_ORIGIN = 'https://winter-firefly-d5dd.cloudflareaccess.com';
export interface MonitorIssue {
  id: string;
  severity: 'warning' | 'critical';
  detail: string;
}
export interface PageCheck {
  id: string;
  path: string;
  expected: number;
  kind: 'page' | 'login' | 'session' | 'access' | 'image' | 'metadata';
}
export interface Probe {
  id: string;
  path: string;
  status: number;
  milliseconds: number;
  issue: MonitorIssue | null;
  body: string;
}
export const PAGE_CHECKS: PageCheck[] = [
  { id: 'home', path: '/', expected: 200, kind: 'page' },
  { id: 'catalogue', path: '/collection', expected: 200, kind: 'page' },
  { id: 'mattresses', path: '/collection/mattresses', expected: 200, kind: 'page' },
  { id: 'repair', path: '/sofa-repair', expected: 200, kind: 'page' },
  { id: 'login', path: '/admin/login', expected: 200, kind: 'login' },
  { id: 'session', path: '/api/admin/session', expected: 401, kind: 'session' },
  { id: 'recovery', path: '/api/admin/editor-drafts', expected: 401, kind: 'session' },
  { id: 'access', path: '/api/admin/access?next=%2Fadmin', expected: 302, kind: 'access' },
  { id: 'robots', path: '/robots.txt', expected: 200, kind: 'metadata' },
  { id: 'sitemap', path: '/sitemap.xml', expected: 200, kind: 'metadata' },
];

export function assessResponse(
  check: PageCheck,
  response: Response,
  body: string,
  milliseconds: number,
): MonitorIssue | null {
  const fail = (detail: string): MonitorIssue => ({
    id: `http:${check.id}`,
    severity: 'critical',
    detail: `${check.path.split('?')[0]}: ${detail}`,
  });
  if (response.status !== check.expected)
    return fail(`expected HTTP ${check.expected}, received ${response.status}`);
  if (check.kind === 'session') {
    try {
      const value = JSON.parse(body) as { error?: unknown } | null;
      if (value?.error !== 'UNAUTHENTICATED') return fail('unexpected authentication response');
    } catch {
      return fail('unreadable authentication response');
    }
    if (!response.headers.get('cache-control')?.includes('no-store'))
      return fail('private response is missing no-store protection');
  }
  if (check.kind === 'access') {
    try {
      const location = new URL(response.headers.get('location') ?? '', SITE);
      if (
        location.origin !== ACCESS_ORIGIN ||
        !location.pathname.startsWith('/cdn-cgi/access/login/')
      )
        return fail('unexpected sign-in destination');
    } catch {
      return fail('invalid sign-in destination');
    }
  }
  if (
    check.kind === 'login' &&
    (!body.includes('Sign in with Cloudflare') || !body.includes('/api/admin/access'))
  )
    return fail('company sign-in action is missing');
  if (check.kind === 'page' && (!body.includes('<main') || !/new\s*galaxy\s*furniture/i.test(body)))
    return fail('expected website content is missing');
  if (check.kind === 'metadata' && (!body.includes(SITE) || body.includes('.workers.dev')))
    return fail('production metadata is missing or points to a temporary hostname');
  if (
    check.kind === 'image' &&
    (!response.headers.get('content-type')?.startsWith('image/') || !body.length)
  )
    return fail('product media is unavailable');
  return milliseconds > 5000
    ? {
        id: `slow:${check.id}`,
        severity: 'warning',
        detail: `${check.path.split('?')[0]} took ${Math.round(milliseconds)} ms twice.`,
      }
    : null;
}

async function limitedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 1024 * 1024) {
      await reader.cancel();
      throw new Error('Response size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

export async function probePage(check: PageCheck, fetcher: typeof fetch = fetch): Promise<Probe> {
  const once = async (): Promise<Probe> => {
    const started = performance.now();
    try {
      const response = await fetcher(SITE + check.path, {
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(15000),
        headers: {
          accept: check.kind === 'image' ? 'image/*' : '*/*',
          'user-agent': 'NGF-HealthMonitor/1.0',
        },
      });
      const body = await limitedBody(response);
      const milliseconds = Math.round(performance.now() - started);
      return {
        id: check.id,
        path: check.path.split('?')[0]!,
        status: response.status,
        milliseconds,
        body,
        issue: assessResponse(check, response, body, milliseconds),
      };
    } catch {
      return {
        id: check.id,
        path: check.path.split('?')[0]!,
        status: 0,
        milliseconds: Math.round(performance.now() - started),
        body: '',
        issue: {
          id: `http:${check.id}`,
          severity: 'critical',
          detail: `${check.path.split('?')[0]}: request timed out, failed, or exceeded the safety limit.`,
        },
      };
    }
  };
  const first = await once();
  return first.issue ? await once() : first;
}

export async function websiteChecks(fetcher: typeof fetch = fetch): Promise<Probe[]> {
  let cursor = 0;
  const probes: Probe[] = [];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < PAGE_CHECKS.length) {
        const index = cursor++;
        probes[index] = await probePage(PAGE_CHECKS[index]!, fetcher);
      }
    }),
  );
  const catalogue = probes.find((probe) => probe.id === 'catalogue');
  if (catalogue?.status === 200) {
    const path = catalogue.body.match(/href="(\/product\/[a-z0-9]+(?:-[a-z0-9]+)*)"/)?.[1];
    if (path) {
      const product = await probePage(
        { id: 'product', path, expected: 200, kind: 'page' },
        fetcher,
      );
      probes.push(product);
      const image = product.body.match(
        /\/img\/p_[a-z0-9]{10}\/img_[a-z0-9]{10}-320\.(?:webp|avif)/,
      )?.[0];
      if (image)
        probes.push(
          await probePage(
            { id: 'product-image', path: image, expected: 200, kind: 'image' },
            fetcher,
          ),
        );
      else if (!product.issue)
        product.issue = {
          id: 'http:product-image',
          severity: 'critical',
          detail: 'The published product has no supported product-media URL.',
        };
    }
  }
  return probes;
}

export function quotaIssue(
  id: string,
  label: string,
  used: number,
  limit: number,
): MonitorIssue | null {
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(limit) || limit <= 0)
    return {
      id: `monitor:${id}`,
      severity: 'warning',
      detail: `${label}: usage could not be verified.`,
    };
  const percentage = (used / limit) * 100;
  if (percentage < 70) return null;
  return {
    id: `quota:${id}`,
    severity: percentage >= 90 ? 'critical' : 'warning',
    detail: `${label}: ${used.toLocaleString('en-IN')} of ${limit.toLocaleString('en-IN')} (${percentage.toFixed(1)}%).`,
  };
}

export function issueChanges(previous: MonitorIssue[], current: MonitorIssue[]) {
  const before = new Map(previous.map((issue) => [issue.id, issue]));
  const after = new Map(current.map((issue) => [issue.id, issue]));
  return [
    ...current
      .filter((issue) => before.get(issue.id)?.severity !== issue.severity)
      .map((issue) => ({ event: before.has(issue.id) ? 'severity-changed' : 'new', ...issue })),
    ...previous
      .filter((issue) => !after.has(issue.id))
      .map((issue) => ({ event: 'recovered', ...issue })),
  ];
}

export function retainUnverifiedIssues(
  previous: MonitorIssue[],
  current: MonitorIssue[],
  incomplete: string[],
): MonitorIssue[] {
  const result = [...current];
  for (const old of previous) {
    const retain =
      (incomplete.includes('all') && !/^(http:|slow:)/.test(old.id)) ||
      (incomplete.includes('usage') &&
        (/^quota:(d1-|worker-|r2-storage)/.test(old.id) || old.id === 'worker:errors')) ||
      (incomplete.includes('r2-operations') && /^quota:r2-class/.test(old.id)) ||
      (incomplete.includes('config') && old.id.startsWith('config:'));
    if (retain && !result.some((issue) => issue.id === old.id)) result.push(old);
  }
  return result;
}
