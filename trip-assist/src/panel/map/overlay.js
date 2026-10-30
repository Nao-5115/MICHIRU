// Google マップ上の共有スポットマーカー・ポップアップ・採用地点の取り込み
import * as T from "../../lib.js";
import { randomId } from "../constants.js";

export function installOverlay(ctx) {
  const { spotLayer, createEl, spotMapUrl, state, SPOT_COLORS, spotStars, tripData, flash, getLocal, saveLocal } = ctx;
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
  function mapUiRects() {
    const selectors = [
      ".app-vertical-widget-holder",
      ".app-horizontal-widget-holder",
      ".widget-pane",
      ".searchbox",
      "#searchbox",
      '[role="search"]',
      "button",
      "input",
      "a",
      '[role="button"]',
      '[role="link"]',
    ];
    return [...document.querySelectorAll(selectors.join(","))]
      .filter(
        (element) =>
          !element.closest("#tripassist-host, #tripassist-spot-layer"),
      )
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0 ||
          rect.width === 0 ||
          rect.height === 0
          ? null
          : rect;
      })
      .filter(Boolean);
  }
  function overlapsMapUi(element, uiRects) {
    const rect = element.getBoundingClientRect();
    return uiRects.some(
      (ui) =>
        rect.left < ui.right &&
        rect.right > ui.left &&
        rect.top < ui.bottom &&
        rect.bottom > ui.top,
    );
  }
  function visibleMapUiRects() {
    return [
      ...mapUiRects(),
      // Google Maps renders its left navigation as internal UI that may not be
      // discoverable through page-level selectors.
      { left: 0, top: 0, right: 96, bottom: window.innerHeight },
    ];
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
    const maxLeft = window.innerWidth - (state.open ? 290 : 280);
    const maxTop = window.innerHeight - 260;
    const positions = [
      [screenX + 18, screenY - 36],
      [screenX - 278, screenY - 36],
      [screenX + 18, screenY + 18],
      [screenX - 278, screenY + 18],
    ].map(([left, top]) => [
      Math.max(8, Math.min(left, maxLeft)),
      Math.max(8, Math.min(top, maxTop)),
    ]);
    popup.style.left = `${positions[0][0]}px`;
    popup.style.top = `${positions[0][1]}px`;
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
    const uiRects = visibleMapUiRects();
    const position = positions.find(([left, top]) => {
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      return !overlapsMapUi(popup, uiRects);
    });
    if (!position) closeSpotPopup();
  }
  let mapDrag = null;
  let coastFrame = null;
  function stopMapCoast() {
    if (coastFrame !== null) cancelAnimationFrame(coastFrame);
    coastFrame = null;
  }
  function startMapCoast(velocityX, velocityY) {
    stopMapCoast();
    let lastTime = performance.now();
    const startedAt = lastTime;
    const step = (time) => {
      if (mapDrag) {
        coastFrame = null;
        return;
      }
      const elapsed = Math.min(time - lastTime, 32);
      lastTime = time;
      const friction = Math.exp(-elapsed / 220);
      const deltaX = (velocityX * 220 * (1 - friction));
      const deltaY = (velocityY * 220 * (1 - friction));
      velocityX *= friction;
      velocityY *= friction;
      if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
        spotLayer
          .querySelectorAll(".tripassist-spot-marker")
          .forEach((element) => {
            element.style.left = `${parseFloat(element.style.left) + deltaX}px`;
            element.style.top = `${parseFloat(element.style.top) + deltaY}px`;
          });
      }
      if (
        time - startedAt < 1600 &&
        (Math.abs(velocityX) > 0.015 || Math.abs(velocityY) > 0.015)
      ) {
        coastFrame = requestAnimationFrame(step);
      } else {
        coastFrame = null;
      }
    };
    if (Math.abs(velocityX) > 0.015 || Math.abs(velocityY) > 0.015)
      coastFrame = requestAnimationFrame(step);
  }
  function updateOverlay() {
    if (mapDrag || coastFrame !== null) return;
    spotLayer
      .querySelectorAll(".tripassist-spot-marker")
      .forEach((element) => element.remove());
    const view = mapViewFromUrl();
    if (!view || view.zoom < 14 || !state.spots) {
      closeSpotPopup();
      return;
    }
    const uiRects = visibleMapUiRects();
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
      if (overlapsMapUi(callout, uiRects)) marker.remove();
    }
  }
  let overlayHref = location.href;
  function updateOverlayForUrlChange() {
    if (!mapDrag && location.href !== overlayHref) {
      overlayHref = location.href;
      stopMapCoast();
      closeSpotPopup();
      updateOverlay();
    }
  }
  setInterval(updateOverlayForUrlChange, 100);
  window.addEventListener("resize", () => {
    closeSpotPopup();
    updateOverlay();
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.isPrimary &&
        event.button === 0 &&
        mapViewFromUrl() &&
        state.spots &&
        event.target.closest("#tripassist-host, #tripassist-spot-layer") === null
      ) {
        stopMapCoast();
        const markers = [
          ...spotLayer.querySelectorAll(".tripassist-spot-marker"),
        ].map((element) => {
          const position = getComputedStyle(element);
          const left = parseFloat(position.left);
          const top = parseFloat(position.top);
          element.style.transition = "none";
          element.style.left = `${left}px`;
          element.style.top = `${top}px`;
          return { element, left, top };
        });
        mapDrag = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          moved: false,
          samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }],
          markers,
        };
      }
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!mapDrag || event.pointerId !== mapDrag.pointerId) return;
      const deltaX = event.clientX - mapDrag.x;
      const deltaY = event.clientY - mapDrag.y;
      if (!mapDrag.moved && Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2)
        return;
      mapDrag.moved = true;
      mapDrag.samples.push({
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
      });
      while (
        mapDrag.samples.length > 2 &&
        event.timeStamp - mapDrag.samples[0].time > 100
      )
        mapDrag.samples.shift();
      for (const marker of mapDrag.markers) {
        marker.element.style.left = `${marker.left + deltaX}px`;
        marker.element.style.top = `${marker.top + deltaY}px`;
      }
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      if (!mapDrag || event.pointerId !== mapDrag.pointerId) return;
      const drag = mapDrag;
      mapDrag = null;
      if (!drag.moved) return;
      closeSpotPopup();
      const first = drag.samples[0];
      const last = drag.samples[drag.samples.length - 1];
      const duration = last.time - first.time;
      if (duration > 0)
        startMapCoast(
          (last.x - first.x) / duration,
          (last.y - first.y) / duration,
        );
      updateOverlayForUrlChange();
      setTimeout(updateOverlayForUrlChange, 100);
      setTimeout(updateOverlayForUrlChange, 350);
    },
    true,
  );
  document.addEventListener(
    "pointercancel",
    (event) => {
      if (!mapDrag || event.pointerId !== mapDrag.pointerId) return;
      mapDrag = null;
      updateOverlayForUrlChange();
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
      if (getLocal().places.some((existing) => T.samePoint(existing, { lat, lng }))) continue;
      if (getLocal().places.length >= T.MAX_LOCAL_PLACES) break;
      getLocal().places.push({ id: randomId(), name: place.name, lat, lng });
      changed = true;
    }
    if (changed) saveLocal();
    return changed;
  }

  // 採用チェックと同時に訪問地点リストへ追加する（取り込みボタンを押し忘れてもリロード後に残る）
  async function addAdoptedPlace(place) {
    if (place.lat == null || place.lng == null) {
      flash("この地点は緯度経度がないため、訪問地点リストに追加できませんでした", "err");
      return;
    }
    const lat = +place.lat, lng = +place.lng;
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    if (getLocal().places.some((existing) => T.samePoint(existing, { lat, lng }))) return;
    if (getLocal().places.length >= T.MAX_LOCAL_PLACES) {
      flash(`訪問地点は最大 ${T.MAX_LOCAL_PLACES} 件までです`, "err");
      return;
    }
    getLocal().places.push({ id: randomId(), name: place.name, lat, lng });
    await saveLocal();
    render();
  }

  // ======================= ルートタブ（幹事のローカル） =======================
  // 訪問順は L().places の並び。集合場所を設定した場合は先頭に加えて計算する
  const modeOf = (from, to) =>
    getLocal().legModes[from.id + ">" + to.id] || getLocal().legModes[to.id + ">" + from.id] || "car";
  function routePlaces() {
    const meetingPlace = getLocal().settings.meetingPlace;
    return meetingPlace
      ? [{ ...meetingPlace, isMeetingPlace: true }, ...getLocal().places]
      : getLocal().places;
  }
  function currentItinerary() {
    const places = routePlaces();
    if (!places.length) return null;
    const settings = getLocal().settings;
    const stays = { ...settings.stays };
    if (settings.meetingPlace && !Number.isFinite(stays[settings.meetingPlace.id]))
      stays[settings.meetingPlace.id] = 0;
    return T.buildItinerary(places, {
      startMin: T.parseTime(settings.startTime),
      speeds: { car: settings.speedCar, train: settings.speedTrain },
      detours: { car: settings.detourCar, train: settings.detourTrain },
      defaultStay: settings.defaultStay,
      stays,
      modeOf,
    });
  }
  // 区間の移動手段は「2 地点の組み合わせ」に紐づけて保持（電車のみ保存、未設定は車）
  function pruneLegModes() {
    const places = routePlaces();
    const placeIds = new Set(places.map((place) => place.id));
    for (const key of Object.keys(getLocal().legModes)) {
      const [fromKey, toKey] = key.split(">");
      if (!placeIds.has(fromKey) || !placeIds.has(toKey)) delete getLocal().legModes[key];
    }
    const keys = Object.keys(getLocal().legModes);
    if (keys.length > 40) {
      const adjacent = new Set();
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

  Object.assign(ctx, { activeSpotPopup, closeSpotPopup, mercatorY, mapViewFromUrl, spotScreenPoint, showSpotPopup, updateOverlay, overlayHref, mapDrag, addAdoptedPlace, syncAdoptedPlaces, modeOf, routePlaces, currentItinerary, pruneLegModes, placesChanged, movePlace });
}
