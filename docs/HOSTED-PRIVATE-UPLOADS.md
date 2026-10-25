# Hosted private photo uploads

Product photos and customer enquiry attachments are processed in the company Cloudflare account. They do not require an operator computer, local HTTP service or locally running AI tool.

- The Images binding fully decodes and re-encodes photographs, strips metadata and prepares product sizes outside the Worker's CPU/memory budget.
- Uploaded originals remain in private R2 storage. Customer attachments remain under the enquiry quarantine prefix and require company `lead.read` permission to view.
- Draft, unlisted and unpublished product photographs require company `product.write` permission. The public image route serves only image IDs attached to the published build catalogue. Private responses use `private, no-store`.
- Upload status and retry/finalization use the existing company session, CSRF, permission, rate-limit and product-write protections. Knowing a private file URL does not grant access.
- Product images become public as part of publishing the product/build. Files that have already been published and downloaded cannot be made secret retroactively.
- Normal uploads preserve the original resolution. Existing 4K photographs and previously prepared review copies are retained. Automatic genuine cloud AI enhancement is not configured; merely enlarging pixel dimensions is not presented as AI enhancement.
- The former local watcher is disabled by default. No new website upload is submitted to its queue. An explicitly requested manual offline review is separate from website operation.

Cloudflare Images Free currently includes 5,000 unique transformations per month; several sizes of a product photograph can consume several transformations. The free allowance has a hard limit rather than automatic overage charges. No paid plan or storage subscription was enabled for this change. See [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/).

Verification includes a complete 4K hosted transformation in the company remote preview, real pixel/EXIF tests, anonymous-access checks, image-promotion idempotency, cloud service failure recovery, company route guards, responsive upload/colour controls, production compilation, CSP/SEO checks and generated-output secret scanning.
