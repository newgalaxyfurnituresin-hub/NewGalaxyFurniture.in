import { expect, test } from '@playwright/test';

test.skip(process.env.NGF_ENHANCEMENT_HARNESS !== '1', 'Uses the isolated local admin fixture.');

for (const width of [320, 768, 1440]) {
  test(`SKU review and two-step deletion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let deletes = 0;
    let patchRequests = 0;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/admin/products/p_device0001', async (route) => {
      if (route.request().method() === 'PATCH') patchRequests++;
      if (route.request().method() !== 'DELETE') return route.continue();
      deletes++;
      const body = route.request().postDataJSON() as {
        confirmSku: string;
        expectedUpdatedAt: string;
      };
      expect(body.confirmSku).toBe('NGF-SOF-WBJZX0');
      expect(body.expectedUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
      await route.fulfill({
        json: {
          deleted: true,
          deletedAt: new Date().toISOString(),
          commitSha: 'test-delete',
          deployTriggered: true,
        },
      });
    });
    await page.route('**/publication-status.json?*', (route) =>
      route.fulfill({ json: { generatedAt: '2099-01-01T00:00:00.000Z', products: [] } }),
    );
    await page.goto('/admin/products/edit?reset=1');
    const input = page.getByLabel('Delete by SKU', { exact: true });
    await input.fill('WRONG-SKU');
    await input.press('Enter');
    await expect(
      page.getByText('That SKU does not match this product.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm deletion', exact: true })).toHaveCount(
      0,
    );
    expect(deletes).toBe(0);
    expect(patchRequests).toBe(0);
    await input.fill('NGF-SOF-WBJZX0');
    await page.getByRole('button', { name: 'Review item to delete', exact: true }).click();
    const review = page.getByRole('region', { name: 'Confirm product deletion', exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByText('Local device fixture', { exact: true })).toBeVisible();
    await expect(review.locator('img')).toBeVisible();
    expect(deletes).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(deletes).toBe(0);
    await input.fill('NGF-SOF-WBJZX0');
    await input.press('Enter');
    await expect(review).toBeVisible();
    await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Product deleted from admin', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Confirmed: this product is no longer in the public catalogue.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
    expect(deletes).toBe(1);
    expect(errors).toEqual([]);
  });
}
