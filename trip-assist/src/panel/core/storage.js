// 幹事のローカル保存（chrome.storage.local）と旅行の切り替え
import { DEF_LOCAL, STORAGE_KEYS, localKey } from "../constants.js";

// 画面で編集しない固定項目（既定値を使う）
const FIXED_KEYS = ["speedCar", "speedTrain", "detourCar", "detourTrain", "defaultStay"];
const pickFixed = (settings) => Object.fromEntries(FIXED_KEYS.map((key) => [key, settings[key]]));

export function installStorage(ctx) {
  const { state, flash, callFirebase, scheduleRender } = ctx;
  const render = (...args) => ctx.render(...args);
  const updateOverlay = (...args) => ctx.updateOverlay(...args);

  // ---------- ローカル保存（幹事のみ使用: 訪問地点・しおり・移動手段など） ----------
  function applyLocal(saved) {
    const base = DEF_LOCAL();
    saved = saved || {};
    state.local = {
      ...base,
      ...saved,
      settings: { ...base.settings, ...(saved.settings || {}) },
    };
    // 標準滞在・速度・迂回係数は固定値（画面では編集しない）。保存済みの値があっても既定値に戻す
    Object.assign(state.local.settings, pickFixed(base.settings));
    for (const key of Object.keys(state.local.legModes))
      if (state.local.legModes[key] !== "train") delete state.local.legModes[key];
  }
  async function loadLocal() {
    if (!state.tripId) {
      state.local = null;
      return;
    }
    const stored = await chrome.storage.local.get(localKey(state.tripId));
    const saved = stored[localKey(state.tripId)];
    applyLocal(saved);
    // 保存済みの固定項目が古い値のままなら、保存データも書き換える
    const savedSettings = (saved && saved.settings) || {};
    if (Object.keys(pickFixed(state.local.settings)).some((key) => savedSettings[key] !== state.local.settings[key]))
      await saveLocal();
  }
  async function saveLocal() {
    if (!state.tripId || !state.local) return false;
    try {
      await chrome.storage.local.set({ [localKey(state.tripId)]: state.local });
      return true;
    } catch (error) {
      flash("保存に失敗しました: " + error.message, "err");
      return false;
    }
  }
  async function selectTrip(tripId) {
    state.tripId = tripId || null;
    state.trip = null;
    state.events = null;
    state.regResults = null;
    state.delResults = null;
    state.selDel.clear();
    if (tripId) await chrome.storage.local.set({ [STORAGE_KEYS.cur]: tripId });
    else await chrome.storage.local.remove(STORAGE_KEYS.cur);
    await loadLocal();
    callFirebase("watchTrip", { tripId: tripId || null }); // 開いた旅行を同期（招待された人は、ここで「参加済み」になる）
    render();
  }

  chrome.storage.onChanged.addListener((change, area) => {
    if (area !== "local") return;
    if (change[STORAGE_KEYS.auth]) state.auth = change[STORAGE_KEYS.auth].newValue || { state: "signedOut" };
    if (change[STORAGE_KEYS.trips]) state.trips = (change[STORAGE_KEYS.trips].newValue || {}).list || [];
    if (change[STORAGE_KEYS.trip]) state.trip = change[STORAGE_KEYS.trip].newValue || null;
    if (change[STORAGE_KEYS.spots]) {
      const value = change[STORAGE_KEYS.spots].newValue || {};
      state.spots = value.list || [];
      state.spotsError = value.error || "";
      updateOverlay();
    }
    if (change[STORAGE_KEYS.cur]) {
      const newTripId = change[STORAGE_KEYS.cur].newValue || null;
      if (newTripId !== state.tripId) {
        // 別のタブで旅行が切り替えられた
        state.tripId = newTripId;
        if (!(state.trip && state.trip.id === newTripId)) state.trip = null;
        loadLocal().then(() => scheduleRender(true));
        return;
      }
    }
    if (state.tripId && change[localKey(state.tripId)]) applyLocal(change[localKey(state.tripId)].newValue);
    scheduleRender(true);
  });

  Object.assign(ctx, { applyLocal, loadLocal, saveLocal, selectTrip });
}
