import { expect, test } from '@playwright/test';

test.skip(process.env.NGF_SCALE_HARNESS !== '1', 'Uses only the isolated 1,000-product build.');

test('admin reports recovery progress and finishes bounded syncing', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/admin/products?*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: unknown[];
      total: number;
      pageCount: number;
      pendingSync: number;
    };
    calls++;
    await route.fulfill({
      json: {
        ...body,
        total: calls === 1 ? 25 : 65,
        pageCount: calls === 1 ? 1 : 3,
        pendingSync: calls === 1 ? 40 : 0,
      },
    });
  });
  await page.goto('/admin/products?recover=1');
  const sync = page.getByRole('button', { name: 'Sync more products', exact: true });
  await expect(sync).toBeEnabled();
  await expect(page.getByText('40 products are still syncing', { exact: false })).toBeVisible();
  await sync.click();
  await expect(sync).toHaveCount(0);
  await expect(page.getByText('65 of 65 products', { exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`browse, sort and enquire across 1,001 public listings at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/img/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYvQAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await page.goto('/collection');
    await page.locator('.ngf-controls').scrollIntoViewIfNeeded();
    const cards = page.locator('#ngf-collection-grid [data-product-card]');
    await expect(cards).toHaveCount(18);
    await expect(page.getByRole('button', { name: 'Next products', exact: true })).toBeEnabled();
    expect(
      await page.locator('body').evaluate((body) => body.querySelectorAll('*').length),
    ).toBeLessThan(1500);
    await page.getByRole('button', { name: 'Next products', exact: true }).click();
    await expect(page.getByText('Page 2 of 56 · 1001 products', { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(18);
    await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('priceAsc');
    await expect(cards.first()).toHaveAttribute('data-slug', 'scale-product-0000');
    await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('priceDesc');
    await expect(cards.first()).toHaveAttribute('data-slug', 'brown-sofa');
    await expect(cards.nth(1)).toHaveAttribute('data-slug', 'scale-product-0999');
    const enquire = cards
      .nth(1)
      .getByRole('link', { name: 'Quick enquire about Scale product 0999', exact: true });
    await enquire.click();
    await expect(
      page.getByRole('dialog', { name: 'Quick enquiry — Scale product 0999', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/collection?q=NGF-SCALE-00017');
    await page.locator('.ngf-controls').scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('data-slug', 'scale-product-0017');
    await page.goto('/collection/mattresses');
    await page.locator('.ngf-controls').scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Next products', exact: true })).toBeEnabled();
    await expect(page.locator('#ngf-mattress-grid [data-product-card]')).toHaveCount(18);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `.wrangler/catalogue-scale-20261025/catalogue-${viewport.width}.png`,
    });
  });
}

test('static next-page links work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8899/collection');
    await page.getByRole('link', { name: 'Next products', exact: true }).click();
    await expect(page).toHaveURL(/\/browse\/all\/2$/);
    await expect(page.locator('[data-product-card]')).toHaveCount(18);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Collection — Page 2');
  } finally {
    await context.close();
  }
});

test('a failed card download preserves the previous products and can be retried', async ({
  page,
}) => {
  await page.goto('/collection');
  await page.locator('.ngf-controls').scrollIntoViewIfNeeded();
  const next = page.getByRole('button', { name: 'Next products', exact: true });
  await expect(next).toBeEnabled();
  const before = await page
    .locator('#ngf-collection-grid [data-product-card]')
    .first()
    .getAttribute('data-slug');
  await page.route('**/catalogue-cards/**', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await next.click();
  await expect(page.getByRole('alert')).toContainText('Your previous page is still available');
  expect(
    await page
      .locator('#ngf-collection-grid [data-product-card]')
      .first()
      .getAttribute('data-slug'),
  ).toBe(before);
  await page.unroute('**/catalogue-cards/**');
  await page.getByRole('button', { name: 'Retry loading products', exact: true }).click();
  await expect(page.getByText('Page 2 of 56 · 1001 products', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`admin paginates and finds records beyond the first page at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin/products');
    await expect(page.getByText('Page 1 of 40', { exact: true })).toBeVisible();
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toBeEnabled();
    const response = page.waitForResponse(
      (res) => res.url().includes('/api/admin/products?') && res.url().includes('page=2'),
    );
    await next.click();
    const body = (await (await response).json()) as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(25);
    expect(body.total).toBe(1000);
    await expect(page.getByText('Page 2 of 40', { exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('NGF-SCALE-00017');
    await expect(page.getByText('1 of 1000 products', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Scale product 0017', exact: true }).first(),
    ).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('does-not-exist');
    await expect(
      page.getByRole('heading', { name: 'No products match these filters', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
