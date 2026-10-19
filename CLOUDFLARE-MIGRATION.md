# Company Cloudflare launch — updated 19 October 2026

Live URL: <https://newgalaxyfurniture.in/>

## Custom domain activated and verified — 19 October 2026

- The `.in` registry now delegates to `georgia.ns.cloudflare.com` and `lou.ns.cloudflare.com`.
- The company Cloudflare zone is active and its free Universal SSL certificate is active.
- `https://newgalaxyfurniture.in/` returns HTTP 200 directly, without forwarding to workers.dev.
- HTTP requests and the `www` hostname redirect to HTTPS on the root domain; paths and query strings are preserved.
- `PUBLIC_SITE_URL`, production build guards, canonical URLs, sitemap and robots use the purchased domain.
- The existing owner-only Access application additionally protects `newgalaxyfurniture.in/api/admin/access`.
  Owner sign-in and the authenticated dashboard were verified on the purchased domain.
- All 31 public pages passed live checks without redirecting to the temporary hostname.
- The custom-domain build passed 76 suites and 1,086 tests, with all configured production and security checks.
- The deployment preserves existing resources, secrets, company GitHub bindings and empty production cron schedules.

## Earlier migration and launch verification

**The public website and owner administrator login are live in the company account. Public and authenticated browser checks pass. The company repository credential passed an isolated read/write test. A real push to company main automatically built and deployed successfully through Cloudflare Workers Builds. The separate GitHub Lighthouse audit still reports performance/image and contrast issues, detailed below.**

## Verified destination

- Identity: `newgalaxyfurnitures.in@gmail.com`.
- Account: `202e4307d4836b9170f546dbea1783d4`.
- Worker: `newgalaxyfurniture`.
- Verified automatic deployment: `525049ed-0f61-41f0-b45d-bb6607ee0b51`, serving 100% of traffic.
- Source commit: `4f7beb6ba8d55804747a67e74967276370cc0c18` on company main.
- Application and runtime secrets uploaded together; deployment succeeded.
- Assets come from `dist/client`; server code is separate.
- Cloudflare API verified the installed bindings and secret names.
- Cloudflare API verified **zero production cron schedules**. Analytics scheduling remains disabled.

| Binding   | Destination resource  | Identifier                             |
| --------- | --------------------- | -------------------------------------- |
| DB        | D1 `ngf-content`      | `0727a2b8-4791-4708-a84b-4b8eff033342` |
| SESSIONS  | KV `SESSIONS`         | `5faf6b288c98463cb21fb4609df2c61a`     |
| DRAFTS    | KV `DRAFTS`           | `abe3026fdaa049d3b7a8a1973405c897`     |
| RATELIMIT | KV `RATELIMIT`        | `d8b27da909f442189d7dd63f4c922706`     |
| MEDIA     | R2 `ngf-media`        | `ngf-media`                            |
| ASSETS    | Workers static assets | `dist/client`                          |

D1 and KV were created earlier in this migration and reused at launch. R2 was enabled by the owner,
then its empty bucket inventory was verified and `ngf-media` was created. No paid plan or billing
terms were accepted by the assistant.

## Data and credentials

- All three project D1 migrations applied in order and verified through the migration table.
- Exactly **one ACTIVE owner** verified using only role/status counts. The owner was provisioned by
  the user in the private terminal, using the runtime password hash and a minimum 12-character password.
- No administrator email, password, hash, API token, or session cookie is recorded in this report.
- `GITHUB_TOKEN` and a fresh `SESSION_SECRET` are installed as Cloudflare `secret_text` bindings.
  Values were supplied from the Git-ignored private preparation file, never from source control.
- The company website token was privately entered and its identity/repository access verified.
  Minimum intended PAT permissions are Contents read/write on
  `newgalaxyfurnituresin-hub/NewGalaxyFurniture.in` only, with Metadata read.
  The replacement company credential passed an isolated branch create/write/read/cleanup test;
  company main and all existing content remained unchanged.
- `GITHUB_REPO=newgalaxyfurnituresin-hub/NewGalaxyFurniture.in`, `GITHUB_BRANCH=main` are non-secret variables.
- Optional AI and deployment-status credentials remain unset rather than using unverified values.
- **48 media objects, 13,461,103 bytes** restored from the existing local backup to company R2.
  Every object was downloaded again and verified byte for byte. Different existing destination
  objects would have stopped the transfer rather than being overwritten.
- All 48 public `/img/**` responses also matched their backup bytes after deployment.

## Source preservation

Source identity: `manojmr1608@gmail.com`, account `b6de0abcb925a7416f4f897f7479e71c`.
Source credentials remain intact; company OAuth credentials are stored separately under Git-ignored
`.wrangler/company-auth`.

Source D1 `deff371f-d6e6-4172-ba16-4b4f9f52d5fa` had the schema already applied and zero rows in
`admin_users`, `leads`, `event_daily`, `search_queries`, and `login_attempts`. Source SESSIONS,
DRAFTS, and RATELIMIT had zero keys; source R2 had zero objects/bytes. No database/customer records
needed copying. Temporary sessions and rate limits started fresh.

The existing local backup at `.agents/tasks/task-publish-brown-sofa/r2-export/manifest.json` contained
4 originals and 44 derivatives mapped to the current brown-sofa product. It remains intact.
No source Worker, database, namespace, bucket, backup, credential, or untracked user artifact was deleted.

## Validation completed

- **71 unit/property suites, 1,056 tests passed**.
- Astro/TypeScript check: zero errors and zero warnings; 21 informational hints.
- Full lint and formatting passed. Screenshot helper browser globals/catches were fixed; 25 existing
  tracked files were formatted. Two source-layout assertions now tolerate formatting whitespace
  between the same required attributes.
- Production Cloudflare build, SEO, CSP, motion, page-budget, image-loading, keyword, and size checks passed.
- Secret-pattern scanning passed; local credential candidates were also absent from generated output.
- Generated configuration was checked for company account/bindings, separate assets, and empty crons;
  it contained none of the personal production resource IDs.
- Fixed a raw caught-error log in draft reconciliation to use the existing redacting logger.
- **Live public verification passed: 37 page/security checks, 59 static assets, 48 media responses**.
  This includes sitemap pages, canonical URLs, robots, public pages, login page, protected route denial,
  CSP/nosniff/HSTS headers, and 404 responses for private configuration/server-bundle paths.
- **16 live browser checks passed** across 1440px and 390px widths, including ten page render checks,
  mobile menu open/Escape, live catalogue search suggestions, image loading, and runtime/network errors.
  Browser verification suppressed its own analytics beacons to avoid polluting production aggregates.
- Live Worker tail inspection observed three successful requests with **no exceptions or error logs**.
  Request headers, cookies, request bodies, and log values were omitted from the saved summaries;
  only the temporary inspection session created for this test was removed afterward.
- Local isolated storage also passed media restoration, login, owner-session lookup, dashboard,
  GitHub product reads, CSRF denial, logout, and revoked-session rejection. The local development
  proxy required a retry after a reproducible connection-loss response; this was recorded explicitly.
  The temporary local owner fixture was removed. Production owner credentials were not used locally.

## Administrator sign-in verified

- Native hosted PBKDF2 rejects the existing 600,000-round password hash. A full-strength JavaScript
  fallback reached resource error 1102 in a non-active preview. No password work factor was lowered,
  no password was reset, and no paid plan was enabled by the assistant.
- The user enabled Zero Trust Free and completed the private company dashboard login. A self-hosted
  Access application was created through that authenticated dashboard because the deployment OAuth
  credential cannot configure Access. Its application lists under that OAuth credential are incomplete;
  do not treat empty lists as proof that dashboard resources do not exist.
- App ID: `525b6643-d5ce-4200-b0c0-08c1f5449903`; policy ID:
  `e25c3486-1d23-4ca7-a8d0-749f7708987a`. The sole Allow rule matches the confirmed owner email.
- Exact protected destination: `newgalaxyfurniture.newgalaxyfurnitures-in.workers.dev/api/admin/access`.
  Session duration is 12 hours; Access cookies are HTTP-only and scoped to that path. App Launcher
  visibility is off. The public catalogue is not behind Access.
- Team: `https://winter-firefly-d5dd.cloudflareaccess.com`; public audience:
  `5490a1a64c3f09635f1442a0a2dbec2f3f4791470971bd8ff414eccda031278b`.
- The actual available sign-in method is **Cloudflare account sign-in**, verified live using the
  existing company dashboard session. The website button accurately says “Sign in with Cloudflare.”
  An email-code provider was not separately created or tested.
- The owner's stored email had a missing “a” in “galaxy.” After the user confirmed the correct address,
  one guarded update corrected only that email. The account ID, role and password hash were retained.
  A safe count verified exactly one ACTIVE owner and one match to the confirmed email.
- Pinned `jose@6.2.12` verifies RS256 signatures, exact issuer/audience, expiry, issue time and human
  identity against the team's public JWKS. The application then requires the existing ACTIVE owner.
  A same-origin confirmation POST creates the existing opaque session; roles, CSRF, secure cookies,
  logout and server-side revocation remain in place. Unsigned identity headers confer no access.
- **Live sign-in succeeded twice**, including on the final version: Access identity validation,
  app-session creation, owner dashboard, GitHub-backed products/editor, categories, homepage, content
  and settings reads. Sign-out returned to login and a subsequent dashboard visit was denied.
  No catalogue, lead, product or media record was changed during those browser tests.
- A redacted runtime trace captured five requests, including GET and POST sign-in exchange and the
  authenticated dashboard/settings, with zero exceptions or error logs. Final unauthenticated probes
  also verified dashboard redirect, session 401, incompatible password login 409 and Access challenge
  despite forged identity headers. Local/unit tests cover CSRF rejection and forged/expired/wrong-app
  tokens; no authenticated production CSRF-forgery test was performed.
- All 1,050 tests, type checks, full lint/security-error audits, production build, SEO/CSP/image/motion
  budgets, bundle limits and generated-output secret scanning pass. The final company Worker version
  is 100% active; the API confirms all required bindings/secrets and `schedules: []`.
- Screenshot: `.wrangler/company-live-admin-dashboard.jpg`. Evidence:
  `company-admin-runtime-results.json`, `company-access-final-state.json`,
  `company-access-final-security.json`, and `company-access-final-deploy.log`.

## Pending checks and limitations

### Company GitHub migration and automatic deployment verified

The user selected `newgalaxyfurnituresin-hub/NewGalaxyFurniture.in` and authorized pushing all
migration changes and enabling automatic updates. This is a separate new public repository,
ID `1423101174`, whose initial commit `952b1532aba077c000b23d06ac9785fa23d55a6b` contained only a README.
The original public repository remains `Website-Deploys/NewGalaxyFurniture`, ID `1354912514`.
Both histories are preserved in company main `3a3b63186fb941868d3ca3b870f1650350c49f58`, including
the user's latest draft commit `f5eb8a38c6f5af2b0efe9de417b190f23d94ec32`. All ten original development
branches were also copied without force. The original repository and all local user artifacts remain intact.
The company repository is now local `origin`; the original remains available as `personal`.

The user completed private company Git authentication and entered a company-owned fine-grained
website token for Contents read/write on the new repository. Its identity and repository role were
verified without exposing its value. The existing session secret and old credential files remain intact.
New private values are under the Git-ignored `.wrangler/company-repository-secrets.json`.

The checked automatic build command is `npm run build:cloudflare`; deployment uses
`npm run deploy:cloudflare`. The complete pipeline passes **71 suites / 1,056 tests**, type/lint checks,
production build, budgets and secret scanning. Guards pin company account, Worker, database, KV,
media bucket, repository, canonical URL, owner authentication and empty cron schedules. Tests use
their own isolated configuration; only the real production build receives the canonical URL.
Routine deployment preserves installed Worker secrets with `--keep-vars`.

Cloudflare's repository connection was saved after explicit user approval for its automatic-build
API credential. It targets the company repository, branch `main`, root `/`, the checked commands,
and no preview builds. The dashboard confirms builds are enabled.
Repository push and the atomic runtime credential switch have succeeded. The deployed version
above uses the company repository and company token, preserving the session secret. A fresh live
check passed all 37 page/security checks, 59 assets and 48 restored media objects; owner sign-in
and all three catalogue records also passed.

Pushing commit `4f7beb6ba8d55804747a67e74967276370cc0c18` triggered build
`b1749fcb-3951-451c-bb13-21d6b6462a04`, which completed successfully in 3 minutes 15 seconds.
The clean Cloudflare build passed 71 suites (1,055 tests passed, one pre-build output check skipped),
types (zero errors/warnings), lint, content, production build, budgets and secret scanning. The
automatic deployment above was verified through both the dashboard and authenticated API.
Post-deployment verification again passed all 37 page/security checks, 59 assets and 48 media
responses. Owner session and company catalogue reads still work; both secret bindings remain
installed and the actual production schedules remain empty. Routine main pushes now rebuild and
deploy without a local terminal. Draft edits stay unpublished; publishing requires a successful build.

GitHub CI clean installation initially failed because npm 10 required a missing nested optional
PGlite peer entry. The eight-line lockfile repair preserves all existing dependency versions and
passes npm 10 clean-install validation. The next GitHub run passed installation, content, types,
lint, all tests, production build, budgets and secret scanning. Its separate Lighthouse stage
still reports performance/image and About-page contrast failures; no thresholds were weakened.

1. **GitHub writes verified:** after the user explicitly approved the prepared isolated test,
   the private production credential created a new disposable codex branch and wrote/read back a
   harmless JSON fixture successfully. The test verified the branch head before deleting only that
   test branch, then confirmed its reference returns 404. Main's head was unchanged. No existing
   branch or catalogue file was modified. Evidence: `.wrangler/company-github-write-results.json`.
   This resolves the earlier automatic-review blocker for that test. Authenticated admin saves on
   production main were not exercised; repository writes and live admin reads were tested separately.
2. **Automatic publishing:** Cloudflare Workers Builds is now connected through the company
   dashboard, using its approved deployment credential. The existing GitHub deployment workflow
   remains an additional manual fallback. The real push-triggered build and production rollout
   passed verification. No existing deployment or security gate was disabled. The independent
   GitHub Lighthouse stage remains red for the recorded performance/image and contrast issues;
   this report does not claim those audits pass.
3. **Custom domain:** `newgalaxyfurniture.in` has not been purchased, connected, or verified. The
   workers.dev URL above is the actual working public URL. No domain purchase was attempted.
4. **Deleted-media expiration:** automatic approval review rejected the proposed 30-day `deleted/`
   lifecycle deletion rule because persistent deletion was not explicitly authorized. The rule was
   not added or retried. Media remains recoverable without automatic expiration; active media and
   source resources are preserved. The bucket's default incomplete-multipart-abort rule is unchanged.
5. **Git:** reviewed migration changes and both repository histories were committed and pushed to
   company main with the user's authorization. All ten original development branches are preserved
   in the company repository. No history rewrite, reset, clean, or stash was performed; the original
   personal repository was not pushed. All originally untracked artifacts remain present. Never commit `.wrangler`,
   `.dev.vars`, local credentials, database exports, or generated private data.

Deployment and test evidence are under the Git-ignored `.wrangler` directory: `company-deploy.log`,
`company-media-transfer.json`, `company-live-public-results.json`, `company-live-browser-results.json`,
`company-live-runtime-results.json`, and the build/check/test/lint/budget logs. These are local evidence,
not files to upload as static assets or commit to Git.

The existing Content screen reports 23 missing real-content keys. These were not invented or filled
with fabricated business details. The custom domain remains unpurchased.
