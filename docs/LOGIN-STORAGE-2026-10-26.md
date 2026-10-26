# Admin HTTP 500 and private runtime storage — 26 October 2026

## Confirmed cause

Anonymous requests to `/api/admin/session` and `/api/admin/editor-drafts` returned empty HTTP 500 responses. Live Worker logs identified `KV put() limit exceeded for the day` in the admin rate-limit counter, before authentication ran. Sign-in also needs writes for its rate counter and new opaque session. Workers KV Free includes 1,000 writes per day across the account; changing browser caches cannot repair this server-side quota failure.

These errors were handled by Astro and logged with Worker outcome `ok`. A zero-exception version chart therefore did not establish that HTTP responses were successful. Verify status codes and redacted runtime logs as well as the exception chart.

## Fix

With `RUNTIME_KV_BACKEND=d1`, the Cloudflare resolver implements the existing `KeyValueStore` contract using the existing company D1 database's new `runtime_kv` table. Sessions, draft state, upload jobs, advisory locks and rate counters retain their namespace, keys, expiry and authorization checks. No rate limit, company-email restriction, JWT verification, password protection or CSRF/origin check was removed. Existing KV bindings remain attached and their contents remain intact.

Reads and updates use the composite primary key. Lists use indexed key ranges and bounded 1,000-key cursor pages, preserving Unicode and literal wildcard prefixes. Expired values are excluded without delete-on-read writes. Expired rows can be removed during maintenance; no cron was added. This raises the practical write allowance using an already available free service; D1 and Worker quotas still apply. It is not unlimited storage or throughput.

The middleware also converts dependency failures into private, non-cacheable HTTP 503 envelopes with a retry hint, rather than an empty unhandled page. Failed operations remain refused; dependency failures do not grant access.

## Safe copy

`scripts/migrate-runtime-kv.ts` verifies the company Worker, account, namespace IDs and destination database. Without `--apply` it only exports. The apply mode creates the additive table, refuses differing destination records, copies in parameterized batches and verifies every value's SHA-256 and absolute expiry. It never writes, deletes or empties the source KV namespaces.

Before the copy, a full private D1 backup was saved under ignored `.wrangler/`. A separate ignored source export contains the 25 runtime records: one session and 24 DRAFTS entries, with no active RATELIMIT entries at export. All 25 copied values and expiry times matched. Private backup contents, session identifiers and credentials were not printed or committed.

Do not rerun the source copy over an actively used SQL store: it intentionally refuses different records. Returning to an old KV-only version without copying newer state back would lose visibility of later SQL edits. Keep the D1 adapter during code rollback, or prepare and verify a separate data migration first.

## Validation

Storage tests cover namespace isolation, JSON/text reads, immediate overwrite/deletion, expiry, 1,005-entry pagination, Unicode/wildcard prefixes, foreign-prefix cursor rejection, opaque session creation and rate enforcement after 1,200 writes. The ordinary release gate, photo/colour regressions and editor recovery checks also apply. Recovery follow-up tests verify a new online autosave after a successful manual Save, and confirmed discard restores the current stored product.

Final complete suite: 1,238 tests in 99 files passed. Production build, type checks, lint/security checks, output secret scan and transfer-size budgets passed. Seven recovery and 16 photo/colour browser scenarios passed; the repeated-save regression additionally waited for an existing online recovery revision before verifying the next save. The seventh scenario checks continued typing during a delayed online save. Recovery comparisons ignore object-key ordering introduced by server validation, while preserving array order.

Live verification after the storage release: public homepage, catalogue, mattresses, repair, real product, robots and sitemap returned HTTP 200; eight public image requests returned image responses. Private environment-file paths returned 404. Anonymous session/recovery reads and a recovery write returned 401. The deployed backend was `d1`, cron count was zero and installed secret bindings remained present. A verified company sign-in reached the dashboard; the user also confirmed their own browser opened it. An incomplete, temporary recovery workspace survived refresh and appeared in the private resume list without creating or publishing a catalogue product.

No paid plan, new administrator, custom domain, secret or cron schedule was introduced.

Sources: [Workers KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/).
