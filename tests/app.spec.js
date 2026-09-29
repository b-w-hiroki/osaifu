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

test('レシートの文字から合計・日付・店名・カテゴリを推定する', async ({ page }) => {
  const cases = [
    {
      text: 'イオン 新宿店\nTEL 03-1234-5678\n2026年9月27日(日) 18:32\n牛乳 ¥198\nパン ¥248\n小計 ¥446\n消費税 ¥35\n合計 ¥481\nお預り ¥1,000\nお釣り ¥519',
      want: { amount: 481, date: '2026-09-27', store: 'イオン新宿店', category: 'food' },
    },
    {
      // 全角・桁区切りのゆれ、合計の金額が次の行
      text: 'マツモトキヨシ\n領収書\n2026/09/05\n合 計\n￥２，９８０\nお預り ￥３，０００',
      want: { amount: 2980, date: '2026-09-05', store: 'マツモトキヨシ', category: 'daily' },
    },
    {
      text: '中央クリニック\n令和8年9月1日\n診療費 1.500円\nお支払金額 1.500円',
      want: { amount: 1500, date: '2026-09-01', store: '中央クリニック', category: 'medical' },
    },
    {
      // 合計行が読めない場合は円表記の最大額
      text: 'カフェ ABC\n2026.9.3\nコーヒー 450円\nケーキ 520円\n970円',
      want: { amount: 970, date: '2026-09-03', store: 'カフェ ABC', category: 'food' },
    },
    {
      // 実際の文字認識結果（文字間の空白、¥が「\」、桁区切りが「.」）
      text: 'イオ ン 新宿 店\n2026 年 9 月 27 日 18:32\n牛乳 \\198\n\n小計 \\446\n\n合計 \\481\n\nお 預り \\1.000\n',
      want: { amount: 481, date: '2026-09-27', store: 'イオン新宿店', category: 'food' },
    },
    { text: 'ぼやけて読めない', want: { amount: 0, date: '' } },
  ];
  for (const c of cases) {
    const got = await page.evaluate((t) => parseReceipt(t), c.text);
    expect(got, c.text.split('\n')[0]).toMatchObject(c.want);
  }
});

test('支出の新規記録にだけ読み取りボタンが出る', async ({ page }) => {
  await seed(page, base);
  await page.click('#fab');
  await expect(page.locator('[data-ocr]')).toBeVisible();
  await page.click('.seg.type button[data-v=income]');
  await expect(page.locator('[data-ocr]')).toHaveCount(0);
});

test('同期：3方向マージは片方の変更を採用し、両方変更なら端末側を優先する', async ({ page }) => {
  const r = await page.evaluate(() => {
    const rec = (amount) => ({ kind: 'tx', data: { id: 'x', amount } });
    const c = Sync.canon;
    const base = { a: c(rec(1)), b: c(rec(1)), d: c(rec(1)), e: c(rec(1)), f: c(rec(1)) };
    const local = { a: rec(2), b: rec(1), d: rec(1), e: rec(5), n: rec(9) /* f は端末で削除 */ };
    const remote = { a: rec(1), b: rec(3), e: rec(6), f: rec(1), m: rec(8) /* d はクラウドで削除 */ };
    const m = Sync.merge(local, base, remote);
    return { amounts: Object.fromEntries(Object.entries(m.recs).map(([k, v]) => [k, v.data.amount])), push: m.push.sort(), del: m.del.sort() };
  });
  expect(r.amounts).toEqual({ a: 2, b: 3, e: 5, n: 9, m: 8 });
  expect(r.push).toEqual(['a', 'e', 'n']);
  expect(r.del).toEqual(['f']);
});

test.describe('クラウド同期（Firebaseを代替して検証）', () => {
  test.beforeEach(async ({ page }) => {
    const fake = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
    await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ body: fake, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/config.js', (route) => route.fulfill({ body: "window.OSAIFU_FIREBASE = { apiKey: 'test', projectId: 'test' };", contentType: 'text/javascript' }));
    // クラウドには別端末で記録した支出が1件ある
    await page.addInitScript(() => {
      globalThis.__fake = { docs: new Map([['t_remote1', { kind: 'tx', data: { id: 'remote1', type: 'expense', amount: 777, date: '2026-09-15', category: 'food', walletId: 'cash', memo: '別端末' } }]]), listeners: [], authCbs: [], writes: [], user: null };
    });
  });

  test('ログインで双方の記録がそろい、以後の変更が往復する', async ({ page }) => {
    await seed(page, { ...base, txs: [{ id: 'local1', type: 'expense', amount: 500, date: '2026-09-20', category: 'fun', walletId: 'cash', memo: 'この端末' }] });
    await page.click('[data-tab=wallet]');
    await page.getByText('Googleでログイン').click();
    await expect(page.locator('.set-row', { hasText: 'クラウド同期' })).toContainText('同期済み');
    await expect(page.locator('.set-row', { hasText: 'クラウド同期' })).toContainText('test@example.com');

    // クラウド → 端末
    let s = await state(page);
    expect(s.txs.map((t) => t.id).sort()).toEqual(['local1', 'remote1']);
    // 端末 → クラウド（財布・設定・端末の記録）
    const remoteIds = await page.evaluate(() => [...__fake.docs.keys()].sort());
    expect(remoteIds).toEqual(['_settings', 't_local1', 't_remote1', 'w_bank', 'w_cash']);

    // 別端末でクラウドの記録が変更された
    await page.evaluate(() => {
      const d = __fake.docs.get('t_remote1'); d.data.amount = 800; __fake.docs.set('t_remote1', d); __fake.emit();
    });
    await page.click('[data-tab=list]');
    await expect(page.locator('[data-edit-tx=remote1]')).toContainText('¥800');

    // 端末で削除 → クラウドからも消える
    page.once('dialog', (d) => d.accept());
    await page.click('[data-edit-tx=local1]');
    await page.click('#txForm [data-del]');
    await expect.poll(() => page.evaluate(() => __fake.docs.has('t_local1'))).toBe(false);

    // ログアウトしても端末のデータは残る
    await page.click('[data-tab=wallet]');
    await page.getByText('ログアウト').click();
    await expect(page.getByText('Googleでログイン')).toBeVisible();
    s = await state(page);
    expect(s.txs.map((t) => t.id)).toEqual(['remote1']);
  });
});

test('Firebase未設定なら同期の項目は出ずSDKも読み込まない', async ({ page }) => {
  const sdk = [];
  page.on('request', (r) => { if (r.url().includes('firebasejs')) sdk.push(r.url()); });
  await page.click('[data-tab=wallet]');
  await expect(page.getByText('クラウド同期')).toHaveCount(0);
  expect(sdk).toEqual([]);
});

test('金額が変わる支払いは記録画面で金額を確定し、次回の目安に反映される', async ({ page }) => {
  await seed(page, { ...base, bills: [{ id: 'elec', name: '電気代', amount: 8000, day: 30, category: 'utility', walletId: 'bank', notifyDays: 1, variable: true }] });
  const row = page.locator('.row-item', { hasText: '電気代' }).first();
  await expect(row).toContainText('約¥8,000');
  await row.locator('[data-pay]').click();
  await expect(page.locator('#txForm input[name=amount]')).toHaveValue('8,000');
  await page.fill('#txForm input[name=amount]', '9100');
  await page.click('#txForm button[type=submit]');
  await expect(row.locator('[data-pay]')).toHaveText('済');
  await expect(row).toContainText('¥9,100');
  const s = await state(page);
  expect(s.txs[0]).toMatchObject({ amount: 9100, billId: 'elec', billMonth: '2026-09', type: 'expense' });
  expect(s.bills[0].amount).toBe(9100);
});

test('毎月の収入を登録して受け取りを記録できる', async ({ page }) => {
  await seed(page, base);
  await page.getByText('＋ 支払いを登録').click();
  await page.click('#billForm .seg.type button[data-v=income]');
  await page.fill('#billForm input[name=name]', '給与');
  await page.fill('#billForm input[name=amount]', '280000');
  await page.selectOption('#billForm select[name=day]', '25');
  await page.click('#billForm button[type=submit]');

  const row = page.locator('.row-item', { hasText: '給与' }).first();
  await expect(row).toContainText('未入金');
  await row.getByText('受取').click();
  await expect(page.locator('.summary .income')).toHaveText('¥280,000');
  const s = await state(page);
  expect(s.bills[0]).toMatchObject({ type: 'income', category: 'salary' });
  expect(s.txs[0]).toMatchObject({ type: 'income', amount: 280000, category: 'salary', billId: s.bills[0].id });
  // 収入は「残り」の支払額に含めない
  await expect(page.locator('.card-head', { hasText: '支払い' })).not.toContainText('残り');
});

test('財布の現在の残高を入力すると、その金額に合わせられる', async ({ page }) => {
  await seed(page, { ...base, txs: [{ id: '1', type: 'expense', amount: 1500, date: '2026-09-10', category: 'food', walletId: 'cash', memo: '' }] });
  await page.click('[data-tab=wallet]');
  await page.click('[data-edit-wallet=cash]');
  await expect(page.locator('#wForm input[name=balance]')).toHaveValue('8500');
  await page.fill('#wForm input[name=balance]', '9000');
  await page.click('#wForm button[type=submit]');
  await expect(page.locator('[data-edit-wallet=cash]')).toContainText('¥9,000');
  expect((await state(page)).wallets.find((w) => w.id === 'cash').initial).toBe(10500);
});

test('支出の推移は6か月分を表示し、棒をタップするとその月へ移る', async ({ page }) => {
  await seed(page, { ...base, txs: [
    { id: '1', type: 'expense', amount: 3000, date: '2026-07-10', category: 'food', walletId: 'cash', memo: '' },
    { id: '2', type: 'expense', amount: 1200, date: '2026-09-10', category: 'food', walletId: 'cash', memo: '' },
  ] });
  await page.click('[data-tab=list]');
  await expect(page.locator('.trend-col')).toHaveCount(6);
  await expect(page.locator('.trend-col.cur')).toContainText('¥1,200');
  await page.click('[data-month="2026-6"]');
  await expect(page.locator('#title')).toHaveText('2026年7月');
  await expect(page.locator('.trend-col.cur')).toContainText('¥3,000');
});
