import { test, expect } from '@playwright/test';
import fs from 'fs';

// 広告枠（i-mobile）: 未設定なら何も表示・通信しない。設定済みなら決めた場所にだけ出る。
const SPOT = { sp: { mid: 1, asid: 2 }, pc: { mid: 3, asid: 4 } };
const CONFIG = { pid: 99, spots: { lp: SPOT, login: SPOT, history: SPOT } };
// i-mobile の SDK の代わりに、指定された要素へ 320x50 のバナーを描く（読み込まれた回数も数える）
const FAKE_SDK = `(function(){
  window.__adLoads = window.__adLoads || 0;
  function draw(o){ window.__adLoads++; var el=document.getElementById(o.elementid); if(!el) return;
    var b=document.createElement('div'); b.className='fake-banner'; b.style.cssText='width:320px;height:50px;background:#ccc'; el.appendChild(b); }
  var q=window.adsbyimobile||[]; var pending=q.splice(0); for (var i=0;i<pending.length;i++) draw(pending[i]);
})();`;

const data = {
  wallets: [{ id: 'cash', name: '現金', initial: 10000 }],
  txs: Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, type: 'expense', amount: 500, date: `2026-09-${String(i + 1).padStart(2, '0')}`, category: 'food', walletId: 'cash', memo: '' })),
  bills: [],
  settings: { budget: 0, notify: false, lastNotified: '' },
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T10:00:00+09:00'));
  // Advertising tests exercise the established login screen; launch.spec.js owns the one-time guide.
  await page.addInitScript(() => localStorage.setItem('osaifu:launch-guide:v1', '1'));
  await page.route('**/config.js', (route) => route.fulfill({ body: 'window.OSAIFU_FIREBASE = null; window.OSAIFU_REQUIRE_LOGIN = false;', contentType: 'text/javascript' }));
  page.on('pageerror', (e) => { throw e; });
});

async function withAds(page) {
  await page.addInitScript((c) => { window.BIRDMAN_ADS_TEST_CONFIG = c; }, CONFIG);
  await page.route('**/spot.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }));
}

test('未設定なら広告枠は出ず、i-mobile へ通信しない', async ({ page }) => {
  await page.addInitScript(() => { window.BIRDMAN_ADS_TEST_CONFIG = { pid: null, spots: {} }; });
  const hits = [];
  page.on('request', (r) => { if (/i-mobile/.test(r.url())) hits.push(r.url()); });
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.goto('/app.html');
  await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), ['osaifu:v1', data]);
  await page.reload();
  await page.locator('[data-tab="list"]').click();
  await expect(page.locator('.ad-slot')).toHaveCount(1);
  await expect(page.locator('.ad-slot')).toBeHidden();
  expect(hits).toEqual([]);
});

test('設定済みなら LP と履歴の末尾に出て、ホームには出ない', async ({ page }) => {
  await withAds(page);
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('.ad-slot[data-ad-spot="lp"] .fake-banner')).toBeVisible();

  await page.goto('/app.html');
  await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), ['osaifu:v1', data]);
  await page.reload();
  await expect(page.locator('.ad-slot')).toHaveCount(0); // ホームには枠自体がない
  await page.locator('[data-tab="list"]').click();
  const slot = page.locator('.ad-slot[data-ad-spot="history"]');
  await slot.evaluate((el) => el.previousElementSibling.scrollIntoView());
  await expect(slot.locator('.fake-banner')).toBeVisible();
  // 履歴の一番最後に置かれる
  expect(await slot.evaluate((el) => el === el.parentElement.lastElementChild)).toBe(true);
  // 月を切り替えて描き直しても、広告を読み込み直さない
  await page.locator('#prevMonth').click();
  await page.locator('#nextMonth').click();
  await expect(slot.locator('.fake-banner')).toHaveCount(1);
  expect(await page.evaluate(() => window.__adLoads)).toBe(1);
  // 他のタブに移ると消える
  await page.locator('[data-tab="home"]').click();
  await expect(page.locator('.ad-slot')).toHaveCount(0);
});

test('ログイン画面ではボタンの下に出て、規約へのリンクがある', async ({ page }) => {
  await withAds(page);
  const fake = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
  await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ body: fake, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.route('**/config.js', (route) => route.fulfill({ body: "window.OSAIFU_FIREBASE = { apiKey: 'test', projectId: 'test' }; window.OSAIFU_REQUIRE_LOGIN = false;", contentType: 'text/javascript' }));
  await page.addInitScript(() => { globalThis.__fake = { docs: new Map(), listeners: [], authCbs: [], writes: [], resets: [], user: null, accounts: {} }; });
  await page.goto('/app.html');
  const gate = page.locator('#login');
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', './terms.html');
  await expect(gate.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', './privacy.html');
  const ad = gate.locator('.ad-slot[data-ad-spot="login"]');
  await expect(ad.locator('.fake-banner')).toBeVisible();
  // 新規登録に切り替えて描き直しても、枠は1つのまま
  await gate.getByRole('button', { name: '新規登録' }).first().click();
  await expect(gate.getByText('利用規約とプライバシーポリシーに同意')).toBeVisible();
  await expect(gate.locator('.ad-slot')).toHaveCount(1);
  expect(await page.evaluate(() => window.__adLoads)).toBe(1);
});

test('client-side navigation flushes a spot queued after the SDK already ran', async ({ page }) => {
  await withAds(page);
  const fake = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
  await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ body: fake, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.route('**/config.js', (route) => route.fulfill({ body: "window.OSAIFU_FIREBASE = { apiKey: 'test', projectId: 'test' }; window.OSAIFU_REQUIRE_LOGIN = false;", contentType: 'text/javascript' }));
  await page.addInitScript(() => { globalThis.__fake = { docs: new Map(), listeners: [], authCbs: [], writes: [], resets: [], user: null, accounts: {} }; });
  await page.goto('/app.html');
  await expect(page.locator('.ad-slot[data-ad-spot="login"] .fake-banner')).toBeVisible();
  await page.locator('[data-login="skip"]').click();
  await page.locator('[data-tab="list"]').click();
  await expect(page.locator('.ad-slot[data-ad-spot="history"] .fake-banner')).toBeVisible();
  await page.locator('[data-tab="home"]').click();
  await page.locator('[data-tab="list"]').click();
  await expect(page.locator('.ad-slot[data-ad-spot="history"] .fake-banner')).toBeVisible();
  await expect(page.locator('script[data-imobile-loader]')).toHaveCount(2);
  expect(await page.evaluate(() => window.__adLoads)).toBe(2);
});

test('利用規約とプライバシーポリシーが開ける', async ({ page }) => {
  await page.goto('/terms.html');
  await expect(page.locator('h1')).toHaveText('利用規約');
  await expect(page.getByText('広告の表示')).toBeVisible();
  await page.goto('/privacy.html');
  await expect(page.locator('h1')).toHaveText('プライバシーポリシー');
  await expect(page.getByRole('link', { name: 'アイモバイルのオプトアウトのページ' })).toBeVisible();
});

test('本番の設定: スマホと PC でそれぞれ発行されたスポットを読み込む', async ({ page, browser }) => {
  async function pushedOn(pg) {
    const pushed = [];
    await pg.route('**/spot.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }));
    await pg.exposeFunction('__record', (o) => pushed.push(o));
    await pg.addInitScript(() => { window.adsbyimobile = { push: (o) => window.__record(o) }; });
    await pg.goto('/');
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => pushed.length).toBe(1);
    return pushed[0];
  }
  expect(await pushedOn(page)).toMatchObject({ pid: 84969, mid: 596790, asid: 1946456, elementid: 'im-9f99b0988b4946b5aebb140752952f23' });
  const pc = await browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' });
  expect(await pushedOn(await pc.newPage())).toMatchObject({ pid: 84969, mid: 596789, asid: 1946459, elementid: 'im-bfe22a60aa8347d4865e764acdb93b56' });
  await pc.close();
});
