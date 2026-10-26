import { expect, test } from '@playwright/test';

test.skip(
  process.env.NGF_RECOVERY_HARNESS !== '1',
  'Uses an isolated editor with no production writes.',
);
for (const width of [375, 768, 1024, 1440]) {
  test(`unfinished details survive refresh and network loss at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let cloud: Record<string, unknown> | null = null;
    let offline = false;
    await page.route('**/api/admin/editor-drafts**', async (route) => {
      if (offline) {
        await route.abort();
        return;
      }
      const request = route.request();
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as {
          scope: string;
          baseUpdatedAt: string;
          patch: unknown;
        };
        cloud = {
          scope: body.scope,
          baseUpdatedAt: body.baseUpdatedAt,
          patch: Object.fromEntries(
            Object.entries(body.patch as Record<string, unknown>).reverse(),
          ),
          revision: crypto.randomUUID(),
          savedAt: Date.now(),
        };
      }
      if (request.method() === 'DELETE') {
        cloud = null;
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json: { draft: cloud } });
    });
    await page.goto('/admin/products/new?recovery=1');
    await expect(page).toHaveURL(/draft=new_/);
    await page.getByRole('textbox', { name: 'Product name', exact: true }).fill('A');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue('A');
    await page
      .getByRole('textbox', { name: 'Product name', exact: true })
      .fill('Tablet unfinished furniture');
    await expect(page.getByRole('region', { name: 'Draft recovery' })).toContainText(
      'saved online',
      { timeout: 15000 },
    );
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
      'Tablet unfinished furniture',
    );
    await expect(page.getByRole('region', { name: 'Draft recovery' })).toContainText(
      'saved online',
      { timeout: 15000 },
    );
    offline = true;
    await page
      .getByRole('textbox', { name: 'Product name', exact: true })
      .fill('Offline unfinished furniture');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
      'Offline unfinished furniture',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('existing product restores tags and colours, then clears recovery after Save', async ({
  page,
}) => {
  let cloud: Record<string, unknown> | null = null;
  let deleted = false;
  await page.route('**/api/admin/editor-drafts**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      if (body.expectedRevision !== (cloud?.revision ?? null)) {
        await route.fulfill({
          status: 409,
          json: { error: 'CONFLICT', message: 'Recovery revision mismatch.' },
        });
        return;
      }
      cloud = { ...body, revision: crypto.randomUUID(), savedAt: Date.now() };
    }
    if (request.method() === 'DELETE') {
      cloud = null;
      deleted = true;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ json: { draft: cloud } });
  });
  await page.goto('/admin/products/edit?reset=1&recovery=1');
  await page
    .getByRole('textbox', { name: 'Product name', exact: true })
    .fill('Recovered tablet sofa');
  await page.locator('#marketing > summary').click();
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('walnut, premium');
  await page.getByRole('button', { name: 'Add colour', exact: true }).click();
  await page
    .getByRole('group', { name: 'Colour 1', exact: true })
    .getByLabel('Colour name', { exact: true })
    .fill('Brown');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
    'Recovered tablet sofa',
  );
  await page.locator('#marketing > summary').click();
  await expect(page.getByRole('textbox', { name: 'Tags', exact: true })).toHaveValue(
    'walnut, premium',
  );
  await expect(
    page
      .getByRole('group', { name: 'Colour 1', exact: true })
      .getByLabel('Colour name', { exact: true }),
  ).toHaveValue('Brown');
  await expect(page.getByRole('region', { name: 'Draft recovery' })).toContainText('saved online', {
    timeout: 15000,
  });
  // An unfinished colour needs a photo before canonical Save. Remove only this local fixture colour.
  await page.getByRole('button', { name: 'Remove colour 1', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved at', { exact: false })).toBeVisible();
  expect(deleted).toBe(true);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('ngf:editor-recovery:')),
    ),
  ).toEqual([]);
  await page
    .getByRole('textbox', { name: 'Product name', exact: true })
    .fill('Another unfinished detail');
  await expect(page.getByRole('region', { name: 'Draft recovery' })).toContainText('saved online', {
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Discard recovery draft…', exact: true }).click();
  await page.getByRole('button', { name: 'Discard unfinished details', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
    'Recovered tablet sofa',
  );
  expect(cloud).toBeNull();
});

test('an offline-only new draft can be resumed from Products', async ({ page }) => {
  await page.route('**/api/admin/editor-drafts**', (route) => route.abort());
  await page.goto('/admin/products/new?recovery=1');
  await page
    .getByRole('textbox', { name: 'Product name', exact: true })
    .fill('Device-only recovery check');
  await page.goto('/admin/products');
  await page.getByRole('link', { name: /Device-only recovery check/ }).click();
  await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue(
    'Device-only recovery check',
  );
});

test('typing while an online save is pending queues the newer details', async ({ page }) => {
  let release: (() => void) | undefined;
  let writes = 0;
  const names: string[] = [];
  await page.route('**/api/admin/editor-drafts**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { draft: null } });
      return;
    }
    const body = request.postDataJSON() as {
      scope: string;
      baseUpdatedAt: string;
      patch: { name: string };
    };
    names.push(body.patch.name);
    if (++writes === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({
      json: {
        draft: {
          scope: body.scope,
          baseUpdatedAt: body.baseUpdatedAt,
          patch: body.patch,
          revision: String(writes),
          savedAt: Date.now(),
        },
      },
    });
  });
  await page.goto('/admin/products/new?recovery=1');
  await page
    .getByRole('textbox', { name: 'Product name', exact: true })
    .fill('First unfinished name');
  await expect(page.getByRole('region', { name: 'Draft recovery' })).toContainText(
    'Saving online',
    { timeout: 15000 },
  );
  await page
    .getByRole('textbox', { name: 'Product name', exact: true })
    .fill('Newest unfinished name');
  await expect.poll(() => release !== undefined).toBe(true);
  release!();
  await expect(page.getByRole('region', { name: 'Draft recovery' })).toContainText(
    'Newer details are waiting',
  );
  await expect(page.getByRole('region', { name: 'Draft recovery' })).toContainText('saved online', {
    timeout: 15000,
  });
  expect(names).toEqual(['First unfinished name', 'Newest unfinished name']);
});
