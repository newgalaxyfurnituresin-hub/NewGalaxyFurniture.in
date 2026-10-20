# Feature integration audit — 20 October 2026

Audited product colours and per-colour stock, mandatory colour photographs, gallery selection, original preservation and 4K review, SKU-confirmed deletion, and their interaction with existing editing, duplication, publication, search and enquiries.

Two integration defects were fixed:

- The open editor retained colour photo references after the existing image remover deleted a photograph. It now removes stale references immediately while retaining references to originals replaced by a reviewed 4K copy. Saving after removal no longer requires a reload.
- Product duplication changed the product ID but retained photo records without copying the media into the new product's storage. Duplication now copies originals, derivatives and preserved enhancement sources before creating the draft, rewrites the storage references, preserves colour assignments, refuses occupied destinations and missing source photographs, and never deletes or overwrites source media. Removing a duplicate's image does not remove the original's image.

Validation performed:

- Full unit/property and API suite, type checking, lint and formatting, guarded company production build, SEO and canonical checks, CSP and error-disclosure checks, image-loading and motion checks, bundle budgets, and generated-asset secret scanning.
- Six colour-editor/customer widths: 320, 375, 430, 768, 1024 and 1440 pixels. Covered adding and saving colours, photo uploads and assignment, swatches, per-colour and size availability, keyboard selection, colour-specific enquiries, gallery switching, late gallery hydration, 4K replacement, and removing an assigned image through the existing image manager.
- Existing 4K queue, offline feedback, review, application, failed-job retry and new-upload feedback at phone, tablet and desktop widths.
- SKU mismatch, product preview, cancellation, final confirmation, single submission, editor removal and verification of public removal at 320, 768 and 1440 pixels.
- WCAG A/AA checks on the colour-photo admin editor at 375, 768 and 1440 pixels.
- Live read-only sweep of all 28 public pages at 320, 375, 430, 768, 1024, 1366 and 1440 pixels: 196 layout checks, with no horizontal overflow, browser page errors or failed site assets.
- Eighteen live WCAG A/AA checks across the homepage, sofa collection, published sofa, sofa repair, mattresses and contact pages. No violations found; Google's embedded map content was excluded from the application's DOM audit.
- Live internal links returned successfully. Anonymous requests to the product, enhancement-status and protected-preview APIs returned 401. Existing company-identity regression tests cover foreign, disabled, deleted and downgraded sessions and database failures.
- The previous automatic Cloudflare build completed successfully. Production cron configuration remains empty.

Final local release gate passed: 1,194 tests in 92 files, zero type-check errors or warnings, formatting and lint, the Cloudflare production build and all post-build guards. Sixteen targeted browser scenarios passed, including three admin accessibility viewports. Combined with the live checks, 21 accessibility viewport checks passed.

The production dependency audit reported 13 high-severity affected packages in the retained Netlify adapter dependency chain, including transitive sharp, braces and node-forge findings. This is an outstanding dependency-maintenance finding, not a clean dependency audit. Cloudflare uses its own runtime adapter and WASM image codecs; sharp is also used for build-time image optimization, so the finding must not be dismissed as universally unreachable. No vulnerable package implementation was identified in the generated Worker by the targeted bundle inspection. npm's proposed automatic remediation downgrades the Netlify adapter across a major version; it was not applied blindly during this feature fix. Resolve this separately with compatible dependency upgrades and validation of both supported build targets. See the upstream [sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) and [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Public checks were read-only. Destructive actions, duplicate-product creation and colour stock/photo changes used isolated local fixtures or protocol-level storage/API tests. No fake catalogue products, customer enquiries or production administrators were created, and no existing product or customer data was deleted for this audit.

The free 4K processor still requires the company computer and its enhancer to be running. Enhancement results need review for fidelity to real furniture. The live catalogue has one sofa; additional actual colours and photographs must be supplied by the business. Automated checks cover the current build and do not guarantee that future content, third-party services or every assistive technology will behave identically.
