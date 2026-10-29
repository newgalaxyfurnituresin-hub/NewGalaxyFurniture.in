import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test.skip(
  process.env.NGF_COLOR_HARNESS !== '1',
  'Uses an isolated local API fixture; never production inventory.',
);
for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`create a draft, upload JPGs and reopen saved colour photos at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const bytes = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#886644' },
    })
      .jpeg()
      .toBuffer();
    await page.goto('/admin/products/new');
    const name = `Device ${viewport.width} test sofa`;
    await page.getByRole('textbox', { name: 'Product name', exact: true }).fill(name);
    await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('sofas');
    await page.getByRole('button', { name: 'Save & add photos', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/products\/p_device0001\?created=1/);
    await page.waitForLoadState('networkidle');
    const photos = ['front.jpg', 'side.jpg'].map((name) => ({
      name,
      mimeType: 'image/jpeg',
      buffer: bytes,
    }));
    const imageRegion = page.getByRole('region', { name: 'Images', exact: true });
    const input = imageRegion.getByLabel('Product photographs', { exact: true });
    await input.setInputFiles(photos);
    await expect(imageRegion.getByText('front.jpg', { exact: true })).toBeVisible();
    await expect(imageRegion.getByText('side.jpg', { exact: true })).toBeVisible();
    await expect(imageRegion.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    await imageRegion
      .getByRole('button', { name: '2. Upload selected photos', exact: true })
      .click();
    await expect(imageRegion.getByText('2 of 2 photos added.', { exact: false })).toBeVisible({
      timeout: 15000,
    });
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
      name,
    );
    await expect(imageRegion.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(2);
    await page.getByRole('button', { name: 'Add colour', exact: true }).click();
    const colour = page.getByRole('group', { name: 'Colour 1', exact: true });
    await colour.getByLabel('Colour name', { exact: true }).fill('Walnut brown');
    await colour
      .getByLabel('Upload photos for Walnut brown', { exact: true })
      .setInputFiles({ ...photos[0]!, name: 'walnut-brown.jpg' });
    await colour.getByRole('button', { name: '2. Upload selected photos', exact: true }).click();
    await expect(
      page.getByText('1 of 1 photograph(s) added for Walnut brown.', { exact: false }),
    ).toBeVisible();
    await colour
      .getByLabel('Availability for this colour', { exact: true })
      .selectOption('OUT_OF_STOCK');
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().endsWith('/p_device0001'),
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(imageRegion.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(3);
    await expect(colour.getByLabel('Colour name', { exact: true })).toHaveValue('Walnut brown');
    await expect(colour.getByLabel('Availability for this colour', { exact: true })).toHaveValue(
      'OUT_OF_STOCK',
    );
    await expect(colour.getByText('1 photo(s) selected.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
