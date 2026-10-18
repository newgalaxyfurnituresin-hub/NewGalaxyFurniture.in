# Sofa repair and mattresses

## Routes and discovery

- `/sofa-repair`: editorial service introduction, configurable repair topics, four-step enquiry process, genuine-project gallery when populated, secure quote form, FAQs and WhatsApp alternatives.
- `/collection/mattresses`: dedicated category presentation using the existing published-product catalogue, search index, product cards, filters and enquiry infrastructure.
- `/admin/experiences`: existing authenticated admin shell with owner-only editing of both heroes, imagery, homepage visibility, repair topics, FAQs and genuine before/after projects.
- `/api/admin/experiences`: existing permission, CSRF, validation, GitHub writer and audit mechanisms. Updates reject stale content with a conflict response rather than overwriting another editor's changes.

Header, mobile navigation, homepage, footer and relevant sofa/bed category pages link to the new experiences. Existing product pages are reused for mattresses.

## Adding content

In **Products → Add product**, choose **Mattresses**. Use real photographs, descriptions and prices. The existing publication controls, image management and product permissions apply. Size variants use the existing label and price-delta fields; each variant can inherit stock status or override it. The detail page updates price, availability and its WhatsApp message for the selected variant. Products marked price-on-enquiry retain that behavior.

No mattress products have been invented or added to the real catalogue. The empty state explicitly explains that no mattress listings are published. Material, size and price filters derive from actual published product data. Size filters include variant labels without creating duplicate products.

In **Repair & Mattresses**, an owner can add and edit repair topics, FAQs and project pairs. Repair topics distinguish visibility from confirmed availability; the shipped topics invite a suitability discussion. Before/after projects stay hidden unless explicitly confirmed as genuine work. Hero and project photographs require a safe public image path, dimensions, descriptive alt text and a caption. Reuse a public product image from the existing media pipeline or add an approved brand asset; private enquiry attachments are rejected as public content.

Saving content uses the configured GitHub repository and existing build pipeline. Public pages update after a successful production build, following review/merge of this feature. A viewer cannot submit changes, and editor permissions do not grant owner-only settings writes.

## Repair enquiries and security

The form submits to the existing `/api/leads` endpoint as a QUOTE. Sofa type, selected topic and preferred contact method are included in the existing requirement field. It collects the existing name/phone fields and problem description; it does not introduce an unhandled email field or a second customer database.

Existing server validation, honeypot, minimum form age, rate limiting, secure photo validation and private R2 quarantine remain active. Inputs remain available after a failure; duplicate in-flight submissions are prevented. A success message appears only after an enquiry is recorded. WhatsApp uses the configured business number as an alternative. There is no checkout or implied order confirmation.

Local Worker tests exposed two existing defects that blocked this flow: the Node image codec could not compile WASM in workerd, and lossy WebP dimensions were read at incorrect offsets. The Cloudflare target now imports precompiled Worker-compatible WASM modules; the Netlify target retains its existing codec. The WebP parser validates its frame signature and reads the correct offsets. Upload type, dimension and size safeguards remain intact.

## Design and imagery

The new presentation uses the existing Fraunces/Inter fonts, ivory/espresso palette, header and footer. Shared flexible layouts adapt at mobile, tablet and desktop widths. Motion uses the existing reveal runtime, restrained hover effects and reduced-motion preferences. No decorative libraries were added.

Repair photographs reuse existing brand assets and are labelled inspiration. No transformation imagery is fabricated. Mattress hero photography is an illustrative bedroom scene generated with the built-in image tool, not an inventory photograph. Its caption makes that distinction visible.

Generated-image prompt direction: a photorealistic premium Indian bedroom, warm ivory bedding, walnut furniture, restrained natural daylight, editorial composition, no logos/text, no product specifications or before/after claims. Optimized copies are `public/brand/mattress-inspiration-{480,768,1040,1440}.webp`, approximately 30–199 KB. The original generated PNG is preserved outside the repository in the local generated-images directory.

## Verification

Unit tests cover content boundaries, image paths, permissions, stale-write protection, actual GitHub write protocol, variant pricing/stock, filtering, form requirements and WebP dimensions. Existing suites remain enabled.

Browser checks cover both public pages at 320×568, 375×812, 430×932, 768×1024, 1024×768, 1366×768 and 1440×900: image loading, overflow, canonical URLs and browser errors. They also exercise homepage/mobile navigation, keyboard FAQ interaction, reduced motion and axe WCAG A/AA checks.

Real local Cloudflare D1/R2 tests verify a recorded repair enquiry, an unavailable-backend error retaining input, rejected SVG attachments, and a valid WebP attachment stored through the existing private-upload flow. No production customer data is used.

An isolated local component harness verifies owner add/save/conflict behavior and viewer restrictions. Separately, a fixture build with two explicitly labelled test mattresses verifies real catalogue filtering, visual sorting, no-match recovery, mobile filter focus, selected-variant pricing/stock and encoded enquiries. Populated cards and variant controls are checked at all seven widths. Fixture products, database state, browser artifacts and harnesses live only in ignored `.wrangler` directories. They are absent from the normal production build and repository catalogue.

Final results: 73 unit suites / 1,071 tests passed; Astro/TypeScript reported zero errors and warnings (25 existing hints); lint and formatting passed. The normal-catalogue browser run passed 18 tests, with five harness-only tests intentionally excluded; those five passed separately (two admin, three populated-catalogue tests). Existing homepage, contact, collection, sofa/bed category and published sofa detail routes returned 200 locally. Both new heroes were also checked with normal motion enabled.

The Cloudflare production build passed for 29 public pages. Build gates include content validation, SEO/canonical/sitemap checks, CSP checks, page/image/motion budgets, keyword checks, client bundle size limits and secret scanning. The built server modules total approximately 2.54 MiB gzip locally; no upload or deployment was performed. The final build contains the three real product files and no test mattress pages. Its generated Worker configuration retains the company account and `crons = []`.

## Launch content and boundaries

The business still needs to confirm repair services and supply genuine project pairs if a gallery is wanted. Add actual mattress inventory, product photography, prices and variant/stock information through the existing admin. Service areas, collection/delivery, turnaround, warranties and exact repair prices are not asserted without confirmation.

No database schema or migration is added. No production deployment, remote migration, secret change, resource provisioning or DNS change is part of this implementation. Production cron configuration remains empty. The feature is committed on a separate branch because main is connected to automatic production deployments; merge only after review.
