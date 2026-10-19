import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of ['/about', '/custom-furniture', '/workshop']) {
  for (const width of [375, 1440]) {
    test(`readable links and process labels: ${route} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(route);
      const result = await new AxeBuilder({ page })
        // Google's embedded map content is maintained by Google, outside this application's DOM.
        .exclude('.ngf-showroom-map iframe')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);
    });
  }
}

test('Shop closes when keyboard focus leaves the dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const menu = page.locator('.ngf-header details[name="ngf-nav"]').first();
  const summary = menu.locator('summary');
  await summary.press('Enter');
  await expect(menu).toHaveAttribute('open', '');
  await summary.press('Shift+Tab');
  await expect(menu).not.toHaveAttribute('open');
  await summary.press('Enter');
  await summary.press('Tab');
  await expect(menu).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open');
  await expect(summary).toBeFocused();
});

test('sticky navigation leaves the repair quote anchor visible', async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/sofa-repair');
    const quote = page
      .locator('main a[href^="#"]')
      .filter({ hasText: /Request a repair quote/i })
      .first();
    const target = await quote.getAttribute('href');
    expect(target).toBeTruthy();
    await quote.click();
    const top = await page
      .locator(String(target))
      .evaluate((element) => element.getBoundingClientRect().top);
    const header = await page.locator('.ngf-header').boundingBox();
    expect(top).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    expect(top).toBeLessThan(600);
  }
});
