import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`homepage text and controls have a readable background at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const panel = await page.locator('.ngf-hero-panel').boundingBox();
    const copy = await page.locator('.ngf-hero-copy').boundingBox();
    expect(panel).not.toBeNull();
    expect(copy).not.toBeNull();
    if (viewport.width < 1024) {
      expect(copy!.y).toBeGreaterThanOrEqual(panel!.y + panel!.height - 1);
      expect(
        await page.locator('.ngf-hero-heading').evaluate((node) => getComputedStyle(node).color),
      ).toBe('rgb(28, 26, 24)');
    } else {
      expect(panel!.y + panel!.height).toBeGreaterThanOrEqual(copy!.y + copy!.height - 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('tablet filters release space for products and remain keyboard accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/collection');
  const toggle = page.locator('.ngf-filter-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole('dialog', { name: 'Filters', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.ngf-filter-shell')).toBeVisible();
  await expect(page.locator('.ngf-filter-shell')).toHaveAttribute('data-sheet', 'closed');
  await expect(toggle).toBeHidden();
});
