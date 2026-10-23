// 「ルート」タブ（訪問順・移動手段・しおり・ルート案内）
import * as T from "../../lib.js";
import { K, rid } from "../constants.js";

export function installRouteTab(c) {
  const { S, body, flash, L, saveLocal, h, root, movePlace, btn, placesChanged, gate, currentItinerary, tripData, me, send } = c;
  const render = (...args) => c.render(...args);

  // ルート案内リンク: 現在のタブ内で遷移（遷移前の URL と画面状態を保存してから）
  const isDirPage = () => location.pathname.startsWith("/maps/dir");
  async function openRoute(e, url) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
      return; // 修飾キー付きはブラウザ標準の動作
    e.preventDefault();
    const fromUrl = S.nav && isDirPage() ? S.nav.fromUrl : location.href;
    S.nav = {
      fromUrl,
      tab: S.tab,
      scroll: body.scrollTop,
      tripId: S.tripId,
      ts: Date.now(),
    };
    try {
      await chrome.storage.local.set({ [K.nav]: S.nav });
    } catch (_) {
      flash(
        "画面状態を保存できませんでした。ルート案内の後に「元の画面に戻る」が使えない場合があります。",
        "err",
      );
    }
    location.assign(url);
  }
  async function clearNav() {
    S.nav = null;
    try {
      await chrome.storage.local.remove(K.nav);
    } catch (_) {}
  }
  async function goBack() {
    if (!S.nav) return;
    if (
      !/^https:\/\/(www\.google\.(com|co\.jp)|maps\.google\.com)\/maps/.test(
        S.nav.fromUrl || "",
      )
    ) {
      await clearNav();
      render();
      return flash("元の画面の URL が不正なため戻れません", "err");
    }
    S.nav.back = true;
    try {
      await chrome.storage.local.set({ [K.nav]: S.nav });
    } catch (_) {}
    location.assign(S.nav.fromUrl);
  }

  // 区間（隣り合う 2 地点）: 移動手段の切替 + Google マップのルート案内リンク
  function legView(prev, r) {
    const a = prev.place,
      b = r.place;
    const setMode = async (mode) => {
      delete L().legModes[a.id + ">" + b.id];
      delete L().legModes[b.id + ">" + a.id];
      if (mode === "train") L().legModes[a.id + ">" + b.id] = "train";
      await saveLocal();
      render();
    };
    const seg = (mode) =>
      h(
        "button",
        {
          class: "seg" + (r.mode === mode ? " on" : ""),
          type: "button",
          onclick: () => setMode(mode),
        },
        T.MODE_LABEL[mode],
      );
    const url = T.mapsDirUrl(a, b, r.mode);
    return h(
      "div",
      { class: "leg" },
      h("div", { class: "legnames" }, `${a.name} → ${b.name}`),
      `${T.fmtTime(prev.depart)}出発 → ${T.fmtTime(r.arrive)}到着（約${r.travel}分・直線${r.km.toFixed(1)}km→道路換算約${r.roadKm.toFixed(1)}km）`,
      h(
        "div",
        { class: "legctl" },
        seg("car"),
        seg("train"),
        h(
          "a",
          { href: url, onclick: (e) => openRoute(e, url) },
          "この区間のルートを見る",
        ),
      ),
    );
  }

  function placeItem(p, i) {
    const st = L().settings;
    const clearMarks = () =>
      root
        .querySelectorAll(".dragging, .drop-before, .drop-after")
        .forEach((n) =>
          n.classList.remove("dragging", "drop-before", "drop-after"),
        );
    const li = h(
      "li",
      {
        ondragover: (e) => {
          if (!S.dragId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const r = li.getBoundingClientRect(),
            after = e.clientY > r.top + r.height / 2;
          li.classList.toggle("drop-before", !after);
          li.classList.toggle("drop-after", after); // 挿入位置の表示
        },
        ondragleave: (e) => {
          if (!li.contains(e.relatedTarget))
            li.classList.remove("drop-before", "drop-after");
        },
        ondrop: (e) => {
          e.preventDefault();
          const after = li.classList.contains("drop-after"),
            from = S.dragId;
          clearMarks();
          S.dragId = null;
          if (from && from !== p.id) movePlace(from, p.id, after);
        },
      },
      h(
        "div",
        { class: "placehead" },
        h(
          "span",
          {
            class: "handle",
            draggable: "true",
            title: "ドラッグして並べ替え",
            ondragstart: (e) => {
              S.dragId = p.id;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", p.id);
              e.dataTransfer.setDragImage(li, 12, 12);
              li.classList.add("dragging");
            },
            ondragend: () => {
              S.dragId = null;
              clearMarks();
            },
          },
          "☰",
        ),
        h("span", { class: "idx" }, `${i + 1}.`),
        h("input", {
          type: "text",
          class: "pname" + (p.name === T.UNNAMED_PLACE ? " unnamed" : ""),
          value: p.name,
          maxlength: 60,
          placeholder: "地点名を入力",
          "aria-label": "地点名",
          onchange: async (e) => {
            p.name = e.target.value.trim() || T.UNNAMED_PLACE;
            await saveLocal();
            render();
          },
        }),
        btn(
          "削除",
          async () => {
            L().places = L().places.filter((x) => x.id !== p.id);
            delete st.stays[p.id];
            await placesChanged();
          },
          "small danger",
        ),
      ),
      p.name === T.UNNAMED_PLACE
        ? h(
            "div",
            { class: "hint" },
            "場所名が未設定です。名前を入力してください。",
          )
        : null,
      h(
        "div",
        { class: "muted" },
        `座標: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
      ),
      h(
        "div",
        { class: "row" },
        h(
          "label",
          {},
          "滞在(分)",
          h("input", {
            type: "number",
            min: 0,
            step: 5,
            value: st.stays[p.id] ?? st.defaultStay,
            onchange: async (e) => {
              const v = parseInt(e.target.value, 10);
              if (v >= 0) st.stays[p.id] = v;
              else delete st.stays[p.id];
              await saveLocal();
              render();
            },
          }),
        ),
      ),
    );
    return li;
  }

  function viewRoute() {
    const g = gate(true);
    if (g) return g;
    const st = L().settings;
    const nameIn = h("input", {
      type: "text",
      placeholder: "地点名（空欄なら URL から自動取得）",
      maxlength: 60,
    });
    const num = (key, min, step) =>
      h("input", {
        type: "number",
        min,
        step,
        value: st[key],
        onchange: async (e) => {
          const v = parseFloat(e.target.value);
          const valid = key.startsWith("detour")
            ? v >= 1
            : v > 0 || (key === "defaultStay" && v >= 0);
          if (valid) {
            st[key] = v;
            await saveLocal();
            render();
          } else {
            flash(
              key.startsWith("detour")
                ? "迂回係数は 1.0 以上の数値にしてください"
                : "正しい数値を入力してください",
              "err",
            );
            e.target.value = st[key];
          }
        },
      });
    const sec1 = h(
      "section",
      {},
      h("h3", {}, "訪問地点（上から順に訪問）"),
      h(
        "p",
        { class: "muted" },
        "訪問地点・しおり・移動手段は、あなた（幹事）のローカルにのみ保存されます。確定後はカレンダー予定でメンバーに共有します。",
      ),
      h(
        "p",
        { class: "muted" },
        "☰ をドラッグすると並べ替えられます（先頭が出発地点）。投票タブで採用した地点の取り込みのほか、Google マップで場所を開いて直接登録もできます。",
      ),
      nameIn,
      btn(
        "現在のページの地点を登録",
        async () => {
          const ll = T.extractLatLng(location.href);
          if (!ll)
            return flash(
              "このページの URL から緯度経度を取得できませんでした。場所を検索・選択してからもう一度お試しください。",
              "err",
            );
          if (L().places.length >= T.MAX_LOCAL_PLACES)
            return flash(
              `登録できる地点は最大 ${T.MAX_LOCAL_PLACES} 件です`,
              "err",
            );
          if (L().places.some((p) => T.samePoint(p, ll)))
            return flash("同じ地点が既に登録されています", "err");
          const typed = nameIn.value.trim(),
            found = T.extractPlaceName(location.href);
          L().places.push({
            id: rid(),
            name: typed || found || T.UNNAMED_PLACE,
            lat: ll.lat,
            lng: ll.lng,
          });
          await placesChanged();
          if (typed || found) flash("地点を登録しました");
          else
            flash(
              "場所名を URL から取得できなかったため「名称未設定の地点」として登録しました。一覧で名前を入力できます。",
              "err",
            );
        },
        "primary",
      ),
      L().places.length
        ? h("ul", { class: "list" }, L().places.map(placeItem))
        : h("p", { class: "muted" }, "登録済みの地点はありません。"),
    );
    const sec2 = h(
      "section",
      {},
      h("h3", {}, "しおりの設定"),
      h(
        "div",
        { class: "row" },
        h(
          "label",
          {},
          "出発時刻",
          h("input", {
            type: "time",
            value: st.startTime,
            onchange: async (e) => {
              st.startTime = e.target.value || "09:00";
              await saveLocal();
              render();
            },
          }),
        ),
        h("label", {}, "標準滞在(分)", num("defaultStay", 0, 5)),
      ),
      h(
        "div",
        { class: "row" },
        h("label", {}, "車の速度(km/h)", num("speedCar", 1, 1)),
        h("label", {}, "電車の速度(km/h)", num("speedTrain", 1, 1)),
      ),
      h(
        "div",
        { class: "row" },
        h("label", {}, "迂回係数・車", num("detourCar", 1, 0.05)),
        h("label", {}, "迂回係数・電車", num("detourTrain", 1, 0.05)),
      ),
      h(
        "p",
        { class: "muted" },
        "移動時間 = 直線距離 × 迂回係数 ÷ 想定速度。迂回係数は直線距離を道路・路線に沿った距離へ近づける倍率です。",
      ),
      btn(
        "訪問順を自動最適化（手動の並べ替えを上書き）",
        async () => {
          if (L().places.length < 2)
            return flash("地点を 2 件以上登録してください", "err");
          L().places = T.optimize(L().places, 0).map((i) => L().places[i]); // 先頭の地点を出発地点として固定
          await placesChanged();
          flash("先頭の地点を出発地点として、訪問順を最適化しました");
        },
        "primary",
      ),
    );
    const it = currentItinerary();
    const sec3 = it
      ? h(
          "section",
          {},
          h("h3", {}, "旅のしおり"),
          it.rows.length > 1
            ? h(
                "p",
                { class: "muted" },
                `総移動距離: 直線 ${it.totalKm.toFixed(1)} km／道路換算 約 ${it.totalRoadKm.toFixed(1)} km`,
              )
            : null,
          h(
            "ol",
            { class: "timeline" },
            it.rows.map((r, i) =>
              h(
                "li",
                {},
                i > 0 ? legView(it.rows[i - 1], r) : null,
                h(
                  "div",
                  { class: "stop" },
                  h("b", {}, r.place.name),
                  ` 滞在${r.stay}分 (${T.fmtTime(r.arrive)}〜${T.fmtTime(r.depart)})`,
                ),
              ),
            ),
          ),
          h("p", { class: "note" }, T.ESTIMATE_NOTE),
        )
      : null;

    // 全体のルート案内（waypoints）
    const whole = T.mapsDirAllUrl(L().places, st.wholeMode, T.isMobile());
    const wseg = (mode) =>
      h(
        "button",
        {
          class: "seg" + (st.wholeMode === mode ? " on" : ""),
          type: "button",
          onclick: async () => {
            st.wholeMode = mode;
            await saveLocal();
            render();
          },
        },
        T.MODE_LABEL[mode],
      );
    const sec4 = whole
      ? h(
          "section",
          {},
          h("h3", {}, "全体のルート案内"),
          h(
            "div",
            { class: "legctl" },
            "全体ルートの移動手段:",
            wseg("car"),
            wseg("train"),
          ),
          h(
            "p",
            { class: "muted" },
            "全体ルートでは移動手段を 1 つに決める必要があります（区間ごとの設定とは別です）。",
          ),
          h(
            "p",
            {},
            h(
              "a",
              {
                class: "bigl",
                href: whole.url,
                onclick: (e) => openRoute(e, whole.url),
              },
              "訪問地点全体のルートを Google マップで見る",
            ),
          ),
          whole.truncated
            ? h(
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
  function toLocalDT(dateStr, min) {
    const d = T.addDays(dateStr, Math.floor(min / 1440)),
      m = min % 1440;
    return `${d}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
  }
  const NOTICE =
    "Google カレンダー以外のメールアドレスの参加者の場合、この通知メールが唯一の伝達手段であり、予定が自動的にその人のカレンダーに追加されることはありません。また、参加者の設定によっては、招待メール内で出欠に回答するまでカレンダーに追加されない場合があります。招待は、あなた（幹事）のメールアドレスから送信されます。";

  async function registerToCalendar() {
    if (S.regBusy) return;
    const d = tripData(),
      st = L().settings,
      m = me();
    const cand = T.datesOf(d).find((x) => x.id === L().confirmedId);
    if (!cand) return flash("日程を確定してください", "err");
    const it = currentItinerary(),
      title = d.meta.name,
      dateText = T.fmtRange(cand);
    const others = T.membersOf(d).filter((x) => x.key !== m.key);
    const invite = st.invite && others.length > 0;

    // description: しおり全体（各地点の到着・出発、滞在、区間の移動手段と時間、区間ごとのルートリンク、全体ルートのリンク）
    let desc = `<b>${T.escapeHtml(title)}</b><br>${T.escapeHtml(dateText)}`;
    if (it) {
      desc = T.itineraryHtml(it.rows, {
        title,
        dateText,
        wholeMode: st.wholeMode,
      });
      if (desc.length > 7800) {
        // description の文字数制限に収まらない場合は、区間リンクを省く
        desc =
          T.itineraryHtml(it.rows, {
            title,
            dateText,
            wholeMode: st.wholeMode,
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
    if (it) {
      const f = it.rows[0].place;
      main.location = f.name === T.UNNAMED_PLACE ? `${f.lat},${f.lng}` : f.name;
    } // 最初の訪問地点
    if (invite)
      main.attendees = others.map((x) => ({
        email: x.email,
        responseStatus: "needsAction",
      }));
    const events = [{ ev: main, sendUpdates: invite ? "all" : "none" }];
    if (it && st.timed) {
      // 任意: 各地点を時刻付きの予定として幹事のカレンダーにも登録（招待はしない）
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      for (const r of it.rows) {
        events.push({
          sendUpdates: "none",
          ev: {
            summary: `${title}: ${r.place.name}`,
            location:
              r.place.name === T.UNNAMED_PLACE
                ? `${r.place.lat},${r.place.lng}`
                : r.place.name,
            description: `<a href="https://www.google.com/maps?q=${r.place.lat},${r.place.lng}">Google マップで開く</a>`,
            start: { dateTime: toLocalDT(cand.s, r.arrive), timeZone: tz },
            end: { dateTime: toLocalDT(cand.s, r.depart), timeZone: tz },
          },
        });
      }
    }

    S.regBusy = true;
    S.regResults = [];
    const recs = [];
    const batch = await send({
      type: "cal:createBatch",
      events: events.map(({ ev, sendUpdates }) => ({
        event: ev,
        sendUpdates,
      })),
    });
    const results = batch.ok
      ? batch.results
      : events.map(() => ({ ok: false, error: batch.error }));
    for (const [index, res] of results.entries()) {
      const ev = events[index].ev;
      S.regResults.push({ name: ev.summary, ok: res.ok, error: res.error });
      if (res.ok && res.id) {
        recs.push(
          ev.start.date
            ? {
                id: res.id,
                title: ev.summary,
                start: ev.start.date,
                end: ev.end.date,
                allDay: true,
                attendees: ev.attendees ? ev.attendees.length : 0,
              }
            : {
                id: res.id,
                title: ev.summary,
                start: ev.start.dateTime.slice(0, 16),
                end: ev.end.dateTime.slice(0, 16),
                allDay: false,
                attendees: 0,
              },
        );
      }
      if (!res.ok && /認証|client_id|401|403/.test(res.error)) break; // 認証系の失敗は打ち切り
    }
    S.regBusy = false;
    let saveErr = "";
    if (recs.length) {
      L().events.push(...recs);
      if (!(await saveLocal()))
        saveErr =
          "（削除用の記録を保存できなかったため、この拡張機能からは削除できません）";
    }
    const ng = S.regResults.filter((r) => !r.ok).length;
    flash(
      (ng
        ? `${ng} 件の登録に失敗しました`
        : `${S.regResults.length} 件の予定を登録しました${invite ? `（${others.length} 人に招待メールを送信）` : ""}`) +
        saveErr,
      ng || saveErr ? "err" : "ok",
    );
    render();
  }

  Object.assign(c, { isDirPage, openRoute, clearNav, goBack, legView, placeItem, viewRoute, toLocalDT, NOTICE, registerToCalendar });
}
