// offscreen ドキュメント: Firebase Authentication / Realtime Database との接続を保持する。
// ・offscreen ドキュメントで使える拡張機能 API は chrome.runtime のみ。保存は Service Worker 経由（app:publish）で行う。
// ・サーバー側ロジック（Cloud Functions）は使わない。権限制御は database.rules.json のセキュリティルールで行う。
// ・Firebase Auth は web-extension 用のエントリを使い、リモートコード（gapi / reCAPTCHA）を読み込まない。
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
} from "firebase/auth/web-extension";
import {
  getDatabase,
  ref,
  onValue,
  update,
  get,
  push,
  remove,
  set,
  serverTimestamp,
  query,
  orderByChild,
  limitToLast,
} from "firebase/database";
import config from "../firebase-config.json";
import { emailKey, normalizeEmail, isValidEmail, shortName } from "./lib.js";

const configured =
  config.apiKey &&
  !String(config.apiKey).includes("YOUR_") &&
  config.databaseURL &&
  !String(config.databaseURL).includes("YOUR_");

let auth = null,
  db = null;
let unsubTrips = null,
  unsubTrip = null,
  unsubSpots = null;
let wantTripId = null;
const joinedMarked = new Set();

const publish = (key, value) =>
  chrome.runtime
    .sendMessage({ type: "app:publish", key, value })
    .catch(() => {});

function humanize(error) {
  const message = String((error && (error.code || error.message)) || error);
  if (/permission[_-]denied/i.test(message))
    return "権限がありません（この旅行に招待されていない、または幹事のみの操作です）。";
  if (
    /auth\/network-request-failed|network|unavailable|offline|disconnected/i.test(
      message,
    )
  )
    return "Firebase に接続できませんでした。ネットワークを確認してください。";
  if (
    /auth\/(invalid-credential|invalid-idp-response|operation-not-allowed|admin-restricted-operation|internal-error)/.test(
      message,
    )
  ) {
    return (
      "Firebase へのサインインに失敗しました。Firebase Authentication で Google が有効か、OAuth クライアントが Firebase と同じプロジェクトにあるかを確認してください。(" +
      message +
      ")"
    );
  }
  return message;
}

function user() {
  const currentUser = auth && auth.currentUser;
  if (!currentUser || !currentUser.email)
    throw new Error(
      "サインインしていません。「旅行」タブからサインインしてください。",
    );
  const email = normalizeEmail(currentUser.email);
  return {
    uid: currentUser.uid,
    email,
    key: emailKey(email),
    name: shortName(email, currentUser.displayName).slice(0, 60),
  };
}
const path = (...parts) => parts.join("/");
const need = (hasValue, msg) => {
  if (!hasValue) throw new Error(msg);
};

// ---------- 同期（Firebase → chrome.storage.local へ中継） ----------
// 旅行一覧の各旅行に、登録済みの候補日（dates）を付けて publish する
let currentTripList = [];
async function publishTrips() {
  const list = await Promise.all(
    currentTripList.map(async (trip) => {
      try {
        const snap = await get(ref(db, path("trips", trip.id, "dates")));
        const dates = Object.values(snap.val() || {}).map((d) => ({
          s: d.s,
          e: d.e || d.s,
        }));
        return { ...trip, dates };
      } catch (_) {
        return { ...trip, dates: [] };
      }
    }),
  );
  publish("fb:trips", { list, ts: Date.now() });
}

function startTripsWatch(user) {
  if (unsubTrips) unsubTrips();
  const key = emailKey(user.email);
  unsubTrips = onValue(
    ref(db, path("userTrips", key)),
    (snap) => {
      const list = Object.entries(snap.val() || {})
        .map(([entryId, value]) => ({
          id: entryId,
          name: value.name,
          ownerEmail: value.ownerEmail,
          invitedAt: value.invitedAt || 0,
        }))
        .sort((first, second) => second.invitedAt - first.invitedAt);
      currentTripList = list;
      publishTrips();
    },
    (error) =>
      publish("fb:trips", { list: [], error: humanize(error), ts: Date.now() }),
  );
}

// 全利用者で共有するおすすめスポット一覧（最新100件）。
function startSpotsWatch() {
  if (unsubSpots) unsubSpots();
  if (!auth || !auth.currentUser) {
    publish("fb:spots", { list: [], ts: Date.now() });
    return;
  }
  unsubSpots = onValue(
    query(ref(db, "spots"), orderByChild("registeredAt"), limitToLast(100)),
    (snap) => {
      const list = Object.entries(snap.val() || {})
        .map(([id, value]) => ({ id, ...value }))
        .sort(
          (first, second) =>
            (+second.registeredAt || 0) - (+first.registeredAt || 0),
        );
      publish("fb:spots", { list, ts: Date.now() });
    },
    (error) =>
      publish("fb:spots", { list: [], error: humanize(error), ts: Date.now() }),
  );
}

function watchTrip() {
  if (unsubTrip) {
    unsubTrip();
    unsubTrip = null;
  }
  if (!wantTripId || !auth || !auth.currentUser) {
    publish("fb:trip", null);
    return;
  }
  const tripId = wantTripId;
  unsubTrip = onValue(
    ref(db, path("trips", tripId)),
    (snap) => {
      const data = snap.val();
      publish("fb:trip", { id: tripId, data, ts: Date.now() });
      markJoined(tripId, data);
    },
    (error) =>
      publish("fb:trip", {
        id: tripId,
        data: null,
        error: humanize(error),
        ts: Date.now(),
      }),
  );
}

// 招待されたメンバーが、その旅行に初めてアクセスしたとき「参加済み」にする（旅行を開いた時点）
async function markJoined(tripId, data) {
  try {
    const currentUser = user();
    const member = data && data.members && data.members[currentUser.key];
    if (!member || member.joinedAt || joinedMarked.has(tripId)) return;
    joinedMarked.add(tripId);
    const base = path("trips", tripId, "members", currentUser.key);
    await update(ref(db), {
      [path(base, "joinedAt")]: serverTimestamp(),
      [path(base, "uid")]: currentUser.uid,
      [path(base, "displayName")]: currentUser.name,
    });
  } catch (_) {
    joinedMarked.delete(tripId); // 失敗時は次回の更新で再試行
  }
}

// ---------- 操作（パネルからの fb:* メッセージ） ----------
const handlers = {
  async signIn() {
    const response = await chrome.runtime.sendMessage({
      type: "auth:token",
      interactive: true,
      refresh: true,
    });
    if (!response || !response.ok)
      throw new Error(
        (response && response.error) || "Google 認証に失敗しました",
      );
    try {
      await signInWithCredential(
        auth,
        GoogleAuthProvider.credential(null, response.token),
      );
    } catch (error) {
      chrome.runtime
        .sendMessage({ type: "auth:clear", token: response.token })
        .catch(() => {}); // 古いトークンを破棄して再試行できるように
      throw error;
    }
    return {};
  },
  async signOut() {
    await signOut(auth);
    return {};
  },
  async watchTrip({ tripId }) {
    wantTripId = tripId || null;
    watchTrip();
    return {};
  },

  async addSpot({ spot }) {
    const currentUser = user();
    spot = spot || {};
    const categories = [
      "観光スポット",
      "飲食店",
      "穴場スポット",
      "カフェ",
      "ショッピング",
      "自然・景色",
      "その他",
    ];
    const name = String((spot && spot.name) || "").trim();
    const category = String((spot && spot.category) || "");
    const latitude = Number(spot && spot.lat),
      longitude = Number(spot && spot.lng),
      rating = Number(spot && spot.rating);
    need(
      name.length > 0 && name.length <= 60,
      "スポット名を60文字以内で入力してください",
    );
    need(categories.includes(category), "カテゴリを選択してください");
    need(
      Number.isFinite(latitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        Number.isFinite(longitude) &&
        longitude >= -180 &&
        longitude <= 180,
      "位置情報が正しくありません",
    );
    need(
      Number.isInteger(rating) && rating >= 1 && rating <= 5,
      "評価（星）を選択してください",
    );
    const record = {
      name,
      lat: latitude,
      lng: longitude,
      category,
      rating,
      description: String(spot.description || "")
        .trim()
        .slice(0, 500),
      recommendation: String(spot.recommendation || "")
        .trim()
        .slice(0, 200),
      registeredBy: String(spot.registeredBy || currentUser.name)
        .trim()
        .slice(0, 40),
      registeredByEmail: currentUser.email,
      registeredAt: serverTimestamp(),
    };
    const tripsRef = push(ref(db, "spots"));
    await set(tripsRef, record);
    return { id: tripsRef.key };
  },
  async deleteSpot({ spotId }) {
    user();
    need(
      typeof spotId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(spotId),
      "スポットIDが正しくありません",
    );
    await remove(ref(db, path("spots", spotId))); // 登録者本人のみルールで削除可能
    return {};
  },

  async createTrip({ name }) {
    const currentUser = user();
    name = String(name || "")
      .trim()
      .slice(0, 60);
    need(name, "旅行名を入力してください");
    const newTripId = push(ref(db, "trips")).key;
    await update(ref(db), {
      [path("trips", newTripId, "meta")]: {
        name,
        ownerUid: currentUser.uid,
        ownerEmail: currentUser.email,
        createdAt: serverTimestamp(),
      },
      [path("trips", newTripId, "members", currentUser.key)]: {
        email: currentUser.email,
        role: "owner",
        invitedAt: serverTimestamp(),
        joinedAt: serverTimestamp(),
        uid: currentUser.uid,
        displayName: currentUser.name,
      },
      [path("userTrips", currentUser.key, newTripId)]: {
        name,
        ownerEmail: currentUser.email,
        invitedAt: serverTimestamp(),
      },
    });
    return { id: newTripId };
  },
  async deleteTrip({ tripId }) {
    user();
    const snap = await get(ref(db, path("trips", tripId, "members")));
    const updates = { [path("trips", tripId)]: null };
    for (const key of Object.keys(snap.val() || {}))
      updates[path("userTrips", key, tripId)] = null;
    await update(ref(db), updates); // 幹事以外はルールで拒否される
    return {};
  },

  async inviteMember({ tripId, email }) {
    user();
    email = normalizeEmail(email);
    need(isValidEmail(email), "メールアドレスの形式が正しくありません");
    const key = emailKey(email);
    const exists = await get(ref(db, path("trips", tripId, "members", key)));
    need(!exists.exists(), "このメールアドレスは既に招待されています");
    const meta = (await get(ref(db, path("trips", tripId, "meta")))).val();
    need(meta, "旅行が見つかりません");
    await update(ref(db), {
      [path("trips", tripId, "members", key)]: {
        email,
        role: "member",
        invitedAt: serverTimestamp(),
      },
      [path("userTrips", key, tripId)]: {
        name: meta.name,
        ownerEmail: meta.ownerEmail,
        invitedAt: serverTimestamp(),
      },
    });
    return {};
  },
  async removeMember({ tripId, email }) {
    const currentUser = user();
    const key = emailKey(email);
    need(key !== currentUser.key, "幹事自身は解除できません");
    await update(ref(db), {
      [path("trips", tripId, "members", key)]: null,
      [path("userTrips", key, tripId)]: null,
    });
    return {};
  },

  async addDate({ tripId, s: startDate, e: endDate }) {
    user();
    const dateId = push(ref(db, path("trips", tripId, "dates"))).key;
    await set(ref(db, path("trips", tripId, "dates", dateId)), {
      s: startDate,
      e: endDate,
      createdAt: serverTimestamp(),
    });
    await publishTrips();
    return { id: dateId };
  },
  async removeDate({ tripId, dateId }) {
    user();
    await remove(ref(db, path("trips", tripId, "dates", dateId)));
    await publishTrips();
    return {};
  },

  async setAnswer({ tripId, dateId, v: answer }) {
    // v: 1=○ 2=△ 0=× / null=未回答
    const currentUser = user();
    const answerRef = ref(
      db,
      path("trips", tripId, "answers", currentUser.key, dateId),
    );
    if (answer === null || answer === undefined) await remove(answerRef);
    else await set(answerRef, answer);
    return {};
  },

  // 候補日以外の日の個人の予定（1=○ 2=△ 0=×、null で取り消し）
  async setDayMark({ tripId, day, v: mark }) {
    const currentUser = user();
    need(/^\d{4}-\d{2}-\d{2}$/.test(String(day || "")), "日付の形式が正しくありません");
    const markRef = ref(db, path("trips", tripId, "schedules", currentUser.key, day));
    if (mark === null || mark === undefined) await remove(markRef);
    else await set(markRef, mark);
    return {};
  },

  async addPlace({ tripId, place }) {
    const currentUser = user();
    const placeId = push(ref(db, path("trips", tripId, "places"))).key;
    const entry = {
      name: String(place.name).slice(0, 60),
      addedBy: currentUser.key,
      addedByName: currentUser.name,
      addedAt: serverTimestamp(),
    };
    if (place.lat != null && place.lng != null) {
      entry.lat = +place.lat;
      entry.lng = +place.lng;
    }
    await set(ref(db, path("trips", tripId, "places", placeId)), entry);
    return { id: placeId };
  },
  async removePlace({ tripId, placeId }) {
    user();
    await remove(ref(db, path("trips", tripId, "places", placeId)));
    return {};
  },
  async setVote({ tripId, placeId, on: enabled }) {
    const currentUser = user();
    const voteRef = ref(
      db,
      path("trips", tripId, "votes", currentUser.key, placeId),
    );
    if (enabled) await set(voteRef, true);
    else await remove(voteRef);
    return {};
  },
  async setAdopted({ tripId, placeId, on: enabled }) {
    user();
    const adoptedRef = ref(db, path("trips", tripId, "adopted", placeId));
    if (enabled) await set(adoptedRef, true);
    else await remove(adoptedRef);
    return {};
  },
  async setPreferences({ tripId, prefs }) {
    const currentUser = user();
    const prefsRef = ref(
      db,
      path("trips", tripId, "preferences", currentUser.key),
    );
    await set(prefsRef, {
      budget: prefs.budget !== undefined ? prefs.budget : null,
      transport: Array.isArray(prefs.transport) ? prefs.transport : [],
      categories: Array.isArray(prefs.categories) ? prefs.categories : [],
      updatedAt: Date.now(),
    });
    return {};
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    !message ||
    typeof message.type !== "string" ||
    !message.type.startsWith("fb:")
  )
    return false;
  const handler = handlers[message.type.slice(3)];
  if (!handler) {
    sendResponse({ ok: false, error: "不明な操作です" });
    return false;
  }
  ready
    .then(() => {
      if (!auth)
        throw new Error(
          "Firebase が初期化されていません（firebase-config.json の設定を確認してください）。",
        );
      return handler(message);
    })
    .then((result) => sendResponse({ ok: true, ...(result || {}) }))
    .catch((error) => sendResponse({ ok: false, error: humanize(error) }));
  return true;
});

// ---------- 初期化 ----------
async function init() {
  if (!configured) {
    await publish("fb:auth", {
      state: "error",
      error:
        "Firebase の設定が未設定です。firebase-config.json を編集して、ビルドし直してください。",
    });
    return;
  }
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app);

  // 再起動後などに、直前に開いていた旅行を復元する
  try {
    const response = await chrome.runtime.sendMessage({
      type: "app:get",
      keys: ["app:currentTripId"],
    });
    wantTripId =
      (response && response.values && response.values["app:currentTripId"]) ||
      null;
  } catch (_) {}

  onAuthStateChanged(
    auth,
    (user) => {
      if (unsubTrips) {
        unsubTrips();
        unsubTrips = null;
      }
      if (unsubSpots) {
        unsubSpots();
        unsubSpots = null;
      }
      if (!user) {
        publish("fb:auth", { state: "signedOut" });
        publish("fb:trips", { list: [], ts: Date.now() });
        publish("fb:spots", { list: [], ts: Date.now() });
        watchTrip();
        return;
      }
      publish("fb:auth", {
        state: "signedIn",
        uid: user.uid,
        email: normalizeEmail(user.email),
        name: shortName(normalizeEmail(user.email), user.displayName).slice(
          0,
          60,
        ),
      });
      startTripsWatch(user);
      startSpotsWatch();
      watchTrip();
    },
    (error) => publish("fb:auth", { state: "error", error: humanize(error) }),
  );
}
const ready = init().catch((error) =>
  publish("fb:auth", { state: "error", error: humanize(error) }),
);
