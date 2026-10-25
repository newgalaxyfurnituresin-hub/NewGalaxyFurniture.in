import { expect, test } from '@playwright/test';
import { demoSofa } from '../fixtures/products';
test.skip(process.env.NGF_COLOR_HARNESS !== '1', 'Uses the isolated local admin fixture.');

for (const width of [375, 768, 1440]) {
  test(`multiple photo uploads and partial recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin/products/edit?reset=1');
    let uploads = 0;
    let active = 0;
    let maximum = 0;
    await page.route('**/api/admin/products/p_device0001/images', async (route) => {
      active++;
      maximum = Math.max(maximum, active);
      const body = route.request().postDataBuffer()!.toString('latin1');
      expect((body.match(/name="file";/g) ?? []).length).toBe(1);
      const number = ++uploads;
      await route.fulfill({
        status: 201,
        json: {
          images: [
            {
              ...demoSofa.images[0],
              id: `img_multi${String(number).padStart(5, '0')}`,
              order: number,
              alt: '',
              width: 1470,
              height: 1070,
              enhancedFrom: undefined,
            },
          ],
          rejected: [],
        },
      });
      active--;
    });
    const photos = ['front.jpg', 'side.jpg', 'back.jpg'].map((name) => ({
      name,
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(5 * 1024 * 1024),
    }));
    await page.getByLabel('Product photographs', { exact: true }).setInputFiles(photos);
    await expect(page.getByText('3 of 3 photos added.', { exact: false })).toBeVisible();
    expect(uploads).toBe(3);
    expect(maximum).toBe(1);
    const images = page.getByRole('region', { name: 'Images', exact: true });
    await expect(images.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(4);
    await page.getByRole('button', { name: 'Add colour', exact: true }).click();
    const colour = page.getByRole('group', { name: 'Colour 1', exact: true });
    await colour.getByLabel('Colour name', { exact: true }).fill('Walnut brown');
    await colour
      .getByLabel('Upload photos for Walnut brown', { exact: true })
      .setInputFiles(photos.slice(0, 2));
    await expect(colour.getByText('2 photo(s) selected.', { exact: false })).toBeVisible();
    await expect(
      page.getByText('2 of 2 photograph(s) added for Walnut brown.', { exact: false }),
    ).toBeVisible();
    // A failing photo must not remove an earlier confirmed upload or start later files.
    await page.unroute('**/api/admin/products/p_device0001/images');
    let recoveryCalls = 0;
    await page.route('**/api/admin/products/p_device0001/images', async (route) => {
      recoveryCalls++;
      if (recoveryCalls === 1)
        await route.fulfill({
          status: 201,
          json: {
            images: [{ ...demoSofa.images[0], id: 'img_recover001', order: 6, alt: '' }],
            rejected: [],
          },
        });
      else await route.fulfill({ status: 500, body: 'Worker error' });
    });
    await page.getByLabel('Product photographs', { exact: true }).setInputFiles(photos);
    await expect(page.getByText('1 of 3 photos added.', { exact: false })).toBeVisible();
    await expect(page.getByText('may already have been saved.', { exact: false })).toBeVisible();
    expect(recoveryCalls).toBe(2);
    await expect(images.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.wrangler/admin-photo-integration-20261020/multiple-upload-${width}.png`,
      fullPage: true,
    });
  });
}
