// タブ定義と画面の描画
import { STORAGE_KEYS } from "../constants.js";

export function installRender(ctx) {
  const { state, clearNav, isDirPage, loadLocal, toggle, sendMessage, callFirebase, updateOverlay } = ctx;

  // 起動: 保存済みの状態を読み込み、offscreen（Firebase 接続）を確実に起動する。
  // ルート案内への遷移後（または元の画面への復帰後）はパネルを自動で再表示して状態を復元する
  async function boot() {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.cur,
      STORAGE_KEYS.nav,
      STORAGE_KEYS.auth,
      STORAGE_KEYS.trips,
      STORAGE_KEYS.trip,
      STORAGE_KEYS.spots,
    ]);
    state.auth = stored[STORAGE_KEYS.auth] || { state: "unknown" };
    state.trips = (stored[STORAGE_KEYS.trips] && stored[STORAGE_KEYS.trips].list) || [];
    state.trip = stored[STORAGE_KEYS.trip] || null;
    const spotState = stored[STORAGE_KEYS.spots];
    state.spots = spotState ? spotState.list || [] : null;
    state.spotsError = (spotState && spotState.error) || "";
    state.tripId = stored[STORAGE_KEYS.cur] || null;
    state.nav = stored[STORAGE_KEYS.nav] || null;
    let reopen = false;
    if (state.nav) {
      if (!state.nav.ts || Date.now() - state.nav.ts > 12 * 3600 * 1000)
        await clearNav(); // 古い遷移記録は破棄
      else {
        if (state.nav.tripId) {
          state.tripId = state.nav.tripId;
          await chrome.storage.local.set({ [STORAGE_KEYS.cur]: state.tripId });
        }
        state.tab = [
          "trip",
          "schedule",
          "vote",
          "route",
          "register",
          "spots",
        ].includes(state.nav.tab)
          ? state.nav.tab
          : "route";
        state.pendingScroll = state.nav.scroll || 0;
        if (state.nav.back || !isDirPage()) await clearNav(); // 元の画面に戻った → 復元して終了
        reopen = true;
      }
    }
    await loadLocal();
    if (reopen) toggle(true);
    await sendMessage({ type: "app:ensure" });
    callFirebase("watchTrip", { tripId: state.tripId });
    updateOverlay();
  }

  Object.assign(ctx, { boot });
}
