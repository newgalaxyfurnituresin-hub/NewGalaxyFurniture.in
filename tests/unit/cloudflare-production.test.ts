import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { validateCompanyConfig, type ProductionConfig } from '../../scripts/cloudflare-production';

const configPath = resolve('wrangler.toml');
const config = (): ProductionConfig =>
  structuredClone(
    unstable_readConfig(
      { config: configPath },
      { hideWarnings: true },
    ) as unknown as ProductionConfig,
  );
describe('company production deployment guards', () => {
  it('accepts the verified company configuration', () => {
    expect(() => validateCompanyConfig(config(), configPath)).not.toThrow();
  });
  it.each([
    'https://newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev',
    'https://www.newgalaxyfurniture.in',
    'http://newgalaxyfurniture.in',
  ])('rejects a noncanonical production address: %s', (site) => {
    const value = config();
    (value.vars as Record<string, unknown>).PUBLIC_SITE_URL = site;
    expect(() => validateCompanyConfig(value, configPath)).toThrow('canonical URL');
  });
  it('rejects missing or wrong-zone domain attachments', () => {
    const value = config();
    value.routes = [
      { pattern: 'newgalaxyfurniture.in', custom_domain: true, zone_id: 'wrong-zone' },
    ];
    expect(() => validateCompanyConfig(value, configPath)).toThrow('custom domains');
  });
  it.each(['account_id', 'name'] as const)('rejects a changed %s', (field) => {
    const value = config();
    value[field] = 'wrong-target';
    expect(() => validateCompanyConfig(value, configPath)).toThrow('company Worker identity');
  });
  it('rejects enabled cron schedules and exposed server assets', () => {
    const cron = config();
    (cron.triggers as { crons: string[] }).crons = ['0 0 * * *'];
    expect(() => validateCompanyConfig(cron, configPath)).toThrow('cron');
    const assets = config();
    (assets.assets as { directory: string }).directory = './dist';
    expect(() => validateCompanyConfig(assets, configPath)).toThrow('assets');
  });
  it('requires the old homepage redirect without routing every asset through the Worker', () => {
    for (const routing of [false, true, ['/*']]) {
      const value = config();
      value.assets!.run_worker_first = routing;
      expect(() => validateCompanyConfig(value, configPath)).toThrow('host redirect routing');
    }
  });
  it('rejects the old repository and credentials placed in public configuration', () => {
    const old = config();
    (old.vars as Record<string, unknown>).GITHUB_REPO = 'Website-Deploys/NewGalaxyFurniture';
    expect(() => validateCompanyConfig(old, configPath)).toThrow('repository');
    const secret = config();
    (secret.vars as Record<string, unknown>).GITHUB_TOKEN = 'synthetic-forbidden-value';
    expect(() => validateCompanyConfig(secret, configPath)).toThrow('secrets');
  });
  it('rejects personal database identifiers and missing owner sign-in configuration', () => {
    const db = config();
    (db.d1_databases as { database_id: string }[])[0]!.database_id = 'wrong-database';
    expect(() => validateCompanyConfig(db, configPath)).toThrow('database');
    const auth = config();
    delete (auth.vars as Record<string, unknown>).CF_ACCESS_AUD;
    expect(() => validateCompanyConfig(auth, configPath)).toThrow('sign-in');
  });
});
