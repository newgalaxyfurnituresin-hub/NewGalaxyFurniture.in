# Catalogue capacity verification — 25 October 2026

The target verified here is 500–1,000 listings, across the existing category model. This is not an unlimited-capacity or zero-failure guarantee, and it is not a test of 1,000 simultaneous visitors.

## Changes

- Collection, category and mattress pages initially render 18 cards. Filtering and sorting apply to the entire published index. The next page downloads only missing, build-versioned cards, with at most four concurrent requests. Old cards are removed so the active grid stays bounded. Failed downloads retain the previous page and offer a retry.
- Static `/browse/{scope}/{page}` pages keep the catalogue browsable without JavaScript. Their canonical URLs, unique metadata and sitemap entries are generated at build time.
- Cards reuse the existing Astro ProductCard component, including real prices, stock, product links and delegated enquiry controls. Static card JSON contains only published products. Standalone source scripts/styles are removed; the host supplies the existing image handler and styling. Versioning includes product edits, card/image templates and public business settings.
- DOM order follows the selected sort, including when parallel downloads finish out of order.
- Gallery boards are split into two-product pages, with complete product-photo links retained. The homepage hero has at most five product slides plus its supplied opening image.
- Admin sends only 25 rows to the browser. Search, category/status filters and page changes use the authenticated paginated API, with cancellation and a short debounce. Existing results remain on request failure.
- A private deployed summary snapshot can restore the admin cache without one GitHub read per product. It only fills missing entries confirmed present by the repository, preserving existing working rows. Unknown entries are reconciled at most 20 per request. Recovery reports remaining work; admin offers **Sync more products**. The explicit rehydrate API returns `nextOffset` for bounded continuation requests.
- GitHub directory listings at the 1,000-entry Contents API boundary switch to non-recursive Git trees. Truncated tree responses are rejected instead of silently returning partial inventory.
- Search uses indexed document lookups rather than repeated full-array scans. Multi-select facet counts use one pass per dimension rather than one catalogue scan per distinct option. Complete SKU queries select the exact product. Embedded preview-image data stays on cards and is omitted from global search and admin summaries.

No schema migrations, production test products, customer records, administrator accounts, paid plans or cron schedules were introduced.

## Evidence

An ignored isolated project under `.wrangler/catalogue-scale-20261025/project` was populated with 1,000 clearly synthetic products across all 12 existing categories. The ordinary three product records were preserved in that copy: 1,003 records total, 1,001 public. No synthetic record was pushed or deployed. Its build caches are separate from the real site's caches.

- 1,632 generated HTML pages passed SEO, CSP, DOM/hydration/preload, image-loading, motion and keyword-density checks.
- Largest measured page: 969 elements, below the unchanged 1,500-element gate.
- Search: 315,509 bytes raw; 10,672 bytes Brotli for 1,001 public entries, below the unchanged 60 KiB gate.
- Isolated Worker dry run: approximately 9,821 KiB uncompressed, 2,924 KiB gzip. No capacity fixture was deployed.
- Eleven capacity browser scenarios passed: public paging, both price sorts, exact SKU lookup, mattress browsing, enquiry dialog focus/Escape, no-JavaScript paging, failed-download recovery, paginated admin searching/empty states, and completing bounded cache recovery with visible progress. Device widths: 375, 768, 1024 and 1440 pixels. These are simulated browser viewports, not physical-device certification.
- The full release gate passed 1,224 unit/property tests, content validation, types, lint, production build, asset-size budgets and output secret scanning.
- All 16 existing multi-photo/colour browser scenarios also passed, including tablet touch pickers, partial upload recovery, colour stock, gallery selection and accessibility.
- Unit regressions cover complete 1,000-row pagination, all six public sort modes, category filtering, 1,000-summary cache restoration without per-file reads, 20-read recovery batches and a 1,250-file repository listing.

## Capacity limits and operation

Cloudflare's current documented bundle limit is 64 MiB uncompressed; gzip size is informational. Workers Free still has 10 ms CPU per HTTP request, 128 MB memory and 100,000 dynamic requests per day. Static file, Images transformation, R2, KV and GitHub API quotas also apply. Reference: https://developers.cloudflare.com/workers/platform/limits/ . No subscription was enabled.

Inventory size is different from visitor concurrency. Public product/browse/gallery/card files are built ahead of time and delivered as static assets; images, authenticated admin and enquiries still use runtime services. Richer content, much higher traffic or thousands more records require fresh measurements and may need a larger plan or a database-backed catalogue/search architecture. Existing dependency-audit findings in legacy Netlify tooling remain separate from this capacity work.

The scale fixture intentionally uses synthetic photo references, with image requests mocked for browser capacity tests. It verifies listing/layout/navigation behavior, not the authenticity or availability of 1,000 real furniture photos. Live checks use the real published product and installed media.
