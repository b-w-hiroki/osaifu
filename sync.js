'use strict';

/* =========================================================
 * クラウド同期（Firebase Authentication + Cloud Firestore）
 * config.js に Firebase の設定がある時だけ有効になる
 *
 * 保存先：users/{uid}/items/{id} = { kind, data, u }
 *   id は w_<財布ID> / t_<記録ID> / b_<支払いID> / _settings
 * 最後に同期した内容（base）を端末に持ち、端末・クラウドの
 * どちらで変わったかを見て1件ずつ3方向マージする
 * ======================================================= */

const Sync = (() => {
  const cfg = window.OSAIFU_FIREBASE || null;
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
  const BASE_KEY = 'osaifu:sync-base';
  const ON_KEY = 'osaifu:sync-on';

  let fb = null;
  let user = null;
  let unsub = null;
  let started = false;
  let ready = false; // 初回のクラウド内容を取り込み済み
  let status = cfg ? 'signedOut' : 'disabled';
  let base = readJson(BASE_KEY) || {};

  function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function setStatus(s) { status = s; if (typeof render === 'function') render(); }

  /** キー順をそろえたJSON（内容比較用） */
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v ?? null);
  }

  /** 状態を同期単位（id → { kind, data }）に分解する */
  function toRecords(state) {
    const r = {};
    for (const w of state.wallets) r[`w_${w.id}`] = { kind: 'wallet', data: w };
    for (const t of state.txs) r[`t_${t.id}`] = { kind: 'tx', data: t };
    for (const b of state.bills) r[`b_${b.id}`] = { kind: 'bill', data: b };
    r._settings = { kind: 'settings', data: { budget: Number(state.settings.budget) || 0 } };
    return r;
  }

  /** 同期単位を状態に戻す（財布の並び順は端末側を保つ） */
  function applyRecords(state, recs) {
    const list = (kind) => Object.values(recs).filter((r) => r.kind === kind).map((r) => r.data);
    const order = new Map(state.wallets.map((w, i) => [w.id, i]));
    const wallets = list('wallet').sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    if (wallets.length) state.wallets = wallets;
    state.txs = list('tx');
    state.bills = list('bill');
    const st = recs._settings?.data;
    if (st) state.settings.budget = Number(st.budget) || 0;
  }

  /**
   * 3方向マージ。local/remote は id → rec、baseMap は id → canon文字列
   * 片方だけ変わっていればその変更を採用、両方変わっていれば端末側を優先
   */
  function merge(local, baseMap, remote) {
    const recs = {};
    const push = [];
    const del = [];
    const ids = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(baseMap)]);
    for (const id of ids) {
      const L = local[id];
      const R = remote[id];
      const l = L && canon(L);
      const r = R && canon(R);
      const b = baseMap[id];
      if (l === r) { if (L) recs[id] = L; continue; }
      const localChanged = l !== b;
      const remoteChanged = r !== b;
      if (localChanged && !remoteChanged) {
        if (L) { recs[id] = L; push.push(id); } else del.push(id);
      } else if (!localChanged && remoteChanged) {
        if (R) recs[id] = R;
      } else if (L) {
        recs[id] = L; push.push(id);
      } else if (R) {
        recs[id] = R;
      }
    }
    return { recs, push, del };
  }

  async function loadSdk() {
    if (fb) return fb;
    const [app, auth, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const a = app.initializeApp(cfg);
    const db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache() });
    fb = { auth, fs, db, au: auth.getAuth(a) };
    return fb;
  }

  const itemsCol = () => fb.fs.collection(fb.db, 'users', user.uid, 'items');

  async function write(recs, pushIds, delIds) {
    const clean = (v) => JSON.parse(JSON.stringify(v));
    const ops = [...pushIds.map((id) => ['set', id]), ...delIds.map((id) => ['del', id])];
    // 1回の一括書き込みは500件まで
    for (let i = 0; i < ops.length; i += 450) {
      const batch = fb.fs.writeBatch(fb.db);
      for (const [op, id] of ops.slice(i, i + 450)) {
        const ref = fb.fs.doc(itemsCol(), id);
        if (op === 'set') batch.set(ref, { kind: recs[id].kind, data: clean(recs[id].data), u: fb.fs.serverTimestamp() });
        else batch.delete(ref);
      }
      await batch.commit();
    }
  }

  function remember(recs) {
    base = Object.fromEntries(Object.entries(recs).map(([id, r]) => [id, canon(r)]));
    writeJson(BASE_KEY, base);
  }

  function onRemote(snap) {
    const remote = {};
    for (const d of snap.docs) {
      const v = d.data();
      if (v && v.kind) remote[d.id] = { kind: v.kind, data: v.data };
    }
    const local = toRecords(S);
    const { recs, push, del } = merge(local, base, remote);
    const changedLocally = canon(recs) !== canon(local);
    if (changedLocally) { applyRecords(S, recs); saveLocal(); }
    remember(recs);
    ready = true;
    if (push.length || del.length) {
      setStatus('syncing');
      write(recs, push, del).then(() => setStatus('synced')).catch(() => setStatus('error'));
    } else {
      setStatus(navigator.onLine === false ? 'offline' : 'synced');
    }
  }

  function listen() {
    stop();
    ready = false;
    setStatus('syncing');
    unsub = fb.fs.onSnapshot(itemsCol(), onRemote, () => setStatus('error'));
  }
  function stop() { if (unsub) { unsub(); unsub = null; } ready = false; }

  /** 端末で保存した後に呼ぶ：base との差分だけクラウドへ送る */
  function push() {
    if (!fb || !user || !ready) return;
    const local = toRecords(S);
    const pushIds = Object.keys(local).filter((id) => canon(local[id]) !== base[id]);
    const delIds = Object.keys(base).filter((id) => !local[id]);
    if (!pushIds.length && !delIds.length) return;
    remember(local);
    setStatus('syncing');
    write(local, pushIds, delIds).then(() => setStatus('synced')).catch(() => setStatus('error'));
  }

  async function start() {
    if (started) return;
    started = true;
    await loadSdk();
    fb.auth.onAuthStateChanged(fb.au, (u) => {
      user = u;
      if (u) listen();
      else { stop(); setStatus('signedOut'); }
    });
  }

  async function signIn() {
    try {
      setStatus('syncing');
      await loadSdk();
      writeJson(ON_KEY, true);
      await start();
      const provider = new fb.auth.GoogleAuthProvider();
      try {
        await fb.auth.signInWithPopup(fb.au, provider);
      } catch (e) {
        if (e && /popup-blocked|operation-not-supported/.test(e.code || '')) await fb.auth.signInWithRedirect(fb.au, provider);
        else throw e;
      }
    } catch (e) {
      setStatus(user ? 'error' : 'signedOut');
      if (typeof toast === 'function') toast('ログインできませんでした');
    }
  }

  async function signOut() {
    writeJson(ON_KEY, false);
    stop();
    base = {};
    writeJson(BASE_KEY, base);
    if (fb) await fb.auth.signOut(fb.au);
    user = null;
    setStatus('signedOut');
  }

  // 以前ログインしていた端末だけ起動時にSDKを読み込む
  if (cfg && readJson(ON_KEY)) start().catch(() => setStatus('error'));
  window.addEventListener('online', () => { if (user && status === 'offline') setStatus('synced'); });
  window.addEventListener('offline', () => { if (user) setStatus('offline'); });

  return {
    get enabled() { return !!cfg; },
    get status() { return status; },
    get email() { return user?.email || ''; },
    signIn, signOut, push,
    // テスト用
    merge, toRecords, applyRecords, canon,
  };
})();
