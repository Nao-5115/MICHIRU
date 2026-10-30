// 「ルート」タブ（訪問順・移動手段・しおり・ルート案内）
import * as T from "../../lib.js";
import { STORAGE_KEYS, randomId } from "../constants.js";

export function installRouteTab(ctx) {
  const { state, body, flash, getLocal, saveLocal, createEl, root, movePlace, makeButton, makeMsIcon, makeSvgIcon, placesChanged, gate, currentItinerary, tripData, currentMember, sendMessage } = ctx;
  const render = (...args) => ctx.render(...args);
  const EDIT_ICON = '<path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/>';
  let editingPlaceId = null; // 名称・滞在時間を編集中の地点 ID（一度に 1 件）
  let locateTripId = null; // 現在地の取得を試した旅行 ID（同じ旅行では 1 回だけ試す）
  const MODE_ICON = {
    car: '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>',
    train: '<path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zm0 2c3.51 0 5.44.48 5.93 1H6.07C6.56 4.48 8.49 4 12 4zM6 7h5v3H6V7zm12 0v3h-5V7h5zM7.5 17C6.67 17 6 16.33 6 15.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>',
  };
  let itinEditor = null; // しおりの編集ポップアップ（開いていないときは null）

  // 旅行を初めて開いたとき、現在地を訪問地点の先頭に登録する（名前・滞在時間は編集可能）
  function ensureCurrentLocation() {
    const local = getLocal();
    if (!local || local.currentLocationAdded || !navigator.geolocation) return;
    const tripId = state.tripId;
    if (locateTripId === tripId) return;
    locateTripId = tripId;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (state.tripId !== tripId) return; // 取得中に旅行を切り替えた場合は何もしない
        const current = getLocal();
        if (!current || current.currentLocationAdded) return;
        const lat = position.coords.latitude,
          lng = position.coords.longitude;
        if (current.places.length < T.MAX_LOCAL_PLACES && !current.places.some((place) => T.samePoint(place, { lat, lng })))
          current.places.unshift({ id: randomId(), name: "現在地", lat, lng });
        current.currentLocationAdded = true;
        await placesChanged();
      },
      () => {
        if (state.tripId === tripId)
          flash("現在地を取得できませんでした。ブラウザの位置情報の許可を確認してください", "err");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 600000 },
    );
  }

  // ルート案内リンク: 現在のタブ内で遷移（遷移前の URL と画面状態を保存してから）
  const isDirPage = () => location.pathname.startsWith("/maps/dir");
  async function openRoute(event, url) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return; // 修飾キー付きはブラウザ標準の動作
    event.preventDefault();
    const fromUrl = state.nav && isDirPage() ? state.nav.fromUrl : location.href;
    state.nav = {
      fromUrl,
      tab: state.tab,
      scroll: body.scrollTop,
      tripId: state.tripId,
      ts: Date.now(),
    };
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.nav]: state.nav });
    } catch (_) {
      flash(
        "画面状態を保存できませんでした。ルート案内の後に「元の画面に戻る」が使えない場合があります。",
        "err",
      );
    }
    location.assign(url);
  }
  async function clearNav() {
    state.nav = null;
    try {
      await chrome.storage.local.remove(STORAGE_KEYS.nav);
    } catch (_) {}
  }
  async function goBack() {
    if (!state.nav) return;
    if (
      !/^https:\/\/(www\.google\.(com|co\.jp)|maps\.google\.com)\/maps/.test(
        state.nav.fromUrl || "",
      )
    ) {
      await clearNav();
      render();
      return flash("元の画面の URL が不正なため戻れません", "err");
    }
    state.nav.back = true;
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.nav]: state.nav });
    } catch (_) {}
    location.assign(state.nav.fromUrl);
  }

  // 区間（隣り合う 2 地点）: 移動手段の切替 + Google マップのルート案内リンク
  function legView(prev, next) {
    const fromPlace = prev.place,
      toPlace = next.place;
    const setMode = async (mode) => {
      delete getLocal().legModes[fromPlace.id + ">" + toPlace.id];
      delete getLocal().legModes[toPlace.id + ">" + fromPlace.id];
      if (mode === "train") getLocal().legModes[fromPlace.id + ">" + toPlace.id] = "train";
      await saveLocal();
      render();
    };
    // この区間を各移動手段で移動した場合の目安時間（分）
    const legMinutes = (mode) => {
      if (mode === "train") {
        const known = ctx.transitMinutesOf(fromPlace, toPlace);
        if (known != null) return known;
      }
      const s = getLocal().settings;
      const speed = mode === "car" ? s.speedCar : s.speedTrain;
      const detour = mode === "car" ? s.detourCar : s.detourTrain;
      const v = speed > 0 ? speed : T.DEFAULT_SPEED[mode];
      const d = detour >= 1 ? detour : T.DEFAULT_DETOUR;
      return Math.max(1, Math.round(((next.km * d) / v) * 60));
    };
    const segmentButton = (mode) =>
      createEl(
        "button",
        {
          class: "seg seg-mode" + (next.mode === mode ? " on" : ""),
          type: "button",
          title: T.MODE_LABEL[mode],
          "aria-label": `${T.MODE_LABEL[mode]} 約${legMinutes(mode)}分`,
          onclick: async (event) => {
            // 移動手段を保存してから、その移動手段のルート案内を開く
            const url = T.mapsDirUrl(fromPlace, toPlace, mode);
            await setMode(mode);
            await openRoute(event, url);
          },
        },
        makeSvgIcon(MODE_ICON[mode], 22),
        createEl("span", { class: "seg-time" }, `${legMinutes(mode)} 分`),
      );
    return createEl(
      "div",
      { class: "leg" },
      createEl(
        "div",
        { class: "legctl" },
        segmentButton("car"),
        segmentButton("train"),
      ),
    );
  }

  function placeItem(place, index) {
    const settings = getLocal().settings;
    const editing = editingPlaceId === place.id;
    const clearMarks = () =>
      root
        .querySelectorAll(".dragging, .drop-before, .drop-after")
        .forEach((node) =>
          node.classList.remove("dragging", "drop-before", "drop-after"),
        );
    const listItem = createEl(
      "li",
      {
        ondragover: (event) => {
          if (!state.dragId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const rect = listItem.getBoundingClientRect(),
            after = event.clientY > rect.top + rect.height / 2;
          listItem.classList.toggle("drop-before", !after);
          listItem.classList.toggle("drop-after", after); // 挿入位置の表示
        },
        ondragleave: (event) => {
          if (!listItem.contains(event.relatedTarget))
            listItem.classList.remove("drop-before", "drop-after");
        },
        ondrop: (event) => {
          event.preventDefault();
          const after = listItem.classList.contains("drop-after"),
            from = state.dragId;
          clearMarks();
          state.dragId = null;
          if (from && from !== place.id) movePlace(from, place.id, after);
        },
      },
      createEl(
        "div",
        { class: "placehead" },
        createEl(
          "span",
          {
            class: "handle",
            draggable: "true",
            title: "ドラッグして並べ替え",
            ondragstart: (event) => {
              state.dragId = place.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", place.id);
              event.dataTransfer.setDragImage(listItem, 12, 12);
              listItem.classList.add("dragging");
            },
            ondragend: () => {
              state.dragId = null;
              clearMarks();
            },
          },
          "☰",
        ),
        createEl("span", { class: "idx" }, `${index + 1}.`),
        editing ? createEl("input", {
          type: "text",
          class: "pname" + (place.name === T.UNNAMED_PLACE ? " unnamed" : ""),
          value: place.name,
          maxlength: 60,
          placeholder: "地点名を入力",
          "aria-label": "地点名",
          onchange: async (event) => {
            place.name = event.target.value.trim() || T.UNNAMED_PLACE;
            await saveLocal();
            render();
          },
        })
          : createEl("span", { class: "pname-text" + (place.name === T.UNNAMED_PLACE ? " unnamed" : "") }, place.name),
        createEl(
          "button",
          {
            class: "icon-edit",
            type: "button",
            title: editing ? "編集を終了" : "名称・滞在時間を編集",
            "aria-label": `${place.name}を編集`,
            "aria-pressed": String(editing),
            onclick: () => {
              editingPlaceId = editing ? null : place.id;
              render();
            },
          },
          makeMsIcon(EDIT_ICON, 18),
        ),
        makeButton(
          "削除",
          async () => {
            getLocal().places = getLocal().places.filter((item) => item.id !== place.id);
            delete settings.stays[place.id];
            await placesChanged();
          },
          "small danger",
        ),
      ),
      place.name === T.UNNAMED_PLACE
        ? createEl(
            "div",
            { class: "hint" },
            "場所名が未設定です。名前を入力してください。",
          )
        : null,
      editing
      ? createEl(
        "div",
        { class: "row" },
        createEl(
          "label",
          {},
          "滞在(分)",
          createEl("input", {
            type: "number",
            min: 0,
            step: 5,
            value: settings.stays[place.id] ?? settings.defaultStay,
            onchange: async (event) => {
              const value = parseInt(event.target.value, 10);
              if (value >= 0) settings.stays[place.id] = value;
              else delete settings.stays[place.id];
              await saveLocal();
              render();
            },
          }),
        ),
      )
      : createEl("div", { class: "muted" }, `滞在 ${settings.stays[place.id] ?? settings.defaultStay} 分`),
    );
    return listItem;
  }

  // しおりの編集ポップアップ（地点名・到着/出発時刻・滞在時間・並べ替え）。
  // 変更は下書きとして持ち、「編集」または Enter で確定する。×・Esc・外側クリックでは破棄する。
  function openItineraryEditor() {
    if (itinEditor && itinEditor.isConnected) return;
    const base = currentItinerary();
    if (!base) return;
    const settings = getLocal().settings;
    const originalStart = T.parseTime(settings.startTime);
    let startMin = originalStart; // 先頭の地点の到着時刻（＝出発時刻）
    const basePlaces = new Map(getLocal().places.map((place) => [place.id, place]));
    const draft = base.rows.map((row) => ({
      id: row.place.id,
      name: row.place.name,
      nameDirty: false,
      stay: settings.stays[row.place.id] ?? settings.defaultStay,
      stayDirty: false,
    }));
    const hhmm = (minutes) => {
      const m = ((minutes % 1440) + 1440) % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };
    // "HH:MM" を、基準時刻と同じ日の分（通算の分）に直す
    const toAbsolute = (text, reference) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(text || "");
      if (!match) return null;
      return Math.floor(reference / 1440) * 1440 + Number(match[1]) * 60 + Number(match[2]);
    };
    // 下書きの内容で到着・出発時刻を計算し直す
    const previewRows = () => {
      const local = getLocal();
      const places = draft.map((item) => basePlaces.get(item.id)).filter(Boolean);
      const stays = {};
      draft.forEach((item) => {
        stays[item.id] = item.stay;
      });
      return T.buildItinerary(places, {
        startMin,
        speeds: { car: settings.speedCar, train: settings.speedTrain },
        detours: { car: settings.detourCar, train: settings.detourTrain },
        defaultStay: settings.defaultStay,
        stays,
        modeOf: (from, to) =>
          local.legModes[from.id + ">" + to.id] || local.legModes[to.id + ">" + from.id] || "car",
      }).rows;
    };
    // 到着時刻の変更: 先頭の地点は出発時刻そのもの。2 件目以降は、ひとつ前の地点での滞在時間を調整する
    const setArrive = (index, value, rows) => {
      if (index === 0) {
        startMin = value;
        return;
      }
      const prev = rows[index - 1],
        cur = rows[index];
      draft[index - 1].stay = Math.max(0, value - cur.travel - prev.arrive);
      draft[index - 1].stayDirty = true;
    };
    // 出発時刻の変更: その地点での滞在時間を調整する
    const setDepart = (index, value, rows) => {
      draft[index].stay = Math.max(0, value - rows[index].arrive);
      draft[index].stayDirty = true;
    };
    const listEl = createEl("ol", { class: "itin-edit-list" });
    const clearMarks = () =>
      itinEditor
        .querySelectorAll(".dragging, .drop-before, .drop-after")
        .forEach((node) => node.classList.remove("dragging", "drop-before", "drop-after"));
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      if (itinEditor) itinEditor.remove();
      itinEditor = null;
    };
    const discard = () => close();
    // 下書きを地点データと設定に反映して保存する
    const commit = async () => {
      if (!itinEditor) return;
      const local = getLocal();
      const byId = new Map(local.places.map((place) => [place.id, place]));
      draft.forEach((item) => {
        const place = byId.get(item.id);
        if (!place) return;
        if (item.nameDirty) place.name = item.name.trim() || T.UNNAMED_PLACE;
        if (item.stayDirty) {
          if (Number.isFinite(item.stay) && item.stay >= 0) settings.stays[item.id] = item.stay;
          else delete settings.stays[item.id];
        }
      });
      if (startMin !== originalStart) settings.startTime = hhmm(startMin);
      const ordered = draft.map((item) => byId.get(item.id)).filter(Boolean);
      const rest = local.places.filter((place) => !draft.some((item) => item.id === place.id));
      local.places = [...ordered, ...rest];
      close();
      await placesChanged();
    };
    const onKey = (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && itinEditor && itinEditor.querySelector(".itin-time-list.open")) {
        event.preventDefault();
        closeLists();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        discard();
      } else if (event.key === "Enter") {
        event.preventDefault();
        // 入力中の値（時刻など）を確定させてから保存する
        if (root.activeElement && root.activeElement.blur) root.activeElement.blur();
        commit();
      }
    };
    // 下書きの並べ替え（確定するまで地点データは変えない）
    const moveDraft = (fromId, toId, after) => {
      const from = draft.findIndex((item) => item.id === fromId);
      if (from < 0 || !draft.some((item) => item.id === toId)) return;
      const [moving] = draft.splice(from, 1);
      const index = draft.findIndex((item) => item.id === toId);
      draft.splice(after ? index + 1 : index, 0, moving);
      fillList();
    };
    const fillList = () => {
      const rows = previewRows();
      listEl.replaceChildren(...draft.map((item, index) => editRow(item, index, rows[index])));
    };
    const closeLists = () => {
      if (itinEditor)
        itinEditor.querySelectorAll(".itin-time-list.open").forEach((list) => list.classList.remove("open"));
    };
    // Google マップ風の時刻入力: 直接入力・◀▶で 15 分ずつ変更・30 分刻みの候補から選択
    const timeField = (current, reference, ariaLabel, onPick) => {
      const dayBase = Math.floor(reference / 1440) * 1440;
      const select = (value) => {
        onPick(value);
        fillList();
      };
      const list = createEl("ul", { class: "itin-time-list" });
      for (let t = 0; t < 1440; t += 30) {
        const value = dayBase + t;
        list.appendChild(
          createEl(
            "li",
            {
              class: value === current ? "selected" : "",
              onmousedown: (event) => event.preventDefault(), // 入力欄のフォーカスを保つ
              onclick: () => select(value),
            },
            hhmm(value),
          ),
        );
      }
      const openList = () => {
        closeLists();
        list.classList.add("open");
        const selected = list.querySelector(".selected");
        if (selected) selected.scrollIntoView({ block: "nearest" });
      };
      const input = createEl("input", {
        type: "text",
        class: "itin-time-input",
        value: hhmm(current),
        maxlength: 5,
        "aria-label": ariaLabel,
        onfocus: () => openList(),
        onblur: () => closeLists(),
        onchange: (event) => {
          const value = toAbsolute(event.target.value, reference);
          if (value === null) fillList();
          else select(value);
        },
      });
      return createEl(
        "div",
        { class: "itin-time-field" },
        createEl(
          "button",
          {
            type: "button",
            class: "itin-time-step",
            "aria-label": `${ariaLabel}を15分戻す`,
            onclick: () => select(current - 15),
          },
          "◀",
        ),
        input,
        createEl(
          "button",
          {
            type: "button",
            class: "itin-time-step",
            "aria-label": `${ariaLabel}を15分進める`,
            onclick: () => select(current + 15),
          },
          "▶",
        ),
        list,
      );
    };
    const editRow = (item, index, row) => {
      const el = createEl(
        "li",
        {
          class: "itin-edit-row",
          ondragover: (event) => {
            if (!state.dragId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = el.getBoundingClientRect(),
              after = event.clientY > rect.top + rect.height / 2;
            el.classList.toggle("drop-before", !after);
            el.classList.toggle("drop-after", after);
          },
          ondragleave: (event) => {
            if (!el.contains(event.relatedTarget))
              el.classList.remove("drop-before", "drop-after");
          },
          ondrop: (event) => {
            event.preventDefault();
            const after = el.classList.contains("drop-after"),
              from = state.dragId;
            clearMarks();
            state.dragId = null;
            if (from && from !== item.id) moveDraft(from, item.id, after);
          },
        },
        createEl(
          "span",
          {
            class: "handle",
            draggable: "true",
            title: "ドラッグして並べ替え",
            ondragstart: (event) => {
              state.dragId = item.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.id);
              event.dataTransfer.setDragImage(el, 12, 12);
              el.classList.add("dragging");
            },
            ondragend: () => {
              state.dragId = null;
              clearMarks();
            },
          },
          "☰",
        ),
        createEl("span", { class: "itin-edit-idx" }, `${index + 1}.`),
        createEl("input", {
          type: "text",
          class: "itin-name" + (item.name === T.UNNAMED_PLACE ? " unnamed" : ""),
          value: item.name,
          maxlength: 60,
          placeholder: "地点名を入力",
          "aria-label": "地点名",
          oninput: (event) => {
            item.name = event.target.value;
            item.nameDirty = true;
          },
        }),
        createEl(
          "div",
          { class: "itin-time-row" },
          createEl(
            "div",
            { class: "itin-time" },
            createEl("span", {}, "到着"),
            timeField(row.arrive, row.arrive, "到着時刻", (value) => setArrive(index, value, previewRows())),
          ),
          createEl(
            "div",
            { class: "itin-time" },
            createEl("span", {}, "出発"),
            timeField(row.depart, row.depart, "出発時刻", (value) => setDepart(index, value, previewRows())),
          ),
          createEl(
            "label",
            { class: "stay-edit" },
            "滞在(分)",
            createEl("input", {
              type: "number",
              min: 0,
              step: 5,
              value: Number.isFinite(item.stay) ? item.stay : "",
              "aria-label": "滞在時間（分）",
              oninput: (event) => {
                item.stay = parseInt(event.target.value, 10);
                item.stayDirty = true;
              },
              onchange: () => fillList(),
            }),
          ),
        ),
      );
      return el;
    };
    itinEditor = createEl(
      "div",
      {
        class: "itin-modal-backdrop",
        onclick: (event) => {
          if (event.target === itinEditor) discard();
        },
      },
      createEl(
        "div",
        { class: "itin-modal", role: "dialog", "aria-modal": "true", "aria-label": "旅のしおりの編集" },
        createEl(
          "div",
          { class: "itin-modal-head" },
          createEl("h3", {}, "旅のしおりの編集"),
          createEl(
            "button",
            { class: "itin-modal-close", type: "button", "aria-label": "閉じる", onclick: discard },
            "×",
          ),
        ),
        listEl,
        makeButton("編集", () => commit(), "primary"),
      ),
    );
    fillList();
    root.appendChild(itinEditor);
    document.addEventListener("keydown", onKey, true);
  }

  function viewRoute() {
    const gateView = gate(true);
    if (gateView) return gateView;
    const settings = getLocal().settings;
    ctx.syncAdoptedPlaces();
    ctx.ensureTransitTimes();
    ensureCurrentLocation();
    // しおりの並べ替え（訪問地点リストと同じ動き）
    const clearDragMarks = () =>
      root
        .querySelectorAll(".dragging, .drop-before, .drop-after")
        .forEach((node) => node.classList.remove("dragging", "drop-before", "drop-after"));
    const optimizeButton = makeButton(
      "訪問順を自動最適化（手動の並べ替えを上書き）",
      async () => {
        if (getLocal().places.length < 2)
          return flash("地点を 2 件以上登録してください", "err");
        getLocal().places = T.optimize(getLocal().places, 0).map((index) => getLocal().places[index]); // 先頭の地点を出発地点として固定
        await placesChanged();
        flash("先頭の地点を出発地点として、訪問順を最適化しました");
      },
      "primary",
    );
    const itinerary = currentItinerary();
    const sec3 = itinerary
      ? createEl(
          "section",
          {},
          createEl(
            "div",
            { class: "sec-head" },
            createEl("h3", {}, "旅のしおり"),
            createEl(
              "button",
              {
                class: "icon-edit",
                type: "button",
                title: "地点名・滞在時間を編集",
                "aria-label": "しおりの地点名・滞在時間を編集",
                onclick: () => openItineraryEditor(),
              },
              makeMsIcon(EDIT_ICON, 18),
            ),
          ),
          createEl(
            "ol",
            { class: "timeline" },
            itinerary.rows.map((row, index) => {
              const item = createEl(
                "li",
                {
                  ondragover: (event) => {
                    if (!state.dragId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = item.getBoundingClientRect(),
                      after = event.clientY > rect.top + rect.height / 2;
                    item.classList.toggle("drop-before", !after);
                    item.classList.toggle("drop-after", after);
                  },
                  ondragleave: (event) => {
                    if (!item.contains(event.relatedTarget))
                      item.classList.remove("drop-before", "drop-after");
                  },
                  ondrop: (event) => {
                    event.preventDefault();
                    const after = item.classList.contains("drop-after"),
                      from = state.dragId;
                    clearDragMarks();
                    state.dragId = null;
                    if (from && from !== row.place.id) movePlace(from, row.place.id, after);
                  },
                },
                index > 0 ? legView(itinerary.rows[index - 1], row) : null,
                createEl(
                  "div",
                  { class: "stop-row" },
                  createEl(
                    "span",
                    {
                      class: "handle",
                      draggable: "true",
                      title: "ドラッグして並べ替え",
                      ondragstart: (event) => {
                        state.dragId = row.place.id;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", row.place.id);
                        event.dataTransfer.setDragImage(item, 12, 12);
                        item.classList.add("dragging");
                      },
                      ondragend: () => {
                        state.dragId = null;
                        clearDragMarks();
                      },
                    },
                    "☰",
                  ),
                  createEl(
                    "div",
                    { class: "stop" },
                    createEl("b", {}, row.place.name),
                    createEl("br", {}),
                    `(${T.fmtTime(row.arrive)}〜${T.fmtTime(row.depart)})`,
                  ),
                ),
              );
              return item;
            }),
          ),
          optimizeButton,
        )
      : null;

    // 全体のルート案内（waypoints）
    const whole = T.mapsDirAllUrl(getLocal().places, settings.wholeMode, T.isMobile());
    const wseg = (mode) =>
      createEl(
        "button",
        {
          class: "seg" + (settings.wholeMode === mode ? " on" : ""),
          type: "button",
          onclick: async () => {
            settings.wholeMode = mode;
            await saveLocal();
            render();
          },
        },
        T.MODE_LABEL[mode],
      );
    const sec4 = whole
      ? createEl(
          "section",
          {},
          createEl("h3", {}, "全体のルート案内"),
          createEl(
            "div",
            { class: "legctl" },
            "全体ルートの移動手段:",
            wseg("car"),
            wseg("train"),
          ),
          createEl(
            "p",
            {},
            createEl(
              "a",
              {
                class: "bigl",
                href: whole.url,
                onclick: (event) => openRoute(event, whole.url),
              },
              "訪問地点全体のルートを Google マップで見る",
            ),
          ),
          whole.truncated
            ? createEl(
                "div",
                { class: "warn" },
                `⚠ ${T.LIMIT_WARNING}（経由地は最大 ${whole.maxWaypoints} 件）。先頭から ${whole.used} 地点までの全体ルートを案内しています。残りの ${whole.total - whole.used} 地点は、上のしおりの区間ごとのルートリンクで確認できます。`,
              )
            : null,
        )
      : null;
    return [sec3, sec4];
  }

  // ======================= 登録タブ（幹事のみ: カレンダー登録・削除） =======================
  function toLocalDT(dateStr, minutes) {
    const targetDate = T.addDays(dateStr, Math.floor(minutes / 1440)),
      minuteOfDay = minutes % 1440;
    return `${targetDate}T${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}:00`;
  }

  async function registerToCalendar() {
    if (state.regBusy) return;
    const trip = tripData(),
      settings = getLocal().settings,
      myMember = currentMember();
    const cand = T.datesOf(trip).find((date) => date.id === getLocal().confirmedId);
    if (!cand) return flash("日程を確定してください", "err");
    const itinerary = currentItinerary(),
      title = trip.meta.name,
      dateText = T.fmtRange(cand);
    const others = T.membersOf(trip).filter((member) => member.key !== myMember.key);
    const invite = settings.invite && others.length > 0;

    // description: しおり全体（各地点の到着・出発、滞在、区間の移動手段と時間、区間ごとのルートリンク、全体ルートのリンク）
    let desc = `<b>${T.escapeHtml(title)}</b><br>${T.escapeHtml(dateText)}`;
    if (itinerary) {
      desc = T.itineraryHtml(itinerary.rows, {
        title,
        dateText,
        wholeMode: settings.wholeMode,
      });
      if (desc.length > 7800) {
        // description の文字数制限に収まらない場合は、区間リンクを省く
        desc =
          T.itineraryHtml(itinerary.rows, {
            title,
            dateText,
            wholeMode: settings.wholeMode,
            withLegLinks: false,
          }) +
          "<br>※文字数の制限により、区間ごとのルート案内リンクは省略しました。";
      }
    }
    const main = {
      summary: title,
      description: desc,
      start: { date: cand.s },
      end: { date: T.addDays(cand.e, 1) },
    };
    if (itinerary) {
      const firstPlace = itinerary.rows[0].place;
      main.location = firstPlace.name === T.UNNAMED_PLACE ? `${firstPlace.lat},${firstPlace.lng}` : firstPlace.name;
    } // 最初の訪問地点
    if (invite)
      main.attendees = others.map((member) => ({
        email: member.email,
        responseStatus: "needsAction",
      }));
    const events = [{ ev: main, sendUpdates: invite ? "all" : "none" }];
    if (itinerary && settings.timed) {
      // 任意: 各地点を時刻付きの予定として幹事のカレンダーにも登録（招待はしない）
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      for (const row of itinerary.rows) {
        events.push({
          sendUpdates: "none",
          ev: {
            summary: `${title}: ${row.place.name}`,
            location:
              row.place.name === T.UNNAMED_PLACE
                ? `${row.place.lat},${row.place.lng}`
                : row.place.name,
            description: `<a href="https://www.google.com/maps?q=${row.place.lat},${row.place.lng}">Google マップで開く</a>`,
            start: { dateTime: toLocalDT(cand.s, row.arrive), timeZone: timeZone },
            end: { dateTime: toLocalDT(cand.s, row.depart), timeZone: timeZone },
          },
        });
      }
    }

    state.regBusy = true;
    state.regResults = [];
    const recs = [];
    const batch = await sendMessage({
      type: "cal:createBatch",
      events: events.map(({ ev: calendarEvent, sendUpdates }) => ({
        event: calendarEvent,
        sendUpdates,
      })),
    });
    const results = batch.ok
      ? batch.results
      : events.map(() => ({ ok: false, error: batch.error }));
    for (const [eventIndex, response] of results.entries()) {
      const calendarEvent = events[eventIndex].ev;
      state.regResults.push({ name: calendarEvent.summary, ok: response.ok, error: response.error });
      if (response.ok && response.id) {
        recs.push(
          calendarEvent.start.date
            ? {
                id: response.id,
                title: calendarEvent.summary,
                start: calendarEvent.start.date,
                end: calendarEvent.end.date,
                allDay: true,
                attendees: calendarEvent.attendees ? calendarEvent.attendees.length : 0,
              }
            : {
                id: response.id,
                title: calendarEvent.summary,
                start: calendarEvent.start.dateTime.slice(0, 16),
                end: calendarEvent.end.dateTime.slice(0, 16),
                allDay: false,
                attendees: 0,
              },
        );
      }
      if (!response.ok && /認証|client_id|401|403/.test(response.error)) break; // 認証系の失敗は打ち切り
    }
    state.regBusy = false;
    let saveErr = "";
    if (recs.length) {
      getLocal().events.push(...recs);
      if (!(await saveLocal()))
        saveErr =
          "（削除用の記録を保存できなかったため、この拡張機能からは削除できません）";
    }
    const failedCount = state.regResults.filter((result) => !result.ok).length;
    flash(
      (failedCount
        ? `${failedCount} 件の登録に失敗しました`
        : `${state.regResults.length} 件の予定を登録しました${invite ? `（${others.length} 人に招待メールを送信）` : ""}`) +
        saveErr,
      failedCount || saveErr ? "err" : "ok",
    );
    render();
  }

  Object.assign(ctx, { isDirPage, openRoute, clearNav, goBack, legView, placeItem, viewRoute, toLocalDT, registerToCalendar });
}
