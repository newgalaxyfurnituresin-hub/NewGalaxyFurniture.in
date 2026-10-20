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
    await first.getByRole('checkbox').check();
    await expect(first.locator('input[type=color]')).toBeVisible();
    await page.getByRole('button', { name: 'Add colour', exact: true }).click();
    const second = page.getByRole('group', { name: 'Colour 2', exact: true });
    await second.getByLabel('Colour name', { exact: true }).fill('Cream');
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
    await expect(page.getByRole('radio', { name: /Walnut brown In stock/ })).toBeChecked();
    const enquire = page.getByRole('link', { name: 'Enquire about this colour' });
    expect(decodeURIComponent((await enquire.getAttribute('href'))!)).toContain(
      'Selected colour: Walnut brown',
    );
    await page.getByRole('radio', { name: /Walnut brown In stock/ }).focus();
    await page.getByRole('radio', { name: /Walnut brown In stock/ }).press('ArrowRight');
    await expect(page.getByRole('radio', { name: /Cream.*out of stock/i })).toBeChecked();
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
