# Product colours and availability

In **Admin → Products**, open a product and find **Colours & availability**. Add up to 20 named colours. Each colour has its own In stock, Limited stock, Currently out of stock or Made to order setting. An optional approximate swatch uses the browser's colour picker. Remove a colour to stop offering it, then save changes.

Saving an existing public product starts the usual website update. Wait for the publication panel to verify it live. New products still follow the existing draft, review and publish process. No additional database migration or service is needed.

Customers can select any listed colour, including an unavailable one to ask about restocking. The enquiry includes the actual product SKU, selected colour, selected size/configuration when present, displayed availability and product URL. Swatches are labelled approximate; they are not photographs or a guarantee of the exact fabric shade.

Product-wide out of stock overrides every colour. Size/configuration restrictions also apply. These are separate restrictions, not an invented inventory matrix for every size and colour combination. All colours unavailable makes the public card, product badge, search availability and structured data out of stock. One unavailable colour does not hide another available colour.

Existing `availableColors` names remain supported. Editing colour options saves structured `colorOptions` and derives the legacy name list for compatibility. Existing products and their colour inventory are not modified by deploying this feature. No colours are invented for products without confirmed colour data.
