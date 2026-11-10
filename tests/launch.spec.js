import { test, expect } from '@playwright/test';
import fs from 'fs';

test.beforeEach(async ({ page }) => {
  const fake = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
  await page.route('https://imp-adedge.i-mobile.co.jp/**', (route) => route.abort());
  await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ body: fake, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.route('**/config.js', (route) => route.fulfill({
    body: "window.OSAIFU_FIREBASE = { apiKey: 'test', projectId: 'test' }; window.OSAIFU_REQUIRE_LOGIN = false;",
    contentType: 'text/javascript',
  }));
  await page.addInitScript(() => {
    globalThis.__fake = { docs: new Map(), listeners: [], authCbs: [], writes: [], resets: [], user: null, accounts: {}, authDelay: 0 };
  });
});

test('初回起動で用途・開始・ログインを選べ、ゲスト選択は再起動後も続く', async ({ page }) => {
  await page.goto('/app.html');
  const gate = page.locator('#login');
  await expect(gate.locator('#launchTitle')).toHaveText('おさいふ');
  await expect(gate.getByText('収支も、財布も、毎月の支払いも')).toBeVisible();
  await expect(gate.getByRole('button', { name: 'はじめる' })).toBeVisible();
  await expect(gate.getByRole('button', { name: 'ログインして同期' })).toBeVisible();
  for (const button of await gate.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  await gate.getByRole('button', { name: 'アプリについて' }).click();
  await expect(page.locator('#aboutDialog')).toHaveAttribute('open', '');
  await page.goBack();
  await expect(page.locator('#aboutDialog')).not.toHaveAttribute('open', '');

  await gate.getByRole('button', { name: 'はじめる' }).click();
  await expect(gate).toBeHidden();
  await page.reload();
  await expect(gate).toBeHidden();
  await expect(page.locator('#title')).not.toBeEmpty();
});

test('ログインを選ぶと既存の認証画面へ進み、設定からaboutを読み直せる', async ({ page }) => {
  await page.goto('/app.html');
  const gate = page.locator('#login');
  await gate.getByRole('button', { name: 'ログインして同期' }).click();
  await expect(gate.getByText('Googleでログイン')).toBeVisible();
  await expect(gate.locator('input[name=email]')).toBeVisible();
  await gate.getByText('ログインせずに使う').click();
  await page.locator('[data-tab=wallet]').click();
  await page.locator('[data-act=about]').click();
  await expect(page.locator('#aboutDialog')).toHaveAttribute('open', '');
  await page.locator('#aboutClose').click();
  await expect(page.locator('#aboutDialog')).not.toHaveAttribute('open', '');
});

test('同期の削除・編集注意は設定で開閉でき、狭い画面でも読める（mock）', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/app.html');
  await page.getByRole('button', { name: 'はじめる', exact: true }).click();
  await page.locator('[data-tab="wallet"]').click();
  const help = page.locator('.sync-help');
  const summary = help.locator('summary');
  await expect(summary).toBeVisible();
  await expect(help).not.toHaveAttribute('open', '');
  await summary.click();
  await expect(help).toHaveAttribute('open', '');
  await expect(help).toContainText('削除と編集が競合すると編集が残り');
  await expect(help).toContainText('各端末の同期を待って内容を確認');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await summary.click();
  await expect(help).not.toHaveAttribute('open', '');
});
