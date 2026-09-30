import { test, expect } from '@playwright/test';

test('トップページからアプリを開ける', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('支払い日');
  const cta = page.getByRole('link', { name: '無料ではじめる' }).first();
  await expect(cta).toHaveAttribute('href', './app.html');
  // 横スクロールが出ない
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
