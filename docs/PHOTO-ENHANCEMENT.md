# Free local AI photo preparation

The Windows computer prepares AI-enhanced copies with a **3,840-pixel longest edge**, preserving the photo's aspect ratio. A landscape product photo may therefore be 3840 × 2795 rather than 3840 × 2160. Portrait photos remain portrait. This does not promise recovered ground-truth detail or make a poor source equivalent to a photograph shot in 4K.

## Everyday use

1. Double-click **Enhance Photos.cmd** in the project folder. It opens the input and review folders.
2. Copy photos into the input folder. Keep the processing window open; it shows progress. Images process one at a time to control GPU memory use.
3. In the review folder, open **index.html**. Open each comparison and click the images to inspect full size. Check colour, fabric, stitching and furniture shape.
4. If the result accurately represents the product, upload **enhanced-4k.jpg** through the website's existing admin photo uploader. Add the description and choose the main photo as usual.
5. Keep the untouched original. Do not use an enhanced photo if it invents or distorts product details.

This is a **local preparation workflow**, not a cloud upload interceptor. Uploads made directly on the website are unchanged. The computer must be on, with the processing window open, for the input-folder watcher to work. Processing and review do not upload, publish, delete or replace website images. There is no background startup task or exposed local HTTP service.

## Setup on this Windows computer

The engine is installed under the Git-ignored `.wrangler/image-enhancer/` directory. It is the official [Real-ESRGAN Windows release](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0), using the general-photography `realesrgan-x4plus` model, not the anime model. Requires a Vulkan-compatible GPU/driver. No API key, paid subscription or external image-processing service is used.

From the project folder in PowerShell:

```powershell
node node_modules\tsx\dist\cli.mjs scripts\setup-photo-enhancer.ts
```

The pinned archive SHA-256 is an integrity check against the version downloaded from the official release; it is not a publisher signature. Binaries, models, originals, temporary images and enhanced outputs stay untracked. Existing project dependencies provide the final image encoding; no new Node dependency is required.

## Other commands

```powershell
# Prepare one photo without modifying its source.
node node_modules\tsx\dist\cli.mjs scripts\enhance-photos.ts "C:\Photos\sofa.jpg"

# Process the current input folder once.
node node_modules\tsx\dist\cli.mjs scripts\enhance-photos.ts --inbox

# Download copies of the published catalogue's originals and prepare local previews.
# Reads public image URLs only; no production writes or credentials.
node node_modules\tsx\dist\cli.mjs scripts\enhance-photos.ts --catalogue
```

## Quality and recovery

- Exact source bytes are backed up beside each comparison. Working copies are auto-oriented, normalized to sRGB and stripped of metadata. Transparent inputs are flattened onto white for product photography.
- AI estimates new detail. Very small photos can take multiple passes and produce less reliable results. Review is always required.
- Files already at or above the target size are resized without AI and labelled accordingly.
- Final JPEGs fit the admin's 12 MB limit. Browsers continue receiving optimized responsive sizes; serving 4K to every phone would waste data and slow the site.
- Identical source bytes reuse an already-completed job. Source hashes, actual dimensions, processing time, model and AI pass count are recorded in `complete.json`. A partial or blank output is never reported as ready.
- If processing fails, the original stays safe. Check the error and graphics driver, then restart the tool to retry. No driver installation is performed automatically.
- Temporary work files are retained for diagnosis. After closing the tool, they can be removed manually from `.wrangler/image-enhancer/work/`; keep `review/` and its originals.
- Do not commit `.wrangler/` or generated photos. Nothing here changes production cron schedules or secrets.
