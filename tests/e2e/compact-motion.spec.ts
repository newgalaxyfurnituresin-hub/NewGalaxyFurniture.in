import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`category scroll arrivals stay readable at ${String(width)}px`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 844 : 900 },
      reducedMotion: 'no-preference',
      hasTouch: width <= 1024,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    const grid = page.locator('.ngf-category-grid');
    await expect(grid).toBeAttached();
    if (width <= 1024) {
      const cards = grid.locator(':scope > [data-reveal="tile"]');
      await expect(cards.first()).toBeAttached();
      // The lower rows must wait for their own intersection, not their parent's.
      await expect(cards.last()).not.toHaveAttribute('data-revealed');
      for (const card of await cards.all()) {
        await card.scrollIntoViewIfNeeded();
        await expect(card).toHaveAttribute('data-revealed');
        await expect(card).toHaveCSS('opacity', '1');
        await expect(card).toHaveCSS('transform', 'none');
        await expect(card.locator('a')).toBeVisible();
      }
    } else {
      await expect(grid.locator('[data-reveal="tile"]')).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const preference of ['system', 'site'] as const) {
  test(`${preference} reduced motion keeps compact cards static`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      reducedMotion: preference === 'system' ? 'reduce' : 'no-preference',
    });
    if (preference === 'site') {
      await context.addInitScript(() => localStorage.setItem('ngf:motion', 'off'));
    }
    const page = await context.newPage();
    await page.goto('/');
    const grid = page.locator('.ngf-category-grid');
    await grid.scrollIntoViewIfNeeded();
    await expect(grid.locator('[data-reveal="tile"]')).toHaveCount(0);
    await expect(grid).toHaveCSS('opacity', '1');
    await expect(grid.locator('li').first()).toHaveCSS('transform', 'none');
    await context.close();
  });
}
