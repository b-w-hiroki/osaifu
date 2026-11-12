import { test, expect } from '@playwright/test';

const KEY = 'osaifu:v1';
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T10:00:00+09:00'));
  await page.addInitScript(() => localStorage.setItem('osaifu:launch-guide:v1', '1'));
  await page.route('**/config.js', r => r.fulfill({ body: 'window.OSAIFU_FIREBASE = null;', contentType: 'text/javascript' }));
  await page.route('https://imp-adedge.i-mobile.co.jp/**', r => r.abort());
  await page.goto('/app.html');
});
for (const width of [320, 390, 1180]) for (const colorScheme of ['light', 'dark']) {
  test(`first payment ${width} ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    const before = await page.evaluate(k => localStorage.getItem(k), KEY);
    const action = page.locator('.first-payment [data-act="new-bill"]');
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThan(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/home/first-payment-${width}-${colorScheme}.png` });
    await action.click();
    await expect(page.locator('#billForm')).toBeVisible();
    expect(await page.evaluate(k => localStorage.getItem(k), KEY)).toBe(before);
  });
}
test('existing transaction history is preserved and does not show onboarding', async ({ page }) => {
  const before = await page.evaluate(k => {
    const data = { wallets: [{ id: 'cash', name: '現金', initial: 1000 }], txs: [], bills: [], settings: { budget: 0, notify: false } };
    data.txs = [{ id: 'existing', type: 'expense', amount: 200, date: '2026-08-02', walletId: data.wallets[0].id, category: 'food' }];
    const raw = JSON.stringify(data); localStorage.setItem(k, raw); return raw;
  }, KEY);
  await page.reload();
  await expect(page.locator('.first-payment')).toHaveCount(0);
  await expect(page.locator('.summary-caption')).toHaveText('今月の収支');
  expect(await page.evaluate(k => localStorage.getItem(k), KEY)).toBe(before);
});
