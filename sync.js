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
  const UID_KEY = 'osaifu:sync-uid'; // この端末のデータが属するアカウント

  let fb = null;
  let user = null;
  let unsub = null;
  let started = false;
  let ready = false; // 初回のクラウド内容を取り込み済み
  // authState: off=未設定 / unknown=前回ログイン済みで確認中 / in / out
  let authState = !cfg ? 'off' : readJson(ON_KEY) ? 'unknown' : 'out';
  let status = !cfg ? 'disabled' : authState === 'unknown' ? 'syncing' : 'signedOut';
  let handlers = {};
  let notice = ''; // ログインを取りやめた理由など、画面に一度だけ出す案内
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
    const au = auth.getAuth(a);
    au.languageCode = 'ja'; // パスワード再設定などのメールを日本語に
    fb = { auth, fs, db, au };
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

  async function onUser(u) {
    if (u) {
      // 別アカウントのデータが端末に残っている場合は、混ざらないよう確認してから切り替える
      const last = readJson(UID_KEY);
      if (last && last !== u.uid) {
        const ok = handlers.onSwitch ? handlers.onSwitch() : true;
        if (!ok) {
          notice = 'ログインを取りやめました。この端末には別のアカウントのデータが残っています';
          await fb.auth.signOut(fb.au);
          return;
        }
        base = {};
        writeJson(BASE_KEY, base);
      }
      writeJson(UID_KEY, u.uid);
      user = u;
      authState = 'in';
      listen();
    } else {
      user = null;
      authState = 'out';
      stop();
      setStatus('signedOut');
    }
  }

  async function start() {
    if (started) return;
    started = true;
    try {
      await loadSdk();
    } catch (e) {
      started = false; // 通信できなかった時は次のログイン操作でやり直せるようにする
      throw e;
    }
    fb.auth.onAuthStateChanged(fb.au, (u) => { onUser(u); });
  }

  /** Firebase のエラーコードを画面用の日本語にする（空文字は表示しない） */
  function authMessage(e) {
    const code = (e && e.code) || '';
    if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) return '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'メールアドレスまたはパスワードが違います';
    if (/email-already-in-use/.test(code)) return 'このメールアドレスは登録済みです。ログインしてください';
    if (/weak-password/.test(code)) return 'パスワードは6文字以上にしてください';
    if (/invalid-email|missing-email/.test(code)) return 'メールアドレスの形式が正しくありません';
    if (/too-many-requests/.test(code)) return '試行回数が多すぎます。しばらくしてからやり直してください';
    if (/network-request-failed/.test(code)) return '通信できません。ネットワークを確認してください';
    if (/operation-not-allowed/.test(code)) return 'このログイン方法は有効になっていません（Firebase の設定を確認してください）';
    if (/unauthorized-domain/.test(code)) return 'このドメインからのログインは許可されていません（Firebase の承認済みドメインを確認してください）';
    return 'ログインできませんでした';
  }

  /**
   * ログイン操作の共通処理。成功で { ok: true }、失敗で { ok: false, error }
   * remember: 'before'＝リダイレクト方式に備えて先に記録 / 'after'＝成功後に記録 / false＝記録しない
   */
  async function run(fn, remember = 'after') {
    try {
      await loadSdk();
      if (remember === 'before') writeJson(ON_KEY, true);
      await start();
      await fn();
      if (remember === 'after') writeJson(ON_KEY, true);
      return { ok: true };
    } catch (e) {
      if (!user) { authState = 'out'; setStatus('signedOut'); }
      return { ok: false, error: authMessage(e) };
    }
  }

  const signInGoogle = () => run(async () => {
    const provider = new fb.auth.GoogleAuthProvider();
    try {
      await fb.auth.signInWithPopup(fb.au, provider);
    } catch (e) {
      if (e && /popup-blocked|operation-not-supported/.test(e.code || '')) await fb.auth.signInWithRedirect(fb.au, provider);
      else throw e;
    }
  }, 'before');
  const signInEmail = (email, password) => run(() => fb.auth.signInWithEmailAndPassword(fb.au, email, password));
  const signUpEmail = (email, password) => run(() => fb.auth.createUserWithEmailAndPassword(fb.au, email, password));
  const resetPassword = (email) => run(() => fb.auth.sendPasswordResetEmail(fb.au, email), false);

  /** ログアウト。端末のデータは呼び出し側で片付ける（このアカウントの記録はクラウドに残る） */
  async function signOut() {
    writeJson(ON_KEY, false);
    stop();
    base = {};
    writeJson(BASE_KEY, base);
    writeJson(UID_KEY, null);
    if (fb) await fb.auth.signOut(fb.au);
    user = null;
    authState = 'out';
    setStatus('signedOut');
  }

  // 以前ログインしていた端末だけ起動時にSDKを読み込む
  if (cfg && readJson(ON_KEY)) start().catch(() => setStatus('error'));
  window.addEventListener('online', () => { if (user && status === 'offline') setStatus('synced'); });
  window.addEventListener('offline', () => { if (user) setStatus('offline'); });

  return {
    get enabled() { return !!cfg; },
    get status() { return status; },
    get authState() { return authState; },
    get email() { return user?.email || ''; },
    setHandlers(h) { handlers = h; },
    takeNotice() { const n = notice; notice = ''; return n; },
    signInGoogle, signInEmail, signUpEmail, resetPassword, signOut, push,
    // テスト用
    merge, toRecords, applyRecords, canon,
  };
})();
