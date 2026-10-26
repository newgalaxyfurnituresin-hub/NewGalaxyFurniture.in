/** Company-only, non-destructive copy. Source namespaces and existing SQL values stay intact. */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { unstable_readConfig } from 'wrangler';
import type { ProductionConfig } from './cloudflare-production';

const account = '202e4307d4836b9170f546dbea1783d4';
const database = '0727a2b8-4791-4708-a84b-4b8eff033342';
const namespaces = {
  SESSIONS: '5faf6b288c98463cb21fb4609df2c61a',
  DRAFTS: 'abe3026fdaa049d3b7a8a1973405c897',
  RATELIMIT: 'd8b27da909f442189d7dd63f4c922706',
};
interface Row {
  namespace: string;
  entry_key: string;
  value: string;
  expires_at: number | null;
}
interface Envelope<T> {
  success: boolean;
  result: T;
  result_info?: { cursor?: string };
}
const folder = resolve('.wrangler/runtime-storage-migration-20261026');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

async function main(): Promise<void> {
  const config = unstable_readConfig(
    { config: resolve('wrangler.toml') },
    { hideWarnings: true },
  ) as unknown as ProductionConfig;
  if (
    config.account_id !== account ||
    config.name !== 'newgalaxyfurniture' ||
    !config.d1_databases?.some((item) => item.database_id === database)
  )
    throw new Error('Company target refused.');
  for (const [binding, id] of Object.entries(namespaces))
    if (!config.kv_namespaces?.some((item) => item.binding === binding && item.id === id))
      throw new Error('Source namespace refused.');
  const auth = await fs.readFile('.wrangler/company-auth/.wrangler/config/default.toml', 'utf8');
  const token = auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error('Run company Wrangler whoami first.');
  const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const headers = { authorization: `Bearer ${token}` };
  const api = async <T>(path: string, body?: unknown): Promise<Envelope<T>> => {
    const response = await fetch(apiRoot + path, {
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(
        `Cloudflare request failed: HTTP ${response.status}. No private response was logged.`,
      );
    const result = (await response.json()) as Envelope<T>;
    if (!result.success) throw new Error('Cloudflare refused the operation.');
    return result;
  };
  const info = (await api<{ uuid: string; name: string }>(`/d1/database/${database}`)).result;
  if (info.uuid !== database || info.name !== 'ngf-content')
    throw new Error('Destination database refused.');
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const result = (
      await api<{ success: boolean; results: T[] }[]>(`/d1/database/${database}/query`, {
        sql,
        params,
      })
    ).result;
    if (!result.length || result.some((item) => !item.success))
      throw new Error('SQL operation refused.');
    return result.flatMap((item) => item.results);
  };
  await fs.mkdir(folder, { recursive: true });
  const rows: Row[] = [];
  for (const [namespace, id] of Object.entries(namespaces)) {
    let cursor = '';
    do {
      const page = await api<{ name: string; expiration?: number }[]>(
        `/storage/kv/namespaces/${id}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      for (const key of page.result) {
        if (key.expiration && key.expiration * 1000 <= Date.now()) continue;
        const response = await fetch(
          `${apiRoot}/storage/kv/namespaces/${id}/values/${encodeURIComponent(key.name)}`,
          { headers },
        );
        if (response.status === 404 && key.expiration) continue;
        if (!response.ok) throw new Error(`Private source read failed: HTTP ${response.status}.`);
        const value = new TextDecoder('utf-8', { fatal: true }).decode(
          await response.arrayBuffer(),
        );
        rows.push({
          namespace,
          entry_key: key.name,
          value,
          expires_at: key.expiration ? key.expiration * 1000 : null,
        });
      }
      cursor = page.result_info?.cursor ?? '';
    } while (cursor);
  }
  const snapshot = JSON.stringify({ account, database, exportedAt: Date.now(), rows });
  const filename = `source-${Date.now()}.json`;
  await fs.writeFile(resolve(folder, filename), snapshot, { flag: 'wx' });
  console.log(
    JSON.stringify({
      sourcePreserved: true,
      records: Object.fromEntries(
        Object.keys(namespaces).map((name) => [
          name,
          rows.filter((row) => row.namespace === name).length,
        ]),
      ),
      privateBackup: filename,
      sha256: digest(snapshot),
    }),
  );
  if (!process.argv.includes('--apply')) return;
  await query(await fs.readFile('migrations/0004_runtime_kv.sql', 'utf8'));
  for (const namespace of Object.keys(namespaces)) {
    const selected = rows.filter((row) => row.namespace === namespace);
    for (let offset = 0; offset < selected.length; offset += 20) {
      const batch = selected.slice(offset, offset + 20);
      const read = (): Promise<Row[]> =>
        query<Row>(
          `SELECT namespace, entry_key, value, expires_at FROM runtime_kv WHERE namespace = ? AND entry_key IN (${batch.map(() => '?').join(',')})`,
          [namespace, ...batch.map((row) => row.entry_key)],
        );
      const existing = await read();
      for (const row of existing) {
        const source = batch.find((item) => item.entry_key === row.entry_key)!;
        if (digest(row.value) !== digest(source.value) || row.expires_at !== source.expires_at)
          throw new Error('Existing destination data differs; nothing was overwritten.');
      }
      await query(
        `INSERT INTO runtime_kv (namespace, entry_key, value, expires_at) VALUES ${batch.map(() => '(?, ?, ?, ?)').join(',')} ON CONFLICT(namespace, entry_key) DO NOTHING`,
        batch.flatMap((row) => [row.namespace, row.entry_key, row.value, row.expires_at]),
      );
      const copied = await read();
      if (
        copied.length !== batch.length ||
        copied.some((row) => {
          const source = batch.find((item) => item.entry_key === row.entry_key)!;
          return digest(row.value) !== digest(source.value) || row.expires_at !== source.expires_at;
        })
      )
        throw new Error('Destination verification failed; source remains intact.');
    }
  }
  const report = {
    account,
    database,
    verifiedAt: Date.now(),
    copied: rows.length,
    valueHashesAndExpiryMatch: true,
    sourcePreserved: true,
  };
  await fs.writeFile(resolve(folder, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
void main().catch(() => {
  console.error(
    'Runtime storage migration stopped. No credential or private record was printed; source resources were preserved.',
  );
  process.exitCode = 1;
});
