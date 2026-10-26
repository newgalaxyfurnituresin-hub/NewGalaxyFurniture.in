# Editor recovery and stability — 25 October 2026

Product details now save immediately to owner-scoped browser storage and, after a pause, to a private workspace in the existing DRAFTS KV namespace. A refresh restores unfinished inputs, including incomplete names, tags and colour choices. Products lists offer resume links for both device-only and online workspaces. These workspaces expire after 30 days and never publish changes or modify an existing product's publication status.

Online saves are debounced, spaced at least eight seconds apart, restricted to one in-flight request per editor, and retried with increasing delays on connection/service failures. Authentication, validation and conflict refusals stop background retries. All endpoints use the existing product.write permission, company access restriction, request bounds, origin/CSRF and rate controls. Storage keys are derived from the authenticated owner. No GitHub writes, image transforms or database migration are involved in autosave.

Manual Save still validates and commits the canonical product. Successful saves clear the matching recovery copy and reset its revision so subsequent edits can autosave again. A confirmed **Discard recovery draft** action fetches the current saved product before discarding unfinished details, retaining its uploaded photographs and latest saved changes. Recovery of older product versions asks the operator to review rather than silently replacing current data; canonical save retains the existing revision conflict check. KV is eventually consistent: workspace revision checks are best-effort conflict detection, not distributed transactions. Keep separate workspaces when editing concurrently from different devices.

The editor disables inputs while a manual save is pending, preventing the save response from erasing newer typing. Comma-separated fields update while typing, rather than only on blur. Admin requests now time out, preserve existing input on failure, and reject unreadable success responses such as an HTML sign-in page. Mutations are not blindly retried.

Photo bytes are not stored in localStorage. Completed private uploads remain on the server; a file that has not finished uploading may need selecting again. Browser storage can be cleared or unavailable, so the status explicitly distinguishes device and online saving.

## Verification

- Full production release gate: 1,231 unit/property tests across 98 files; content validation, types, lint, SEO/CSP, motion, DOM/image budgets, transfer sizes and output secret scanning passed.
- Six isolated recovery browser scenarios: refresh, online restoration after clearing local storage, offline refresh at 375/768/1024/1440 pixels, colour/tag recovery, successful Save cleanup, and resuming a device-only workspace from Products.
- Sixteen existing photo/colour browser regression scenarios passed, including tablet touch uploads, partial network failure, colour availability, image selection and accessibility.
- No production catalogue record, customer record, account or secret was changed during local tests. No paid plan or scheduled task was enabled.
- The preceding 1,000-listing capacity release and signed-in search/reset checks remain documented in CATALOGUE-CAPACITY-2026-10-25.md.

## Runtime finding

Cloudflare's last-24-hours errors view attributed 22 exceptions to two older versions (fa317eaa and de32bca1). Recent versions, including 45a5476f, showed zero recorded runtime errors when checked. This does not establish that every browser/network failure is resolved, and does not guarantee unlimited traffic or zero future failures. The precise current crash action/message was requested from the user; no newer reproduction was available during implementation.

Update, 26 October: the reported HTTP 500 was reproduced and traced to the daily KV write quota. See LOGIN-STORAGE-2026-10-26.md for the confirmed cause and the quota-safe database-backed store. These handled HTTP failures did not increment the Worker exception chart.
