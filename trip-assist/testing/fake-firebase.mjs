// offscreen.js のテスト用: Firebase SDK の偽物（呼び出し内容を記録する）
export const calls = [];
export const store = {};
export const watchers = {};
const authCbs = [];
let n = 0;
export const auth = { currentUser: null };
export const initializeApp = (c) => ({ c });
export const getAuth = () => auth;
export const getDatabase = () => ({});
export class GoogleAuthProvider { static credential(a, b) { return { idToken: a, accessToken: b }; } }
export async function signInWithCredential(_a, cred) {
  calls.push(['signIn', cred]);
  auth.currentUser = { uid: 'u-owner', email: 'Owner@Example.com', displayName: '幹事さん' };
  authCbs.forEach((cb) => cb(auth.currentUser));
  return {};
}
export async function signOut() { auth.currentUser = null; authCbs.forEach((cb) => cb(null)); }
export const onAuthStateChanged = (_a, cb) => { authCbs.push(cb); };
export const ref = (_db, p = '') => ({ path: p });
export const push = (r) => { const k = 'K' + ++n; return { key: k, path: r.path + '/' + k }; };
export const set = async (r, v) => { calls.push(['set', r.path, v]); };
export const remove = async (r) => { calls.push(['remove', r.path]); };
export const update = async (r, u) => { calls.push(['update', r.path, u]); };
export const get = async (r) => ({ exists: () => r.path in store, val: () => store[r.path] });
export const onValue = (r, cb) => { watchers[r.path] = cb; return () => { delete watchers[r.path]; }; };
export const serverTimestamp = () => 'TS';
