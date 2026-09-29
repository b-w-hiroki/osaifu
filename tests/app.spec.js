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

test.describe('ログインとクラウド同期（Firebaseを代替して検証）', () => {
  const remoteTx = { kind: 'tx', data: { id: 'remote1', type: 'expense', amount: 777, date: '2026-09-15', category: 'food', walletId: 'cash', memo: '別端末' } };

  // opts.require: ログイン必須 / opts.user: すでにログイン済み / opts.accounts: 登録済みのアカウント
  async function setup(page, opts = {}) {
    const fake = fs.readFileSync(new URL('./fake-firebase.js', import.meta.url), 'utf8');
    await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ body: fake, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/config.js', (route) => route.fulfill({
      body: `window.OSAIFU_FIREBASE = { apiKey: 'test', projectId: 'test' }; window.OSAIFU_REQUIRE_LOGIN = ${!!opts.require};`,
      contentType: 'text/javascript',
    }));
    await page.addInitScript((o) => {
      if (globalThis.__fake) return; // 再読み込み時はクラウドの内容を引き継ぐ（addInitScript は毎回走るため）
      globalThis.__fake = {
        docs: new Map([['t_remote1', o.remote]]), listeners: [], authCbs: [], writes: [], resets: [],
        user: o.user || null, accounts: o.accounts || {},
      };
    }, { remote: remoteTx.data && remoteTx, user: opts.user, accounts: opts.accounts });
  }
  const gate = (page) => page.locator('#login');

  test('未ログインの初回はログイン画面が出て、「ログインせずに使う」で閉じられる', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    await expect(gate(page)).toBeVisible();
    await expect(gate(page).getByText('Googleでログイン')).toBeVisible();
    await expect(gate(page).locator('input[name=email]')).toBeVisible();
    await gate(page).getByText('ログインせずに使う').click();
    await expect(gate(page)).toBeHidden();
    await expect(page.locator('#title')).toHaveText('2026年9月');
    // 次回以降は出ない。設定画面からはいつでもログインできる
    await page.reload();
    await expect(gate(page)).toBeHidden();
    await page.click('[data-tab=wallet]');
    await page.locator('.set-row', { hasText: 'ログイン' }).getByRole('button', { name: 'ログイン' }).click();
    await expect(gate(page)).toBeVisible();
    await gate(page).getByText('戻る').click();
    await expect(gate(page)).toBeHidden();
  });

  test('ログイン必須の設定では「ログインせずに使う」が出ない', async ({ page }) => {
    await setup(page, { require: true });
    await page.goto('/');
    await expect(gate(page)).toBeVisible();
    await expect(gate(page).getByText('ログインせずに使う')).toHaveCount(0);
    await page.reload();
    await expect(gate(page)).toBeVisible();
  });

  test('メールで新規登録するとログインでき、端末とクラウドの記録がそろう', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    await seed(page, { ...base, txs: [{ id: 'local1', type: 'expense', amount: 500, date: '2026-09-20', category: 'fun', walletId: 'cash', memo: 'この端末' }] });
    await gate(page).getByRole('button', { name: '新規登録' }).first().click();
    await gate(page).locator('input[name=email]').fill('me@example.com');
    await gate(page).locator('input[name=password]').fill('secret123');
    await gate(page).locator('form button[type=submit]').click();
    await expect(gate(page)).toBeHidden();

    await page.click('[data-tab=wallet]');
    const row = page.locator('.set-row', { hasText: 'アカウント' });
    await expect(row).toContainText('me@example.com');
    await expect(row).toContainText('同期済み');
    expect((await state(page)).txs.map((t) => t.id).sort()).toEqual(['local1', 'remote1']);
    expect(await page.evaluate(() => [...__fake.docs.keys()].sort())).toEqual(['_settings', 't_local1', 't_remote1', 'w_bank', 'w_cash']);

    // クラウド側の変更が届く
    await page.evaluate(() => { const d = __fake.docs.get('t_remote1'); d.data.amount = 800; __fake.docs.set('t_remote1', d); __fake.emit(); });
    await page.click('[data-tab=list]');
    await expect(page.locator('[data-edit-tx=remote1]')).toContainText('¥800');
  });

  test('Googleでログインできる', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    await gate(page).getByText('Googleでログイン').click();
    await expect(gate(page)).toBeHidden();
    await page.click('[data-tab=wallet]');
    await expect(page.locator('.set-row', { hasText: 'アカウント' })).toContainText('test@example.com');
  });

  test('ログインの失敗はわかりやすい日本語で出る', async ({ page }) => {
    await setup(page, { accounts: { 'a@example.com': { pw: 'correct-pass', uid: 'ua' } } });
    await page.goto('/');
    const msg = gate(page).locator('.login-msg');
    const submit = gate(page).locator('form button[type=submit]');
    await gate(page).locator('input[name=email]').fill('a@example.com');
    await gate(page).locator('input[name=password]').fill('wrong');
    await submit.click();
    await expect(msg).toHaveText('メールアドレスまたはパスワードが違います');
    await expect(gate(page)).toBeVisible();
    // 入力したメールアドレスは残る
    await expect(gate(page).locator('input[name=email]')).toHaveValue('a@example.com');

    await gate(page).getByRole('button', { name: '新規登録' }).first().click();
    await gate(page).locator('input[name=email]').fill('new@example.com');
    await gate(page).locator('input[name=password]').fill('12345');
    await submit.click();
    await expect(msg).toHaveText('パスワードは6文字以上にしてください');
    await gate(page).locator('input[name=email]').fill('a@example.com');
    await gate(page).locator('input[name=password]').fill('123456');
    await submit.click();
    await expect(msg).toContainText('登録済みです');
    await gate(page).locator('input[name=email]').fill('');
    await submit.click();
    await expect(msg).toHaveText('メールアドレスとパスワードを入力してください');
  });

  test('パスワード再設定のメールを送れる', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    await gate(page).getByText('パスワードを忘れた').click();
    await expect(gate(page).locator('.login-msg')).toHaveText('メールアドレスを入力してください');
    await gate(page).locator('input[name=email]').fill('me@example.com');
    await gate(page).getByText('パスワードを忘れた').click();
    await expect(gate(page).locator('.login-msg')).toHaveText('再設定用のメールを送信しました');
    expect(await page.evaluate(() => __fake.resets)).toEqual(['me@example.com']);
    await expect(gate(page)).toBeVisible();
  });

  test('ログアウトで端末のデータを片付け、再ログインでクラウドから戻る', async ({ page }) => {
    await setup(page, { accounts: { 'a@example.com': { pw: 'correct-pass', uid: 'ua' } } });
    await page.goto('/');
    await gate(page).locator('input[name=email]').fill('a@example.com');
    await gate(page).locator('input[name=password]').fill('correct-pass');
    await gate(page).locator('form button[type=submit]').click();
    await expect(gate(page)).toBeHidden();
    await expect.poll(async () => (await state(page)).txs.length).toBe(1);

    await page.click('[data-tab=wallet]');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(gate(page)).toBeVisible();
    expect((await state(page)).txs).toEqual([]);
    expect(await page.evaluate(() => __fake.docs.has('t_remote1'))).toBe(true); // クラウドには残る

    await gate(page).locator('input[name=email]').fill('a@example.com');
    await gate(page).locator('input[name=password]').fill('correct-pass');
    await gate(page).locator('form button[type=submit]').click();
    await expect(gate(page)).toBeHidden();
    await expect.poll(async () => (await state(page)).txs.map((t) => t.id)).toEqual(['remote1']);
  });

  test('別アカウントのデータが端末に残っていたら、確認してから切り替える', async ({ page }) => {
    await setup(page, { accounts: { 'b@example.com': { pw: 'bbbbbb', uid: 'ub' } } });
    await page.goto('/');
    await seed(page, { ...base, txs: [{ id: 'mine', type: 'expense', amount: 1, date: '2026-09-01', category: 'food', walletId: 'cash', memo: 'Aさんの記録' }] });
    await page.evaluate(() => localStorage.setItem('osaifu:sync-uid', JSON.stringify('ua')));

    // 断ると、ログアウトして端末のデータはそのまま
    page.once('dialog', (d) => d.dismiss());
    await gate(page).locator('input[name=email]').fill('b@example.com');
    await gate(page).locator('input[name=password]').fill('bbbbbb');
    await gate(page).locator('form button[type=submit]').click();
    await expect(gate(page)).toBeVisible();
    await expect(gate(page).locator('.login-msg')).toContainText('取りやめました');
    expect((await state(page)).txs.map((t) => t.id)).toEqual(['mine']);
    expect(await page.evaluate(() => __fake.docs.has('t_mine'))).toBe(false); // 他人のデータをBに上げない

    // 受け入れると、Bさんのデータに切り替わる
    page.once('dialog', (d) => d.accept());
    await gate(page).locator('input[name=password]').fill('bbbbbb'); // パスワード欄は描き直しで空になる
    await gate(page).locator('form button[type=submit]').click();
    await expect(gate(page)).toBeHidden();
    await expect.poll(async () => (await state(page)).txs.map((t) => t.id)).toEqual(['remote1']);
    expect(await page.evaluate(() => __fake.docs.has('t_mine'))).toBe(false);
  });

  test('前回ログインした端末は、画面を開き直してもログイン画面を出さない', async ({ page }) => {
    await setup(page, { user: { uid: 'u1', email: 'test@example.com' } });
    await page.addInitScript(() => localStorage.setItem('osaifu:sync-on', 'true'));
    await page.goto('/');
    await expect(gate(page)).toBeHidden();
    await page.click('[data-tab=wallet]');
    await expect(page.locator('.set-row', { hasText: 'アカウント' })).toContainText('test@example.com');
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

const cardBase = {
  wallets: [
    { id: 'cash', name: '現金', initial: 10000 },
    { id: 'bank', name: '銀行口座', initial: 100000 },
    { id: 'card', name: 'カード', initial: 0, kind: 'card', closingDay: 15, payDay: 10, payMonthOffset: 1, payWalletId: 'bank', notifyDays: 3 },
  ],
  txs: [
    { id: 'c1', type: 'expense', amount: 1000, date: '2026-08-05', category: 'food', walletId: 'card', memo: '' }, // 8/15締め → 9/10
    { id: 'c2', type: 'expense', amount: 2000, date: '2026-08-20', category: 'food', walletId: 'card', memo: '' }, // 9/15締め → 10/10
    { id: 'c3', type: 'expense', amount: 3000, date: '2026-09-10', category: 'food', walletId: 'card', memo: '' }, // 9/15締め → 10/10
    { id: 'c4', type: 'expense', amount: 5000, date: '2026-09-20', category: 'food', walletId: 'card', memo: '' }, // 10/15締め → 11/10
  ],
  bills: [],
  settings: { budget: 0, notify: false, lastNotified: '' },
};

test('支払いの頻度：隔月・年1回は起点の月から数えた月にだけ現れる', async ({ page }) => {
  const r = await page.evaluate(() => {
    const months = (b) => Array.from({ length: 12 }, (_, m) => m).filter((m) => billOccurs(b, 2026, m)).map((m) => m + 1);
    return {
      monthly: months({ every: 1 }),
      quarterly: months({ every: 3, startMonth: 8 }),
      yearly: months({ every: 12, startMonth: 10 }),
      bimonthly: months({ every: 2, startMonth: 1 }),
    };
  });
  expect(r.monthly).toHaveLength(12);
  expect(r.quarterly).toEqual([2, 5, 8, 11]);
  expect(r.yearly).toEqual([10]);
  expect(r.bimonthly).toEqual([1, 3, 5, 7, 9, 11]);
});

test('年1回の予定を登録すると、その月にだけ表示される', async ({ page }) => {
  await seed(page, base);
  await page.getByText('＋ 支払いを登録').click();
  await page.fill('#billForm input[name=name]', '自動車税');
  await page.fill('#billForm input[name=amount]', '34500');
  await page.selectOption('#billForm select[name=every]', '12');
  await expect(page.locator('#billForm label', { hasText: '支払う月' })).toBeVisible();
  await page.selectOption('#billForm select[name=startMonth]', '10');
  await page.selectOption('#billForm select[name=day]', '30');
  await page.click('#billForm button[type=submit]');

  await expect(page.locator('.row-item', { hasText: '自動車税' })).toHaveCount(0); // 9月にはない
  const b = (await state(page)).bills[0];
  expect(b).toMatchObject({ every: 12, startMonth: 10, day: 30 });
  await page.click('#nextMonth');
  const row = page.locator('.row-item', { hasText: '自動車税' });
  await expect(row).toContainText('年1回');
  await expect(row).toContainText('¥34,500');
  await page.click('#nextMonth');
  await expect(page.locator('.row-item', { hasText: '自動車税' })).toHaveCount(0);
});

test('カードの引き落とし日は、締め日・引き落とし月の設定から決まる', async ({ page }) => {
  const r = await page.evaluate(() => {
    const fmt = (card, d) => { const x = cardPayDate(card, d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const a = { closingDay: 15, payDay: 10, payMonthOffset: 1 };
    const b = { closingDay: 31, payDay: 27, payMonthOffset: 1 };
    const c = { closingDay: 31, payDay: 31, payMonthOffset: 1 };
    const d = { closingDay: 15, payDay: 10, payMonthOffset: 2 };
    return [fmt(a, '2026-09-15'), fmt(a, '2026-09-16'), fmt(a, '2026-12-20'), fmt(b, '2026-09-30'), fmt(c, '2026-01-31'), fmt(d, '2026-09-10')];
  });
  expect(r).toEqual(['2026-10-10', '2026-11-10', '2027-02-10', '2026-10-27', '2026-02-28', '2026-11-10']);
});

test('カードの引き落とし予定：利用額から計算し、済にすると口座→カードの振替になる', async ({ page }) => {
  await seed(page, cardBase);
  // 9月の引き落とし＝8/5の利用分1,000円（期日を過ぎている）
  const row = page.locator('.row-item', { hasText: '引き落とし' });
  await expect(row).toContainText('¥1,000');
  await expect(row).toContainText('超過');
  await expect(page.locator('.card-head', { hasText: '支払い' })).toContainText('残り ¥1,000');
  await expect(page.locator('[data-edit-wallet=card]')).toContainText('−¥11,000');

  await row.locator('[data-pay]').click();
  await expect(row.locator('[data-pay]')).toHaveText('済');
  await expect(page.locator('[data-edit-wallet=bank]')).toContainText('¥99,000');
  await expect(page.locator('[data-edit-wallet=card]')).toContainText('−¥10,000');
  const t = (await state(page)).txs.find((x) => x.settleKey);
  expect(t).toMatchObject({ type: 'transfer', amount: 1000, date: '2026-09-10', walletId: 'bank', toWalletId: 'card', settleKey: 'card:2026-09-10' });

  // 取り消し
  await page.locator('#toast button').click();
  await expect(page.locator('[data-edit-wallet=bank]')).toContainText('¥100,000');

  // 来月（10/10）は8/20と9/10の利用分5,000円、再来月（11/10）は5,000円
  await page.click('#nextMonth');
  await expect(page.locator('.row-item', { hasText: '引き落とし' })).toContainText('¥5,000');
  await page.click('#nextMonth');
  await expect(page.locator('.row-item', { hasText: '引き落とし' })).toContainText('¥5,000');
});

test('カードで払う予定は「残り」に含めず、引き落とし側で数える', async ({ page }) => {
  await seed(page, { ...cardBase, txs: [], bills: [
    { id: 'n', name: 'Netflix', amount: 1500, day: 30, category: 'subsc', walletId: 'card', notifyDays: 1 },
    { id: 'r', name: '家賃', amount: 80000, day: 30, category: 'house', walletId: 'bank', notifyDays: 1 },
  ] });
  await expect(page.locator('.card-head', { hasText: '支払い' })).toContainText('残り ¥80,000');
});

test('引き落とし口座の残高が足りない時は警告する', async ({ page }) => {
  const data = structuredClone(cardBase);
  data.wallets[1].initial = 400; // 銀行口座の残高
  await seed(page, data);
  await expect(page.locator('.lack')).toContainText('銀行口座');
  await expect(page.locator('.lack')).toContainText('¥600 不足');
  // 足りている時は出さない
  const ok = structuredClone(cardBase);
  await seed(page, ok);
  await expect(page.locator('.lack')).toHaveCount(0);
});

test('カレンダーの予定は口座別にまとめて小計を見られる', async ({ page }) => {
  await seed(page, { ...cardBase, bills: [
    { id: 'r', name: '家賃', amount: 80000, day: 27, category: 'house', walletId: 'bank', notifyDays: 1 },
    { id: 's', name: '給与', amount: 300000, day: 25, category: 'salary', walletId: 'bank', notifyDays: 1, type: 'income' },
  ] });
  await page.click('[data-tab=cal]');
  await page.click('[data-group] button[data-v=wallet]');
  const head = page.locator('.day-head.in-card', { hasText: '銀行口座' });
  await expect(head).toContainText('+¥219,000'); // 300,000 − 80,000 − カード引き落とし1,000
});

test('クレジットカードを追加し、締め日・引き落とし日・口座を設定できる', async ({ page }) => {
  await seed(page, base);
  await page.click('[data-tab=wallet]');
  await page.click('[data-act=new-wallet]');
  await page.click('#wForm .seg.type button[data-v=card]');
  await page.fill('#wForm input[name=name]', '楽天カード');
  await page.selectOption('#wForm select[name=closingDay]', '31');
  await page.selectOption('#wForm select[name=payDay]', '27');
  await page.selectOption('#wForm select[name=payWalletId]', 'bank');
  await page.click('#wForm button[type=submit]');
  const w = (await state(page)).wallets.find((x) => x.name === '楽天カード');
  expect(w).toMatchObject({ kind: 'card', closingDay: 31, payDay: 27, payMonthOffset: 1, payWalletId: 'bank', initial: 0 });
  await expect(page.locator('[data-edit-wallet]', { hasText: '楽天カード' })).toContainText('月末締め・翌月27日引き落とし');

  // 引き落とし口座に使われている財布は削除できない
  await page.click('[data-edit-wallet=bank]');
  page.once('dialog', (d) => d.accept());
  await page.click('#wForm [data-del]');
  await expect(page.locator('#toast')).toContainText('削除できません');
});

test('.icsにカードの引き落としと年1回の予定が入る', async ({ page }) => {
  await seed(page, { ...cardBase, bills: [
    { id: 'y', name: '自動車税', amount: 34500, day: 5, category: 'other', walletId: 'bank', notifyDays: 3, every: 12, startMonth: 10 },
  ] });
  await page.click('[data-tab=wallet]');
  const ics = await readDownload(page, () => page.click('[data-act=ics]'));
  expect(ics).toContain('UID:card-card@osaifu');
  expect(ics).toContain('SUMMARY:カード 引き落とし');
  expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=10');
  expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=5');
  expect(ics).toContain('DTSTART;VALUE=DATE:20261005'); // 今月(9月)には無いので10月が最初
});

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const stmtBase = { ...cardBase, txs: [], bills: [] };

async function importFile(page, file) {
  await page.click('[data-tab=wallet]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=import-csv]')]);
  await chooser.setFiles(file);
  await expect(page.locator('.sheet-panel h3')).toHaveText('明細を取り込む');
}

test('明細CSVの読み取り：引用符・改行・区切り・日付・金額の書き方', async ({ page }) => {
  const r = await page.evaluate(() => ({
    csv: parseCsv('a,"b,c","d ""x"""\n1,2,3\r\n\r\n"x\ny",5,6\n'),
    tsv: parseCsv('日付\t内容\t金額\n2026/9/1\tテスト\t100'),
    dates: ['2026/9/5', '2026-09-05', '2026年9月5日', '20260905', '令和8年9月5日', '26/09/05', '2026.9.5 12:30', '9/5', 'abc', '2026/13/40'].map(parseAnyDate),
    amounts: ['¥1,200', '1,200円', '△500', '(500)', '500-', '-500', '−500', '１，２００', '', 'abc', '1.5'].map(parseAmountCell),
  }));
  expect(r.csv).toEqual([['a', 'b,c', 'd "x"'], ['1', '2', '3'], ['x\ny', '5', '6']]);
  expect(r.tsv).toEqual([['日付', '内容', '金額'], ['2026/9/1', 'テスト', '100']]);
  expect(r.dates).toEqual(['2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05', '2026-09-05', '', '', '']);
  expect(r.amounts).toEqual([1200, 1200, -500, -500, -500, -500, -500, 1200, null, null, 2]);
});

test('明細CSVの列の判定：主な銀行・カードの見出し', async ({ page }) => {
  const g = (h) => page.evaluate((x) => guessColumns(x), h);
  const idx = (headers, cols) => Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, headers[i] ?? null]));
  const cases = [
    [['利用日', '利用店名・商品名', '利用者', '支払方法', '利用金額', '支払手数料', '支払総額'], { date: '利用日', desc: '利用店名・商品名', amount: '利用金額', out: null, in: null }],
    [['日付', '摘要', '摘要内容', '支払い金額', '預かり金額', '差引残高', 'メモ'], { date: '日付', desc: '摘要内容', amount: null, out: '支払い金額', in: '預かり金額' }],
    [['日付', '内容', '出金金額(円)', '入金金額(円)', '残高(円)', 'メモ'], { date: '日付', desc: '内容', amount: null, out: '出金金額(円)', in: '入金金額(円)' }],
    [['取引日', '入出金(円)', '取引後残高(円)', '入出金内容'], { date: '取引日', desc: '入出金内容', amount: '入出金(円)', out: null, in: null }],
    [['取引日', '受入金額（円）', '払出金額（円）', '詳細1', '詳細2'], { date: '取引日', desc: '詳細1', amount: null, out: '払出金額（円）', in: '受入金額（円）' }],
    [['年月日', 'お引出し', 'お預入れ', 'お取り扱い内容', '残高'], { date: '年月日', desc: 'お取り扱い内容', amount: null, out: 'お引出し', in: 'お預入れ' }],
    [['計算対象', '日付', '内容', '金額（円）', '保有金融機関', '大項目'], { date: '日付', desc: '内容', amount: '金額（円）', out: null, in: null }],
    [['日付', '方法', 'カテゴリ', '品目', 'メモ', 'お店', '収入', '支出', '振替'], { date: '日付', desc: '品目', amount: null, out: '支出', in: '収入' }],
  ];
  for (const [headers, want] of cases) expect(idx(headers, await g(headers)), headers.join()).toEqual(want);
});

test('カードのCSV（UTF-8）を取り込む：カード宛て・カテゴリ推定・返金は収入・取り消し', async ({ page }) => {
  await seed(page, stmtBase);
  await importFile(page, fixture('card-utf8.csv'));
  await expect(page.locator('[data-imp-wallet]')).toHaveValue('card'); // 「利用日」の見出しからカードと判断
  await expect(page.locator('.imp-head')).toContainText('5件を取り込み');
  await page.click('[data-imp-go]');

  const s = await state(page);
  const byMemo = (m) => s.txs.find((t) => t.memo.includes(m));
  expect(s.txs).toHaveLength(5);
  expect(s.txs.every((t) => t.walletId === 'card')).toBe(true);
  expect(byMemo('セブン')).toMatchObject({ type: 'expense', amount: 520, date: '2026-09-03', category: 'food' });
  expect(byMemo('NETFLIX')).toMatchObject({ amount: 1490, category: 'subsc' });
  expect(byMemo('Suica')).toMatchObject({ amount: 3000, category: 'transport' });
  expect(s.txs.find((t) => t.type === 'expense' && t.memo === 'ユニクロ 渋谷店')).toMatchObject({ amount: 4990, category: 'clothes' });
  expect(byMemo('返品')).toMatchObject({ type: 'income', amount: 990 });
  // カードの引き落とし予定にも反映される（9/20の分は10/15締め、9/25の返金も同じ回）
  expect(await page.evaluate(() => [...cardCharges(walletOf('card')).entries()])).toEqual([['2026-10-10', 520 + 1490 + 3000], ['2026-11-10', 4990 - 990]]);

  await page.locator('#toast button').click(); // 取り消し
  expect((await state(page)).txs).toHaveLength(0);
});

test('同じ明細をもう一度取り込んでも二重にならない', async ({ page }) => {
  await seed(page, stmtBase);
  await importFile(page, fixture('card-utf8.csv'));
  await page.click('[data-imp-go]');
  await page.click('[data-tab=wallet]');
  await importFile(page, fixture('card-utf8.csv'));
  await expect(page.locator('.imp-head')).toContainText('0件を取り込み（5件は除外）');
  await expect(page.locator('.imp-row small', { hasText: '取り込み済みの可能性' })).toHaveCount(5);
  await expect(page.locator('[data-imp-go]')).toBeDisabled();
  // 取り込み済みでも、手で選べば取り込める
  await page.locator('[data-imp-all="1"]').click();
  await expect(page.locator('[data-imp-go]')).toHaveText('5件を取り込む');
});

test('銀行のCSV（Shift_JIS・前置きの行・半角カナ）：入出金の列を分けて読み、カード引き落としは既定で除外', async ({ page }) => {
  await seed(page, stmtBase);
  await importFile(page, fixture('bank-sjis.csv'));
  await expect(page.locator('[data-imp-wallet]')).toHaveValue('bank');
  await expect(page.locator('[data-imp-mode]')).toHaveCount(0); // 出金・入金が別の列なので「金額の見方」は不要
  await expect(page.locator('.imp-head')).toContainText('3件を取り込み（1件は除外）');
  await expect(page.locator('.imp-row small', { hasText: 'カード引き落とし' })).toHaveCount(1);
  await page.click('[data-imp-go]');

  const s = await state(page);
  expect(s.txs.map((t) => [t.date, t.type, t.amount, t.category, t.walletId]).sort()).toEqual([
    ['2026-09-01', 'income', 280000, 'salary', 'bank'],
    ['2026-09-10', 'expense', 8200, 'utility', 'bank'],
    ['2026-09-27', 'expense', 85000, 'house', 'bank'],
  ]);
  expect(s.txs.find((t) => t.type === 'income').memo).toBe('フリコミ キユウヨ カ)サンプル'); // 半角カナは全角にそろえる
});

test('入出金が1列の銀行CSV：マイナスが支出になり、見方は切り替えられる', async ({ page }) => {
  await seed(page, stmtBase);
  await importFile(page, fixture('bank-signed.csv'));
  await expect(page.locator('[data-imp-mode]')).toHaveValue('expenseNegative');
  await expect(page.locator('.imp-amt.expense')).toHaveCount(1);
  await page.selectOption('[data-imp-mode]', 'expensePositive'); // 逆にすると収支が入れ替わる
  await expect(page.locator('.imp-amt.income')).toHaveCount(1);
  await expect(page.locator('.imp-row', { hasText: '300,000' }).locator('.imp-amt')).toHaveClass(/expense/);
  await page.selectOption('[data-imp-mode]', 'expenseNegative');
  await page.click('[data-imp-go]');
  const s = await state(page);
  expect(s.txs.find((t) => t.memo === 'スーパー イオン')).toMatchObject({ type: 'expense', amount: 1200, date: '2026-09-03', category: 'food' });
  expect(s.txs.find((t) => t.memo === 'キユウヨ')).toMatchObject({ type: 'income', amount: 300000, category: 'salary' });
});

test('見出しのないCSVは中身から列を推定し、列の対応は手で直せる', async ({ page }) => {
  await seed(page, stmtBase);
  await page.click('[data-tab=wallet]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=import-csv]')]);
  await chooser.setFiles({ name: 'vpass.csv', mimeType: 'text/csv', buffer: Buffer.from('2026/09/03,ローソン,520,1回,1,520\n2026/09/04,スターバックス,650,1回,1,650\n') });
  await expect(page.locator('.imp-head')).toContainText('2件を取り込み');
  await expect(page.locator('details.map')).not.toHaveAttribute('open', ''); // 判定できた時は閉じたまま
  await page.click('details.map summary');
  await expect(page.locator('[data-imp-col=amount]')).toHaveValue('2');
  // 日付の列を「なし」にすると取り込めなくなり、列の対応が開いた状態で描き直される
  await page.selectOption('[data-imp-col=date]', '-1');
  await expect(page.locator('.imp-head')).toContainText('0件を取り込み');
  await expect(page.locator('details.map')).toHaveAttribute('open', '');
  await page.selectOption('[data-imp-col=date]', '0');
  await page.click('[data-imp-go]');
  expect((await state(page)).txs.map((t) => [t.memo, t.amount]).sort()).toEqual([['スターバックス', 650], ['ローソン', 520]]);
});

test('取り込む行を選べ、過去に同じ内容で付けたカテゴリを引き継ぐ', async ({ page }) => {
  await seed(page, { ...stmtBase, txs: [{ id: 'h', type: 'expense', amount: 999, date: '2026-08-01', category: 'fun', walletId: 'card', memo: 'ユニクロ 渋谷店' }] });
  await importFile(page, fixture('card-utf8.csv'));
  await page.locator('.imp-row', { hasText: 'NETFLIX' }).locator('input').uncheck();
  await expect(page.locator('.imp-head')).toContainText('4件を取り込み（1件は除外）');
  await page.click('[data-imp-go]');
  const s = await state(page);
  expect(s.txs.some((t) => t.memo.includes('NETFLIX'))).toBe(false);
  // 過去に「娯楽」で記録した店は、キーワード（衣服）ではなく過去のカテゴリを使う
  expect(s.txs.find((t) => t.id !== 'h' && t.memo === 'ユニクロ 渋谷店')).toMatchObject({ category: 'fun' });
});
