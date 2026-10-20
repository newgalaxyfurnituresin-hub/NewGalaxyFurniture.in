import { expect, test } from '@playwright/test';
test.skip(process.env.NGF_COLOR_HARNESS !== '1', 'Uses the isolated local colour fixture.');
for (const width of [320, 768, 1440]) {
  test(`manage and enquire about colour availability at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/admin/products/edit?reset=1');
    await page.getByRole('button', { name: 'Add colour', exact: true }).click();
    const first = page.getByRole('group', { name: 'Colour 1', exact: true });
    await first.getByLabel('Colour name', { exact: true }).fill('Walnut brown');
    await first.getByLabel('Upload photos for Walnut brown', { exact: true }).setInputFiles({
      name: 'brown.png',
      mimeType: 'image/png',
      buffer: Buffer.from('isolated fixture'),
    });
    await expect(first.getByText('1 photo(s) selected.', { exact: false })).toBeVisible();
    await first
      .getByRole('checkbox', { name: 'Show an approximate colour swatch (optional)', exact: true })
      .check();
    await expect(first.locator('input[type=color]')).toBeVisible();
    await page.getByRole('button', { name: 'Add colour', exact: true }).click();
    const second = page.getByRole('group', { name: 'Colour 2', exact: true });
    await second.getByLabel('Colour name', { exact: true }).fill('Cream');
    await second.getByLabel('Upload photos for Cream', { exact: true }).setInputFiles({
      name: 'cream.png',
      mimeType: 'image/png',
      buffer: Buffer.from('isolated fixture'),
    });
    await expect(second.getByText('1 photo(s) selected.', { exact: false })).toBeVisible();
    await second
      .getByLabel('Availability for this colour', { exact: true })
      .selectOption('OUT_OF_STOCK');
    const save = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith('/p_device0001'),
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await save).ok()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto('/admin/products/edit');
    await expect(page.getByLabel('Colour name', { exact: true }).nth(1)).toHaveValue('Cream');
    await expect(
      page.getByLabel('Availability for this colour', { exact: true }).nth(1),
    ).toHaveValue('OUT_OF_STOCK');
    await page.goto('/colour-choice');
    const gallery = page.getByRole('group', {
      name: 'Local device fixture — Walnut brown photographs',
      exact: true,
    });
    await expect(gallery).toBeVisible();
    const brownSource = await gallery.locator('figure[data-current=true] img').getAttribute('src');
    await expect(page.getByRole('radio', { name: /Walnut brown In stock/ })).toBeChecked();
    const enquire = page.getByRole('link', { name: 'Enquire about this colour' });
    expect(decodeURIComponent((await enquire.getAttribute('href'))!)).toContain(
      'Selected colour: Walnut brown',
    );
    await page.getByRole('radio', { name: /Walnut brown In stock/ }).focus();
    await page.getByRole('radio', { name: /Walnut brown In stock/ }).press('ArrowRight');
    await expect(page.getByRole('radio', { name: /Cream.*out of stock/i })).toBeChecked();
    const creamGallery = page.getByRole('group', {
      name: 'Local device fixture — Cream photographs',
      exact: true,
    });
    await expect(creamGallery).toBeVisible();
    expect(
      await creamGallery.locator('figure[data-current=true] img').getAttribute('src'),
    ).not.toBe(brownSource);
    const restock = page.getByRole('link', { name: 'Ask about restocking' });
    await expect(restock).toBeVisible();
    const message = decodeURIComponent((await restock.getAttribute('href'))!);
    expect(message).toContain('Selected colour: Cream');
    expect(message).toContain('Selected option: Queen');
    await page.getByRole('radio', { name: /Walnut brown In stock/ }).check();
    await page.getByLabel('Size or configuration').selectOption('king');
    await expect(restock).toBeVisible();
    await page.getByLabel('Size or configuration').selectOption('queen');
    await expect(enquire).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.wrangler/admin-photo-integration-20261020/color-choice-${width}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('colour selection survives late gallery hydration and a reviewed 4K replacement', async ({
  page,
}) => {
  await page.goto('/admin/products/edit?enhancement=ready');
  await page.getByRole('button', { name: 'Review 4K photo', exact: true }).first().click();
  await page.getByRole('button', { name: 'Use reviewed 4K photo', exact: true }).click();
  await expect(
    page.getByText('4K copy applied · original preserved', { exact: true }).first(),
  ).toBeVisible();
  await page.goto('/colour-choice?lateGallery=1');
  await page.getByRole('radio', { name: /Cream.*out of stock/i }).check();
  await page.getByRole('button', { name: 'Load gallery', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Local device fixture — Cream photographs', exact: true }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Walnut brown In stock/ }).check();
  const gallery = page.getByRole('group', {
    name: 'Local device fixture — Walnut brown photographs',
    exact: true,
  });
  await expect(gallery).toBeVisible();
  expect(await gallery.locator('figure[data-current=true] img').getAttribute('src')).toContain(
    'img_4kresult01',
  );
});
