# Website monitoring

Configured on 26 October 2026 for https://newgalaxyfurniture.in and the company Cloudflare account `202e4307d4836b9170f546dbea1783d4`. Monitoring reads the site and aggregate usage; it does not publish products, submit enquiries, change authentication, or enable paid services.

## Independent Cloudflare error alert

Cloudflare monitor **NGF website server errors** (`7d55eefa08b54eab9397c1550c31b4ca`) is enabled. Every five minutes it checks recorded HTTP responses for the primary and www hostnames. One or more HTTP 5xx responses in the five-minute window triggers an email to **newgalaxyfurnitures.in@gmail.com**. The repeat interval is one hour.

```sql
SELECT COUNT(*) AS value
FROM events.httpRequests
WHERE accountTag = '202e4307d4836b9170f546dbea1783d4'
  AND clientRequestHttpHost IN ('newgalaxyfurniture.in','www.newgalaxyfurniture.in')
  AND edgeResponseStatus >= 500
```

The dashboard confirmed Enabled and accepted the query. No failure was deliberately induced and email receipt has not been tested. This runs at Cloudflare even when the office computer is off. It examines recorded traffic, subject to Cloudflare analytics availability/sampling; it is not an active DNS or availability probe and cannot guarantee detection without traffic.

## Hourly active checks and capacity warnings

The Codex heartbeat **New Galaxy Furniture health watch** runs hourly in this chat. Local automations require the computer to be awake and the Codex app running. It runs:

```powershell
cd C:\Users\Atreus\NewGalaxyFurniture
npm run monitor:website
```

The script checks the homepage, collection, mattress category, sofa repair, login page, unauthenticated session and draft protection, Cloudflare sign-in redirect, robots and sitemap. When a published product exists, it also checks its detail page and a real product image. Expected private-endpoint HTTP 401 responses are healthy; the sign-in handoff must be HTTP 302 to the configured Cloudflare Access team. It checks content as well as status codes, including handled HTTP 500 errors that may not count as Worker exceptions.

Requests omit credentials, never follow sign-in redirects, have time/body limits, and use at most three concurrent fixed probes. A failed or slow response is checked once more before reporting. These are light functional probes, not a load test or an authenticated upload/OTP test.

Cloudflare aggregate analytics also check:

- Workers requests against 100,000/day and recent Worker exceptions.
- D1 rows read against 5 million/day and rows written against 100,000/day.
- D1 storage against 500 MB/database and 5 GB/account.
- R2 storage against the 10 GB free allowance and monthly operations against 1 million Class A / 10 million Class B.
- Production private storage still selects D1, required secret binding names remain present, and production cron schedules remain empty.

Usage warns at **70%** and becomes critical at **90%**. Daily counters use UTC. Storage uses recent peak values, not an exact invoice average. Unknown R2 operation types are conservatively counted as Class A; billing and analytics may lag. These thresholds are warnings, not spending caps or guarantees against short spikes between checks. Review the account plan before changing allowances.

## Reports and notification behavior

Ignored local reports are written to `.wrangler/website-monitor/current.json` and `state.json`. They contain only check paths/status/timing, aggregate counters and sanitized issue descriptions. Response bodies, credentials, signed login URLs and customer records are excluded. Existing private Wrangler authorization is used, with one official CLI refresh attempt if needed; no new permissions are granted.

The heartbeat reports new incidents, severity changes, recoveries and loss of monitoring access. It stays quiet on healthy runs and unchanged incidents. Missing analytics are reported as unknown and cannot falsely clear an earlier quota warning. Public checks continue if Cloudflare analytics access is unavailable. Cloudflare's separate email alert follows its own repeat interval.

If an alert arrives, inspect the sanitized report and Cloudflare logs. Renew expired authorization privately through the official login flow if requested. Do not restore the old KV-backed private store: its free daily write quota caused the earlier login outage. Monitoring itself must not alter production, deploy, purchase services, delete data or weaken access controls.

## Verification

The initial complete run passed all **12 live checks**, with no active issues or incomplete analytics. At that observation, Workers daily requests were approximately 1.84%, D1 daily writes 0.06%, and R2 storage 0.54% of the checked allowances.

Eight unit tests cover server-error detection, authentication responses and redirect restrictions, content/media checks, retries and privacy, bounded concurrency/product discovery, quota boundaries, deduplication and recovery, and retaining incidents when analytics disappear. Type checking and the repository lint/security checks passed. No application deployment or production cron was needed for monitoring.

References: [Cloudflare Monitors](https://developers.cloudflare.com/notifications/monitors/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), and [local Codex automation requirements](https://developers.openai.com/codex/app/automations/).
