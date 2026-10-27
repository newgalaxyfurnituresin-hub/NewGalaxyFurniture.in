# Homepage hero selection

The hero shows at most eight distinct product photographs. Only public products in published categories qualify. Drafts, review items, unpublished products, products without a main photograph and photographs explicitly still processing are excluded.

1. Choose the newest-added eligible product in each category, using `createdAt`, not the last edit date.
2. Put those category representatives first, newest first. If more than eight categories qualify, keep the eight newest representatives.
3. If fewer than eight categories qualify, fill the remaining slots with the newest other eligible products. Never repeat a product or its stored main photograph.
4. If fewer than eight distinct photos exist, show fewer slides. If none exist, use the configured living-room scene or the existing composition fallback.

Publishing a newer product replaces the older representative in that category on the next successful automatic site build. Saving an unpublished draft does not change the public hero. An older representative may still occupy a spare slot while fewer than eight categories are populated. Removing or unpublishing a selected item automatically promotes the next eligible product on the next build.

The first selected photograph is the only high-priority, preloaded hero image. Other slides use the existing lazy image delivery, six-second crossfade, manual controls and reduced-motion behavior. Selection is capped at eight even for catalogues of 1,000 products. Phone and tablet layouts retain the image above the text; desktop product slides use a dark overlay to keep the existing white text readable on varying photos.

Regression coverage includes eight populated categories, empty-category fallback, new-publication replacement, edits to older products, private and processing images, duplicates, small inventories and 1,000 products. Test records remain in tests only; no fake products are published.

The complete guarded production build passed 1,254 tests. A local eight-control preview was checked at 320, 375, 768, 1024 and 1440 pixels: no horizontal overflow and every control fits with a 44-pixel target. All eight buttons selected their matching slide, and arrow-key navigation passed. The desktop copy layer's empty area no longer intercepts clicks on the controls. The final rebuild passed the page, image, security, size and secret checks.
