// 幹事のローカル保存（chrome.storage.local）と旅行の切り替え
import { DEF_LOCAL, K, lk } from "../constants.js";

export function installStorage(c) {
  const { S, flash, fb, scheduleRender } = c;
  const render = (...args) => c.render(...args);
  const updateOverlay = (...args) => c.updateOverlay(...args);

  // ---------- ローカル保存（幹事のみ使用: 訪問地点・しおり・移動手段など） ----------
  function applyLocal(v) {
    const base = DEF_LOCAL();
    v = v || {};
    S.local = {
      ...base,
      ...v,
      settings: { ...base.settings, ...(v.settings || {}) },
    };
    for (const k of Object.keys(S.local.legModes))
      if (S.local.legModes[k] !== "train") delete S.local.legModes[k];
  }
  async function loadLocal() {
    if (!S.tripId) {
      S.local = null;
      return;
    }
    const d = await chrome.storage.local.get(lk(S.tripId));
    applyLocal(d[lk(S.tripId)]);
  }
  async function saveLocal() {
    if (!S.tripId || !S.local) return false;
    try {
      await chrome.storage.local.set({ [lk(S.tripId)]: S.local });
      return true;
    } catch (e) {
      flash("保存に失敗しました: " + e.message, "err");
      return false;
    }
  }
  async function selectTrip(id) {
    S.tripId = id || null;
    S.trip = null;
    S.events = null;
    S.regResults = null;
    S.delResults = null;
    S.selDel.clear();
    if (id) await chrome.storage.local.set({ [K.cur]: id });
    else await chrome.storage.local.remove(K.cur);
    await loadLocal();
    fb("watchTrip", { tripId: id || null }); // 開いた旅行を同期（招待された人は、ここで「参加済み」になる）
    render();
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch[K.auth]) S.auth = ch[K.auth].newValue || { state: "signedOut" };
    if (ch[K.trips]) S.trips = (ch[K.trips].newValue || {}).list || [];
    if (ch[K.trip]) S.trip = ch[K.trip].newValue || null;
    if (ch[K.spots]) {
      const value = ch[K.spots].newValue || {};
      S.spots = value.list || [];
      S.spotsError = value.error || "";
      updateOverlay();
    }
    if (ch[K.cur]) {
      const id = ch[K.cur].newValue || null;
      if (id !== S.tripId) {
        // 別のタブで旅行が切り替えられた
        S.tripId = id;
        if (!(S.trip && S.trip.id === id)) S.trip = null;
        loadLocal().then(() => scheduleRender(true));
        return;
      }
    }
    if (S.tripId && ch[lk(S.tripId)]) applyLocal(ch[lk(S.tripId)].newValue);
    scheduleRender(true);
  });

  Object.assign(c, { applyLocal, loadLocal, saveLocal, selectTrip });
}
