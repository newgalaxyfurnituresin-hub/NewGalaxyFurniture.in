import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('isolated admin component harness', () => {
  test.skip(!process.env.NGF_ADMIN_HARNESS, 'Requires the localhost-only admin component harness.');
  test('owner adds repair topics, FAQs and project records and recovers from a conflict', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:8897/');
    await page.getByRole('button', { name: 'Add repair topic', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).last().fill('Local stitch assessment');
    await page
      .getByLabel('Description', { exact: true })
      .last()
      .fill('A local-only fixture for checking the service editor.');
    await page.getByLabel('Visible on the repair page', { exact: true }).last().check();
    await page.getByRole('button', { name: 'Add FAQ', exact: true }).click();
    await page
      .getByLabel('Question', { exact: true })
      .last()
      .fill('What can I share with the team?');
    await page
      .getByLabel('Answer', { exact: true })
      .last()
      .fill('Share the sofa dimensions and a useful photograph.');
    await page.getByRole('button', { name: 'Add project', exact: true }).click();
    await page.getByLabel('Project title', { exact: true }).fill('Local unpublished project');
    await page.getByRole('button', { name: 'Save experience content', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Saved to GitHub');
    await page
      .getByLabel('Hero heading', { exact: true })
      .first()
      .fill('Keep the local edits when another tab changes this file.');
    await page.route('**/api/admin/experiences', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'CONFLICT',
              message: 'The fixture was changed in another tab.',
            }),
          })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Save experience content', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Reload this page');
    await expect(page.getByLabel('Hero heading', { exact: true }).first()).toHaveValue(
      'Keep the local edits when another tab changes this file.',
    );
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
  test('viewer sees content but cannot author or submit it', async ({ page }) => {
    await page.goto('http://127.0.0.1:8897/?role=viewer');
    await expect(page.getByText('You can view these sections.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save experience content' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add repair topic' })).toHaveCount(0);
    await expect(page.getByLabel('Hero heading', { exact: true }).first()).toBeDisabled();
  });
});

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+/.test(baseURL))
    throw new Error('Premium browser checks are local-only.');
  // Isolate test visitors without changing or clearing the real rate-limit mechanism.
  const visitor = crypto.randomUUID().slice(0, 8);
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `2001:db8:${visitor.slice(0, 4)}:${visitor.slice(4)}::1`,
  });
  // The test must not add fabricated visitor analytics to any data store.
  await page.route('**/api/events', (route) => route.fulfill({ status: 204 }));
});

for (const route of ['/sofa-repair', '/collection/mattresses']) {
  for (const viewport of viewports) {
    test(`${route} at ${viewport.width} × ${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator('main h1')).toBeVisible();
      for (const image of await page.locator('main img').all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(async () => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      const overflow = await page
        .locator('main h1, main h2, main p, main input, main textarea, main select, main a')
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              if (
                !rect.width ||
                !rect.height ||
                style.position === 'absolute' ||
                element.closest('[hidden], [aria-hidden="true"]')
              )
                return false;
              return rect.left < -1 || rect.right > window.innerWidth + 1;
            })
            .map((element) => element.tagName),
        );
      expect(overflow).toEqual([]);
      expect(errors).toEqual([]);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toMatch(new RegExp(`${route}$`));
      expect(canonical).not.toMatch(/localhost|127\.0\.0\.1/);
      if ([375, 768, 1440].includes(viewport.width)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `.wrangler/premium-local/screenshots/${route.includes('mattresses') ? 'mattresses' : 'repair'}-${viewport.width}.png`,
          fullPage: true,
        });
        await testInfo.attach('Responsive page', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      }
    });
  }
}

test('homepage and mobile navigation discover both experiences', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('link', { name: /Give your sofa a second look/ }).click();
  await expect(page).toHaveURL(/\/sofa-repair$/);
  await page.goto('/');
  await page.getByRole('link', { name: /Discover mattresses/ }).click();
  await expect(page).toHaveURL(/\/collection\/mattresses$/);
  const menu = page.getByRole('button', { name: /open menu|open navigation|menu/i }).first();
  await menu.click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Sofa Repair', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Mattresses', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('repair FAQ is keyboard accessible and new sections pass axe', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sofa-repair');
  const summary = page.locator('.ngf-exp-faq summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ngf-exp-faq details').first()).toHaveAttribute('open', '');
  const repair = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    repair.violations.map((issue) => ({
      id: issue.id,
      targets: issue.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.goto('/collection/mattresses');
  const mattresses = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    mattresses.violations.map((issue) => ({
      id: issue.id,
      targets: issue.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test('repair form validates, preserves input on failure, prevents duplicates and stores a local enquiry', async ({
  page,
}) => {
  await page.goto('/sofa-repair#repair-quote');
  const form = page.locator('[data-ngf-enquiry-form="QUOTE"]');
  await expect(form).toHaveAttribute('data-ngf-hydrated', 'true');
  await page.waitForTimeout(1600); // Exercise the real minimum-age spam guard, without bypassing it.
  await form.getByRole('button', { name: 'Send repair enquiry' }).click();
  await expect(form.locator('[aria-invalid="true"]').first()).toBeVisible();
  await form.getByLabel('Your name', { exact: false }).fill('Local Repair Test');
  await form.getByLabel('Phone number', { exact: false }).fill('9876543210');
  await form
    .getByLabel('What would you like us to look at?', { exact: false })
    .fill('Please assess the loose seat cushion on this three-seater sofa.');
  await form.getByLabel('Sofa type or seating (optional)').fill('Three-seater');
  await form.getByLabel('Preferred way to reach you').selectOption('WhatsApp');
  await page.route('**/api/leads', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'LEAD_NOT_RECORDED',
        message: 'Your enquiry was not recorded. Try again or contact us directly.',
      }),
    }),
  );
  await form.getByRole('button', { name: 'Try again' }).click();
  await expect(
    form.getByText('Your enquiry was not recorded. Try again or contact us directly.'),
  ).toBeVisible();
  await expect(form.getByLabel('Your name', { exact: false })).toHaveValue('Local Repair Test');
  await expect(form.getByRole('link', { name: /WhatsApp/ }).first()).toHaveAttribute(
    'href',
    /^https:\/\/wa.me\//,
  );
  await page.unroute('**/api/leads');
  let submitted = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/leads') && request.method() === 'POST') submitted++;
  });
  await form.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-ngf-enquiry-state="sent"]')).toContainText(
    'Your repair enquiry has been recorded',
  );
  expect(submitted).toBe(1);
});

test('repair photo attachments are validated and safely stored only in the local fixture', async ({
  page,
}) => {
  await page.goto('/sofa-repair#repair-quote');
  const form = page.locator('[data-ngf-enquiry-form="QUOTE"]');
  await expect(form).toHaveAttribute('data-ngf-hydrated', 'true');
  await form.getByLabel('Your name', { exact: false }).fill('Local Photo Test');
  await form.getByLabel('Phone number', { exact: false }).fill('9876543210');
  await form
    .getByLabel('What would you like us to look at?', { exact: false })
    .fill('Local-only attachment validation fixture for a sofa enquiry.');
  await form.locator('input[type="file"]').setInputFiles({
    name: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await page.waitForTimeout(1600);
  await form.getByRole('button', { name: 'Send repair enquiry' }).click();
  await expect(form.locator('input[type="file"]')).toHaveAttribute('aria-invalid', 'true');
  await form
    .locator('input[type="file"]')
    .setInputFiles('public/brand/mattress-inspiration-1040.webp');
  await form.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-ngf-enquiry-state="sent"]')).toContainText(
    'Your repair enquiry has been recorded',
  );
});

test.describe('populated mattress fixture (never production inventory)', () => {
  test.skip(
    !process.env.NGF_MATTRESS_FIXTURE,
    'Requires the isolated .wrangler mattress fixture build.',
  );
  test.beforeEach(async ({ page }) => {
    await page.route('**/img/p_testmat*/**', (route) =>
      route.fulfill({
        path: 'public/brand/mattress-inspiration-1040.webp',
        contentType: 'image/webp',
      }),
    );
  });
  test('real size facets, sorting and the no-match recovery affect the existing cards', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/collection/mattresses#mattress-collection');
    await expect(page.getByLabel('Sort', { exact: true })).toBeVisible();
    const cards = page.locator('#ngf-mattress-grid > li:not([hidden])');
    await expect(cards).toHaveCount(2);
    await page.getByLabel('Sort', { exact: true }).selectOption('priceDesc');
    const firstVisibleName = () =>
      cards.evaluateAll(
        (elements) =>
          elements
            .map((element) => ({
              name: element.querySelector('h3')?.textContent,
              x: element.getBoundingClientRect().x,
              y: element.getBoundingClientRect().y,
            }))
            .sort((a, b) => a.y - b.y || a.x - b.x)[0]?.name,
      );
    await expect.poll(firstVisibleName).toContain('Spring Mattress');
    await page.getByLabel('Sort', { exact: true }).selectOption('priceAsc');
    await expect.poll(firstVisibleName).toContain('Foam Mattress');
    await page.getByLabel('King', { exact: true }).check();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Foam Mattress');
    await page.goto('/collection/mattresses?size=Single&material=Foam#mattress-collection');
    await expect(page.getByLabel('Sort', { exact: true })).toBeVisible();
    await expect(page.locator('#ngf-mattress-nomatch')).toBeVisible();
    await page.getByRole('button', { name: /Clear/ }).click();
    await expect(cards).toHaveCount(2);
    await page.screenshot({
      path: '.wrangler/premium-local/screenshots/mattresses-populated-1366.png',
      fullPage: true,
    });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      for (const card of await cards.all()) {
        const bounds = await card.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    }
  });
  test('the mobile filter drawer closes with Escape and restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/collection/mattresses#mattress-collection');
    const toggle = page.getByRole('button', { name: /^Filters/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.getByLabel('King', { exact: true }).check();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(page.locator('#ngf-mattress-grid > li:not([hidden])')).toHaveCount(1);
  });
  test('selected size changes the actual derived price, availability and enquiry message', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/product/local-test-mattress-1');
    const options = page.locator('.ngf-mattress-options');
    await options.scrollIntoViewIfNeeded();
    await expect(options.getByRole('radio', { name: 'King', exact: true })).toBeVisible();
    await options.getByRole('radio', { name: 'King', exact: true }).check();
    await expect(options.locator('output')).toContainText('16,000');
    await expect(options.locator('output')).toContainText('out of stock');
    const href = await options
      .getByRole('link', { name: 'Enquire about King' })
      .getAttribute('href');
    expect(new URL(href!).searchParams.get('text')).toContain('Selected option: King');
    expect(new URL(href!).searchParams.get('text')).toContain('[LOCAL TEST] Foam Mattress');
    expect(await page.locator('.ngf-pdp-trust').count()).toBe(0);
    const audit = await new AxeBuilder({ page })
      .include('.ngf-mattress-options')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: '.wrangler/premium-local/screenshots/mattress-options-375.png',
      fullPage: true,
    });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(options.getByRole('radio', { name: 'King', exact: true })).toBeChecked();
    }
  });
});
