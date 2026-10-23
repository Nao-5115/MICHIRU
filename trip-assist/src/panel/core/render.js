// タブ定義と画面の描画
import { K } from "../constants.js";

export function installRender(c) {
  const { S, clearNav, isDirPage, loadLocal, toggle, send, fb, updateOverlay } = c;

  // 起動: 保存済みの状態を読み込み、offscreen（Firebase 接続）を確実に起動する。
  // ルート案内への遷移後（または元の画面への復帰後）はパネルを自動で再表示して状態を復元する
  async function boot() {
    const d = await chrome.storage.local.get([
      K.cur,
      K.nav,
      K.auth,
      K.trips,
      K.trip,
      K.spots,
    ]);
    S.auth = d[K.auth] || { state: "unknown" };
    S.trips = (d[K.trips] && d[K.trips].list) || [];
    S.trip = d[K.trip] || null;
    const spotState = d[K.spots];
    S.spots = spotState ? spotState.list || [] : null;
    S.spotsError = (spotState && spotState.error) || "";
    S.tripId = d[K.cur] || null;
    S.nav = d[K.nav] || null;
    let reopen = false;
    if (S.nav) {
      if (!S.nav.ts || Date.now() - S.nav.ts > 12 * 3600 * 1000)
        await clearNav(); // 古い遷移記録は破棄
      else {
        if (S.nav.tripId) {
          S.tripId = S.nav.tripId;
          await chrome.storage.local.set({ [K.cur]: S.tripId });
        }
        S.tab = [
          "trip",
          "schedule",
          "vote",
          "route",
          "register",
          "spots",
        ].includes(S.nav.tab)
          ? S.nav.tab
          : "route";
        S.pendingScroll = S.nav.scroll || 0;
        if (S.nav.back || !isDirPage()) await clearNav(); // 元の画面に戻った → 復元して終了
        reopen = true;
      }
    }
    await loadLocal();
    if (reopen) toggle(true);
    await send({ type: "app:ensure" });
    fb("watchTrip", { tripId: S.tripId });
    updateOverlay();
  }

  Object.assign(c, { boot });
}
