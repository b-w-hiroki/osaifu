// テスト用の Firebase 代替（app / auth / firestore の3モジュール共通）。状態は globalThis.__fake に置く
const F = (globalThis.__fake ||= { docs: new Map(), listeners: [], authCbs: [], writes: [], user: null });
F.snap = () => ({ docs: [...F.docs].map(([id, d]) => ({ id, data: () => structuredClone(d) })) });
F.emit = () => F.listeners.forEach((cb) => cb(F.snap()));

export const initializeApp = (cfg) => ({ cfg });
export const getAuth = () => ({});
export const onAuthStateChanged = (_a, cb) => { F.authCbs.push(cb); setTimeout(() => cb(F.user), F.authDelay || 0); return () => {}; };
export class GoogleAuthProvider {}
export const signInWithPopup = async () => {
  F.user = { uid: 'u1', email: 'test@example.com' };
  F.authCbs.forEach((cb) => cb(F.user));
  return { user: F.user };
};
export const signInWithRedirect = signInWithPopup;
export const signOut = async () => { F.user = null; F.authCbs.forEach((cb) => cb(null)); };

const fail = (code) => Object.assign(new Error(code), { code });
const enter = (user) => { F.user = user; F.authCbs.forEach((cb) => cb(F.user)); return { user }; };
export const createUserWithEmailAndPassword = async (_a, email, pw) => {
  F.accounts ||= {};
  if (!/.+@.+\..+/.test(email)) throw fail('auth/invalid-email');
  if (F.accounts[email]) throw fail('auth/email-already-in-use');
  if (pw.length < 6) throw fail('auth/weak-password');
  F.accounts[email] = { pw, uid: `u_${email}` };
  return enter({ uid: F.accounts[email].uid, email });
};
export const signInWithEmailAndPassword = async (_a, email, pw) => {
  const acc = (F.accounts ||= {})[email];
  if (!acc || acc.pw !== pw) throw fail('auth/invalid-credential');
  return enter({ uid: acc.uid, email });
};
export const sendPasswordResetEmail = async (_a, email) => { (F.resets ||= []).push(email); };

export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const collection = (_db, ...path) => ({ path: path.join('/') });
export const doc = (col, id) => ({ path: `${col.path}/${id}`, id });
export const serverTimestamp = () => 'ts';
export const onSnapshot = (_col, cb) => {
  F.listeners.push(cb);
  setTimeout(() => cb(F.snap()), 0);
  return () => { F.listeners = F.listeners.filter((x) => x !== cb); };
};
export const writeBatch = () => {
  const ops = [];
  return {
    set: (ref, d) => ops.push(['set', ref.id, d]),
    delete: (ref) => ops.push(['del', ref.id]),
    commit: async () => {
      if (F.failCommits > 0) {
        F.failCommits -= 1;
        throw new Error('injected commit failure');
      }
      for (const [op, id, d] of ops) {
        F.writes.push(`${op}:${id}`);
        if (op === 'set') F.docs.set(id, structuredClone(d)); else F.docs.delete(id);
      }
      setTimeout(F.emit, 0);
    },
  };
};
