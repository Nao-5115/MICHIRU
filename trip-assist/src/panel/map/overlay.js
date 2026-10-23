// Google マップ上の共有スポットマーカー・ポップアップ・採用地点の取り込み
import * as T from "../../lib.js";
import { rid } from "../constants.js";

export function installOverlay(c) {
  const { spotLayer, h, spotMapUrl, S, SPOT_COLORS, spotStars, tripData, flash, L, saveLocal } = c;
  const render = (...args) => c.render(...args);
  let activeSpotPopup = null;
  function closeSpotPopup() {
    spotLayer
      .querySelectorAll(".tripassist-spot-popup")
      .forEach((el) => el.remove());
    activeSpotPopup = null;
  }
  function mercatorY(lat) {
    const sin = Math.sin(
      (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180,
    );
    return Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  }
  function mapViewFromUrl() {
    const m = location.href.match(
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/,
    );
    return m ? { lat: +m[1], lng: +m[2], zoom: +m[3] } : null;
  }
  function spotScreenPoint(spot, view) {
    const scale = 256 * 2 ** view.zoom;
    const dx = ((spot.lng - view.lng) / 360) * scale;
    const dy = (mercatorY(view.lat) - mercatorY(spot.lat)) * scale;
    return { x: window.innerWidth / 2 + dx, y: window.innerHeight / 2 + dy };
  }
  function showSpotPopup(spot, x, y) {
    if (activeSpotPopup === spot.id) {
      closeSpotPopup();
      return;
    }
    closeSpotPopup();
    activeSpotPopup = spot.id;
    const popup = h("div", { class: "tripassist-spot-popup" });
    const date = spot.registeredAt
      ? new Date(spot.registeredAt).toLocaleDateString("ja-JP")
      : "";
    const mapUrl = spotMapUrl(spot);
    const left = Math.max(
      8,
      Math.min(x + 18, window.innerWidth - (S.open ? 390 : 280)),
    );
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(8, Math.min(y - 36, window.innerHeight - 260))}px`;
    popup.append(
      h(
        "button",
        {
          type: "button",
          class: "tripassist-spot-close",
          title: "閉じる",
          onclick: closeSpotPopup,
        },
        "×",
      ),
      h("h4", {}, spot.name),
      h(
        "div",
        {},
        h(
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
      spot.description ? h("p", {}, spot.description) : null,
      spot.recommendation ? h("p", {}, `💬 ${spot.recommendation}`) : null,
      h("p", {}, `${spot.registeredBy || "匿名"}${date ? ` ・ ${date}` : ""}`),
      h(
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
      .forEach((el) => el.remove());
    const view = mapViewFromUrl();
    if (!view || view.zoom < 14 || !S.spots) {
      closeSpotPopup();
      return;
    }
    for (const spot of S.spots) {
      if (!Number.isFinite(+spot.lat) || !Number.isFinite(+spot.lng)) continue;
      const { x, y } = spotScreenPoint(spot, view);
      if (
        x < -50 ||
        x > window.innerWidth + 50 ||
        y < -50 ||
        y > window.innerHeight + 50
      )
        continue;
      const color = SPOT_COLORS[spot.category] || "#616161";
      const stars = "★".repeat(
        Math.max(0, Math.min(5, Math.round(+spot.rating))),
      );
      const marker = h("div", {
        class: "tripassist-spot-marker",
        title: `${spot.name}\n${spot.category}　${stars}`,
        onclick: (e) => {
          e.stopPropagation();
          showSpotPopup(spot, x, y);
        },
      });
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
      const callout = h(
        "div",
        { class: "tripassist-spot-callout" },
        h("div", { class: "tripassist-spot-name" }, spot.name),
        spot.recommendation
          ? h("div", { class: "tripassist-spot-rec" }, spot.recommendation)
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
    (e) => {
      if (
        mapViewFromUrl() &&
        S.spots &&
        e.target.closest("#tripassist-host") === null
      )
        mapDrag = { x: e.clientX, y: e.clientY };
    },
    true,
  );
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!mapDrag) return;
      const dx = e.clientX - mapDrag.x,
        dy = e.clientY - mapDrag.y;
      spotLayer.querySelectorAll(".tripassist-spot-marker").forEach((el) => {
        el.style.left = `${parseFloat(el.style.left) + dx}px`;
        el.style.top = `${parseFloat(el.style.top) + dy}px`;
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

  async function importAdopted() {
    const d = tripData(),
      adopted = d.adopted || {};
    const picked = T.placesOf(d).filter((p) => adopted[p.id]);
    if (!picked.length)
      return flash(
        "採用した地点がありません。「採用」にチェックを入れてください。",
        "err",
      );
    let added = 0,
      dup = 0;
    for (const p of picked) {
      if (L().places.some((x) => T.samePoint(x, p))) {
        dup++;
        continue;
      }
      if (L().places.length >= T.MAX_LOCAL_PLACES) {
        flash(`訪問地点は最大 ${T.MAX_LOCAL_PLACES} 件までです`, "err");
        break;
      }
      L().places.push({ id: rid(), name: p.name, lat: +p.lat, lng: +p.lng });
      added++;
    }
    await saveLocal();
    if (added || !dup)
      flash(
        `${added} 件を訪問地点リストに取り込みました${dup ? `（${dup} 件は登録済み）` : ""}`,
      );
    else flash("採用した地点は、すべて訪問地点リストに登録済みです");
    render();
  }

  // ======================= ルートタブ（幹事のローカル） =======================
  // 訪問順 = L().places の並び。しおり・ルートリンクは常にこの並びから再計算される
  const modeOf = (a, b) =>
    L().legModes[a.id + ">" + b.id] || L().legModes[b.id + ">" + a.id] || "car";
  function currentItinerary() {
    if (!L().places.length) return null;
    const st = L().settings;
    return T.buildItinerary(L().places, {
      startMin: T.parseTime(st.startTime),
      speeds: { car: st.speedCar, train: st.speedTrain },
      detours: { car: st.detourCar, train: st.detourTrain },
      defaultStay: st.defaultStay,
      stays: st.stays,
      modeOf,
    });
  }
  // 区間の移動手段は「2 地点の組み合わせ」に紐づけて保持（電車のみ保存、未設定は車）
  function pruneLegModes() {
    const ids = new Set(L().places.map((p) => p.id));
    for (const k of Object.keys(L().legModes)) {
      const [x, y] = k.split(">");
      if (!ids.has(x) || !ids.has(y)) delete L().legModes[k];
    }
    const keys = Object.keys(L().legModes);
    if (keys.length > 40) {
      const adj = new Set(),
        pl = L().places;
      for (let i = 1; i < pl.length; i++) {
        adj.add(pl[i - 1].id + ">" + pl[i].id);
        adj.add(pl[i].id + ">" + pl[i - 1].id);
      }
      for (const k of keys) if (!adj.has(k)) delete L().legModes[k];
    }
  }
  async function placesChanged() {
    pruneLegModes();
    await saveLocal();
    render();
  }

  async function movePlace(fromId, toId, after) {
    const moving = L().places.find((x) => x.id === fromId);
    const arr = L().places.filter((x) => x.id !== fromId);
    const idx = arr.findIndex((x) => x.id === toId);
    if (!moving || idx < 0) return;
    arr.splice(after ? idx + 1 : idx, 0, moving);
    if (arr.every((x, i) => x.id === L().places[i].id)) return;
    L().places = arr;
    await placesChanged();
    flash("並べ替えました。しおりの時刻とルートリンクを更新しました。");
  }

  Object.assign(c, { activeSpotPopup, closeSpotPopup, mercatorY, mapViewFromUrl, spotScreenPoint, showSpotPopup, updateOverlay, overlayHref, mapDrag, importAdopted, modeOf, currentItinerary, pruneLegModes, placesChanged, movePlace });
}
