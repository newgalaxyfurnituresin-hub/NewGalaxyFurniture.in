import { expect, test } from '@playwright/test';

test.skip(
  process.env.NGF_ENHANCEMENT_HARNESS !== '1',
  'Uses the isolated local image-management fixture.',
);

for (const width of [390, 768, 1440]) {
  test(`4K queue, review and apply controls at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/admin/products/edit?reset=1');
    const queue = page.getByRole('button', { name: 'Enhance to 4K', exact: true });
    await queue.click();
    await expect(
      page.getByText('Waiting for the company computer’s photo enhancer. Your original is saved.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto('/admin/products/edit?reset=1&enhancement=ready');
    await page.getByRole('button', { name: 'Review 4K photo', exact: true }).click();
    const review = page.getByRole('region', { name: 'Compare original and enhanced photo' });
    await expect(review).toBeVisible();
    await expect(review.locator('img')).toHaveCount(2);
    for (const image of await review.locator('img').all()) {
      await expect
        .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const apply = page.getByRole('button', { name: 'Use reviewed 4K photo', exact: true });
    await apply.focus();
    await apply.press('Enter');
    await expect(
      page.getByText('4K copy applied · original preserved', { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('new uploads show their queue state and failed jobs can be retried', async ({ page }) => {
  await page.goto('/admin/products/edit?reset=1');
  await page.locator('#image-upload').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from('isolated fixture'),
  });
  await expect(
    page
      .getByText('Waiting for the company computer’s photo enhancer. Your original is saved.', {
        exact: true,
      })
      .last(),
  ).toBeVisible();
  await page.goto('/admin/products/edit?reset=1&enhancement=failed');
  await page.getByRole('button', { name: 'Retry 4K enhancement', exact: true }).click();
  await expect(
    page.getByText('Waiting for the company computer’s photo enhancer. Your original is saved.', {
      exact: true,
    }),
  ).toBeVisible();
});
