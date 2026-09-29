'use strict';

/* =========================================================
 * おさいふ — 家計簿・財布・毎月の支払い管理
 * データはすべて端末の localStorage に保存する
 * ======================================================= */

const KEY = 'osaifu:v1';

const CATS = {
  expense: [
    { id: 'food', name: '食費', icon: '食', color: '#c0793a' },
    { id: 'daily', name: '日用品', icon: '日', color: '#6f8f5e' },
    { id: 'house', name: '住居', icon: '住', color: '#5a6f93' },
    { id: 'utility', name: '光熱費', icon: '光', color: '#b0913a' },
    { id: 'phone', name: '通信', icon: '信', color: '#4f86a6' },
    { id: 'transport', name: '交通', icon: '交', color: '#4a8a86' },
    { id: 'subsc', name: 'サブスク', icon: '定', color: '#8a6aa3' },
    { id: 'insurance', name: '保険', icon: '保', color: '#6c7480' },
    { id: 'medical', name: '医療', icon: '医', color: '#b35b55' },
    { id: 'fun', name: '娯楽', icon: '遊', color: '#b0647f' },
    { id: 'clothes', name: '衣服', icon: '衣', color: '#7d6aa0' },
    { id: 'edu', name: '教育', icon: '学', color: '#4d6fa8' },
    { id: 'social', name: '交際費', icon: '際', color: '#c2703f' },
    { id: 'card', name: 'カード', icon: 'カ', color: '#7a7066' },
    { id: 'other', name: 'その他', icon: '他', color: '#8e8a80' },
  ],
  income: [
    { id: 'salary', name: '給与', icon: '給', color: '#3d7a4f' },
    { id: 'bonus', name: '賞与', icon: '賞', color: '#4f8a45' },
    { id: 'side', name: '副業', icon: '副', color: '#3f7f76' },
    { id: 'gift', name: 'お小遣い', icon: '贈', color: '#6f8a3a' },
    { id: 'other_in', name: 'その他', icon: '他', color: '#7a8a4a' },
  ],
};
const NOTIFY_OPTS = [[0, '当日'], [1, '1日前'], [3, '3日前'], [7, '7日前']];

/* ---------- utils ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (y, m) => `${y}-${pad(m + 1)}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
const yen = (n) => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + yen(Math.abs(n));
const compact = (n) => (n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万' : Math.round(n).toLocaleString('ja-JP'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const todayStr = () => ymd(new Date());
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const catOf = (type, id) => (CATS[type] || CATS.expense).find((c) => c.id === id) || { name: '未分類', icon: '他', color: '#8e8a80' };
const TRANSFER = { name: '振替', icon: '移', color: '#6c7480' };
const WALLET_COLORS = ['#5a6f93', '#3d7a4f', '#b0913a', '#b35b55', '#8a6aa3', '#4a8a86'];
/** 分類・財布の目印（色付きの1文字） */
const mark = (c) => `<div class="ic" style="--c:${c.color}">${esc(c.icon)}</div>`;
const walletMark = (w) => mark({ icon: [...(w?.name || '?')][0], color: WALLET_COLORS[Math.max(0, S.wallets.indexOf(w)) % WALLET_COLORS.length] });

/* ---------- state ---------- */
function seed() {
  return {
    wallets: [
      { id: 'cash', name: '現金', initial: 0 },
      { id: 'bank', name: '銀行口座', initial: 0 },
      { id: 'card', name: 'クレジットカード', initial: 0, kind: 'card', closingDay: 15, payDay: 10, payMonthOffset: 1, payWalletId: 'bank', notifyDays: 3 },
    ],
    txs: [],
    bills: [],
    settings: { budget: 0, notify: false, lastNotified: '' },
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.wallets)) return { ...seed(), ...s, settings: { ...seed().settings, ...s.settings } };
  } catch (e) { /* ignore */ }
  return seed();
}
let S = load();
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('保存に失敗しました'); }
}
function save() {
  saveLocal();
  Sync.push();
}

const now = new Date();
const UI = {
  tab: 'home',
  y: now.getFullYear(),
  m: now.getMonth(),
  sel: todayStr(),
  filter: 'all',
  group: 'date',
  forceLogin: false,
};

/* ---------- domain ---------- */
const walletOf = (id) => S.wallets.find((w) => w.id === id);
const inMonth = (t, y, m) => t.date.startsWith(ym(y, m));
const monthTxs = (y, m) => S.txs.filter((t) => inMonth(t, y, m));

function totals(y, m) {
  let income = 0, expense = 0;
  for (const t of monthTxs(y, m)) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

function balance(wid) {
  const w = walletOf(wid);
  let b = w ? Number(w.initial) || 0 : 0;
  for (const t of S.txs) {
    if (t.type === 'income' && t.walletId === wid) b += t.amount;
    if (t.type === 'expense' && t.walletId === wid) b -= t.amount;
    if (t.type === 'transfer') {
      if (t.walletId === wid) b -= t.amount;
      if (t.toWalletId === wid) b += t.amount;
    }
  }
  return b;
}

function dueDate(bill, y, m) {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(bill.day, last));
}
const paidTx = (bill, y, m) => S.txs.find((t) => t.billId === bill.id && t.billMonth === ym(y, m));
const billType = (b) => (b.type === 'income' ? 'income' : 'expense');

const EVERY_OPTS = [[1, '毎月'], [2, '2か月ごと'], [3, '3か月ごと'], [6, '半年ごと'], [12, '年1回']];
const freqLabel = (b) => ({ 2: '隔月', 3: '3か月毎', 6: '半年毎', 12: '年1回' })[Number(b.every)] || '';
/** その月に支払いがあるか（起点の月から every か月ごと） */
function billOccurs(b, y, m) {
  const e = Number(b.every) || 1;
  if (e === 1) return true;
  const start = Number(b.startMonth) || 1;
  return (((m + 1 - start) % e) + e) % e === 0;
}

const isCard = (w) => w?.kind === 'card';
const clampDay = (y, m, d) => Math.min(d, new Date(y, m + 1, 0).getDate());

/** カードの利用日から、その分の引き落とし日を求める（締め日を過ぎた分は翌月締め） */
function cardPayDate(card, dateStr) {
  const d = parseYmd(dateStr);
  const cy = d.getFullYear();
  let cm = d.getMonth();
  if (d.getDate() > clampDay(cy, cm, Number(card.closingDay) || 31)) cm += 1;
  const p = new Date(cy, cm + (card.payMonthOffset ?? 1), 1);
  return new Date(p.getFullYear(), p.getMonth(), clampDay(p.getFullYear(), p.getMonth(), Number(card.payDay) || 1));
}

/** 引き落とし日ごとの利用額（返金は差し引く）。キーは引き落とし日 YYYY-MM-DD */
function cardCharges(card) {
  const groups = new Map();
  for (const t of S.txs) {
    if (t.walletId !== card.id) continue;
    const amt = t.type === 'expense' ? t.amount : t.type === 'income' ? -t.amount : 0;
    if (!amt) continue;
    const key = ymd(cardPayDate(card, t.date));
    groups.set(key, (groups.get(key) || 0) + amt);
  }
  return groups;
}
const settleTx = (cardId, key) => S.txs.find((t) => t.settleKey === `${cardId}:${key}`);

/** 指定月の定期支払い一覧（期日順） */
function monthBills(y, m) {
  const today = parseYmd(todayStr());
  return S.bills
    .filter((b) => b.active !== false && billOccurs(b, y, m))
    .map((b) => {
      const due = dueDate(b, y, m);
      const tx = paidTx(b, y, m);
      const diff = daysBetween(today, due);
      let status = 'upcoming';
      if (tx) status = 'paid';
      else if (diff < 0) status = 'late';
      else if (diff <= (b.notifyDays ?? 1)) status = 'soon';
      return { bill: b, due, dueStr: ymd(due), tx, diff, status };
    })
    .sort((a, b) => a.due - b.due);
}

/** 指定月のカード引き落とし（利用額から自動計算）。定期の予定と同じ形で返す */
function monthCardItems(y, m) {
  const today = parseYmd(todayStr());
  const out = [];
  for (const card of S.wallets.filter(isCard)) {
    const groups = cardCharges(card);
    const keys = new Set([...groups.keys()]);
    for (const t of S.txs) if (t.settleKey?.startsWith(`${card.id}:`)) keys.add(t.settleKey.slice(card.id.length + 1));
    for (const key of keys) {
      if (!key.startsWith(ym(y, m))) continue;
      const tx = settleTx(card.id, key);
      const amount = tx ? tx.amount : groups.get(key) || 0;
      if (amount <= 0) continue;
      const due = parseYmd(key);
      const diff = daysBetween(today, due);
      let status = 'upcoming';
      if (tx) status = 'paid';
      else if (diff < 0) status = 'late';
      else if (diff <= (card.notifyDays ?? 3)) status = 'soon';
      out.push({
        bill: { id: `card:${card.id}:${key}`, kind: 'card', name: card.name, tag: '引き落とし', amount, type: 'expense', category: 'card', walletId: card.payWalletId, cardId: card.id },
        due, dueStr: key, tx, diff, status,
      });
    }
  }
  return out;
}

/** 支払い・収入・カード引き落としをまとめた月の予定（日付順） */
const monthItems = (y, m) => [...monthBills(y, m), ...monthCardItems(y, m)].sort((a, b) => a.due - b.due);

/** 今月の引き落とし予定に対して、口座の残高が足りるか */
function shortages(y, m) {
  const t = new Date();
  if (y !== t.getFullYear() || m !== t.getMonth()) return [];
  const need = new Map();
  for (const it of monthItems(y, m)) {
    if (it.tx || billType(it.bill) !== 'expense') continue;
    const w = walletOf(it.bill.walletId);
    if (!w || isCard(w)) continue;
    need.set(w.id, (need.get(w.id) || 0) + it.bill.amount);
  }
  return [...need].map(([id, n]) => ({ w: walletOf(id), need: n, short: n - balance(id) })).filter((x) => x.short > 0);
}

function dueLabel(it) {
  if (it.status === 'paid') return '';
  if (it.diff < 0 && billType(it.bill) === 'income') return '<span class="badge warn">未入金</span>';
  if (it.diff < 0) return `<span class="badge danger">${-it.diff}日超過</span>`;
  if (it.diff === 0) return '<span class="badge danger">今日</span>';
  if (it.diff === 1) return '<span class="badge warn">明日</span>';
  if (it.status === 'soon') return `<span class="badge warn">あと${it.diff}日</span>`;
  return `<span class="badge">${it.due.getDate()}日</span>`;
}

/** カードの引き落としを済にする／戻す（口座 → カードの振替を作る／消す） */
function toggleSettle(itemId) {
  const [, cardId, key] = itemId.split(':');
  const card = walletOf(cardId);
  if (!card) return;
  const done = settleTx(cardId, key);
  if (done) {
    S.txs = S.txs.filter((t) => t !== done);
    save(); render();
    toast(`${card.name} の引き落としを未済に戻しました`);
    return;
  }
  const amount = cardCharges(card).get(key) || 0;
  if (amount <= 0) return;
  if (!walletOf(card.payWalletId)) { toast('引き落とし口座を設定してください'); walletSheet(card); return; }
  const date = key <= todayStr() ? key : todayStr();
  const t = { id: uid(), type: 'transfer', amount, date, walletId: card.payWalletId, toWalletId: card.id, memo: `${card.name} 引き落とし`, settleKey: `${cardId}:${key}` };
  S.txs.push(t);
  save(); render();
  toast(`${card.name} ${yen(amount)} を引き落とし済にしました`, '取り消し', () => {
    S.txs = S.txs.filter((x) => x.id !== t.id); save(); render();
  });
}

function togglePaid(billId, y, m) {
  if (billId.startsWith('card:')) return toggleSettle(billId);
  const bill = S.bills.find((b) => b.id === billId);
  if (!bill) return;
  const tx = paidTx(bill, y, m);
  if (tx) {
    S.txs = S.txs.filter((t) => t !== tx);
    save(); render();
    toast(`${bill.name} を未払いに戻しました`);
    return;
  }
  const due = dueDate(bill, y, m);
  const today = new Date();
  const date = today < due && today.getFullYear() === y && today.getMonth() === m ? todayStr() : ymd(due);
  const t = {
    id: uid(), type: billType(bill), amount: bill.amount, date, category: bill.category,
    walletId: bill.walletId, memo: bill.name, billId: bill.id, billMonth: ym(y, m),
  };
  // 金額が毎月変わるものは、前回の金額を入れた記録画面で確定する
  if (bill.variable) { txSheet(null, t); return; }
  S.txs.push(t);
  save(); render();
  toast(`${bill.name} ${yen(bill.amount)} を${t.type === 'income' ? '受取済' : '支払済'}にしました`, '取り消し', () => {
    S.txs = S.txs.filter((x) => x.id !== t.id); save(); render();
  });
}

/* ---------- rendering ---------- */
const view = $('#view');

function render() {
  const showMonth = UI.tab !== 'wallet';
  $('#title').textContent = showMonth ? `${UI.y}年${UI.m + 1}月` : '財布';
  $('#prevMonth').hidden = !showMonth;
  $('#nextMonth').hidden = !showMonth;
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === UI.tab));
  view.innerHTML = { home: homeView, cal: calView, list: listView, wallet: walletView }[UI.tab]();
  renderLogin();
}

/* ---------- login ---------- */
const LOGIN_SKIP_KEY = 'osaifu:login-skipped';
const LOGIN = { mode: 'login', busy: false, error: '', info: '' };
const loginSkipped = () => { try { return localStorage.getItem(LOGIN_SKIP_KEY) === '1'; } catch (e) { return false; } };
const setLoginSkipped = (on) => { try { if (on) localStorage.setItem(LOGIN_SKIP_KEY, '1'); else localStorage.removeItem(LOGIN_SKIP_KEY); } catch (e) { /* ignore */ } };
const loginRequired = () => window.OSAIFU_REQUIRE_LOGIN === true;

/** ログイン画面を出すか：Firebase設定済みで未ログイン、かつ（必須設定・設定画面から開いた・まだ「使わない」を選んでいない） */
function needLogin() {
  if (!Sync.enabled || Sync.authState !== 'out') return false;
  return UI.forceLogin || loginRequired() || !loginSkipped();
}

function renderLogin() {
  const el = $('#login');
  const show = needLogin();
  const was = !el.hidden;
  el.hidden = !show;
  if (show && !was) { LOGIN.error = ''; LOGIN.info = ''; paintLogin(); }
  if (!show && was) el.innerHTML = '';
  const n = Sync.takeNotice();
  if (n && show) { LOGIN.error = n; LOGIN.busy = false; paintLogin(); }
}

/** 入力中の欄を消さないよう、メールアドレスだけ引き継いで描き直す */
function paintLogin() {
  const el = $('#login');
  const email = $('input[name=email]', el)?.value || '';
  const signup = LOGIN.mode === 'signup';
  const canSkip = !loginRequired() || UI.forceLogin;
  el.innerHTML = `
  <div class="login-box">
    <div class="login-brand"><img src="icons/icon.svg" alt="" width="56" height="56"><h2>おさいふ</h2></div>
    <button class="btn ghost block" type="button" data-login="google" ${LOGIN.busy ? 'disabled' : ''}>Googleでログイン</button>
    <div class="or"><span>または</span></div>
    <div class="seg">${[['login', 'ログイン'], ['signup', '新規登録']].map(([v, l]) => `<button type="button" data-login="mode-${v}" class="${LOGIN.mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <form id="loginForm" class="form" novalidate>
      <div class="field"><label for="loginEmail">メールアドレス</label><input class="input" id="loginEmail" type="email" name="email" autocomplete="email" inputmode="email" value="${esc(email)}"></div>
      <div class="field"><label for="loginPass">パスワード${signup ? '（6文字以上）' : ''}</label><input class="input" id="loginPass" type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}"></div>
      <div class="login-msg ${LOGIN.error ? 'err' : ''}" role="alert">${esc(LOGIN.error || LOGIN.info)}</div>
      <button class="btn block" type="submit" ${LOGIN.busy ? 'disabled' : ''}>${signup ? '新規登録' : 'ログイン'}</button>
    </form>
    ${signup ? '' : '<button class="link" type="button" data-login="reset">パスワードを忘れた</button>'}
    ${canSkip ? `<button class="link muted-link" type="button" data-login="skip">${UI.forceLogin ? '戻る' : 'ログインせずに使う'}</button>` : ''}
  </div>`;
}

async function runLogin(fn) {
  LOGIN.busy = true; LOGIN.error = ''; LOGIN.info = '';
  paintLogin();
  const r = await fn();
  LOGIN.busy = false;
  if (r.ok) {
    setLoginSkipped(false);
    UI.forceLogin = false;
    render();
    // 別アカウントのデータの確認で断った時などは画面が残るので、ボタンを押せる状態に戻す
    if (!$('#login').hidden) paintLogin();
    return r;
  }
  LOGIN.error = r.error;
  paintLogin();
  return r;
}

$('#login').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-login]')?.dataset.login;
  if (!act) return;
  if (act === 'google') return runLogin(() => Sync.signInGoogle());
  if (act === 'mode-login' || act === 'mode-signup') { LOGIN.mode = act.slice(5); LOGIN.error = ''; LOGIN.info = ''; return paintLogin(); }
  if (act === 'skip') { setLoginSkipped(true); UI.forceLogin = false; return render(); }
  if (act === 'reset') {
    const email = $('#loginForm input[name=email]').value.trim();
    if (!email) { LOGIN.error = 'メールアドレスを入力してください'; return paintLogin(); }
    const r = await runLogin(() => Sync.resetPassword(email));
    if (r.ok) { LOGIN.info = '再設定用のメールを送信しました'; paintLogin(); }
  }
});
$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = $('input[name=email]', e.target).value.trim();
  const password = $('input[name=password]', e.target).value;
  if (!email || !password) { LOGIN.error = 'メールアドレスとパスワードを入力してください'; LOGIN.info = ''; return paintLogin(); }
  return runLogin(() => (LOGIN.mode === 'signup' ? Sync.signUpEmail(email, password) : Sync.signInEmail(email, password)));
});

/** ログアウト：この端末のデータも片付ける（アカウントの記録はクラウドに残り、次回ログインで戻る） */
async function logout() {
  const synced = Sync.status === 'synced';
  const msg = synced
    ? 'ログアウトします。この端末のデータは削除されます（クラウドの記録は、次回ログインで復元されます）。'
    : '同期が終わっていない変更があります。ログアウトするとこの端末のデータが削除され、未同期の変更は失われます。ログアウトしますか？';
  if (!confirm(msg)) return;
  await Sync.signOut();
  S = seed();
  saveLocal();
  UI.tab = 'home';
  render();
}

// 別のアカウントのデータが端末に残っていた時（ログイン期限切れ後など）は、混ざらないよう確認する
Sync.setHandlers({
  onSwitch: () => {
    const hasData = S.txs.length || S.bills.length;
    if (hasData && !confirm('この端末には別のアカウントのデータが残っています。削除して、ログインしたアカウントのデータに切り替えますか？（キャンセルするとログアウトします）')) return false;
    S = seed();
    saveLocal();
    return true;
  },
});

function billRow(it) {
  const type = billType(it.bill);
  // 支払済は実際の金額、未払いで金額が変わるものは目安として表示
  const amount = it.tx ? it.tx.amount : it.bill.amount;
  return `
  <div class="row-item">
    ${mark(catOf(type, it.bill.category))}
    <div class="row-main" data-edit-bill="${it.bill.id}"><div class="t"><span>${esc(it.bill.name)}</span>${dueLabel(it)}</div>${it.bill.tag || freqLabel(it.bill) ? `<div class="s">${it.bill.tag || freqLabel(it.bill)}</div>` : ''}</div>
    <div class="amt num ${type === 'income' ? 'income' : ''}">${!it.tx && it.bill.variable ? '<small class="muted">約</small>' : ''}${yen(amount)}</div>
    <button class="pay-btn ${it.tx ? 'done' : ''}" data-pay="${it.bill.id}">${it.tx ? '済' : it.bill.kind === 'card' ? '引落' : type === 'income' ? '受取' : '支払う'}</button>
  </div>`;
}

function txRow(t) {
  const isTr = t.type === 'transfer';
  const c = isTr ? TRANSFER : catOf(t.type, t.category);
  const title = isTr ? `${walletOf(t.walletId)?.name || ''} → ${walletOf(t.toWalletId)?.name || ''}` : t.memo || c.name;
  const cls = t.type === 'income' ? 'income' : isTr ? 'muted' : '';
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  return `
  <button class="row-item" data-edit-tx="${t.id}">
    ${mark(c)}
    <div class="row-main"><div class="t"><span>${esc(title)}</span></div></div>
    <div class="amt num ${cls}">${sign}${yen(t.amount)}</div>
  </button>`;
}

function homeView() {
  const { y, m } = UI;
  const tot = totals(y, m);
  const budget = Number(S.settings.budget) || 0;
  const bills = monthItems(y, m);
  const unpaid = bills.filter((b) => !b.tx);
  // 残り＝口座・現金から出ていく未払い分（カード払いの予定は、引き落としの時に数える）
  const unpaidSum = unpaid
    .filter((b) => billType(b.bill) === 'expense' && !isCard(walletOf(b.bill.walletId)))
    .reduce((s, b) => s + b.bill.amount, 0);
  const lack = shortages(y, m);
  const shown = (unpaid.length ? unpaid : bills).slice(0, 3);
  const totalBal = S.wallets.reduce((s, w) => s + balance(w.id), 0);

  // カテゴリ別（上位4件＋その他）
  const byCat = {};
  for (const t of monthTxs(y, m)) if (t.type === 'expense') byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const top = cats.slice(0, 4);
  const rest = cats.slice(4).reduce((s, [, v]) => s + v, 0);
  if (rest) top.push(['__rest', rest]);

  const left = budget - tot.expense;
  const budgetHtml = budget ? `<div class="budget ${left < 0 ? 'over' : ''}">
      <div class="bar"><span style="width:${Math.min(100, (tot.expense / budget) * 100)}%"></span></div>
      <div class="budget-meta"><span></span><span>${left >= 0 ? `予算残り <b class="num">${yen(left)}</b>` : `<b class="expense num">予算を${yen(-left)}超過</b>`}</span></div>
    </div>` : '';

  return `
  <section class="card summary">
    <div class="big num ${tot.net < 0 ? 'expense' : ''}">${signed(tot.net)}</div>
    <div class="row">
      <div class="pill"><span class="label">収入</span><b class="num income">${yen(tot.income)}</b></div>
      <div class="pill"><span class="label">支出</span><b class="num expense">${yen(tot.expense)}</b></div>
    </div>
    ${budgetHtml}
  </section>

  <section class="card">
    <div class="card-head">
      <h2>支払い</h2>
      ${unpaidSum ? `<span class="head-val num">残り ${yen(unpaidSum)}</span>` : bills.length && !unpaid.length ? '<span class="head-val">完了</span>' : ''}
    </div>
    ${bills.length ? `<div class="rows">${shown.map(billRow).join('')}</div>
      ${bills.length > shown.length ? `<button class="link more" data-goto="cal">ほか${bills.length - shown.length}件</button>` : ''}`
      : '<div class="empty"><button class="btn sm" data-act="new-bill">＋ 支払いを登録</button></div>'}
  </section>

  <section class="card">
    <div class="card-head"><h2>財布</h2><span class="head-val num">${yen(totalBal)}</span></div>
    <div class="wallet-strip">
      ${S.wallets.map((w) => { const b = balance(w.id); return `<button class="wchip" data-edit-wallet="${w.id}"><span class="n">${esc(w.name)}</span><b class="num ${b < 0 ? 'expense' : ''}">${yen(b)}</b></button>`; }).join('')}
    </div>
    ${lack.map((x) => `<div class="lack">${esc(x.w.name)}：今月の引き落とし ${yen(x.need)} に対して ${yen(x.short)} 不足</div>`).join('')}
  </section>

  <section class="card">
    <div class="card-head"><h2>内訳</h2></div>
    ${top.length ? `
      <div class="bar cat-bar">${top.map(([id, v]) => `<span style="width:${(v / tot.expense) * 100}%;background:${id === '__rest' ? '#c9c4b8' : catOf('expense', id).color}"></span>`).join('')}</div>
      <div class="legend">${top.map(([id, v]) => { const c = id === '__rest' ? { name: 'その他', color: '#c9c4b8' } : catOf('expense', id); return `<div><i style="background:${c.color}"></i><span>${c.name}</span><b class="num">${yen(v)}</b></div>`; }).join('')}</div>`
      : '<div class="empty">まだ支出の記録がありません</div>'}
  </section>`;
}

function calView() {
  const { y, m } = UI;
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0).getDate();
  const today = todayStr();
  if (!UI.sel.startsWith(ym(y, m))) UI.sel = today.startsWith(ym(y, m)) ? today : ymd(first);

  const bills = monthItems(y, m);
  const perDay = {};
  for (const t of monthTxs(y, m)) {
    const d = perDay[t.date] || (perDay[t.date] = { ex: 0, in: 0 });
    if (t.type === 'expense') d.ex += t.amount;
    if (t.type === 'income') d.in += t.amount;
  }
  const billsByDay = {};
  for (const b of bills) (billsByDay[b.dueStr] ||= []).push(b);

  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="cal-day out"></div>';
  for (let d = 1; d <= last; d++) {
    const ds = `${ym(y, m)}-${pad(d)}`;
    const wd = new Date(y, m, d).getDay();
    const pd = perDay[ds];
    const bd = billsByDay[ds] || [];
    cells += `<button class="cal-day ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''} ${ds === today ? 'today' : ''} ${ds === UI.sel ? 'sel' : ''}" data-day="${ds}">
      <span class="d">${d}</span>
      ${bd.length ? `<span class="dots">${bd.map((b) => `<i class="${b.status === 'paid' ? 'paid' : billType(b.bill) === 'income' ? 'in' : b.status === 'late' ? 'late' : ''}"></i>`).join('')}</span>` : ''}
      ${pd?.in ? `<span class="in num">+${compact(pd.in)}</span>` : ''}
      ${pd?.ex ? `<span class="ex num">-${compact(pd.ex)}</span>` : ''}
    </button>`;
  }

  const sel = parseYmd(UI.sel);
  const selBills = billsByDay[UI.sel] || [];
  const selTxs = S.txs.filter((t) => t.date === UI.sel && !selBills.some((b) => b.tx === t));

  return `
  <section class="card cal">
    <div class="cal-grid">
      ${WD.map((w, i) => `<div class="cal-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}
      ${cells}
    </div>
    <div class="cal-legend"><span><i></i>支払い</span><span><i class="in"></i>収入</span><span><i class="late"></i>超過</span><span><i class="paid"></i>済</span></div>
  </section>

  <section class="card">
    <div class="card-head">
      <h2>${sel.getMonth() + 1}/${sel.getDate()}(${WD[sel.getDay()]})</h2>
      <button class="link" data-act="add-on-day">＋ 記録</button>
    </div>
    ${selBills.length || selTxs.length ? `<div class="rows">${selBills.map(billRow).join('')}${selTxs.map(txRow).join('')}</div>` : '<div class="empty">なし</div>'}
  </section>

  <section class="card">
    <div class="card-head"><h2>予定</h2><button class="link" data-act="new-bill">＋ 追加</button></div>
    ${bills.length ? `<div class="seg mini" data-group>${[['date', '日付順'], ['wallet', '口座別']].map(([v, l]) => `<button data-v="${v}" class="${UI.group === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${UI.group === 'wallet' ? scheduleByWallet(bills) : `<div class="rows">${bills.map(billRow).join('')}</div>`}` : '<div class="empty">なし</div>'}
  </section>`;
}

/** 支払い元・入金先の口座ごとにまとめる（出ていく額－入る額を小計に表示） */
function scheduleByWallet(items) {
  const groups = new Map();
  for (const it of items) (groups.get(it.bill.walletId) || groups.set(it.bill.walletId, []).get(it.bill.walletId)).push(it);
  return [...groups].map(([wid, list]) => {
    const net = list.reduce((s, it) => s + (billType(it.bill) === 'income' ? 1 : -1) * (it.tx ? it.tx.amount : it.bill.amount), 0);
    return `<div class="day-head in-card"><span>${esc(walletOf(wid)?.name || '未設定')}</span><span class="num">${signed(net)}</span></div>
      <div class="rows">${list.map(billRow).join('')}</div>`;
  }).join('');
}

/** 表示中の月までの6か月の支出（棒をタップでその月へ） */
function trendCard() {
  const months = Array.from({ length: 6 }, (_, i) => new Date(UI.y, UI.m - 5 + i, 1));
  const vals = months.map((d) => totals(d.getFullYear(), d.getMonth()).expense);
  const max = Math.max(...vals);
  if (!max) return '';
  return `<section class="card trend" aria-label="支出の推移">
    <div class="card-head"><h2>支出の推移</h2></div>
    <div class="trend-bars">${months.map((d, i) => {
      const cur = i === 5;
      const label = `${d.getMonth() + 1}月`;
      return `<button class="trend-col ${cur ? 'cur' : ''}" data-month="${d.getFullYear()}-${d.getMonth()}" aria-label="${label} ${yen(vals[i])}" data-tip="${yen(vals[i])}">
        ${cur ? `<span class="trend-val num">${yen(vals[i])}</span>` : ''}
        <span class="trend-bar" style="height:${vals[i] ? Math.max(3, (vals[i] / max) * 100) : 0}%"></span>
        <span class="trend-m">${label}</span>
      </button>`;
    }).join('')}</div>
  </section>`;
}

function listView() {
  const { y, m } = UI;
  const f = UI.filter;
  const txs = monthTxs(y, m)
    .filter((t) => f === 'all' || t.type === f)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  const groups = {};
  for (const t of txs) (groups[t.date] ||= []).push(t);

  return `
  ${trendCard()}
  <div class="seg" data-filter>
    ${[['all', 'すべて'], ['expense', '支出'], ['income', '収入'], ['transfer', '振替']].map(([v, l]) => `<button data-v="${v}" class="${f === v ? 'on' : ''}">${l}</button>`).join('')}
  </div>
  ${txs.length ? Object.entries(groups).map(([d, list]) => {
    const dt = parseYmd(d);
    const net = list.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
    return `<div class="day-head"><span>${dt.getMonth() + 1}/${dt.getDate()}(${WD[dt.getDay()]})</span><span class="num">${net ? signed(net) : ''}</span></div>
      <section class="card" style="padding:2px 16px"><div class="rows">${list.map(txRow).join('')}</div></section>`;
  }).join('') : '<section class="card"><div class="empty">記録なし</div></section>'}`;
}

const SYNC_LABEL = { syncing: '同期中', synced: '同期済み', offline: 'オフライン', error: '同期エラー' };
function syncRow() {
  if (!Sync.enabled) return '';
  const on = Sync.authState === 'in' || Sync.authState === 'unknown';
  return `<div class="set-row">
      <div class="row-main"><div class="t">${on ? 'アカウント' : 'ログイン'}</div>${on ? `<div class="s">${esc(Sync.email)} ${SYNC_LABEL[Sync.status] || ''}</div>` : ''}</div>
      ${on ? '<button class="btn ghost sm" data-act="sync-out">ログアウト</button>' : '<button class="btn sm" data-act="sync-in">ログイン</button>'}
    </div>`;
}

function walletView() {
  const total = S.wallets.reduce((s, w) => s + balance(w.id), 0);
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const note = perm === 'denied' ? 'ブラウザでブロック中' : perm === 'unsupported' ? 'この端末は非対応' : '';
  return `
  <section class="card summary">
    <div class="big num ${total < 0 ? 'expense' : ''}">${yen(total)}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>財布</h2><button class="link" data-act="new-wallet">＋ 追加</button></div>
    <div class="rows">
      ${S.wallets.map((w) => { const b = balance(w.id); return `<button class="row-item" data-edit-wallet="${w.id}">${walletMark(w)}<div class="row-main"><div class="t"><span>${esc(w.name)}</span></div>${isCard(w) ? `<div class="s">${w.closingDay === 31 ? '月末' : w.closingDay + '日'}締め・${['当月', '翌月', '翌々月'][w.payMonthOffset ?? 1]}${w.payDay === 31 ? '末' : w.payDay + '日'}引き落とし</div>` : ''}</div><div class="amt num ${b < 0 ? 'expense' : ''}">${yen(b)}</div></button>`; }).join('')}
    </div>
    <button class="btn ghost block sm" data-act="transfer" style="margin-top:8px">振替</button>
  </section>

  <section class="card">
    <div class="card-head"><h2>設定</h2></div>
    ${syncRow()}
    <div class="set-row">
      <div class="row-main"><div class="t">通知</div>${note ? `<div class="s">${note}</div>` : ''}</div>
      <label class="switch"><input type="checkbox" id="notifyToggle" ${S.settings.notify && perm === 'granted' ? 'checked' : ''} ${note ? 'disabled' : ''}><span></span></label>
    </div>
    <div class="set-row">
      <div class="row-main"><div class="t">カレンダーに登録</div></div>
      <button class="btn sm" data-act="ics">書き出し</button>
    </div>
    <div class="set-row">
      <div class="row-main"><div class="t">月の予算</div></div>
      <button class="btn ghost sm num" data-act="budget">${S.settings.budget ? yen(S.settings.budget) : '設定'}</button>
    </div>
    <div class="set-row">
      <div class="row-main"><div class="t">明細の取り込み</div><div class="s">銀行・カードのCSV</div></div>
      <button class="btn ghost sm" data-act="import-csv">選ぶ</button>
    </div>
    <div class="set-row">
      <div class="row-main"><div class="t">CSV書き出し</div></div>
      <button class="btn ghost sm" data-act="csv">CSV</button>
    </div>
    <div class="set-row">
      <div class="row-main"><div class="t">バックアップ</div></div>
      <button class="btn ghost sm" data-act="export">保存</button>
      <button class="btn ghost sm" data-act="import">復元</button>
    </div>
    <div class="set-row">
      <div class="row-main"><div class="t">全データ削除</div></div>
      <button class="btn danger sm" data-act="reset">削除</button>
    </div>
  </section>`;
}

/* ---------- sheets ---------- */
const sheet = $('#sheet');
const sheetBody = $('#sheetBody');
let lastFocus = null;
function openSheet(html, mount) {
  lastFocus = document.activeElement;
  sheetBody.innerHTML = html;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  mount && mount(sheetBody);
}
function closeSheet() {
  sheet.hidden = true;
  sheetBody.innerHTML = '';
  document.body.style.overflow = '';
  lastFocus && lastFocus.focus?.();
}
sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

const walletOptions = (sel) => S.wallets.map((w) => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
const catGrid = (type, sel) => `<div class="cat-grid">${CATS[type].map((c) => `
  <label><input type="radio" name="category" value="${c.id}" ${c.id === sel ? 'checked' : ''}><span class="c"><b style="--c:${c.color}">${c.icon}</b>${c.name}</span></label>`).join('')}</div>`;
const parseAmount = (v) => Math.round(Number(String(v).replace(/[^\d.]/g, '')) || 0);

function txSheet(tx, preset = {}) {
  const t = tx || { type: 'expense', amount: '', date: preset.date || todayStr(), category: 'food', walletId: S.wallets[0]?.id, toWalletId: S.wallets[1]?.id, memo: '', ...preset };
  let type = t.type;
  const body = () => `
    <form class="form" id="txForm">
      <h3>${tx ? '記録を編集' : '記録する'}</h3>
      <div class="seg type">${[['expense', '支出'], ['income', '収入'], ['transfer', '振替']].map(([v, l]) => `<button type="button" data-v="${v}" class="${type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="amount-wrap"><span>¥</span><input class="amount-input num" name="amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${t.amount ? Number(t.amount).toLocaleString('ja-JP') : ''}" required></div>
      ${type === 'expense' && !tx ? '<button type="button" class="btn ghost sm block" data-ocr>レシートを読み取る</button><input type="file" accept="image/*" data-ocr-file hidden>' : ''}
      ${type === 'transfer' ? `
        <div class="grid2">
          <div class="field"><label>出金元</label><select class="input" name="walletId">${walletOptions(t.walletId)}</select></div>
          <div class="field"><label>入金先</label><select class="input" name="toWalletId">${walletOptions(t.toWalletId || S.wallets.find((w) => w.id !== t.walletId)?.id)}</select></div>
        </div>` : `
        <div class="field"><span class="lbl">カテゴリ</span>${catGrid(type, CATS[type].some((c) => c.id === t.category) ? t.category : CATS[type][0].id)}</div>
        <div class="field"><label>${type === 'income' ? '入金先' : '支払い元'}</label><select class="input" name="walletId">${walletOptions(t.walletId)}</select></div>`}
      <div class="grid2">
        <div class="field"><label>日付</label><input class="input" type="date" name="date" value="${t.date}" required></div>
        <div class="field"><label>メモ</label><input class="input" name="memo" value="${esc(t.memo)}" placeholder="任意"></div>
      </div>
      <button class="btn block" type="submit">${tx ? '更新する' : '記録する'}</button>
      ${tx ? '<button class="btn danger block" type="button" data-del>この記録を削除</button>' : ''}
    </form>`;

  const mount = (root) => {
    const f = $('#txForm', root);
    const amt = f.amount;
    amt.addEventListener('input', () => {
      const n = parseAmount(amt.value);
      amt.value = n ? n.toLocaleString('ja-JP') : '';
    });
    $$('.seg.type button', root).forEach((b) => b.addEventListener('click', () => {
      // 入力中の値を保持して種類を切り替え
      Object.assign(t, readForm(f));
      type = b.dataset.v;
      if (type !== 'transfer' && !CATS[type].some((c) => c.id === t.category)) t.category = CATS[type][0].id;
      root.innerHTML = body(); mount(root);
    }));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = readForm(f);
      if (!v.amount) { amt.focus(); toast('金額を入力してください'); return; }
      if (type === 'transfer' && v.walletId === v.toWalletId) { toast('出金元と入金先が同じです'); return; }
      const link = preset.billId ? { billId: preset.billId, billMonth: preset.billMonth } : {};
      const rec = { ...(tx || { id: uid(), ...link }), type, ...v };
      if (type !== 'transfer') delete rec.toWalletId; else delete rec.category;
      if (tx) Object.assign(tx, rec); else S.txs.push(rec);
      const bill = rec.billId && S.bills.find((b) => b.id === rec.billId);
      if (bill?.variable && !tx) bill.amount = rec.amount;
      save(); closeSheet(); render();
      toast(tx ? '更新しました' : `${type === 'income' ? '収入' : type === 'expense' ? '支出' : '振替'} ${yen(rec.amount)} を記録しました`);
    });
    $('[data-del]', root)?.addEventListener('click', () => {
      if (!confirm('この記録を削除しますか？')) return;
      S.txs = S.txs.filter((x) => x.id !== tx.id);
      save(); closeSheet(); render(); toast('削除しました');
    });
    const ocrBtn = $('[data-ocr]', root);
    const ocrFile = $('[data-ocr-file]', root);
    ocrBtn?.addEventListener('click', () => ocrFile.click());
    ocrFile?.addEventListener('change', async () => {
      const file = ocrFile.files[0];
      if (!file) return;
      ocrBtn.disabled = true;
      ocrBtn.textContent = '読み取り中…';
      try {
        const r = await readReceipt(file, (p) => { ocrBtn.textContent = `読み取り中… ${Math.round(p * 100)}%`; });
        if (!f.isConnected) return;
        if (r.amount) amt.value = r.amount.toLocaleString('ja-JP');
        if (r.date) f.date.value = r.date;
        if (r.store && !f.memo.value) f.memo.value = r.store;
        if (r.category) { const c = $(`input[name=category][value="${r.category}"]`, f); if (c) c.checked = true; }
        toast(r.amount ? '読み取りました。内容を確認してください' : '合計金額を読み取れませんでした');
      } catch (e) {
        toast('読み取りに失敗しました（通信環境を確認してください）');
      } finally {
        ocrBtn.disabled = false;
        ocrBtn.textContent = 'レシートを読み取る';
        ocrFile.value = '';
      }
    });
    if (!tx) setTimeout(() => amt.focus(), 250);
  };
  openSheet(body(), mount);
}
function readForm(f) {
  const fd = new FormData(f);
  const o = { amount: parseAmount(fd.get('amount')), date: fd.get('date'), memo: String(fd.get('memo') || '').trim(), walletId: fd.get('walletId') };
  if (fd.get('category')) o.category = fd.get('category');
  if (fd.get('toWalletId')) o.toWalletId = fd.get('toWalletId');
  return o;
}

function billSheet(bill) {
  const b = { name: '', amount: '', day: 27, category: 'house', walletId: S.wallets.find((w) => w.id === 'bank')?.id || S.wallets[0]?.id, notifyDays: 1, type: 'expense', variable: false, every: 1, startMonth: new Date().getMonth() + 1, ...bill };
  let type = billType(b);
  const body = () => `
    <form class="form" id="billForm">
      <h3>${bill ? '予定を編集' : '予定を登録'}</h3>
      <div class="seg type">${[['expense', '支払い'], ['income', '収入']].map(([v, l]) => `<button type="button" data-v="${v}" class="${type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="field"><label>名前</label><input class="input" name="name" value="${esc(b.name)}" placeholder="${type === 'income' ? '例：給与' : '例：家賃、電気代、Netflix'}" required></div>
      <div class="amount-wrap"><span>¥</span><input class="amount-input num" name="amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${b.amount ? Number(b.amount).toLocaleString('ja-JP') : ''}" required></div>
      <label class="check"><input type="checkbox" name="variable" ${b.variable ? 'checked' : ''}> 毎月金額が変わる（記録時に入力）</label>
      <div class="grid2">
        <div class="field"><label>頻度</label><select class="input" name="every">${EVERY_OPTS.map(([v, l]) => `<option value="${v}" ${v === Number(b.every) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${Number(b.every) > 1 ? `<div class="field"><label>${Number(b.every) === 12 ? '支払う月' : '起点の月'}</label><select class="input" name="startMonth">${Array.from({ length: 12 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === Number(b.startMonth) ? 'selected' : ''}>${n}月</option>`).join('')}</select></div>` : '<div></div>'}
      </div>
      <div class="grid2">
        <div class="field"><label>${Number(b.every) === 1 ? '毎月の' : ''}${type === 'income' ? '入金日' : '支払日'}</label><select class="input" name="day">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === b.day ? 'selected' : ''}>${d === 31 ? '月末' : d + '日'}</option>`).join('')}</select></div>
        <div class="field"><label>お知らせ</label><select class="input" name="notifyDays">${NOTIFY_OPTS.map(([v, l]) => `<option value="${v}" ${v === b.notifyDays ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><span class="lbl">カテゴリ</span>${catGrid(type, CATS[type].some((c) => c.id === b.category) ? b.category : CATS[type][0].id)}</div>
      <div class="field"><label>${type === 'income' ? '入金先' : '支払い元'}</label><select class="input" name="walletId">${walletOptions(b.walletId)}</select></div>
      <button class="btn block" type="submit">${bill ? '更新する' : '登録する'}</button>
      ${bill ? '<button class="btn danger block" type="button" data-del>この予定を削除</button>' : ''}
    </form>`;
  const readBill = (f) => {
    const fd = new FormData(f);
    return {
      name: String(fd.get('name')).trim(), amount: parseAmount(fd.get('amount')), day: Number(fd.get('day')),
      notifyDays: Number(fd.get('notifyDays')), category: fd.get('category') || 'other', walletId: fd.get('walletId'),
      type, variable: fd.get('variable') === 'on',
      every: Number(fd.get('every')) || 1, startMonth: Number(fd.get('startMonth')) || b.startMonth,
    };
  };
  const mount = (root) => {
    const f = $('#billForm', root);
    f.amount.addEventListener('input', () => { const n = parseAmount(f.amount.value); f.amount.value = n ? n.toLocaleString('ja-JP') : ''; });
    $$('.seg.type button', root).forEach((btn) => btn.addEventListener('click', () => {
      Object.assign(b, readBill(f), { amount: parseAmount(f.amount.value) || '' });
      type = btn.dataset.v;
      if (!CATS[type].some((c) => c.id === b.category)) b.category = CATS[type][0].id;
      root.innerHTML = body(); mount(root);
    }));
    // 頻度を変えると「支払う月」の欄が出入りするので、入力中の値を保って描き直す
    f.every.addEventListener('change', () => {
      Object.assign(b, readBill(f), { amount: parseAmount(f.amount.value) || '' });
      root.innerHTML = body(); mount(root);
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = readBill(f);
      if (!v.name || !v.amount) { toast('名前と金額を入力してください'); return; }
      if (bill) Object.assign(bill, v); else S.bills.push({ id: uid(), active: true, ...v });
      save(); closeSheet(); render();
      toast(bill ? '更新しました' : `${v.name} を登録しました`);
      if (!bill && !S.settings.notify && 'Notification' in window && Notification.permission === 'default') {
        setTimeout(() => toast('期日前に通知を受け取りますか？', 'オンにする', enableNotify), 1800);
      }
    });
    $('[data-del]', root)?.addEventListener('click', () => {
      if (!confirm(`「${bill.name}」を削除しますか？\n（過去の記録は残ります）`)) return;
      S.bills = S.bills.filter((x) => x.id !== bill.id);
      S.txs.forEach((t) => { if (t.billId === bill.id) delete t.billId; });
      save(); closeSheet(); render(); toast('削除しました');
    });
    if (!bill) setTimeout(() => f.name.focus(), 250);
  };
  openSheet(body(), mount);
}

function walletSheet(w) {
  const x = { name: '', kind: 'asset', closingDay: 15, payDay: 10, payMonthOffset: 1, notifyDays: 3, payWalletId: '', ...w };
  let kind = isCard(x) ? 'card' : 'asset';
  const assets = () => S.wallets.filter((v) => !isCard(v) && v.id !== w?.id);
  if (!x.payWalletId || !assets().some((v) => v.id === x.payWalletId)) x.payWalletId = assets()[0]?.id || '';
  const days = (sel) => Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === Number(sel) ? 'selected' : ''}>${d === 31 ? '月末' : d + '日'}</option>`).join('');
  const body = () => `
    <form class="form" id="wForm">
      <h3>${w ? '財布を編集' : '財布・カードを追加'}</h3>
      <div class="seg type">${[['asset', '財布・口座'], ['card', 'クレジットカード']].map(([v, l]) => `<button type="button" data-v="${v}" class="${kind === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="field"><label>名前</label><input class="input" name="name" value="${esc(x.name)}" placeholder="${kind === 'card' ? '例：楽天カード' : '例：PayPay、楽天銀行'}" required></div>
      ${kind === 'card' ? `
        <div class="grid2">
          <div class="field"><label>締め日</label><select class="input" name="closingDay">${days(x.closingDay)}</select></div>
          <div class="field"><label>引き落とし日</label><select class="input" name="payDay">${days(x.payDay)}</select></div>
        </div>
        <div class="grid2">
          <div class="field"><label>引き落とし月</label><select class="input" name="payMonthOffset">${[[1, '締め月の翌月'], [2, '締め月の翌々月'], [0, '締め月の当月']].map(([v, l]) => `<option value="${v}" ${v === Number(x.payMonthOffset) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>お知らせ</label><select class="input" name="notifyDays">${NOTIFY_OPTS.map(([v, l]) => `<option value="${v}" ${v === Number(x.notifyDays) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>引き落とし口座</label><select class="input" name="payWalletId">${assets().map((v) => `<option value="${v.id}" ${v.id === x.payWalletId ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>`
      : `<div class="field"><label>現在の残高</label><input class="input num" name="balance" inputmode="numeric" value="${w ? balance(w.id) : ''}" placeholder="0"></div>`}
      <button class="btn block" type="submit">${w ? '更新する' : '追加する'}</button>
      ${w ? '<button class="btn danger block" type="button" data-del>この財布を削除</button>' : ''}
    </form>`;
  const mount = (root) => {
    const f = $('#wForm', root);
    $$('.seg.type button', root).forEach((btn) => btn.addEventListener('click', () => {
      x.name = f.name.value;
      kind = btn.dataset.v;
      root.innerHTML = body(); mount(root);
    }));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const name = String(fd.get('name')).trim();
      if (!name) return;
      const CARD_KEYS = ['closingDay', 'payDay', 'payMonthOffset', 'notifyDays', 'payWalletId'];
      if (kind === 'card') {
        if (!fd.get('payWalletId')) { toast('引き落とし口座になる財布・口座を先に登録してください'); return; }
        const v = {
          name, kind: 'card', closingDay: Number(fd.get('closingDay')), payDay: Number(fd.get('payDay')),
          payMonthOffset: Number(fd.get('payMonthOffset')), notifyDays: Number(fd.get('notifyDays')), payWalletId: fd.get('payWalletId'),
        };
        if (w) Object.assign(w, v); else S.wallets.push({ id: uid(), initial: 0, ...v });
      } else {
        const entered = Number(String(fd.get('balance')).replace(/[^\d-]/g, '')) || 0;
        // 記録から計算した増減はそのままに、残高が入力値になるよう起点を合わせる
        const moved = w ? balance(w.id) - (Number(w.initial) || 0) : 0;
        if (w) { w.name = name; w.initial = entered - moved; w.kind = 'asset'; CARD_KEYS.forEach((k) => delete w[k]); }
        else S.wallets.push({ id: uid(), name, kind: 'asset', initial: entered });
      }
      save(); closeSheet(); render();
    });
    $('[data-del]', root)?.addEventListener('click', () => {
      const used = S.txs.some((t) => t.walletId === w.id || t.toWalletId === w.id) || S.bills.some((v) => v.walletId === w.id) || S.wallets.some((v) => v.payWalletId === w.id);
      if (used) { toast('記録・予定・カードの引き落とし口座で使われているため削除できません'); return; }
      if (S.wallets.length <= 1) { toast('最低1つの財布が必要です'); return; }
      if (!confirm(`「${w.name}」を削除しますか？`)) return;
      S.wallets = S.wallets.filter((v) => v.id !== w.id);
      save(); closeSheet(); render();
    });
  };
  openSheet(body(), mount);
}

function budgetSheet() {
  openSheet(`
    <form class="form" id="bForm">
      <h3>月の予算</h3>
      <div class="amount-wrap"><span>¥</span><input class="amount-input num" name="budget" inputmode="numeric" value="${S.settings.budget ? S.settings.budget.toLocaleString('ja-JP') : ''}" placeholder="0"></div>
      <div class="muted" style="font-size:12px">0にすると予算表示をオフにします</div>
      <button class="btn block" type="submit">保存</button>
    </form>`, (root) => {
    const f = $('#bForm', root);
    f.budget.addEventListener('input', () => { const n = parseAmount(f.budget.value); f.budget.value = n ? n.toLocaleString('ja-JP') : ''; });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      S.settings.budget = parseAmount(f.budget.value);
      save(); closeSheet(); render();
    });
    setTimeout(() => f.budget.focus(), 250);
  });
}

/* ---------- receipt OCR ---------- */
// 画像は端末内で文字認識し、外部には送らない（ライブラリと日本語データのみCDNから取得）
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return (tesseractLoading ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = TESSERACT_URL;
    el.onload = () => resolve(window.Tesseract);
    el.onerror = () => { tesseractLoading = null; el.remove(); reject(new Error('load failed')); };
    document.head.appendChild(el);
  }));
}

/** 認識を速くするため長辺1600pxに縮小 */
async function shrinkImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function readReceipt(file, onProgress) {
  const T = await loadTesseract();
  const img = await shrinkImage(file);
  const { data } = await T.recognize(img, 'jpn', {
    logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress); },
  });
  return parseReceipt(data.text);
}

const RECEIPT_CATEGORY = [
  [/病院|クリニック|医院|歯科|調剤/, 'medical'],
  [/ドラッグ|薬|マツモトキヨシ|ウエルシア|ツルハ|スギ|ダイソー|セリア|ニトリ|無印/, 'daily'],
  [/JR|鉄道|タクシー|バス|駐車|ガソリン|ENEOS|出光|コスモ/i, 'transport'],
  [/書店|ブック/, 'edu'],
  [/ユニクロ|UNIQLO|GU|しまむら|ZARA/i, 'clothes'],
  [/スーパー|マート|イオン|AEON|西友|ライフ|イトーヨーカドー|まいばすけっと|業務|ローソン|セブン|ファミリー|ミニストップ|コンビニ|食品|ベーカリー|パン|カフェ|珈琲|コーヒー|スターバックス|マクドナルド|吉野家|すき家|松屋|食堂|レストラン|弁当/i, 'food'],
];

/** レシートの文字認識結果から合計金額・日付・店名・カテゴリを推定する */
function parseReceipt(text) {
  // 文字認識は日本語の文字間に空白を入れるので詰める。「¥」は「\」と読まれることがある
  const jp = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー';
  const lines = String(text).normalize('NFKC').replace(/\\/g, '¥').split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(new RegExp(`(?<=[${jp}]) (?=[${jp}])`, 'gu'), '').trim())
    .filter(Boolean);
  // 「1,234」「1.234」「1 234」のような桁区切りをまとめる
  const numbersIn = (l) => [...l.replace(/(\d)[,. ](?=\d{3}(?!\d))/g, '$1').matchAll(/\d+/g)].map((m) => Number(m[0]));
  const plausible = (n) => n > 0 && n < 10000000;

  let amount = 0;
  const totalRe = /合\s*計|総\s*額|お?買\s*上|お?買い上げ|ご?請求|お?支払(?:金額|合計)?/;
  const excludeRe = /小\s*計|預|釣|税|点数|内\s*訳|割引|値引|ポイント/;
  for (let i = 0; i < lines.length && !amount; i++) {
    if (!totalRe.test(lines[i]) || excludeRe.test(lines[i])) continue;
    const here = numbersIn(lines[i]).filter(plausible);
    const next = lines[i + 1] && !excludeRe.test(lines[i + 1]) ? numbersIn(lines[i + 1]).filter(plausible) : [];
    amount = here.at(-1) || next.at(-1) || 0;
  }
  if (!amount) {
    // 合計行が読めない時は「¥」「円」付きの最大額
    const yenNums = lines.filter((l) => !excludeRe.test(l) && /¥|円/.test(l)).flatMap(numbersIn).filter(plausible);
    amount = yenNums.length ? Math.max(...yenNums) : 0;
  }

  let date = '';
  const joined = lines.join('\n');
  const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : '';
  const western = joined.match(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/);
  const reiwa = joined.match(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
  if (western) date = valid(+western[1], +western[2], +western[3]);
  else if (reiwa) date = valid(2018 + (reiwa[1] === '元' ? 1 : +reiwa[1]), +reiwa[2], +reiwa[3]);

  const store = lines.slice(0, 6).find((l) =>
    (l.match(/[^\d\s\-:/.,¥]/g) || []).length >= 2 && !/領収|レシート|明細|TEL|電話|〒|登録番号|\d{2,4}-\d{2,4}-\d{3,4}|\d{4}[年/]/i.test(l),
  )?.slice(0, 20) || '';
  const category = RECEIPT_CATEGORY.find(([re]) => re.test(store))?.[1] || '';

  return { amount, date, store, category };
}

/* ---------- notifications ---------- */
async function enableNotify() {
  if (!('Notification' in window)) { toast('この端末は通知に未対応です'); return false; }
  const p = await Notification.requestPermission();
  S.settings.notify = p === 'granted';
  S.settings.lastNotified = '';
  save(); render();
  if (p === 'granted') { toast('通知をオンにしました'); checkDue(true); }
  else toast('通知が許可されませんでした');
  return p === 'granted';
}

async function notify(title, body) {
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'osaifu-due' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch (e) { /* fallthrough */ }
  try { new Notification(title, opts); } catch (e) { /* ignore */ }
}

/** 期日が近い・過ぎた未払いの支払いを1日1回通知する */
function checkDue(force = false) {
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayStr();
  if (!force && S.settings.lastNotified === today) return;
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const items = [...monthItems(d.getFullYear(), d.getMonth()), ...monthItems(next.getFullYear(), next.getMonth())]
    .filter((i) => !i.tx && billType(i.bill) === 'expense' && (i.status === 'late' || i.status === 'soon'));
  S.settings.lastNotified = today;
  save();
  if (!items.length) return;
  const lines = items.slice(0, 5).map((i) => `${i.bill.name} ${yen(i.bill.amount)}（${i.diff < 0 ? `${-i.diff}日超過` : i.diff === 0 ? '今日' : i.diff === 1 ? '明日' : `${i.diff}日後`}）`);
  notify(`支払い予定が${items.length}件あります`, lines.join('\n'));
}

/* ---------- calendar (.ics) export ---------- */
function exportIcs() {
  const bills = S.bills.filter((b) => b.active !== false);
  const cards = S.wallets.filter((w) => isCard(w) && w.payDay);
  if (!bills.length && !cards.length) { toast('書き出す予定がありません'); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const icsEsc = (t) => String(t).replace(/[\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const d = new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//osaifu//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:おさいふ 支払い予定'];
  const event = ({ uid: id, summary, desc, day, notifyDays, every = 1, occurs, alarm }) => {
    // 最初の予定日：今月から every か月以内で、支払いのある月
    let start = null;
    for (let k = 0; k < every && !start; k++) {
      const t = new Date(d.getFullYear(), d.getMonth() + k, 1);
      if (occurs(t.getFullYear(), t.getMonth())) start = new Date(t.getFullYear(), t.getMonth(), clampDay(t.getFullYear(), t.getMonth(), day));
    }
    // 29〜31日指定は「その日がない月は月末」にする
    const monthDay = day >= 29
      ? `BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`
      : `BYMONTHDAY=${day}`;
    const rule = `RRULE:FREQ=MONTHLY;${every > 1 ? `INTERVAL=${every};` : ''}${monthDay}`;
    const n = Number(notifyDays) || 0;
    const trigger = n === 0 ? 'PT9H' : `-PT${n * 24 - 9}H`; // 通知は午前9時
    const ds = ymd(start).replace(/-/g, '');
    const de = ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT', `UID:${id}@osaifu`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ds}`, `DTEND;VALUE=DATE:${de}`, rule,
      `SUMMARY:${icsEsc(summary)}`, `DESCRIPTION:${icsEsc(desc)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(alarm)}`, `TRIGGER:${trigger}`, 'END:VALARM',
      'END:VEVENT',
    );
  };
  for (const b of bills) {
    event({
      uid: b.id, day: b.day, notifyDays: b.notifyDays, every: Number(b.every) || 1, occurs: (y, m) => billOccurs(b, y, m),
      summary: `${b.name} ${b.variable ? '約' : ''}${yen(b.amount)}${billType(b) === 'income' ? '（入金）' : ''}`,
      desc: `支払い元：${walletOf(b.walletId)?.name || ''}`, alarm: `${b.name}の支払い`,
    });
  }
  for (const c of cards) {
    event({
      uid: `card-${c.id}`, day: c.payDay, notifyDays: c.notifyDays ?? 3, occurs: () => true,
      summary: `${c.name} 引き落とし`, desc: `引き落とし口座：${walletOf(c.payWalletId)?.name || ''}`, alarm: `${c.name}の引き落とし`,
    });
  }
  lines.push('END:VCALENDAR');
  download('osaifu-payments.ics', lines.join('\r\n'), 'text/calendar');
  toast('カレンダーファイルを書き出しました。開いて追加してください');
}

/* ---------- CSV export ---------- */
function exportCsv() {
  if (!S.txs.length) { toast('書き出す記録がありません'); return; }
  const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const TYPE = { expense: '支出', income: '収入', transfer: '振替' };
  const rows = [['日付', '種類', 'カテゴリ', '金額', '財布', '移動先', 'メモ', '定期支払い']];
  for (const t of [...S.txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    rows.push([
      t.date, TYPE[t.type] || t.type, t.type === 'transfer' ? '' : catOf(t.type, t.category).name, t.amount,
      walletOf(t.walletId)?.name || '', t.type === 'transfer' ? walletOf(t.toWalletId)?.name || '' : '',
      t.memo || '', t.billId ? S.bills.find((b) => b.id === t.billId)?.name || '' : '',
    ]);
  }
  // 先頭のBOMでExcelでも文字化けしない
  download(`osaifu-${todayStr()}.csv`, '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv');
  toast(`${S.txs.length}件をCSVで書き出しました`);
}

/* ---------- 明細の取り込み（銀行・カードのCSV） ---------- */
// 口座への直接連携は行わず、各社サイトからダウンロードしたCSVを端末内で読み込む（外部には送らない）

/** UTF-8として読めなければ Shift_JIS（銀行・カードのCSVに多い）として読む */
function decodeText(buf) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('shift_jis').decode(buf); }
  return text.replace(/^﻿/, '');
}

/** CSV／TSV を行の配列にする（引用符・改行入りのセルに対応） */
function parseCsv(text) {
  const head = text.slice(0, 3000).split(/\r?\n/).slice(0, 8).join('\n');
  const delim = (head.match(/\t/g) || []).length > (head.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

/** 「2026/9/5」「2026年9月5日」「20260905」「令和8年9月5日」「26/09/05」などを YYYY-MM-DD に */
function parseAnyDate(str) {
  const t = String(str ?? '').normalize('NFKC').trim();
  const ok = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100 ? `${y}-${pad(mo)}-${pad(d)}` : '');
  let m;
  if ((m = t.match(/(\d{4})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/))) return ok(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/))) return ok(+m[1], +m[2], +m[3]);
  if ((m = t.match(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/))) return ok(2018 + (m[1] === '元' ? 1 : +m[1]), +m[2], +m[3]);
  if ((m = t.match(/^(\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})$/))) return ok(2000 + +m[1], +m[2], +m[3]);
  return '';
}

/** 「¥1,200」「1,200円」「△500」「(500)」「500-」などを数値に（マイナスは負）。読めなければ null */
function parseAmountCell(str) {
  let t = String(str ?? '').normalize('NFKC').trim();
  if (!t) return null;
  const neg = /^[△▲\-−]/.test(t) || /^\(.*\)$/.test(t) || /[-−]$/.test(t);
  t = t.replace(/[¥円,\s()△▲\-−+]/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(parseFloat(t));
  return neg ? -n : n;
}

// 見出しから列を推定する（上にあるものほど優先）
const HEADER_KEYS = {
  date: [/利用日/, /取引日/, /年月日/, /日付/, /日にち/, /^日$/],
  desc: [/利用店名|利用先/, /品目|お店|店名/, /摘要内容|取引内容|お取り扱い内容|入出金内容/, /内容|摘要|詳細/, /備考|メモ|明細/],
  out: [/出金|引出|払出|支出/, /お?支払(い)?金額/],
  in: [/入金|預入|預かり|受入|収入/],
  amount: [/利用金額/, /支払総額/, /入出金/, /金額/],
};
function guessColumns(headers) {
  const cols = { date: -1, desc: -1, amount: -1, out: -1, in: -1 };
  const used = new Set();
  // 「入出金内容」「入金先支店コード」のような説明・コードの列は、金額の列にしない
  const TEXTY = /内容|摘要|詳細|メモ|備考|店名|利用先|品目|方法|区分|回数|利用者|カテゴリ|コード|番号|名義|支店/;
  const usable = (h, idx, key) => !used.has(idx) && !/残高/.test(h) && !(['out', 'in', 'amount'].includes(key) && TEXTY.test(h));
  for (const key of ['date', 'out', 'in', 'amount', 'desc']) {
    for (const re of HEADER_KEYS[key]) {
      const i = headers.findIndex((h, idx) => usable(h, idx, key) && re.test(h));
      if (i >= 0) { cols[key] = i; used.add(i); break; }
    }
  }
  // 出金と入金の両方があれば分けて読む。片方だけなら「金額」の列を優先する
  if (!(cols.out >= 0 && cols.in >= 0)) {
    if (cols.amount < 0 && cols.out >= 0) { cols.amount = cols.out; }
    cols.out = -1; cols.in = -1;
  }
  return cols;
}
/** 見出しの行を探す（口座名などの前置きの行を飛ばす）。見つからなければ -1 */
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const g = guessColumns(rows[i]);
    if (g.date >= 0 && (g.amount >= 0 || (g.out >= 0 && g.in >= 0))) return i;
  }
  return -1;
}
/** 見出しがないCSV：中身から日付・内容・金額の列を推定（内容の次にある最初の数値の列を金額とする） */
function guessByData(rows) {
  const r = rows[0];
  const cols = { date: r.findIndex((c) => parseAnyDate(c)), desc: -1, amount: -1, out: -1, in: -1 };
  cols.desc = r.findIndex((c, i) => i !== cols.date && c && parseAmountCell(c) === null && !parseAnyDate(c));
  const from = Math.max(cols.date, cols.desc) + 1;
  for (let i = from; i < r.length; i++) if (parseAmountCell(r[i]) !== null) { cols.amount = i; break; }
  return cols;
}

const IMPORT_RULES = [
  [/家賃|賃貸|住宅ローン|管理費|ヤチン/, 'house'],
  [/電気|ガス(?!ト)|水道|東京電力|関西電力|東京ガス|大阪ガス|デンキ|デンリヨク|デンリョク|ガスダイ|スイドウ/, 'utility'],
  [/ドコモ|docomo|ソフトバンク|softbank|楽天モバイル|ワイモバイル|ahamo|povo|NTT|光回線|プロバイダ|OCN|インターネット/i, 'phone'],
  [/netflix|spotify|amazon\s*prime|youtube|disney|hulu|u-next|dazn|adobe|icloud|サブスク/i, 'subsc'],
  [/suica|pasmo|icoca|モバイルsuica|ＪＲ|JR|バス|タクシー|鉄道|高速|\bETC\b|ガソリン|ENEOS|出光|コスモ|駐車/i, 'transport'],
  [/保険|生命|共済|損保/, 'insurance'],
  [/病院|クリニック|医院|歯科|薬局|調剤/, 'medical'],
  [/居酒屋|会食|飲み会|バー/, 'social'],
  [/映画|ゲーム|steam|playstation|nintendo|カラオケ|ライブ|チケット|ディズニー/i, 'fun'],
  [/書店|ブック|学校|スクール|udemy|講座|塾/i, 'edu'],
  [/カード|クレジ|JCB|VISA|マスター|ニコス|セゾン|エポス|オリコ|アプラス|ＵＣ/i, 'card'],
];
const CARD_PAYMENT_RE = /カード|クレジ|JCB|VISA|マスター|ニコス|セゾン|エポス|オリコ|アプラス|ＵＣ/i;

/** 内容からカテゴリを推定：同じ内容の過去の記録 → キーワード → 既定の順 */
function guessCategory(type, memo, history) {
  if (history.has(`${type}:${memo}`)) return history.get(`${type}:${memo}`);
  if (type === 'income') {
    if (/給与|給料|キユウヨ|キュウヨ/.test(memo)) return 'salary';
    if (/賞与|ボーナス|ショウヨ/.test(memo)) return 'bonus';
    return 'other_in';
  }
  const hit = [...IMPORT_RULES, ...RECEIPT_CATEGORY].find(([re]) => re.test(memo));
  return hit ? hit[1] : 'other';
}

/** 取り込み画面の状態から、取り込み候補の一覧を作る */
function importItems(imp) {
  const { rows, hi, cols, mode, walletId } = imp;
  const history = new Map();
  for (const t of S.txs) if (t.memo && t.category) history.set(`${t.type}:${t.memo}`, t.category);
  // すでにある記録との重複（同じ日・金額・種類。内容が同じか、どちらかが空）。同じ行が複数ある時は1件ずつ対応させる
  const pool = S.txs.filter((t) => t.walletId === walletId && t.type !== 'transfer').map((t) => ({ ...t, used: false }));
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = cols.date >= 0 ? parseAnyDate(r[cols.date]) : '';
    if (!date) continue;
    const memo = String(cols.desc >= 0 ? r[cols.desc] || '' : '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 40);
    let type, amount;
    if (cols.out >= 0 && cols.in >= 0) {
      const o = parseAmountCell(r[cols.out]);
      const n = parseAmountCell(r[cols.in]);
      if (o) { type = 'expense'; amount = Math.abs(o); } else if (n) { type = 'income'; amount = Math.abs(n); } else continue;
    } else {
      const a = cols.amount >= 0 ? parseAmountCell(r[cols.amount]) : null;
      if (!a) continue;
      type = (mode === 'expensePositive' ? a > 0 : a < 0) ? 'expense' : 'income';
      amount = Math.abs(a);
    }
    const hit = pool.find((t) => !t.used && t.date === date && t.type === type && t.amount === amount && (!t.memo || !memo || t.memo === memo));
    if (hit) hit.used = true;
    const cardPay = type === 'expense' && !isCard(walletOf(walletId)) && CARD_PAYMENT_RE.test(memo);
    out.push({ idx: i, date, memo, type, amount, category: guessCategory(type, memo, history), dup: !!hit, cardPay });
  }
  return out;
}

let imp = null;
function pickStatement() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv,.tsv,.txt,text/csv';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try { openImport(f.name, decodeText(await f.arrayBuffer())); } catch (e) { toast('ファイルを読み込めませんでした'); }
  };
  input.click();
}

function openImport(name, text) {
  const rows = parseCsv(text);
  if (rows.length < 2) { toast('取り込める行がありません'); return; }
  const hi = findHeader(rows);
  const headers = hi >= 0 ? rows[hi] : rows[0].map((_, i) => `${i + 1}列目`);
  const cols = hi >= 0 ? guessColumns(headers) : guessByData(rows);
  const cards = S.wallets.filter(isCard);
  const looksCard = headers.some((h) => /利用/.test(h));
  const wallet = (looksCard && cards[0]) || S.wallets.find((w) => !isCard(w) && w.id !== 'cash') || S.wallets[0];
  imp = { name, rows, hi, headers, cols, walletId: wallet.id, mode: 'expensePositive', touched: new Map() };
  imp.mode = defaultMode(imp);
  showImport();
}
function defaultMode(x) {
  if (isCard(walletOf(x.walletId))) return 'expensePositive';
  const neg = x.rows.slice(x.hi + 1).some((r) => (parseAmountCell(r[x.cols.amount]) || 0) < 0);
  return neg ? 'expenseNegative' : 'expensePositive';
}

function showImport() {
  const x = imp;
  const items = importItems(x);
  const on = (it) => (x.touched.has(it.idx) ? x.touched.get(it.idx) : !(it.dup || it.cardPay));
  const picked = items.filter(on);
  const split = x.cols.out >= 0 && x.cols.in >= 0;
  const colSel = (key, label) => `<div class="field"><label>${label}</label><select class="input" data-imp-col="${key}"><option value="-1">なし</option>${x.headers.map((h, i) => `<option value="${i}" ${x.cols[key] === i ? 'selected' : ''}>${esc(h || `${i + 1}列目`)}</option>`).join('')}</select></div>`;
  const fail = x.cols.date < 0 || (x.cols.amount < 0 && !split);
  const shown = items.slice(0, 80);
  openSheet(`
    <div class="form">
      <h3>明細を取り込む</h3>
      <div class="muted" style="font-size:12px">${esc(x.name)}</div>
      <div class="field"><label>取り込み先</label><select class="input" data-imp-wallet>${S.wallets.map((w) => `<option value="${w.id}" ${w.id === x.walletId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
      ${split ? '' : `<div class="field"><label>金額の見方</label><select class="input" data-imp-mode>
        <option value="expensePositive" ${x.mode === 'expensePositive' ? 'selected' : ''}>プラスの数字が支出（カード明細など）</option>
        <option value="expenseNegative" ${x.mode === 'expenseNegative' ? 'selected' : ''}>マイナスの数字が支出（入出金が1列の銀行など）</option></select></div>`}
      <details class="map" ${fail ? 'open' : ''}><summary>列の対応${fail ? '（日付と金額の列を選んでください）' : ''}</summary>
        <div class="grid2" style="margin-top:8px">${colSel('date', '日付')}${colSel('desc', '内容')}${colSel('amount', '金額')}${colSel('out', '出金')}${colSel('in', '入金')}</div>
      </details>
      <div class="imp-head"><span class="num">${picked.length}件を取り込み${items.length > picked.length ? `（${items.length - picked.length}件は除外）` : ''}</span>
        <span><button type="button" class="link" data-imp-all="1">すべて選択</button><button type="button" class="link" data-imp-all="0">すべて解除</button></span></div>
      <div class="imp-list">${items.length ? shown.map((it) => `<label class="imp-row ${on(it) ? '' : 'off'}">
          <input type="checkbox" data-imp-row="${it.idx}" ${on(it) ? 'checked' : ''}>
          <span class="imp-date num">${+it.date.slice(5, 7)}/${+it.date.slice(8)}</span>
          <span class="imp-memo">${esc(it.memo || '(内容なし)')}<small>${it.dup ? '取り込み済みの可能性' : it.cardPay ? 'カード引き落とし（重複に注意）' : esc(catOf(it.type, it.category).name)}</small></span>
          <span class="imp-amt num ${it.type === 'income' ? 'income' : 'expense'}">${it.type === 'income' ? '+' : '−'}${yen(it.amount)}</span></label>`).join('')
          + (items.length > shown.length ? `<div class="empty">ほか${items.length - shown.length}件</div>` : '')
        : '<div class="empty">取り込める行がありません。列の対応を確認してください</div>'}</div>
      <button class="btn block" data-imp-go ${picked.length ? '' : 'disabled'}>${picked.length}件を取り込む</button>
    </div>`, (root) => {
    const again = () => { x.touched = new Map(); showImport(); };
    $('[data-imp-wallet]', root).onchange = (e) => { x.walletId = e.target.value; x.mode = defaultMode(x); again(); };
    $('[data-imp-mode]', root)?.addEventListener('change', (e) => { x.mode = e.target.value; again(); });
    $$('[data-imp-col]', root).forEach((sel) => sel.addEventListener('change', () => { x.cols[sel.dataset.impCol] = Number(sel.value); x.mode = defaultMode(x); again(); }));
    $$('[data-imp-row]', root).forEach((c) => c.addEventListener('change', () => {
      x.touched.set(Number(c.dataset.impRow), c.checked);
      const keep = $('.sheet-panel').scrollTop; showImport(); $('.sheet-panel').scrollTop = keep;
    }));
    $$('[data-imp-all]', root).forEach((b) => b.addEventListener('click', () => {
      items.forEach((it) => x.touched.set(it.idx, b.dataset.impAll === '1'));
      showImport();
    }));
    $('[data-imp-go]', root).onclick = () => {
      const made = picked.map((it) => ({
        id: uid(), type: it.type, amount: it.amount, date: it.date, category: it.category, walletId: x.walletId, memo: it.memo,
      }));
      S.txs.push(...made);
      save(); closeSheet(); render();
      const ids = new Set(made.map((t) => t.id));
      toast(`${made.length}件を取り込みました`, '取り消し', () => { S.txs = S.txs.filter((t) => !ids.has(t.id)); save(); render(); });
    };
  });
}

/* ---------- backup ---------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importJson() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!Array.isArray(data.wallets) || !Array.isArray(data.txs)) throw new Error('bad');
      if (!confirm('現在のデータを上書きして復元しますか？')) return;
      S = { ...seed(), ...data, settings: { ...seed().settings, ...data.settings } };
      save(); render(); toast('復元しました');
    } catch (e) { toast('ファイルを読み込めませんでした'); }
  };
  input.click();
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, actionLabel, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  el.hidden = false;
  if (actionLabel) $('button', el).onclick = () => { el.hidden = true; action(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 5000 : 2500);
}

/* ---------- events ---------- */
function shiftMonth(delta) {
  const d = new Date(UI.y, UI.m + delta, 1);
  UI.y = d.getFullYear(); UI.m = d.getMonth();
  render();
}
$('#prevMonth').onclick = () => shiftMonth(-1);
$('#nextMonth').onclick = () => shiftMonth(1);
$$('.tab').forEach((b) => (b.onclick = () => { UI.tab = b.dataset.tab; render(); view.scrollTop = 0; }));
$('#fab').onclick = () => {
  const inView = UI.tab === 'cal' ? UI.sel : todayStr().startsWith(ym(UI.y, UI.m)) ? todayStr() : ymd(new Date(UI.y, UI.m, 1));
  txSheet(null, { date: inView });
};

// 左右スワイプで月移動（ホーム・カレンダー・履歴）
let touchX = null, touchY = null;
view.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
view.addEventListener('touchend', (e) => {
  if (touchX === null || UI.tab === 'wallet') return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest('.wallet-strip')) shiftMonth(dx < 0 ? 1 : -1);
  touchX = null;
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-pay],[data-edit-bill],[data-edit-tx],[data-edit-wallet],[data-goto],[data-act],[data-day],[data-month],[data-filter] button,[data-group] button');
  if (!el) return;
  const ds = el.dataset;
  if (ds.pay) {
    const [y, m] = [UI.y, UI.m];
    return togglePaid(ds.pay, y, m);
  }
  if (ds.editBill) return ds.editBill.startsWith('card:') ? walletSheet(walletOf(ds.editBill.split(':')[1])) : billSheet(S.bills.find((b) => b.id === ds.editBill));
  if (ds.editTx) return txSheet(S.txs.find((t) => t.id === ds.editTx));
  if (ds.editWallet) return walletSheet(walletOf(ds.editWallet));
  if (ds.goto) { UI.tab = ds.goto; render(); view.scrollTop = 0; return; }
  if (ds.day) { UI.sel = ds.day; render(); return; }
  if (ds.month) { const [y, m] = ds.month.split('-').map(Number); UI.y = y; UI.m = m; render(); return; }
  if (el.parentElement?.dataset.filter !== undefined && ds.v) { UI.filter = ds.v; render(); return; }
  if (el.parentElement?.dataset.group !== undefined && ds.v) { UI.group = ds.v; render(); return; }
  switch (ds.act) {
    case 'new-bill': return billSheet(null);
    case 'new-wallet': return walletSheet(null);
    case 'transfer': return txSheet(null, { type: 'transfer' });
    case 'add-on-day': return txSheet(null, { date: UI.sel });
    case 'budget': return budgetSheet();
    case 'ics': return exportIcs();
    case 'csv': return exportCsv();
    case 'import-csv': return pickStatement();
    case 'sync-in': UI.forceLogin = true; return render();
    case 'sync-out': return logout();
    case 'export': return download(`osaifu-backup-${todayStr()}.json`, JSON.stringify(S, null, 2), 'application/json');
    case 'import': return importJson();
    case 'reset':
      if (confirm(`すべてのデータを削除します${Sync.status !== 'signedOut' && Sync.enabled ? '（クラウドの記録も削除されます）' : ''}。元に戻せません。よろしいですか？`)) { S = seed(); save(); render(); toast('削除しました'); }
      return;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id !== 'notifyToggle') return;
  if (e.target.checked) enableNotify();
  else { S.settings.notify = false; save(); render(); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // 日付が変わっていたら表示を更新
  render();
  checkDue();
});

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
checkDue();
