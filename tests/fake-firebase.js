// テスト用の Firebase 代替（app / auth / firestore の3モジュール共通）。状態は globalThis.__fake に置く
const F = (globalThis.__fake ||= { docs: new Map(), listeners: [], authCbs: [], writes: [], user: null });
F.snap = () => ({ docs: [...F.docs].map(([id, d]) => ({ id, data: () => structuredClone(d) })) });
F.emit = () => F.listeners.forEach((cb) => cb(F.snap()));

export const initializeApp = (cfg) => ({ cfg });
export const getAuth = () => ({});
export const onAuthStateChanged = (_a, cb) => { F.authCbs.push(cb); cb(F.user); return () => {}; };
export class GoogleAuthProvider {}
export const signInWithPopup = async () => {
  F.user = { uid: 'u1', email: 'test@example.com' };
  F.authCbs.forEach((cb) => cb(F.user));
  return { user: F.user };
};
export const signInWithRedirect = signInWithPopup;
export const signOut = async () => { F.user = null; F.authCbs.forEach((cb) => cb(null)); };

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
      for (const [op, id, d] of ops) {
        F.writes.push(`${op}:${id}`);
        if (op === 'set') F.docs.set(id, structuredClone(d)); else F.docs.delete(id);
      }
      setTimeout(F.emit, 0);
    },
  };
};
