// 「ルート」タブ（訪問順・移動手段・しおり・ルート案内）
import * as T from "../../lib.js";
import { STORAGE_KEYS, randomId } from "../constants.js";

export function installRouteTab(ctx) {
  const { state, body, flash, getLocal, saveLocal, createEl, root, movePlace, makeButton, makeMsIcon, placesChanged, gate, currentItinerary, tripData, currentMember, sendMessage } = ctx;
  const render = (...args) => ctx.render(...args);
  const EDIT_ICON = '<path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/>';
  let editingPlaceId = null; // 名称・滞在時間を編集中の地点 ID（一度に 1 件）
  let locateTripId = null; // 現在地の取得を試した旅行 ID（同じ旅行では 1 回だけ試す）

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

  function viewRoute() {
    const gateView = gate(true);
    if (gateView) return gateView;
    const settings = getLocal().settings;
    ctx.syncAdoptedPlaces();
    ensureCurrentLocation();
    const sec1 = createEl(
      "section",
      {},
      createEl("h3", {}, "訪問地点（上から順に訪問）"),
      createEl(
        "ul",
        { class: "list trip-list trip-list-divider", "aria-hidden": "true" },
        createEl("li", {}),
      ),
      getLocal().places.length
        ? createEl("ul", { class: "list trip-list" }, getLocal().places.map(placeItem))
        : createEl("p", { class: "muted" }, "登録済みの地点はありません。"),
    );
    const sec2 = createEl(
      "section",
      {},
      createEl("h3", {}, "しおりの設定"),
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
      ),
      makeButton(
        "訪問順を自動最適化（手動の並べ替えを上書き）",
        async () => {
          if (getLocal().places.length < 2)
            return flash("地点を 2 件以上登録してください", "err");
          getLocal().places = T.optimize(getLocal().places, 0).map((index) => getLocal().places[index]); // 先頭の地点を出発地点として固定
          await placesChanged();
          flash("先頭の地点を出発地点として、訪問順を最適化しました");
        },
        "primary",
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
