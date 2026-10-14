// offscreen ドキュメント: Firebase Authentication / Realtime Database との接続を保持する。
// ・offscreen ドキュメントで使える拡張機能 API は chrome.runtime のみ。保存は Service Worker 経由（app:publish）で行う。
// ・サーバー側ロジック（Cloud Functions）は使わない。権限制御は database.rules.json のセキュリティルールで行う。
// ・Firebase Auth は web-extension 用のエントリを使い、リモートコード（gapi / reCAPTCHA）を読み込まない。
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } from 'firebase/auth/web-extension';
import { getDatabase, ref, onValue, update, get, push, remove, set, serverTimestamp } from 'firebase/database';
import config from '../firebase-config.json';
import { emailKey, normalizeEmail, isValidEmail, shortName } from './lib.js';

const configured =
  config.apiKey && !String(config.apiKey).includes('YOUR_') &&
  config.databaseURL && !String(config.databaseURL).includes('YOUR_');

let auth = null, db = null;
let unsubTrips = null, unsubTrip = null;
let wantTripId = null;
const joinedMarked = new Set();

const publish = (key, value) => chrome.runtime.sendMessage({ type: 'app:publish', key, value }).catch(() => {});

function humanize(e) {
  const m = String((e && (e.code || e.message)) || e);
  if (/permission[_-]denied/i.test(m)) return '権限がありません（この旅行に招待されていない、または幹事のみの操作です）。';
  if (/auth\/network-request-failed|network|unavailable|offline|disconnected/i.test(m)) return 'Firebase に接続できませんでした。ネットワークを確認してください。';
  if (/auth\/(invalid-credential|invalid-idp-response|operation-not-allowed|admin-restricted-operation|internal-error)/.test(m)) {
    return 'Firebase へのサインインに失敗しました。Firebase Authentication で Google が有効か、OAuth クライアントが Firebase と同じプロジェクトにあるかを確認してください。(' + m + ')';
  }
  return m;
}

function user() {
  const u = auth && auth.currentUser;
  if (!u || !u.email) throw new Error('サインインしていません。「旅行」タブからサインインしてください。');
  const email = normalizeEmail(u.email);
  return { uid: u.uid, email, key: emailKey(email), name: shortName(email, u.displayName).slice(0, 60) };
}
const path = (...p) => p.join('/');
const need = (v, msg) => { if (!v) throw new Error(msg); };

// ---------- 同期（Firebase → chrome.storage.local へ中継） ----------
function startTripsWatch(u) {
  if (unsubTrips) unsubTrips();
  const k = emailKey(u.email);
  unsubTrips = onValue(
    ref(db, path('userTrips', k)),
    (snap) => {
      const list = Object.entries(snap.val() || {})
        .map(([id, v]) => ({ id, name: v.name, ownerEmail: v.ownerEmail, invitedAt: v.invitedAt || 0 }))
        .sort((a, b) => b.invitedAt - a.invitedAt);
      publish('fb:trips', { list, ts: Date.now() });
    },
    (err) => publish('fb:trips', { list: [], error: humanize(err), ts: Date.now() })
  );
}

function watchTrip() {
  if (unsubTrip) { unsubTrip(); unsubTrip = null; }
  if (!wantTripId || !auth || !auth.currentUser) { publish('fb:trip', null); return; }
  const tripId = wantTripId;
  unsubTrip = onValue(
    ref(db, path('trips', tripId)),
    (snap) => {
      const data = snap.val();
      publish('fb:trip', { id: tripId, data, ts: Date.now() });
      markJoined(tripId, data);
    },
    (err) => publish('fb:trip', { id: tripId, data: null, error: humanize(err), ts: Date.now() })
  );
}

// 招待されたメンバーが、その旅行に初めてアクセスしたとき「参加済み」にする（旅行を開いた時点）
async function markJoined(tripId, data) {
  try {
    const u = user();
    const m = data && data.members && data.members[u.key];
    if (!m || m.joinedAt || joinedMarked.has(tripId)) return;
    joinedMarked.add(tripId);
    const base = path('trips', tripId, 'members', u.key);
    await update(ref(db), {
      [path(base, 'joinedAt')]: serverTimestamp(),
      [path(base, 'uid')]: u.uid,
      [path(base, 'displayName')]: u.name
    });
  } catch (_) {
    joinedMarked.delete(tripId); // 失敗時は次回の更新で再試行
  }
}

// ---------- 操作（パネルからの fb:* メッセージ） ----------
const handlers = {
  async signIn() {
    const r = await chrome.runtime.sendMessage({ type: 'auth:token', interactive: true });
    if (!r || !r.ok) throw new Error((r && r.error) || 'Google 認証に失敗しました');
    try {
      await signInWithCredential(auth, GoogleAuthProvider.credential(null, r.token));
    } catch (e) {
      chrome.runtime.sendMessage({ type: 'auth:clear', token: r.token }).catch(() => {}); // 古いトークンを破棄して再試行できるように
      throw e;
    }
    return {};
  },
  async signOut() { await signOut(auth); return {}; },
  async watchTrip({ tripId }) { wantTripId = tripId || null; watchTrip(); return {}; },

  async createTrip({ name }) {
    const u = user();
    name = String(name || '').trim().slice(0, 60);
    need(name, '旅行名を入力してください');
    const id = push(ref(db, 'trips')).key;
    await update(ref(db), {
      [path('trips', id, 'meta')]: { name, ownerUid: u.uid, ownerEmail: u.email, createdAt: serverTimestamp() },
      [path('trips', id, 'members', u.key)]: {
        email: u.email, role: 'owner', invitedAt: serverTimestamp(), joinedAt: serverTimestamp(), uid: u.uid, displayName: u.name
      },
      [path('userTrips', u.key, id)]: { name, ownerEmail: u.email, invitedAt: serverTimestamp() }
    });
    return { id };
  },
  async deleteTrip({ tripId }) {
    user();
    const snap = await get(ref(db, path('trips', tripId, 'members')));
    const updates = { [path('trips', tripId)]: null };
    for (const k of Object.keys(snap.val() || {})) updates[path('userTrips', k, tripId)] = null;
    await update(ref(db), updates); // 幹事以外はルールで拒否される
    return {};
  },

  async inviteMember({ tripId, email }) {
    user();
    email = normalizeEmail(email);
    need(isValidEmail(email), 'メールアドレスの形式が正しくありません');
    const k = emailKey(email);
    const exists = await get(ref(db, path('trips', tripId, 'members', k)));
    need(!exists.exists(), 'このメールアドレスは既に招待されています');
    const meta = (await get(ref(db, path('trips', tripId, 'meta')))).val();
    need(meta, '旅行が見つかりません');
    await update(ref(db), {
      [path('trips', tripId, 'members', k)]: { email, role: 'member', invitedAt: serverTimestamp() },
      [path('userTrips', k, tripId)]: { name: meta.name, ownerEmail: meta.ownerEmail, invitedAt: serverTimestamp() }
    });
    return {};
  },
  async removeMember({ tripId, email }) {
    const u = user();
    const k = emailKey(email);
    need(k !== u.key, '幹事自身は解除できません');
    await update(ref(db), { [path('trips', tripId, 'members', k)]: null, [path('userTrips', k, tripId)]: null });
    return {};
  },

  async addDate({ tripId, s, e }) {
    user();
    const id = push(ref(db, path('trips', tripId, 'dates'))).key;
    await set(ref(db, path('trips', tripId, 'dates', id)), { s, e, createdAt: serverTimestamp() });
    return { id };
  },
  async removeDate({ tripId, dateId }) { user(); await remove(ref(db, path('trips', tripId, 'dates', dateId))); return {}; },

  async setAnswer({ tripId, dateId, v }) { // v: 1=○ 2=△ 0=× / null=未回答
    const u = user();
    const r = ref(db, path('trips', tripId, 'answers', u.key, dateId));
    if (v === null || v === undefined) await remove(r); else await set(r, v);
    return {};
  },

  async addPlace({ tripId, place }) {
    const u = user();
    const id = push(ref(db, path('trips', tripId, 'places'))).key;
    await set(ref(db, path('trips', tripId, 'places', id)), {
      name: String(place.name).slice(0, 60), lat: +place.lat, lng: +place.lng,
      addedBy: u.key, addedByName: u.name, addedAt: serverTimestamp()
    });
    return { id };
  },
  async removePlace({ tripId, placeId }) { user(); await remove(ref(db, path('trips', tripId, 'places', placeId))); return {}; },
  async setVote({ tripId, placeId, on }) {
    const u = user();
    const r = ref(db, path('trips', tripId, 'votes', u.key, placeId));
    if (on) await set(r, true); else await remove(r);
    return {};
  },
  async setAdopted({ tripId, placeId, on }) {
    user();
    const r = ref(db, path('trips', tripId, 'adopted', placeId));
    if (on) await set(r, true); else await remove(r);
    return {};
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string' || !msg.type.startsWith('fb:')) return false;
  const fn = handlers[msg.type.slice(3)];
  if (!fn) { sendResponse({ ok: false, error: '不明な操作です' }); return false; }
  ready
    .then(() => {
      if (!auth) throw new Error('Firebase が初期化されていません（firebase-config.json の設定を確認してください）。');
      return fn(msg);
    })
    .then((r) => sendResponse({ ok: true, ...(r || {}) }))
    .catch((e) => sendResponse({ ok: false, error: humanize(e) }));
  return true;
});

// ---------- 初期化 ----------
async function init() {
  if (!configured) {
    await publish('fb:auth', { state: 'error', error: 'Firebase の設定が未設定です。firebase-config.json を編集して、ビルドし直してください。' });
    return;
  }
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app);

  // 再起動後などに、直前に開いていた旅行を復元する
  try {
    const r = await chrome.runtime.sendMessage({ type: 'app:get', keys: ['app:currentTripId'] });
    wantTripId = (r && r.values && r.values['app:currentTripId']) || null;
  } catch (_) {}

  onAuthStateChanged(
    auth,
    (u) => {
      if (unsubTrips) { unsubTrips(); unsubTrips = null; }
      if (!u) {
        publish('fb:auth', { state: 'signedOut' });
        publish('fb:trips', { list: [], ts: Date.now() });
        watchTrip();
        return;
      }
      publish('fb:auth', { state: 'signedIn', uid: u.uid, email: normalizeEmail(u.email), name: shortName(normalizeEmail(u.email), u.displayName).slice(0, 60) });
      startTripsWatch(u);
      watchTrip();
    },
    (e) => publish('fb:auth', { state: 'error', error: humanize(e) })
  );
}
const ready = init().catch((e) => publish('fb:auth', { state: 'error', error: humanize(e) }));
