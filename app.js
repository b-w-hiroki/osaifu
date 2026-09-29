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
      { id: 'card', name: 'クレジットカード', initial: 0 },
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

/** 指定月の定期支払い一覧（期日順） */
function monthBills(y, m) {
  const today = parseYmd(todayStr());
  return S.bills
    .filter((b) => b.active !== false)
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

function dueLabel(it) {
  if (it.status === 'paid') return '';
  if (it.diff < 0) return `<span class="badge danger">${-it.diff}日超過</span>`;
  if (it.diff === 0) return '<span class="badge danger">今日</span>';
  if (it.diff === 1) return '<span class="badge warn">明日</span>';
  if (it.status === 'soon') return `<span class="badge warn">あと${it.diff}日</span>`;
  return `<span class="badge">${it.due.getDate()}日</span>`;
}

function togglePaid(billId, y, m) {
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
    id: uid(), type: 'expense', amount: bill.amount, date, category: bill.category,
    walletId: bill.walletId, memo: bill.name, billId: bill.id, billMonth: ym(y, m),
  };
  S.txs.push(t);
  save(); render();
  toast(`${bill.name} ${yen(bill.amount)} を支払済にしました`, '取り消し', () => {
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
}

function billRow(it) {
  return `
  <div class="row-item">
    ${mark(catOf('expense', it.bill.category))}
    <div class="row-main" data-edit-bill="${it.bill.id}"><div class="t"><span>${esc(it.bill.name)}</span>${dueLabel(it)}</div></div>
    <div class="amt num">${yen(it.bill.amount)}</div>
    <button class="pay-btn ${it.tx ? 'done' : ''}" data-pay="${it.bill.id}">${it.tx ? '済' : '支払う'}</button>
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
  const bills = monthBills(y, m);
  const unpaid = bills.filter((b) => !b.tx);
  const unpaidSum = unpaid.reduce((s, b) => s + b.bill.amount, 0);
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
      ${unpaid.length ? `<span class="head-val num">残り ${yen(unpaidSum)}</span>` : bills.length ? '<span class="head-val">完了</span>' : ''}
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

  const bills = monthBills(y, m);
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
      ${bd.length ? `<span class="dots">${bd.map((b) => `<i class="${b.status === 'paid' ? 'paid' : b.status === 'late' ? 'late' : ''}"></i>`).join('')}</span>` : ''}
      ${pd?.in ? `<span class="in num">+${compact(pd.in)}</span>` : ''}
      ${pd?.ex ? `<span class="ex num">-${compact(pd.ex)}</span>` : ''}
    </button>`;
  }

  const sel = parseYmd(UI.sel);
  const selBills = billsByDay[UI.sel] || [];
  const selTxs = S.txs.filter((t) => t.date === UI.sel && !(t.billId && selBills.some((b) => b.tx === t)));

  return `
  <section class="card cal">
    <div class="cal-grid">
      ${WD.map((w, i) => `<div class="cal-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}
      ${cells}
    </div>
    <div class="cal-legend"><span><i></i>予定</span><span><i class="late"></i>超過</span><span><i class="paid"></i>済</span></div>
  </section>

  <section class="card">
    <div class="card-head">
      <h2>${sel.getMonth() + 1}/${sel.getDate()}(${WD[sel.getDay()]})</h2>
      <button class="link" data-act="add-on-day">＋ 記録</button>
    </div>
    ${selBills.length || selTxs.length ? `<div class="rows">${selBills.map(billRow).join('')}${selTxs.map(txRow).join('')}</div>` : '<div class="empty">なし</div>'}
  </section>

  <section class="card">
    <div class="card-head"><h2>毎月の支払い</h2><button class="link" data-act="new-bill">＋ 追加</button></div>
    ${bills.length ? `<div class="rows">${bills.map(billRow).join('')}</div>` : '<div class="empty">なし</div>'}
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
  const on = Sync.status !== 'signedOut';
  return `<div class="set-row">
      <div class="row-main"><div class="t">クラウド同期</div>${on ? `<div class="s">${esc(Sync.email)} ${SYNC_LABEL[Sync.status] || ''}</div>` : ''}</div>
      ${on ? '<button class="btn ghost sm" data-act="sync-out">ログアウト</button>' : '<button class="btn sm" data-act="sync-in">Googleでログイン</button>'}
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
      ${S.wallets.map((w) => { const b = balance(w.id); return `<button class="row-item" data-edit-wallet="${w.id}">${walletMark(w)}<div class="row-main"><div class="t"><span>${esc(w.name)}</span></div></div><div class="amt num ${b < 0 ? 'expense' : ''}">${yen(b)}</div></button>`; }).join('')}
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
      const rec = { ...(tx || { id: uid() }), type, ...v };
      if (type !== 'transfer') delete rec.toWalletId; else delete rec.category;
      if (tx) Object.assign(tx, rec); else S.txs.push(rec);
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
  const b = bill || { name: '', amount: '', day: 27, category: 'house', walletId: S.wallets.find((w) => w.id === 'bank')?.id || S.wallets[0]?.id, notifyDays: 1 };
  openSheet(`
    <form class="form" id="billForm">
      <h3>${bill ? '毎月の支払いを編集' : '毎月の支払いを登録'}</h3>
      <div class="field"><label>名前</label><input class="input" name="name" value="${esc(b.name)}" placeholder="例：家賃、電気代、Netflix" required></div>
      <div class="amount-wrap"><span>¥</span><input class="amount-input num" name="amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${b.amount ? Number(b.amount).toLocaleString('ja-JP') : ''}" required></div>
      <div class="grid2">
        <div class="field"><label>毎月の支払日</label><select class="input" name="day">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === b.day ? 'selected' : ''}>${d === 31 ? '月末' : d + '日'}</option>`).join('')}</select></div>
        <div class="field"><label>お知らせ</label><select class="input" name="notifyDays">${NOTIFY_OPTS.map(([v, l]) => `<option value="${v}" ${v === b.notifyDays ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><span class="lbl">カテゴリ</span>${catGrid('expense', b.category)}</div>
      <div class="field"><label>支払い元</label><select class="input" name="walletId">${walletOptions(b.walletId)}</select></div>
      <button class="btn block" type="submit">${bill ? '更新する' : '登録する'}</button>
      ${bill ? '<button class="btn danger block" type="button" data-del>この支払いを削除</button>' : ''}
    </form>`, (root) => {
    const f = $('#billForm', root);
    f.amount.addEventListener('input', () => { const n = parseAmount(f.amount.value); f.amount.value = n ? n.toLocaleString('ja-JP') : ''; });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const v = {
        name: String(fd.get('name')).trim(), amount: parseAmount(fd.get('amount')), day: Number(fd.get('day')),
        notifyDays: Number(fd.get('notifyDays')), category: fd.get('category') || 'other', walletId: fd.get('walletId'),
      };
      if (!v.name || !v.amount) { toast('名前と金額を入力してください'); return; }
      if (bill) Object.assign(bill, v); else S.bills.push({ id: uid(), active: true, ...v });
      save(); closeSheet(); render();
      toast(bill ? '更新しました' : `${v.name} を登録しました`);
      if (!bill && !S.settings.notify && 'Notification' in window && Notification.permission === 'default') {
        setTimeout(() => toast('期日前に通知を受け取りますか？', 'オンにする', enableNotify), 1800);
      }
    });
    $('[data-del]', root)?.addEventListener('click', () => {
      if (!confirm(`「${bill.name}」を削除しますか？\n（過去の支払い記録は残ります）`)) return;
      S.bills = S.bills.filter((x) => x.id !== bill.id);
      S.txs.forEach((t) => { if (t.billId === bill.id) delete t.billId; });
      save(); closeSheet(); render(); toast('削除しました');
    });
    if (!bill) setTimeout(() => f.name.focus(), 250);
  });
}

function walletSheet(w) {
  const x = w || { name: '', initial: 0 };
  openSheet(`
    <form class="form" id="wForm">
      <h3>${w ? '財布を編集' : '財布・口座を追加'}</h3>
      <div class="field"><label>名前</label><input class="input" name="name" value="${esc(x.name)}" placeholder="例：PayPay、楽天銀行" required></div>
      <div class="field"><label>初期残高（現在の残高を入力）</label><input class="input num" name="initial" inputmode="numeric" value="${Number(x.initial) || ''}" placeholder="0"></div>
      ${w ? `<div class="muted" style="font-size:12px">現在の残高：${yen(balance(w.id))}</div>` : ''}
      <button class="btn block" type="submit">${w ? '更新する' : '追加する'}</button>
      ${w ? '<button class="btn danger block" type="button" data-del>この財布を削除</button>' : ''}
    </form>`, (root) => {
    const f = $('#wForm', root);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const raw = String(fd.get('initial')).replace(/[^\d-]/g, '');
      const v = { name: String(fd.get('name')).trim(), initial: Number(raw) || 0 };
      if (!v.name) return;
      if (w) Object.assign(w, v); else S.wallets.push({ id: uid(), ...v });
      save(); closeSheet(); render();
    });
    $('[data-del]', root)?.addEventListener('click', () => {
      const used = S.txs.some((t) => t.walletId === w.id || t.toWalletId === w.id) || S.bills.some((b) => b.walletId === w.id);
      if (used) { toast('記録や支払いで使われているため削除できません'); return; }
      if (S.wallets.length <= 1) { toast('最低1つの財布が必要です'); return; }
      if (!confirm(`「${w.name}」を削除しますか？`)) return;
      S.wallets = S.wallets.filter((x) => x.id !== w.id);
      save(); closeSheet(); render();
    });
  });
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
  const items = [...monthBills(d.getFullYear(), d.getMonth()), ...monthBills(next.getFullYear(), next.getMonth())]
    .filter((i) => !i.tx && (i.status === 'late' || i.status === 'soon'));
  S.settings.lastNotified = today;
  save();
  if (!items.length) return;
  const lines = items.slice(0, 5).map((i) => `${i.bill.name} ${yen(i.bill.amount)}（${i.diff < 0 ? `${-i.diff}日超過` : i.diff === 0 ? '今日' : i.diff === 1 ? '明日' : `${i.diff}日後`}）`);
  notify(`支払い予定が${items.length}件あります`, lines.join('\n'));
}

/* ---------- calendar (.ics) export ---------- */
function exportIcs() {
  const bills = S.bills.filter((b) => b.active !== false);
  if (!bills.length) { toast('毎月の支払いが登録されていません'); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const d = new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//osaifu//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:おさいふ 支払い予定'];
  for (const b of bills) {
    const start = dueDate(b, d.getFullYear(), d.getMonth());
    // 29〜31日指定は「その日がない月は月末」にする
    const rule = b.day >= 29
      ? `RRULE:FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: b.day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`
      : `RRULE:FREQ=MONTHLY;BYMONTHDAY=${b.day}`;
    const n = Number(b.notifyDays) || 0;
    const trigger = n === 0 ? 'PT9H' : `-PT${n * 24 - 9}H`; // 通知は午前9時
    const ds = ymd(start).replace(/-/g, '');
    const de = ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT', `UID:${b.id}@osaifu`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ds}`, `DTEND;VALUE=DATE:${de}`, rule,
      `SUMMARY:${icsEsc(`${b.name} ${yen(b.amount)}`)}`,
      `DESCRIPTION:${icsEsc(`支払い元：${walletOf(b.walletId)?.name || ''}`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(`${b.name}の支払い`)}`, `TRIGGER:${trigger}`, 'END:VALARM',
      'END:VEVENT',
    );
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
  const el = e.target.closest('[data-pay],[data-edit-bill],[data-edit-tx],[data-edit-wallet],[data-goto],[data-act],[data-day],[data-filter] button');
  if (!el) return;
  const ds = el.dataset;
  if (ds.pay) {
    const [y, m] = [UI.y, UI.m];
    return togglePaid(ds.pay, y, m);
  }
  if (ds.editBill) return billSheet(S.bills.find((b) => b.id === ds.editBill));
  if (ds.editTx) return txSheet(S.txs.find((t) => t.id === ds.editTx));
  if (ds.editWallet) return walletSheet(walletOf(ds.editWallet));
  if (ds.goto) { UI.tab = ds.goto; render(); view.scrollTop = 0; return; }
  if (ds.day) { UI.sel = ds.day; render(); return; }
  if (el.parentElement?.dataset.filter !== undefined && ds.v) { UI.filter = ds.v; render(); return; }
  switch (ds.act) {
    case 'new-bill': return billSheet(null);
    case 'new-wallet': return walletSheet(null);
    case 'transfer': return txSheet(null, { type: 'transfer' });
    case 'add-on-day': return txSheet(null, { date: UI.sel });
    case 'budget': return budgetSheet();
    case 'ics': return exportIcs();
    case 'csv': return exportCsv();
    case 'sync-in': return Sync.signIn();
    case 'sync-out': return Sync.signOut();
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
