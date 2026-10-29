import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { demoSofa } from '../fixtures/products';
test.skip(process.env.NGF_COLOR_HARNESS !== '1', 'Uses the isolated local admin fixture.');

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
]) {
  test(`tablet touch photo pickers and colour photos at ${viewport.width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      let uploaded = 0;
      await page.route('**/api/admin/products/p_device0001/photo-uploads', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: { computerOnline: true, uploads: [] } });
          return;
        }
        uploaded++;
        await route.fulfill({
          status: 201,
          json: {
            images: [
              {
                ...demoSofa.images[0],
                id: 'img_tablet' + String(uploaded).padStart(4, '0'),
                order: uploaded,
              },
            ],
            rejected: [],
          },
        });
      });
      await page.goto('http://127.0.0.1:8898/admin/products/edit?reset=1');
      const images = page.getByRole('region', { name: 'Images', exact: true });
      const picker = images.getByLabel('Product photographs', { exact: true });
      const photo = {
        name: 'tablet-front.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fixture'),
      };
      const choose = async (button: ReturnType<typeof page.getByRole>): Promise<void> => {
        await button.scrollIntoViewIfNeeded();
        const chooser = page.waitForEvent('filechooser');
        await button.tap();
        await (await chooser).setFiles(photo);
        await expect(
          button.locator('..').locator('..').getByText(photo.name, { exact: true }),
        ).toBeVisible();
        await button
          .locator('..')
          .locator('..')
          .getByRole('button', { name: '2. Upload selected photos', exact: true })
          .tap();
      };
      await choose(picker);
      await expect(images.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(2);
      // Re-selecting the same file must still trigger a new native change event.
      await choose(picker);
      await expect(images.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(3);
      await page.getByRole('button', { name: 'Add colour', exact: true }).tap();
      const colour = page.getByRole('group', { name: 'Colour 1', exact: true });
      await expect(colour.getByLabel('Upload photos for colour 1', { exact: true })).toBeDisabled();
      const name = 'Warm walnut brown with textured upholstery';
      await colour.getByLabel('Colour name', { exact: true }).fill(name);
      const colourPicker = colour.getByLabel(`Upload photos for ${name}`, { exact: true });
      await choose(colourPicker);
      await expect(colour.getByText('1 photo(s) selected.', { exact: false })).toBeVisible();
      await colour
        .getByLabel('Availability for this colour', { exact: true })
        .selectOption('OUT_OF_STOCK');
      for (const button of [
        picker,
        colourPicker,
        images.getByRole('button', { name: 'Remove', exact: true }).first(),
      ]) {
        const bounds = await button.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(48);
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
      await colour.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `.wrangler/admin-photo-integration-20261020/tablet-photo-picker-${viewport.width}.png`,
      });
    } finally {
      await context.close();
    }
  });
}

test('private online preparation resumes after a service interruption', async ({ page }) => {
  let mode = 'empty';
  await page.route('**/api/admin/products/p_device0001/photo-uploads', async (route) => {
    if (route.request().method() === 'POST') {
      mode = 'queued';
      await route.fulfill({
        status: 202,
        json: { uploadId: 'img_pending001', images: [], rejected: [] },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        computerOnline: mode === 'ready',
        uploads:
          mode === 'empty'
            ? []
            : [{ imageId: 'img_pending001', filename: 'photo.jpg', colorName: '', state: mode }],
      },
    });
  });
  await page.route('**/photo-uploads/img_pending001', async (route) => {
    mode = 'empty';
    await route.fulfill({
      status: 200,
      json: {
        images: [{ ...demoSofa.images[0], id: 'img_pending001', order: 1 }],
        rejected: [],
        colorName: '',
      },
    });
  });
  await page.goto('/admin/products/edit?reset=1');
  await page.getByLabel('Product photographs', { exact: true }).setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('local mock'),
  });
  await page
    .getByLabel('Product photographs', { exact: true })
    .locator('..')
    .locator('..')
    .getByRole('button', { name: '2. Upload selected photos', exact: true })
    .click();
  await expect(page.getByText('1 being prepared securely online', { exact: false })).toBeVisible();
  mode = 'ready';
  await page.reload();
  await expect(page.getByText('Prepared photo added.', { exact: false })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Images', exact: true })
      .getByRole('button', { name: 'Remove', exact: true }),
  ).toHaveCount(2);
});

for (const width of [375, 768, 1440]) {
  test(`multiple photo uploads and partial recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin/products/edit?reset=1');
    let uploads = 0;
    let active = 0;
    let maximum = 0;
    await page.route('**/api/admin/products/p_device0001/photo-uploads', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: { computerOnline: true, uploads: [] } });
        return;
      }
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
    await page
      .getByLabel('Product photographs', { exact: true })
      .locator('..')
      .locator('..')
      .getByRole('button', { name: '2. Upload selected photos', exact: true })
      .click();
    await expect(page.getByText('3 of 3 photos added.', { exact: false })).toBeVisible({
      timeout: 15000,
    });
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
    await colour.getByRole('button', { name: '2. Upload selected photos', exact: true }).click();
    await expect(colour.getByText('2 photo(s) selected.', { exact: false })).toBeVisible();
    await expect(
      page.getByText('2 of 2 photograph(s) added for Walnut brown.', { exact: false }),
    ).toBeVisible();
    // A failing photo must not remove an earlier confirmed upload or start later files.
    await page.unroute('**/api/admin/products/p_device0001/photo-uploads');
    let recoveryCalls = 0;
    await page.route('**/api/admin/products/p_device0001/photo-uploads', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: { computerOnline: true, uploads: [] } });
        return;
      }
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
    await page
      .getByLabel('Product photographs', { exact: true })
      .locator('..')
      .locator('..')
      .getByRole('button', { name: '2. Upload selected photos', exact: true })
      .click();
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

test('an unexpected upload response is visible and the picker recovers', async ({ page }) => {
  await page.route('**/api/admin/products/p_device0001/photo-uploads', async (route) => {
    await route.fulfill({
      json:
        route.request().method() === 'GET'
          ? { computerOnline: true, uploads: [] }
          : { unexpected: true },
    });
  });
  await page.goto('/admin/products/edit?reset=1');
  const picker = page.getByLabel('Product photographs', { exact: true });
  await picker.setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fixture'),
  });
  await picker
    .locator('..')
    .locator('..')
    .getByRole('button', { name: '2. Upload selected photos', exact: true })
    .click();
  await expect(page.getByText('Photo upload was interrupted.', { exact: false })).toBeVisible();
  await expect(picker).toBeEnabled();
  await page.getByRole('button', { name: 'Add colour', exact: true }).click();
  const colour = page.getByRole('group', { name: 'Colour 1', exact: true });
  await colour.getByLabel('Colour name', { exact: true }).fill('Brown');
  const colorPicker = colour.getByLabel('Upload photos for Brown', { exact: true });
  await colorPicker.setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fixture'),
  });
  await colorPicker
    .locator('..')
    .locator('..')
    .getByRole('button', { name: '2. Upload selected photos', exact: true })
    .click();
  await expect(
    page.getByText('Colour photo upload was interrupted.', { exact: false }),
  ).toBeVisible();
  await expect(colorPicker).toBeEnabled();
});

test('Android native selection uploads even when input/change events are missing', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/api/admin/products/p_device0001/photo-uploads', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { computerOnline: true, uploads: [] } });
      return;
    }
    writes++;
    await route.fulfill({
      status: 201,
      json: { images: [{ ...demoSofa.images[0], id: 'img_android001', order: 1 }], rejected: [] },
    });
  });
  await page.goto('/admin/products/edit?reset=1');
  const picker = page.getByLabel('Product photographs', { exact: true });
  // Model an Android document-provider handoff that populates files without dispatching events.
  await picker.evaluate((element: HTMLInputElement) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['local test'], 'lenovo-photo.jpg', { type: 'image/jpeg' }));
    element.files = transfer.files;
  });
  expect(writes).toBe(0);
  const upload = picker
    .locator('..')
    .locator('..')
    .getByRole('button', { name: '2. Upload selected photos', exact: true });
  await upload.click();
  await expect(page.getByText('1 of 1 photos added.', { exact: false })).toBeVisible();
  expect(writes).toBe(1);
  await upload.click();
  await expect(
    page.getByText('No photos were received from the selector.', { exact: false }),
  ).toBeVisible();
  expect(writes).toBe(1);
});

test('tablet completes fifteen 15 MB photos through durable preparation checkpoints', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 820, height: 1180 });
  let id = '';
  let remaining = 0;
  let received = 0;
  let finished = 0;
  await page.route('**/api/admin/products/p_device0001/photo-uploads**', async (route) => {
    const request = route.request();
    const isCollection = new URL(request.url()).pathname.endsWith('/photo-uploads');
    if (request.method() === 'GET') {
      await route.fulfill({
        json: {
          computerOnline: true,
          uploads: remaining ? [{ imageId: id, state: 'processing' }] : [],
        },
      });
      return;
    }
    if (isCollection) {
      expect(remaining).toBe(0);
      id = 'img_batch' + String(++received).padStart(5, '0');
      remaining = 8;
      await route.fulfill({ status: 202, json: { uploadId: id, images: [], rejected: [] } });
      return;
    }
    expect(request.url().endsWith('/' + id)).toBe(true);
    if (--remaining > 0) {
      await route.fulfill({
        status: 202,
        json: { uploadId: id, images: [], rejected: [], progress: 'Preparing next size' },
      });
      return;
    }
    finished++;
    await route.fulfill({
      json: { images: [{ ...demoSofa.images[0], id, order: finished }], rejected: [] },
    });
  });
  await page.goto('/admin/products/edit?reset=1');
  const images = page.getByRole('region', { name: 'Images', exact: true });
  await mkdir(testInfo.outputPath('photo-files'), { recursive: true });
  const photos = Array.from({ length: 15 }, (_, i) =>
    testInfo.outputPath('photo-files', 'high-quality-' + i + '.png'),
  );
  const bytes = Buffer.alloc(15 * 1024 * 1024);
  await Promise.all(photos.map((path) => writeFile(path, bytes)));
  await images.getByLabel('Product photographs', { exact: true }).setInputFiles(photos);
  await images.getByRole('button', { name: '2. Upload selected photos', exact: true }).click();
  await expect(images.getByText('Photo 1 of 15:', { exact: false })).toBeVisible();
  await expect(images.getByText('15 of 15 photos added.', { exact: false })).toBeVisible({
    timeout: 150000,
  });
  expect(received).toBe(15);
  expect(finished).toBe(15);
  await expect(images.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
