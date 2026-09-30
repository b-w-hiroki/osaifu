import { test, expect } from '@playwright/test';

// アクセス解析（GA4）: 測定ID未設定なら読み込まない。設定すると gtag を読み込み page_view を送る。
test.beforeEach(async ({ page }) => {
  await page.route('**/config.js', (route) => route.fulfill({ body: 'window.OSAIFU_FIREBASE = null; window.OSAIFU_REQUIRE_LOGIN = false;', contentType: 'text/javascript' }));
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  page.on('pageerror', (e) => { throw e; });
});

test('測定ID未設定なら GA を読み込まない', async ({ page }) => {
  const hits = [];
  page.on('request', (r) => { if (/googletagmanager|google-analytics/.test(r.url())) hits.push(r.url()); });
  await page.goto('/');
  await page.goto('/app.html');
  await expect(page.locator('#title')).toBeVisible();
  expect(hits).toEqual([]);
  expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined');
});

test('測定IDを設定すると gtag を読み込み、表示方法を付けて送る', async ({ page }) => {
  await page.addInitScript(() => { window.BIRDMAN_GA_TEST_ID = 'G-TEST123'; });
  const hits = [];
  await page.route('https://www.googletagmanager.com/**', (route) => { hits.push(route.request().url()); route.fulfill({ contentType: 'text/javascript', body: '' }); });
  await page.goto('/app.html');
  await expect(page.locator('#title')).toBeVisible();
  const cfg = await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).find((a) => a[0] === 'config'));
  expect(cfg[1]).toBe('G-TEST123');
  expect(cfg[2]).toEqual({ display_mode: 'browser' });
  expect(hits.some((u) => u.includes('id=G-TEST123'))).toBe(true);
});
