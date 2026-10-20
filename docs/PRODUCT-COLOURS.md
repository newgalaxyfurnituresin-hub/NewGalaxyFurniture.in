# Product colours and availability

In **Admin → Products**, open a product and find **Colours & availability**. For a new product, create its draft first. Then:

1. Add a colour name and choose its availability.
2. Upload real photos of the product in that colour directly in the colour panel, or tick matching photos already uploaded. Every colour needs at least one separate photo before publishing. A photo cannot represent two different colours.
3. Save changes. Customers selecting a colour see that colour's gallery, including its matching thumbnails and zoom.

Each colour supports In stock, Limited stock, Currently out of stock or Made to order. Up to 20 colours and 20 total product photos are supported. An optional approximate swatch uses the browser's colour picker. Remove a colour to stop offering it, then save changes. Removing a colour only removes its association; its photographs remain in Images until explicitly removed. A published colour's last photograph cannot be deleted until a replacement is assigned or the colour is removed.

Saving an existing public product starts the usual website update. Wait for the publication panel to verify it live. New products still follow the existing draft, review and publish process. No additional database migration or service is needed.

Colour uploads use the same secure storage, validation, responsive-image processing and automatic 4K queue as all other admin uploads. Keep the company computer and **Start Admin Photo Enhancer.cmd** running. Review the result in **Images**, then choose **Use reviewed 4K photo**. The colour stays linked to the enhanced copy and its original remains preserved. Photos are never artificially recoloured to imply that an unavailable inventory photo exists.

Customers can select any listed colour, including an unavailable one to ask about restocking. The enquiry includes the actual product SKU, selected colour, selected size/configuration when present, displayed availability and product URL. Swatches are labelled approximate; they are not photographs or a guarantee of the exact fabric shade. Older structured colours without assigned photographs show an honest unavailable-photo message until configured; new public colour edits and publication are blocked until photographs are assigned.

Product-wide out of stock overrides every colour. Size/configuration restrictions also apply. These are separate restrictions, not an invented inventory matrix for every size and colour combination. All colours unavailable makes the public card, product badge, search availability and structured data out of stock. One unavailable colour does not hide another available colour.

Existing `availableColors` names remain supported. Editing colour options saves structured `colorOptions` and derives the legacy name list for compatibility. Existing products and their colour inventory are not modified by deploying this feature. No colours are invented for products without confirmed colour data.
