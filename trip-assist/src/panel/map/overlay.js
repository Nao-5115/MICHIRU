// Google マップ上の共有スポットマーカー・ポップアップ・採用地点の取り込み
import * as T from "../../lib.js";
import { randomId } from "../constants.js";

export function installOverlay(ctx) {
  const { spotLayer, createEl, spotMapUrl, state, SPOT_COLORS, spotStars, tripData, flash, getLocal, saveLocal, sendMessage, callFirebase } = ctx;
  const render = (...args) => ctx.render(...args);
  let activeSpotPopup = null;
  function closeSpotPopup() {
    spotLayer
      .querySelectorAll(".tripassist-spot-popup")
      .forEach((element) => element.remove());
    activeSpotPopup = null;
  }
  function mercatorY(latitude) {
    const sinLat = Math.sin(
      (Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180,
    );
    return Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  }
  function mapViewFromUrl() {
    const match = location.href.match(
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/,
    );
    return match ? { lat: +match[1], lng: +match[2], zoom: +match[3] } : null;
  }
  function spotScreenPoint(spot, view) {
    const scale = 256 * 2 ** view.zoom;
    const deltaX = ((spot.lng - view.lng) / 360) * scale;
    const deltaY = (mercatorY(view.lat) - mercatorY(spot.lat)) * scale;
    return { x: window.innerWidth / 2 + deltaX, y: window.innerHeight / 2 + deltaY };
  }
  function showSpotPopup(spot, screenX, screenY) {
    if (activeSpotPopup === spot.id) {
      closeSpotPopup();
      return;
    }
    closeSpotPopup();
    activeSpotPopup = spot.id;
    const popup = createEl("div", { class: "tripassist-spot-popup" });
    const date = spot.registeredAt
      ? new Date(spot.registeredAt).toLocaleDateString("ja-JP")
      : "";
    const mapUrl = spotMapUrl(spot);
    const left = Math.max(
      8,
      Math.min(screenX + 18, window.innerWidth - (state.open ? 390 : 280)),
    );
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(8, Math.min(screenY - 36, window.innerHeight - 260))}px`;
    popup.append(
      createEl(
        "button",
        {
          type: "button",
          class: "tripassist-spot-close",
          title: "閉じる",
          onclick: closeSpotPopup,
        },
        "×",
      ),
      createEl("h4", {}, spot.name),
      createEl(
        "div",
        {},
        createEl(
          "span",
          {
            class: "spot-cat",
            style: `color:${SPOT_COLORS[spot.category] || "#616161"}`,
          },
          spot.category,
        ),
        " ",
        spotStars(+spot.rating),
      ),
      spot.description ? createEl("p", {}, spot.description) : null,
      spot.recommendation ? createEl("p", {}, `💬 ${spot.recommendation}`) : null,
      createEl("p", {}, `${spot.registeredBy || "匿名"}${date ? ` ・ ${date}` : ""}`),
      createEl(
        "a",
        { href: mapUrl, target: "_blank", rel: "noopener noreferrer" },
        "Google マップで開く",
      ),
    );
    spotLayer.append(popup);
  }
  function updateOverlay() {
    spotLayer
      .querySelectorAll(".tripassist-spot-marker")
      .forEach((element) => element.remove());
    const view = mapViewFromUrl();
    if (!view || view.zoom < 14 || !state.spots) {
      closeSpotPopup();
      return;
    }
    for (const spot of state.spots) {
      if (!Number.isFinite(+spot.lat) || !Number.isFinite(+spot.lng)) continue;
      const { x: screenX, y: screenY } = spotScreenPoint(spot, view);
      if (
        screenX < -50 ||
        screenX > window.innerWidth + 50 ||
        screenY < -50 ||
        screenY > window.innerHeight + 50
      )
        continue;
      const color = SPOT_COLORS[spot.category] || "#616161";
      const stars = "★".repeat(
        Math.max(0, Math.min(5, Math.round(+spot.rating))),
      );
      const marker = createEl("div", {
        class: "tripassist-spot-marker",
        title: `${spot.name}\n${spot.category}　${stars}`,
        onclick: (event) => {
          event.stopPropagation();
          showSpotPopup(spot, screenX, screenY);
        },
      });
      marker.style.left = `${screenX}px`;
      marker.style.top = `${screenY}px`;
      const callout = createEl(
        "div",
        { class: "tripassist-spot-callout" },
        createEl("div", { class: "tripassist-spot-name" }, spot.name),
        spot.recommendation
          ? createEl("div", { class: "tripassist-spot-rec" }, spot.recommendation)
          : null,
      );
      callout.style.setProperty("--sc", color);
      marker.append(callout);
      spotLayer.append(marker);
    }
  }
  let overlayHref = location.href;
  setInterval(() => {
    if (location.href !== overlayHref) {
      overlayHref = location.href;
      closeSpotPopup();
      updateOverlay();
    }
  }, 350);
  window.addEventListener("resize", () => {
    closeSpotPopup();
    updateOverlay();
  });
  let mapDrag = null;
  document.addEventListener(
    "mousedown",
    (event) => {
      if (
        mapViewFromUrl() &&
        state.spots &&
        event.target.closest("#tripassist-host") === null
      )
        mapDrag = { x: event.clientX, y: event.clientY };
    },
    true,
  );
  document.addEventListener(
    "mousemove",
    (event) => {
      if (!mapDrag) return;
      const deltaX = event.clientX - mapDrag.x,
        deltaY = event.clientY - mapDrag.y;
      spotLayer.querySelectorAll(".tripassist-spot-marker").forEach((element) => {
        element.style.left = `${parseFloat(element.style.left) + deltaX}px`;
        element.style.top = `${parseFloat(element.style.top) + deltaY}px`;
      });
    },
    true,
  );
  document.addEventListener(
    "mouseup",
    () => {
      if (mapDrag) {
        mapDrag = null;
        closeSpotPopup();
        updateOverlay();
      }
    },
    true,
  );

  // 採用済みの地点のうち、訪問地点リストにまだないものを自動で追加する（画面表示時に呼ぶ。変更があった場合だけ保存）
  function syncAdoptedPlaces() {
    const trip = tripData();
    if (!trip || !getLocal()) return false;
    const adopted = trip.adopted || {};
    let changed = false;
    for (const place of T.placesOf(trip)) {
      if (!adopted[place.id] || place.lat == null || place.lng == null) continue;
      const lat = +place.lat, lng = +place.lng;
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
      if (findDuplicateLocal(place, lat, lng)) continue;
      if (getLocal().places.length >= T.MAX_LOCAL_PLACES) break;
      getLocal().places.push({ id: randomId(), name: place.name, lat, lng, sourceId: place.id });
      changed = true;
    }
    if (changed) saveLocal();
    return changed;
  }

  // 区間の所要時間（Gemini の目安。電車・車）。旅行の Firebase データ（trips/{旅行}/transit）に保存して、メンバー全員で再利用する
  // 座標が変わった区間は、保存値の sig（座標の組み合わせ）が合わないので取り直す
  // 地点名と座標から作るキー（地点を追加し直しても、同じ地点の組み合わせなら同じキーになる）
  const transitSig = (from, to) =>
    `${from.name}|${from.lat},${from.lng}|${to.name}|${to.lat},${to.lng}`;
  const hashText = (text) => {
    let hash = 5381;
    for (let index = 0; index < text.length; index++) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
    return hash.toString(36);
  };
  const transitKey = (from, to, mode) => `${mode}_${hashText(transitSig(from, to))}`;
  const transitFailed = new Set(); // 失敗した区間は、ページを開き直すまで再問い合わせしない
  const transitRequests = new Set();
  // 保存済みの値を探す（同じ地点の組み合わせなら、順番を逆にした区間の値も使う）
  function transitMinutesOf(from, to, mode) {
    const trip = tripData();
    const saved = (trip && trip.transit) || {};
    for (const [first, second] of [[from, to], [to, from]]) {
      const entry = saved[transitKey(first, second, mode)];
      if (entry && entry.sig === transitSig(first, second) && entry.minutes != null) return entry.minutes;
    }
    return null;
  }
  // 訪問順の隣り合う区間で、まだ保存されていない（電車・車）だけ Gemini に問い合わせて保存する
  async function ensureTransitTimes() {
    const places = getLocal() ? getLocal().places : [];
    for (let index = 1; index < places.length; index++) {
      const from = places[index - 1], to = places[index];
      for (const mode of ["train", "car"]) {
        const key = transitKey(from, to, mode);
        if (transitMinutesOf(from, to, mode) != null || transitRequests.has(key) || transitFailed.has(key)) continue;
        transitRequests.add(key);
        const result = await sendMessage({
          type: "gemini:routeTime",
          mode,
          from: { name: from.name, lat: from.lat, lng: from.lng },
          to: { name: to.name, lat: to.lat, lng: to.lng },
        });
        if (!result.ok) {
          transitFailed.add(key);
          transitRequests.delete(key);
          flash(`所要時間を取得できませんでした: ${result.error || ""}`, "err");
          continue;
        }
        const saved = await callFirebase("setTransitMinutes", {
          tripId: state.tripId,
          key,
          minutes: result.minutes,
          sig: transitSig(from, to),
          mode,
        });
        transitRequests.delete(key);
        if (!saved.ok) flash(`所要時間を保存できませんでした: ${saved.error || ""}`, "err");
      }
    }
  }

  // 同じ候補地点（sourceId）か、座標と名前が両方一致する場合だけ重複とみなす
  // （地図の中心座標を使うと別の施設でも座標が同じになるため、座標だけでは判定しない）
  const findDuplicateLocal = (place, lat, lng) =>
    getLocal().places.find(
      (existing) =>
        (place.id != null && existing.sourceId === place.id) ||
        (T.samePoint(existing, { lat, lng }) && existing.name === place.name),
    );

  // 採用チェックと同時に訪問地点リストへ追加する（取り込みボタンを押し忘れてもリロード後に残る）
  async function addAdoptedPlace(place) {
    if (place.lat == null || place.lng == null) {
      flash("この地点は緯度経度がないため、訪問地点リストに追加できませんでした", "err");
      return;
    }
    const lat = +place.lat, lng = +place.lng;
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      flash(`「${place.name}」の緯度経度が正しくないため、訪問地点リストに追加できませんでした`, "err");
      return;
    }
    if (findDuplicateLocal(place, lat, lng)) {
      flash(`「${place.name}」はすでに訪問地点リストに入っています`, "err");
      return;
    }
    if (getLocal().places.length >= T.MAX_LOCAL_PLACES) {
      flash(`訪問地点は最大 ${T.MAX_LOCAL_PLACES} 件までです`, "err");
      return;
    }
    getLocal().places.push({ id: randomId(), name: place.name, lat, lng, sourceId: place.id });
    await saveLocal();
    flash(`「${place.name}」を訪問地点リストに追加しました`);
    render();
  }

  // ======================= ルートタブ（幹事のローカル） =======================
  // 訪問順 = L().places の並び。しおり・ルートリンクは常にこの並びから再計算される
  const modeOf = (from, to) =>
    getLocal().legModes[from.id + ">" + to.id] || getLocal().legModes[to.id + ">" + from.id] || "car";
  function currentItinerary() {
    if (!getLocal().places.length) return null;
    const settings = getLocal().settings;
    return T.buildItinerary(getLocal().places, {
      startMin: T.parseTime(settings.startTime),
      speeds: { car: settings.speedCar, train: settings.speedTrain },
      detours: { car: settings.detourCar, train: settings.detourTrain },
      defaultStay: settings.defaultStay,
      stays: settings.stays,
      modeOf,
      knownMinutes: transitMinutesOf,
    });
  }
  // 区間の移動手段は「2 地点の組み合わせ」に紐づけて保持（電車のみ保存、未設定は車）
  function pruneLegModes() {
    const placeIds = new Set(getLocal().places.map((place) => place.id));
    for (const key of Object.keys(getLocal().legModes)) {
      const [fromKey, toKey] = key.split(">");
      if (!placeIds.has(fromKey) || !placeIds.has(toKey)) delete getLocal().legModes[key];
    }
    const keys = Object.keys(getLocal().legModes);
    if (keys.length > 40) {
      const adjacent = new Set(),
        places = getLocal().places;
      for (let index = 1; index < places.length; index++) {
        adjacent.add(places[index - 1].id + ">" + places[index].id);
        adjacent.add(places[index].id + ">" + places[index - 1].id);
      }
      for (const key of keys) if (!adjacent.has(key)) delete getLocal().legModes[key];
    }
  }
  async function placesChanged() {
    pruneLegModes();
    await saveLocal();
    render();
  }

  async function movePlace(fromId, toId, after) {
    const moving = getLocal().places.find((place) => place.id === fromId);
    const remaining = getLocal().places.filter((place) => place.id !== fromId);
    const index = remaining.findIndex((place) => place.id === toId);
    if (!moving || index < 0) return;
    remaining.splice(after ? index + 1 : index, 0, moving);
    if (remaining.every((place, index) => place.id === getLocal().places[index].id)) return;
    getLocal().places = remaining;
    await placesChanged();
    flash("並べ替えました。しおりの時刻とルートリンクを更新しました。");
  }

  Object.assign(ctx, { transitMinutesOf, ensureTransitTimes, activeSpotPopup, closeSpotPopup, mercatorY, mapViewFromUrl, spotScreenPoint, showSpotPopup, updateOverlay, overlayHref, mapDrag, addAdoptedPlace, syncAdoptedPlaces, modeOf, currentItinerary, pruneLegModes, placesChanged, movePlace });
}
