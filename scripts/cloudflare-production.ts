/** Checked production build/deploy commands shared by local operators and Workers Builds. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_readConfig } from 'wrangler';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILT_CONFIG = resolve(ROOT, 'dist/server/wrangler.json');
const ACCOUNT = '202e4307d4836b9170f546dbea1783d4';
const REPOSITORY = 'newgalaxyfurnituresin-hub/NewGalaxyFurniture.in';
const SITE = 'https://newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev';

export interface ProductionConfig {
  routes?: { pattern?: string; custom_domain?: boolean; zone_id?: string }[];
  name?: string;
  account_id?: string;
  triggers?: { crons?: string[] };
  assets?: { binding?: string; directory?: string };
  vars?: Record<string, unknown>;
  d1_databases?: { binding: string; database_id: string }[];
  kv_namespaces?: { binding: string; id: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
}

/** Refuse wrong-account, preview, missing-storage, scheduled or credential-bearing artifacts. */
export function validateCompanyConfig(value: unknown, configPath: string): void {
  if (typeof value !== 'object' || value === null)
    throw new Error('Production configuration refused: missing object');
  const config = value as ProductionConfig;
  const refuse = (condition: boolean, reason: string): void => {
    if (!condition) throw new Error(`Production configuration refused: ${reason}`);
  };
  refuse(
    config.name === 'newgalaxyfurniture' && config.account_id === ACCOUNT,
    'company Worker identity',
  );
  refuse(
    Array.isArray(config.triggers?.crons) && config.triggers.crons.length === 0,
    'cron schedules must be empty',
  );
  refuse(
    config.assets?.binding === 'ASSETS' &&
      typeof config.assets.directory === 'string' &&
      resolve(dirname(configPath), config.assets.directory) === resolve(ROOT, 'dist/client'),
    'public client assets directory',
  );
  refuse(
    config.vars?.GITHUB_REPO === REPOSITORY && config.vars.GITHUB_BRANCH === 'main',
    'company content repository',
  );
  refuse(config.vars?.PUBLIC_SITE_URL === SITE, 'production canonical URL');
  refuse(
    config.routes?.length === 2 &&
      ['newgalaxyfurniture.in', 'www.newgalaxyfurniture.in'].every((hostname) =>
        config.routes?.some(
          (route) =>
            route.pattern === hostname &&
            route.custom_domain === true &&
            route.zone_id === 'e2a8b54e03b144580ecad35cc5479a17',
        ),
      ),
    'verified company custom domains',
  );
  refuse(
    config.vars?.CF_ACCESS_TEAM_DOMAIN === 'https://winter-firefly-d5dd.cloudflareaccess.com' &&
      config.vars.CF_ACCESS_AUD ===
        '5490a1a64c3f09635f1442a0a2dbec2f3f4791470971bd8ff414eccda031278b',
    'owner sign-in configuration',
  );
  for (const name of ['GITHUB_TOKEN', 'SESSION_SECRET', 'AI_API_KEY', 'CF_API_TOKEN']) {
    refuse(!Object.hasOwn(config.vars ?? {}, name), 'secrets must remain runtime secrets');
  }
  refuse(
    config.d1_databases?.length === 1 &&
      config.d1_databases[0]?.binding === 'DB' &&
      config.d1_databases[0]?.database_id === '0727a2b8-4791-4708-a84b-4b8eff033342',
    'company database',
  );
  const namespaces = new Map(config.kv_namespaces?.map((binding) => [binding.binding, binding.id]));
  refuse(
    config.kv_namespaces?.length === 3 &&
      namespaces.get('SESSIONS') === '5faf6b288c98463cb21fb4609df2c61a' &&
      namespaces.get('DRAFTS') === 'abe3026fdaa049d3b7a8a1973405c897' &&
      namespaces.get('RATELIMIT') === 'd8b27da909f442189d7dd63f4c922706',
    'company key-value storage',
  );
  refuse(
    config.r2_buckets?.length === 1 &&
      config.r2_buckets[0]?.binding === 'MEDIA' &&
      config.r2_buckets[0]?.bucket_name === 'ngf-media',
    'company media bucket',
  );
}

function runNode(args: string[], publicBuild = false): void {
  const env: NodeJS.ProcessEnv = { ...process.env, DEPLOY_TARGET: 'cloudflare' };
  // Unit tests supply their own configuration, including the missing-setting cases.
  // Only the real production build receives the canonical URL as a build variable.
  if (publicBuild) env.PUBLIC_SITE_URL = SITE;
  else delete env.PUBLIC_SITE_URL;
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });
  if (result.error || result.status !== 0)
    throw new Error('Production command failed; deployment stopped.');
}

function main(): void {
  if (process.env.CLOUDFLARE_ENV)
    throw new Error('Production command cannot select a preview environment.');
  const mode = process.argv[2];
  if (mode === 'build') {
    validateCompanyConfig(
      unstable_readConfig({ config: resolve(ROOT, 'wrangler.toml') }, { hideWarnings: true }),
      resolve(ROOT, 'wrangler.toml'),
    );
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Run through npm run build:cloudflare.');
    for (const script of [
      'validate:content',
      'check',
      'lint',
      'test',
      'build',
      'size-limit',
      'scan:secrets',
    ]) {
      runNode([npm, 'run', script], script === 'build');
    }
    validateCompanyConfig(JSON.parse(readFileSync(BUILT_CONFIG, 'utf8')), BUILT_CONFIG);
    console.log('Company production build and deployment guards passed.');
  } else if (mode === 'deploy') {
    validateCompanyConfig(JSON.parse(readFileSync(BUILT_CONFIG, 'utf8')), BUILT_CONFIG);
    const commit = process.env.WORKERS_CI_COMMIT_SHA;
    const message =
      commit && /^[0-9a-f]{40}$/.test(commit) ? ['--message', `GitHub ${commit}`] : [];
    // Preserve the installed runtime secrets. They never enter the repository or build environment.
    runNode([
      resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
      'deploy',
      '--config',
      BUILT_CONFIG,
      '--keep-vars',
      ...message,
    ]);
  } else throw new Error('Expected build or deploy.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
