import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { unstable_readConfig } from 'wrangler';
import { validateCompanyConfig } from './cloudflare-production';
import {
  issueChanges,
  quotaIssue,
  websiteChecks,
  retainUnverifiedIssues,
  type MonitorIssue,
} from './monitoring-core';

const ACCOUNT = '202e4307d4836b9170f546dbea1783d4';
const DATABASE = '0727a2b8-4791-4708-a84b-4b8eff033342';
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/newgalaxyfurniture`;
const authDirectory = resolve('.wrangler/company-auth');
const stateDirectory = resolve('.wrangler/website-monitor');
const number = z.number().nonnegative();
const sums = z.array(z.object({ sum: z.object({ requests: number, errors: number }) }));
const analyticsSchema = z.object({
  d1QueriesAdaptiveGroups: z.array(
    z.object({ sum: z.object({ rowsRead: number, rowsWritten: number }) }),
  ),
  d1StorageAdaptiveGroups: z.array(
    z.object({
      dimensions: z.object({ databaseId: z.string() }),
      max: z.object({ databaseSizeBytes: number }),
    }),
  ),
  workersInvocationsAdaptive: sums,
  recentWorkers: sums,
  r2StorageAdaptiveGroups: z.array(
    z.object({ max: z.object({ payloadSize: number, metadataSize: number }) }),
  ),
});
const issueSchema = z.object({
  id: z.string(),
  severity: z.enum(['warning', 'critical']),
  detail: z.string(),
});
interface Metric {
  id: string;
  label: string;
  used: number;
  limit: number;
  percentage: number;
}
interface Observation {
  metrics: Metric[];
  issues: MonitorIssue[];
  incomplete: string[];
}

async function cloudflareObservation(now: Date): Promise<Observation> {
  const metrics: Metric[] = [];
  const issues: MonitorIssue[] = [];
  const incomplete: string[] = [];
  const add = (id: string, label: string, used: number, limit: number): void => {
    metrics.push({ id, label, used, limit, percentage: Number(((used / limit) * 100).toFixed(2)) });
    const issue = quotaIssue(id, label, used, limit);
    if (issue) issues.push(issue);
  };
  try {
    let refreshed = false;
    const readToken = async (): Promise<string> => {
      const raw = await fs.readFile(
        resolve(authDirectory, '.wrangler/config/default.toml'),
        'utf8',
      );
      const token = raw.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
      if (!token) throw new Error('Credential unavailable.');
      return token;
    };
    const refresh = async (): Promise<void> => {
      if (refreshed) throw new Error('Authentication unavailable.');
      refreshed = true;
      // Official refresh only. No login browser, new token grant or secret output.
      await promisify(execFile)(
        process.execPath,
        [resolve('node_modules/wrangler/bin/wrangler.js'), 'whoami'],
        {
          windowsHide: true,
          timeout: 30000,
          env: {
            ...process.env,
            XDG_CONFIG_HOME: authDirectory,
            CI: 'true',
            WRANGLER_SEND_METRICS: 'false',
          },
        },
      );
    };
    let token: string;
    try {
      token = await readToken();
    } catch {
      await refresh();
      token = await readToken();
    }
    const request = async (url: string, query?: string): Promise<unknown> => {
      const send = async (): Promise<Response> =>
        await fetch(url, {
          method: query ? 'POST' : 'GET',
          signal: AbortSignal.timeout(20000),
          headers: {
            authorization: `Bearer ${token}`,
            ...(query ? { 'content-type': 'application/json' } : {}),
          },
          ...(query ? { body: JSON.stringify({ query }) } : {}),
        });
      let response = await send();
      if (response.status === 401 && !refreshed) {
        await refresh();
        token = await readToken();
        response = await send();
      }
      if (!response.ok) throw new Error('Cloudflare monitoring request unavailable.');
      return (await response.json()) as unknown;
    };
    const graphql = async (query: string): Promise<unknown> => {
      const raw = await request('https://api.cloudflare.com/client/v4/graphql', query);
      const envelope = z
        .object({
          data: z
            .object({ viewer: z.object({ accounts: z.array(z.unknown()).length(1) }) })
            .nullable()
            .optional(),
          errors: z.array(z.unknown()).nullable().optional(),
        })
        .parse(raw);
      if (envelope.errors?.length || !envelope.data)
        throw new Error('Usage analytics unavailable.');
      return envelope.data.viewer.accounts[0];
    };
    const date = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    const hourAgo = new Date(now.getTime() - 3600000).toISOString();
    try {
      const raw = await graphql(`query { viewer { accounts(filter:{accountTag:"${ACCOUNT}"}) {
        d1QueriesAdaptiveGroups(limit:100,filter:{date:"${date}"}) {sum{rowsRead rowsWritten}}
        d1StorageAdaptiveGroups(limit:100,filter:{date_geq:"${yesterday.slice(0, 10)}",date_leq:"${date}"}) {dimensions{databaseId} max{databaseSizeBytes}}
        workersInvocationsAdaptive(limit:100,filter:{date:"${date}"}) {sum{requests errors}}
        recentWorkers:workersInvocationsAdaptive(limit:100,filter:{datetime_geq:"${hourAgo}",datetime_leq:"${now.toISOString()}"}) {sum{requests errors}}
        r2StorageAdaptiveGroups(limit:100,filter:{datetime_geq:"${yesterday}",datetime_leq:"${now.toISOString()}"}) {max{payloadSize metadataSize}}
      } } }`);
      const data = analyticsSchema.parse(raw);
      if (
        Object.values(data).some((rows) => rows.length >= 100) ||
        !data.d1StorageAdaptiveGroups.some((row) => row.dimensions.databaseId === DATABASE) ||
        !data.r2StorageAdaptiveGroups.length
      )
        throw new Error('Incomplete usage analytics.');
      add(
        'd1-reads',
        'D1 rows read today (UTC)',
        data.d1QueriesAdaptiveGroups.reduce((total, row) => total + row.sum.rowsRead, 0),
        5000000,
      );
      add(
        'd1-writes',
        'D1 rows written today (UTC)',
        data.d1QueriesAdaptiveGroups.reduce((total, row) => total + row.sum.rowsWritten, 0),
        100000,
      );
      add(
        'worker-requests',
        'Worker requests today (UTC)',
        data.workersInvocationsAdaptive.reduce((total, row) => total + row.sum.requests, 0),
        100000,
      );
      add(
        'd1-account-storage',
        'D1 account peak storage bytes',
        data.d1StorageAdaptiveGroups.reduce((total, row) => total + row.max.databaseSizeBytes, 0),
        5000000000,
      );
      for (const row of data.d1StorageAdaptiveGroups)
        add(
          `d1-storage-${row.dimensions.databaseId}`,
          'D1 database peak storage bytes',
          row.max.databaseSizeBytes,
          500000000,
        );
      add(
        'r2-storage',
        'R2 account peak storage bytes (last 24h)',
        data.r2StorageAdaptiveGroups.reduce(
          (total, row) => total + row.max.payloadSize + row.max.metadataSize,
          0,
        ),
        10000000000,
      );
      const errors = data.recentWorkers.reduce((total, row) => total + row.sum.errors, 0);
      const requests = data.recentWorkers.reduce((total, row) => total + row.sum.requests, 0);
      if (errors >= 3 && errors / Math.max(1, requests) >= 0.01)
        issues.push({
          id: 'worker:errors',
          severity: 'warning',
          detail: `${errors} Worker exceptions among ${requests} requests in the last hour. HTTP probes separately check handled server errors.`,
        });
    } catch {
      incomplete.push('usage');
      issues.push({
        id: 'monitor:usage',
        severity: 'warning',
        detail:
          'Cloudflare usage could not be verified. Analytics may be delayed, rate-limited or need renewed access; uptime checks still run.',
      });
    }
    try {
      const raw = await graphql(
        `query { viewer { accounts(filter:{accountTag:"${ACCOUNT}"}) {r2OperationsAdaptiveGroups(limit:100,filter:{datetime_geq:"${date.slice(0, 7)}-01T00:00:00Z",datetime_leq:"${now.toISOString()}"}) {dimensions{actionType} sum{requests}}} } }`,
      );
      const rows = z
        .object({
          r2OperationsAdaptiveGroups: z
            .array(
              z.object({
                dimensions: z.object({ actionType: z.string() }),
                sum: z.object({ requests: number }),
              }),
            )
            .max(99),
        })
        .parse(raw).r2OperationsAdaptiveGroups;
      let classA = 0,
        classB = 0;
      for (const row of rows) {
        if (/^(DeleteObject|DeleteObjects|AbortMultipartUpload)$/.test(row.dimensions.actionType))
          continue;
        if (/^(GetObject|HeadObject)$/.test(row.dimensions.actionType)) classB += row.sum.requests;
        else classA += row.sum.requests; // Conservative upper bound for other operations.
      }
      add('r2-class-a', 'R2 monthly Class A operations (conservative)', classA, 1000000);
      add('r2-class-b', 'R2 monthly Class B operations', classB, 10000000);
    } catch {
      incomplete.push('r2-operations');
      issues.push({
        id: 'monitor:r2-operations',
        severity: 'warning',
        detail:
          'Monthly media-operation usage could not be verified; photo storage and uptime checks are independent.',
      });
    }
    try {
      const settings = z
        .object({
          success: z.literal(true),
          result: z.object({
            bindings: z.array(z.object({ name: z.string(), text: z.string().optional() })),
          }),
        })
        .parse(await request(API + '/settings')).result;
      const schedule = z
        .object({ success: z.literal(true), result: z.object({ schedules: z.array(z.unknown()) }) })
        .parse(await request(API + '/schedules')).result;
      if (settings.bindings.find((binding) => binding.name === 'RUNTIME_KV_BACKEND')?.text !== 'd1')
        issues.push({
          id: 'config:storage',
          severity: 'critical',
          detail:
            'The production private store no longer selects D1; the KV write-quota failure could recur.',
        });
      if (schedule.schedules.length)
        issues.push({
          id: 'config:crons',
          severity: 'critical',
          detail: 'Production cron schedules are no longer empty.',
        });
      for (const name of ['GITHUB_TOKEN', 'SESSION_SECRET'])
        if (!settings.bindings.some((binding) => binding.name === name))
          issues.push({
            id: `config:${name}`,
            severity: 'critical',
            detail: `Required secret binding ${name} is missing. Its value was not read.`,
          });
    } catch {
      incomplete.push('config');
      issues.push({
        id: 'monitor:config',
        severity: 'warning',
        detail:
          'The production storage setting, secret names and cron count could not be verified.',
      });
    }
  } catch {
    incomplete.push('all');
    issues.push({
      id: 'monitor:access',
      severity: 'warning',
      detail:
        'Cloudflare monitoring access needs attention. Public website checks still run; quota levels are unknown.',
    });
  }
  return { metrics, issues, incomplete };
}

async function main(): Promise<void> {
  validateCompanyConfig(
    unstable_readConfig({ config: resolve('wrangler.toml') }, { hideWarnings: true }),
    resolve('wrangler.toml'),
  );
  let previous: MonitorIssue[] = [];
  try {
    previous = z
      .object({ issues: z.array(issueSchema) })
      .parse(
        JSON.parse(await fs.readFile(resolve(stateDirectory, 'state.json'), 'utf8')) as unknown,
      ).issues;
  } catch {
    /* First run or an interrupted state write is a fresh baseline. */
  }
  const now = new Date();
  const [probes, cloudflare] = await Promise.all([websiteChecks(), cloudflareObservation(now)]);
  const current = [
    ...probes.flatMap((probe) => (probe.issue ? [probe.issue] : [])),
    ...cloudflare.issues,
  ];
  // Lost analytics must not falsely announce that a previous quota/config incident recovered.
  const issues = retainUnverifiedIssues(previous, current, cloudflare.incomplete);
  const report = {
    checkedAt: now.toISOString(),
    website: 'https://newgalaxyfurniture.in',
    issues,
    changes: issueChanges(previous, issues),
    probes: probes.map((probe) => ({
      id: probe.id,
      path: probe.path,
      status: probe.status,
      milliseconds: probe.milliseconds,
    })),
    metrics: cloudflare.metrics,
    analyticsIncomplete: cloudflare.incomplete,
  };
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.writeFile(resolve(stateDirectory, 'current.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(
    resolve(stateDirectory, 'state.json'),
    JSON.stringify({ checkedAt: report.checkedAt, issues }, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (issues.some((issue) => issue.severity === 'critical')) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    console.error(
      'Website monitor could not finish. Check local configuration and monitoring access; no private response or credentials were printed.',
    );
    process.exitCode = 1;
  });
}
