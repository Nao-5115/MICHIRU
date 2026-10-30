// 「ルート」タブ（訪問順・移動手段・しおり・ルート案内）
import * as T from "../../lib.js";
import { STORAGE_KEYS, randomId } from "../constants.js";

export function installRouteTab(ctx) {
  const { state, body, flash, getLocal, saveLocal, createEl, root, movePlace, makeButton, makeMsIcon, placesChanged, gate, currentItinerary, tripData, currentMember, sendMessage } = ctx;
  const render = (...args) => ctx.render(...args);
  const ICONS = {
    pin: '<path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 400Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Zm0-80q133-132 196.5-238.5T740-552q0-117-73.5-182.5T480-800q-113 0-186.5 65.5T220-552q0 47 20 99.5T303.5-341Q347-275 480-160Zm0-392Z"/>',
    map: '<path d="m600-120-240-84-168 65q-20 8-36-4.5T140-178v-562q0-13 7.5-23t20.5-15l192-67 240 84 168-65q20-8 36 4.5t16 34.5v562q0 13-7.5 23T792-187l-192 67Zm-40-98v-468l-160-56v468l160 56Zm80 0 120-40v-474l-120 46v468Zm-420-11 120-46v-468l-120 40v474Zm420-457v468-468Zm-300-57v468-468Z"/>',
    schedule: '<path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Zm112 168L452-452v-188h56v156l124 124-40 40Z"/>',
    delete: '<path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>',
  };

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
    const segmentButton = (mode) =>
      createEl(
        "button",
        {
          class: "seg" + (next.mode === mode ? " on" : ""),
          type: "button",
          onclick: () => setMode(mode),
        },
        T.MODE_LABEL[mode],
      );
    const url = T.mapsDirUrl(fromPlace, toPlace, next.mode);
    return createEl(
      "div",
      { class: "leg" },
      createEl("div", { class: "legnames" }, `${fromPlace.name} → ${toPlace.name}`),
      `${T.fmtTime(prev.depart)}出発 → ${T.fmtTime(next.arrive)}到着（約${next.travel}分・直線${next.km.toFixed(1)}km→道路換算約${next.roadKm.toFixed(1)}km）`,
      createEl(
        "div",
        { class: "legctl" },
        segmentButton("car"),
        segmentButton("train"),
        createEl(
          "a",
          { href: url, onclick: (event) => openRoute(event, url) },
          "この区間のルートを見る",
        ),
      ),
    );
  }

  function placeItem(place, index) {
    const settings = getLocal().settings;
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
        createEl("input", {
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
        }),
        createEl("button", {
          class: "icon-delete route-delete",
          type: "button",
          title: "地点を削除",
          "aria-label": `${place.name}を削除`,
          onclick: async () => {
            getLocal().places = getLocal().places.filter((item) => item.id !== place.id);
            delete settings.stays[place.id];
            await placesChanged();
          },
        },
          makeMsIcon(ICONS.delete, 18),
        ),
      ),
      place.name === T.UNNAMED_PLACE
        ? createEl(
            "div",
            { class: "hint" },
            "場所名が未設定です。名前を入力してください。",
          )
        : null,
      createEl(
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
      ),
    );
    return listItem;
  }

  function viewRoute() {
    const gateView = gate(true);
    if (gateView) return gateView;
    const settings = getLocal().settings;
    const nameIn = createEl("input", {
      type: "text",
      placeholder: "地点名（任意）",
      maxlength: 60,
    });
    const num = (key, minValue, step) =>
      createEl("input", {
        type: "number",
        min: minValue,
        step,
        value: settings[key],
        onchange: async (event) => {
          const value = parseFloat(event.target.value);
          const valid = key.startsWith("detour")
            ? value >= 1
            : value > 0 || (key === "defaultStay" && value >= 0);
          if (valid) {
            settings[key] = value;
            await saveLocal();
            render();
          } else {
            flash(
              key.startsWith("detour")
                ? "迂回係数は 1.0 以上の数値にしてください"
                : "正しい数値を入力してください",
              "err",
            );
            event.target.value = settings[key];
          }
        },
      });
    const sec1 = createEl(
      "section",
      { class: "route-section route-stops" },
      createEl("div", { class: "route-section__head" },
        createEl("div", {},
          createEl("h3", {}, "訪問地点"),
          createEl("p", { class: "muted" }, `${getLocal().places.length} 件 · 上から順に訪問`),
        ),
        createEl("span", { class: "route-section__icon", "aria-hidden": "true" }, makeMsIcon(ICONS.pin, 22)),
      ),
      createEl("div", { class: "route-add" },
      nameIn,
      makeButton(
        "＋ この場所を追加",
        async () => {
          const latLng = T.extractLatLng(location.href);
          if (!latLng)
            return flash(
              "このページの URL から緯度経度を取得できませんでした。場所を検索・選択してからもう一度お試しください。",
              "err",
            );
          if (getLocal().places.length >= T.MAX_LOCAL_PLACES)
            return flash(
              `登録できる地点は最大 ${T.MAX_LOCAL_PLACES} 件です`,
              "err",
            );
          if (getLocal().places.some((place) => T.samePoint(place, latLng)))
            return flash("同じ地点が既に登録されています", "err");
          const typed = nameIn.value.trim(),
            found = T.extractPlaceName(location.href);
          getLocal().places.push({
            id: randomId(),
            name: typed || found || T.UNNAMED_PLACE,
            lat: latLng.lat,
            lng: latLng.lng,
          });
          await placesChanged();
          if (typed || found) flash("地点を登録しました");
          else
            flash(
              "場所名を URL から取得できなかったため「名称未設定の地点」として登録しました。一覧で名前を入力できます。",
              "err",
            );
        },
        "primary route-add__button",
      )),
      getLocal().places.length
        ? createEl("ul", { class: "list trip-list route-place-list" }, getLocal().places.map(placeItem))
        : createEl("div", { class: "route-empty" },
            createEl("span", { class: "route-empty__icon", "aria-hidden": "true" }, makeMsIcon(ICONS.map, 30)),
            createEl("b", {}, "訪問地点を追加しましょう"),
            createEl("span", { class: "muted" }, "Google マップで場所を開いて追加できます"),
          ),
    );
    const sec2 = createEl(
      "section",
      { class: "route-section route-settings" },
      createEl("div", { class: "route-section__head" },
        createEl("div", {},
          createEl("h3", {}, "しおり"),
          createEl("p", { class: "muted" }, "出発時刻と滞在時間を設定"),
        ),
        createEl("span", { class: "route-section__icon", "aria-hidden": "true" }, makeMsIcon(ICONS.schedule, 22)),
      ),
      createEl(
        "div",
        { class: "row" },
        createEl(
          "label",
          {},
          "出発時刻",
          createEl("input", {
            type: "time",
            value: settings.startTime,
            onchange: async (event) => {
              settings.startTime = event.target.value || "09:00";
              await saveLocal();
              render();
            },
          }),
        ),
        createEl("label", {}, "標準滞在(分)", num("defaultStay", 0, 5)),
      ),
      createEl("details", { class: "route-advanced" },
        createEl("summary", {}, "移動時間の詳細設定"),
      createEl(
        "div",
        { class: "row" },
        createEl("label", {}, "車の速度(km/h)", num("speedCar", 1, 1)),
        createEl("label", {}, "電車の速度(km/h)", num("speedTrain", 1, 1)),
      ),
      createEl(
        "div",
        { class: "row" },
        createEl("label", {}, "迂回係数・車", num("detourCar", 1, 0.05)),
        createEl("label", {}, "迂回係数・電車", num("detourTrain", 1, 0.05)),
      ),
      ),
      makeButton(
        "訪問順を自動で並べ替え",
        async () => {
          if (getLocal().places.length < 2)
            return flash("地点を 2 件以上登録してください", "err");
          getLocal().places = T.optimize(getLocal().places, 0).map((index) => getLocal().places[index]); // 先頭の地点を出発地点として固定
          await placesChanged();
          flash("先頭の地点を出発地点として、訪問順を最適化しました");
        },
        "primary route-optimize",
      ),
    );
    const itinerary = currentItinerary();
    const sec3 = itinerary
      ? createEl(
          "section",
          {},
          createEl("h3", {}, "旅のしおり"),
          itinerary.rows.length > 1
            ? createEl(
                "p",
                { class: "muted" },
                `総移動距離: 直線 ${itinerary.totalKm.toFixed(1)} km／道路換算 約 ${itinerary.totalRoadKm.toFixed(1)} km`,
              )
            : null,
          createEl(
            "ol",
            { class: "timeline" },
            itinerary.rows.map((row, index) =>
              createEl(
                "li",
                {},
                index > 0 ? legView(itinerary.rows[index - 1], row) : null,
                createEl(
                  "div",
                  { class: "stop" },
                  createEl("b", {}, row.place.name),
                  ` 滞在${row.stay}分 (${T.fmtTime(row.arrive)}〜${T.fmtTime(row.depart)})`,
                ),
              ),
            ),
          ),
          createEl("p", { class: "note" }, T.ESTIMATE_NOTE),
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
            { class: "muted" },
            "全体ルートでは移動手段を 1 つに決める必要があります（区間ごとの設定とは別です）。",
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
    return [sec1, sec2, sec3, sec4];
  }

  // ======================= 登録タブ（幹事のみ: カレンダー登録・削除） =======================
  function toLocalDT(dateStr, minutes) {
    const targetDate = T.addDays(dateStr, Math.floor(minutes / 1440)),
      minuteOfDay = minutes % 1440;
    return `${targetDate}T${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}:00`;
  }
  const NOTICE =
    "Google カレンダー以外のメールアドレスの参加者の場合、この通知メールが唯一の伝達手段であり、予定が自動的にその人のカレンダーに追加されることはありません。また、参加者の設定によっては、招待メール内で出欠に回答するまでカレンダーに追加されない場合があります。招待は、あなた（幹事）のメールアドレスから送信されます。";

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

  Object.assign(ctx, { isDirPage, openRoute, clearNav, goBack, legView, placeItem, viewRoute, toLocalDT, NOTICE, registerToCalendar });
}
