import { test, expect } from '@playwright/test';

test('トップページからアプリを開ける', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('支払い日');
  const cta = page.getByRole('link', { name: '無料ではじめる' }).first();
  await expect(cta).toHaveAttribute('href', './app.html');
  // 横スクロールが出ない
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('ブランドサイト導線は使いやすく、姉妹アプリメニューを保つ', async ({ page }) => {
  await page.goto('/');
  const links = page.locator('a[href="https://birdman-studio.com/"]');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('.bs-sw-btn').click();
  await expect(page.locator('.bs-sw-pop a')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('.bs-sw-pop')).toBeHidden();
});
