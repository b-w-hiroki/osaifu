import { test, expect } from '@playwright/test';
import fs from 'fs';

const KEY = 'osaifu:v1';

// 日付を 2026-09-28 に固定して毎回同じ結果にする
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T10:00:00+09:00'));
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
});

async function seed(page, data) {
  await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [KEY, data]);
  await page.reload();
}
const state = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
async function readDownload(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return fs.readFileSync(await dl.path(), 'utf8');
}

const base = {
  wallets: [
    { id: 'cash', name: '現金', icon: '👛', initial: 10000 },
    { id: 'bank', name: '銀行口座', icon: '🏦', initial: 100000 },
  ],
  txs: [],
  bills: [],
  settings: { budget: 0, notify: false, lastNotified: '' },
};

test('初回は空の状態で案内が表示される', async ({ page }) => {
  await expect(page.locator('#title')).toHaveText('2026年9月');
  await expect(page.getByText('＋ 支払いを登録')).toBeVisible();
  await expect(page.getByText('まだ支出の記録がありません')).toBeVisible();
});

test('横スクロールが発生しない', async ({ page }) => {
  await seed(page, { ...base, bills: [{ id: 'b1', name: 'とても長い名前の支払いとても長い名前の支払い', amount: 1234567, day: 27, category: 'house', walletId: 'bank', notifyDays: 1 }] });
  for (const tab of ['home', 'cal', 'list', 'wallet']) {
    await page.click(`[data-tab=${tab}]`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, tab).toBeLessThanOrEqual(0);
  }
});

test('支出を記録すると収支と財布残高に反映される', async ({ page }) => {
  await seed(page, base);
  await page.click('#fab');
  await page.fill('input[name=amount]', '1500');
  await expect(page.locator('input[name=amount]')).toHaveValue('1,500');
  await page.click('.cat-grid label:has-text("交通")');
  await page.selectOption('select[name=walletId]', 'cash');
  await page.click('#txForm button[type=submit]');

  await expect(page.locator('.summary .big')).toHaveText('−¥1,500');
  await expect(page.locator('[data-edit-wallet=cash]')).toContainText('¥8,500');
  const s = await state(page);
  expect(s.txs[0]).toMatchObject({ type: 'expense', amount: 1500, category: 'transport', walletId: 'cash', date: '2026-09-28' });
});

test('振替は財布間で残高が移り、収支には含まれない', async ({ page }) => {
  await seed(page, base);
  await page.click('#fab');
  await page.click('.seg.type button[data-v=transfer]');
  await page.fill('input[name=amount]', '20000');
  await page.selectOption('select[name=walletId]', 'bank');
  await page.selectOption('select[name=toWalletId]', 'cash');
  await page.click('#txForm button[type=submit]');

  await expect(page.locator('.summary .big')).toHaveText('¥0');
  await expect(page.locator('[data-edit-wallet=cash]')).toContainText('¥30,000');
  await expect(page.locator('[data-edit-wallet=bank]')).toContainText('¥80,000');
});

test('毎月の支払いを登録→支払済→取り消しできる', async ({ page }) => {
  await seed(page, base);
  await page.getByText('＋ 支払いを登録').click();
  await page.fill('input[name=name]', '家賃');
  await page.fill('#billForm input[name=amount]', '80000');
  await page.selectOption('select[name=day]', '30');
  await page.click('#billForm button[type=submit]');

  const row = page.locator('.row-item', { hasText: '家賃' }).first();
  await expect(row).toContainText('30日');
  await row.locator('[data-pay]').click();
  await expect(row.locator('[data-pay]')).toHaveText('済');
  await expect(page.locator('.summary')).toContainText('¥80,000');
  let s = await state(page);
  expect(s.txs).toHaveLength(1);
  expect(s.txs[0]).toMatchObject({ amount: 80000, billMonth: '2026-09', date: '2026-09-28' });

  await page.locator('#toast button').click();
  await expect(row).toContainText('30日');
  s = await state(page);
  expect(s.txs).toHaveLength(0);
});

test('期日を過ぎた未払いは超過表示、月末指定は短い月で末日になる', async ({ page }) => {
  await seed(page, {
    ...base,
    bills: [
      { id: 'late', name: 'スマホ', amount: 3000, day: 25, category: 'phone', walletId: 'bank', notifyDays: 1 },
      { id: 'eom', name: 'カード', amount: 50000, day: 31, category: 'card', walletId: 'bank', notifyDays: 3 },
    ],
  });
  await expect(page.locator('.row-item', { hasText: 'スマホ' })).toContainText('3日超過');
  await page.click('[data-tab=cal]');
  // 9月は30日まで → 31日指定は30日に表示
  await expect(page.locator('[data-day="2026-09-30"] .dots i')).toHaveCount(1);
  await expect(page.locator('[data-day="2026-09-25"] .dots i.late')).toHaveCount(1);
});

test('カレンダー(.ics)に月末ルールと通知が入る', async ({ page }) => {
  await seed(page, {
    ...base,
    bills: [
      { id: 'a', name: '家賃', amount: 80000, day: 27, category: 'house', walletId: 'bank', notifyDays: 1 },
      { id: 'b', name: 'カード', amount: 50000, day: 31, category: 'card', walletId: 'bank', notifyDays: 0 },
    ],
  });
  await page.click('[data-tab=wallet]');
  const ics = await readDownload(page, () => page.click('[data-act=ics]'));
  expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=27');
  expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
  expect(ics).toContain('TRIGGER:-PT15H'); // 前日9時
  expect(ics).toContain('TRIGGER:PT9H'); // 当日9時
  expect(ics).toContain('DTSTART;VALUE=DATE:20260930');
});

test('CSVはBOM付きでカンマ・引用符をエスケープする', async ({ page }) => {
  await seed(page, {
    ...base,
    txs: [
      { id: '1', type: 'income', amount: 250000, date: '2026-09-25', category: 'salary', walletId: 'bank', memo: '' },
      { id: '2', type: 'expense', amount: 1200, date: '2026-09-20', category: 'food', walletId: 'cash', memo: 'ランチ, "特盛"' },
    ],
  });
  await page.click('[data-tab=wallet]');
  const csv = await readDownload(page, () => page.click('[data-act=csv]'));
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).split('\r\n');
  expect(lines[0]).toBe('日付,種類,カテゴリ,金額,財布,移動先,メモ,定期支払い');
  expect(lines[1]).toBe('2026-09-20,支出,食費,1200,現金,,"ランチ, ""特盛""",');
  expect(lines[2]).toBe('2026-09-25,収入,給与,250000,銀行口座,,,');
});

test('バックアップを書き出して復元できる', async ({ page }) => {
  await seed(page, { ...base, txs: [{ id: '1', type: 'expense', amount: 999, date: '2026-09-01', category: 'food', walletId: 'cash', memo: 'x' }] });
  await page.click('[data-tab=wallet]');
  const json = await readDownload(page, () => page.click('[data-act=export]'));
  expect(JSON.parse(json).txs[0].amount).toBe(999);

  page.once('dialog', (d) => d.accept());
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=import]')]);
  await chooser.setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('#toast')).toContainText('復元しました');
  expect((await state(page)).txs[0].amount).toBe(999);
});

test('タブバーはスクロールしても画面下に固定される', async ({ page }) => {
  await seed(page, { ...base, txs: Array.from({ length: 40 }, (_, i) => ({ id: 't' + i, type: 'expense', amount: 100, date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, category: 'food', walletId: 'cash', memo: '' })) });
  await page.click('[data-tab=list]');
  const vh = page.viewportSize().height;
  const before = await page.locator('.tabbar').boundingBox();
  await page.locator('#view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const after = await page.locator('.tabbar').boundingBox();
  expect(Math.round(before.y + before.height)).toBe(vh);
  expect(after.y).toBe(before.y);
});
