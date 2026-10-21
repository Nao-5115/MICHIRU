// Google マップ上に重ねて表示するサイドパネル（Shadow DOM で独立。マップの DOM には依存しない）
//
// データの置き場所:
//  ・Firebase（リアルタイム共有）: メンバー・候補日・出欠・候補地点・投票・採用した地点  → offscreen.js が接続し、chrome.storage.local の fb:* に中継
//  ・chrome.storage.local（幹事のローカルのみ）: 訪問地点・しおり設定・区間ごとの移動手段・確定日程・登録済みカレンダー予定 → local:<旅行ID>
import * as T from "./lib.js";

const K = {
  cur: "app:currentTripId",
  nav: "app:nav",
  auth: "fb:auth",
  trips: "fb:trips",
  trip: "fb:trip",
  spots: "fb:spots",
};
const lk = (id) => "local:" + id;
const rid = () => Math.random().toString(36).slice(2, 10);

const DEF_LOCAL = () => ({
  places: [],
  legModes: {},
  confirmedId: null,
  events: [],
  settings: {
    speedCar: 40,
    speedTrain: 35,
    detourCar: 1.3,
    detourTrain: 1.3,
    startTime: "09:00",
    defaultStay: 60,
    stays: {},
    wholeMode: "car",
    invite: true,
    timed: false,
  },
});

function main() {
  if (document.getElementById("tripassist-host")) return;

  const S = {
    tab: "trip",
    open: false,
    auth: { state: "unknown" },
    trips: [],
    trip: null,
    tripId: null,
    local: null,
    nav: null,
    spots: null,
    spotsError: "",
    events: null,
    dragId: null,
    pendingScroll: null,
    selDel: new Set(),
    delResults: null,
    regResults: null,
    regBusy: false,
    geo: null,
    ghost: true,
  };
  const L = () => S.local;
  const SPOT_CATEGORIES = [
    "観光スポット",
    "飲食店",
    "穴場スポット",
    "カフェ",
    "ショッピング",
    "自然・景色",
    "その他",
  ];
  const SPOT_COLORS = {
    観光スポット: "#1a73e8",
    飲食店: "#e53935",
    穴場スポット: "#7b1fa2",
    カフェ: "#f57c00",
    ショッピング: "#0097a7",
    "自然・景色": "#388e3c",
    その他: "#616161",
  };
  const SPOT_ICONS = {
    "観光スポット": { label: "観光", svg: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>' },
    "飲食店":     { label: "飲食",  svg: '<path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>' },
    "穴場スポット": { label: "穴場",  svg: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49 3.49-7.51-7.51 3.49-3.49 7.51zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1-1.1-.49-1.1-1.1.49-1.1 1.1-1.1z"/>' },
    "カフェ":     { label: "カフェ", svg: '<path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>' },
    "ショッピング": { label: "ショッピング", svg: '<path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h12c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm0 10c-2.21 0-4-1.79-4-4h2c0 1.1.9 2 2 2s2-.9 2-2h2c0 2.21-1.79 4-4 4z"/>' },
    "自然・景色": { label: "自然",  svg: '<path d="M17 12h2L12 2 5.05 12H7l-3.9 6h8.45V22h1.1v-4H21L17 12zm-9.24 4l2.99-4.52.25-.38.25.38L14.24 16H7.76z"/>' },
    "その他":     { label: "その他", svg: '<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>' },
  };
  function makeSvgIcon(svgPath, size = 22) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "currentColor");
    svg.innerHTML = svgPath;
    return svg;
  }
  // Material Symbols 用（viewBox: 0 -960 960 960）
  function makeMsIcon(svgPath, size = 22) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "currentColor");
    svg.innerHTML = svgPath;
    return svg;
  }
  const MS_GROUP_PATH = '<path d="M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v63H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100.5 15T325-320ZM160-440q-33 0-56.5-23.5T80-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-440Zm640 0q-33 0-56.5-23.5T720-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-440Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-80q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560Zm1 240Zm-1-280Z"/>';


  // ---------- 旅行データ（Firebase 由来）の取り出し ----------
  const tripData = () =>
    S.trip && S.trip.id === S.tripId ? S.trip.data : null;
  const me = () =>
    S.auth.state === "signedIn"
      ? { uid: S.auth.uid, email: S.auth.email, key: T.emailKey(S.auth.email) }
      : null;
  const isOwner = () => {
    const d = tripData(),
      m = me();
    return !!(d && d.meta && m && d.meta.ownerUid === m.uid);
  };

  // ---------- DOM ヘルパ（textContent のみ使用） ----------
  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false)
        e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  const btn = (label, onclick, cls = "") =>
    h("button", { class: "btn " + cls, type: "button", onclick }, label);

  // ---------- パネル位置・サイズ・半透明 ----------
  const MIN_W = 300, MIN_H = 240;
  const defaultGeo = () => {
    const w = Math.min(380, innerWidth);
    return { x: innerWidth - w - 12, y: 12, w, h: innerHeight - 24 };
  };
  function clampGeo(g) {
    const w = Math.min(Math.max(g.w, MIN_W), innerWidth),
          h = Math.min(Math.max(g.h, MIN_H), innerHeight);
    return { w, h, x: Math.min(Math.max(g.x, 0), innerWidth - w), y: Math.min(Math.max(g.y, 0), innerHeight - h) };
  }
  function applyGeo() {
    const g = (S.geo = clampGeo(S.geo || defaultGeo()));
    Object.assign(panel.style, { left: g.x + "px", top: g.y + "px", width: g.w + "px", height: g.h + "px", right: "auto" });
  }
  async function saveUi() {
    try { await chrome.storage.local.set({ ui: { geo: S.geo, ghost: S.ghost } }); } catch (_) {}
  }
  async function loadUi() {
    try {
      const { ui } = await chrome.storage.local.get("ui");
      if (ui) { S.geo = ui.geo || null; S.ghost = ui.ghost !== false; }
    } catch (_) {}
  }
  function applyGhost() {
    panel.classList.toggle("ghost", S.ghost);
    ghostBtn.style.opacity = S.ghost ? 1 : 0.5;
  }
  function startDrag(e) {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    const el = e.currentTarget, sx = e.clientX, sy = e.clientY, g0 = { ...S.geo };
    el.setPointerCapture(e.pointerId);
    const move = (ev) => { S.geo = { ...g0, x: g0.x + ev.clientX - sx, y: g0.y + ev.clientY - sy }; applyGeo(); };
    const up = () => { el.removeEventListener("pointermove", move); saveUi(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
    el.addEventListener("pointercancel", up, { once: true });
  }
  function startResize(e, dir) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget, sx = e.clientX, sy = e.clientY, g0 = { ...S.geo };
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h } = g0;
      if (dir.includes("e")) w = g0.w + dx;
      if (dir.includes("s")) h = g0.h + dy;
      if (dir.includes("w")) { w = g0.w - dx; x = g0.x + dx; }
      if (dir.includes("n")) { h = g0.h - dy; y = g0.y + dy; }
      if (w < MIN_W) { if (dir.includes("w")) x -= MIN_W - w; w = MIN_W; }
      if (h < MIN_H) { if (dir.includes("n")) y -= MIN_H - h; h = MIN_H; }
      S.geo = { x, y, w, h }; applyGeo();
    };
    const up = () => { el.removeEventListener("pointermove", move); saveUi(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
    el.addEventListener("pointercancel", up, { once: true });
  }
  window.addEventListener("resize", () => { if (S.open) applyGeo(); });

  const host = h("div", { id: "tripassist-host" });
  const root = host.attachShadow({ mode: "open" });
  const statusEl = h("div", { class: "status", hidden: true });
  const body = h("div", { class: "body" });
  const tabsEl = h("div", { class: "tabs" });
  const navBar = h("div", { class: "navbar", hidden: true });
  const subEl = h("span", { class: "sub" });
  const ghostBtn = btn("👻", () => { S.ghost = !S.ghost; applyGhost(); saveUi(); }, "icon");
  ghostBtn.title = "離れたら半透明（オン/オフ）";
  ghostBtn.setAttribute("aria-label", "半透明モードの切り替え");
  const panel = h(
    "div",
    { class: "panel", hidden: true },
    h(
      "div",
      { class: "head", onpointerdown: startDrag },
      h("div", { class: "head-left" },
        h("img", {
          src: chrome.runtime.getURL("michiru-logo.png"),
          class: "head-logo",
          alt: "MICHIRU",
        }),
        subEl,
      ),
      h("span", {}, ghostBtn, btn("×", () => toggle(false), "icon")),
    ),
    navBar,
    tabsEl,
    statusEl,
    body,
    ...["n","s","e","w","ne","nw","se","sw"].map((d) =>
      h("div", { class: "grip " + d, onpointerdown: (e) => startResize(e, d) })
    ),
  );
  const fab = h(
    "button",
    {
      class: "fab",
      type: "button",
      title: "旅行アシストを開く",
      onclick: () => toggle(true),
    },
    "旅",
  );
  root.append(
    h("link", { rel: "stylesheet", href: chrome.runtime.getURL("panel.css") }),
panel,
    fab,
  );
  document.documentElement.append(host);

  let flashTimer;
  function flash(text, type = "ok") {
    statusEl.textContent = text;
    statusEl.className = "status " + type;
    statusEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (statusEl.hidden = true), 9000);
  }
  function toggle(open) {
    S.open = open;
    panel.hidden = !open;
    fab.hidden = open;
    if (open) { applyGeo(); applyGhost(); render(); }
  }

  // ---------- 再描画（他のメンバーの更新で入力中の欄を壊さない） ----------
  let dirty = false;
  const editing = () => {
    const a = root.activeElement;
    return (
      !!a &&
      ["SELECT", "INPUT", "TEXTAREA"].includes(a.tagName) &&
      !["checkbox", "radio", "button"].includes(a.type)
    );
  };
  function scheduleRender(remote = false) {
    if (!S.open) return;
    if (remote && editing()) {
      dirty = true;
      return;
    }
    render();
  }
  root.addEventListener("focusout", () => {
    if (dirty)
      setTimeout(() => {
        if (!editing()) render();
      }, 0);
  });

  // ---------- 拡張機能内メッセージ ----------
  async function send(msg) {
    try {
      const r = await chrome.runtime.sendMessage(msg);
      if (!r) throw new Error("応答がありません");
      return r;
    } catch (e) {
      const m = String(e.message || e);
      return {
        ok: false,
        error: /context invalidated/i.test(m)
          ? "拡張機能が更新されました。ページを再読み込みしてください。"
          : m,
      };
    }
  }
  // Firebase 操作（offscreen.js が処理）。offscreen が無い場合は作り直して 1 回だけ再試行する
  const NO_RECEIVER =
    /Receiving end does not exist|Could not establish connection|message port closed|応答がありません/i;
  async function fb(op, args = {}) {
    let r = await send({ type: "fb:" + op, ...args });
    if (!r.ok && NO_RECEIVER.test(r.error || "")) {
      await send({ type: "app:ensure" });
      await new Promise((res) => setTimeout(res, 400));
      r = await send({ type: "fb:" + op, ...args });
      if (!r.ok && NO_RECEIVER.test(r.error || "")) {
        r = {
          ok: false,
          error:
            "Firebase との接続を開始できませんでした。拡張機能を再読み込みして、もう一度お試しください。",
        };
      }
    }
    return r;
  }
  async function act(op, args, okMsg) {
    const r = await fb(op, args);
    flash(r.ok ? okMsg : r.error, r.ok ? "ok" : "err");
    return r;
  }

  // ---------- ローカル保存（幹事のみ使用: 訪問地点・しおり・移動手段など） ----------
  function applyLocal(v) {
    const base = DEF_LOCAL();
    v = v || {};
    S.local = {
      ...base,
      ...v,
      settings: { ...base.settings, ...(v.settings || {}) },
    };
    for (const k of Object.keys(S.local.legModes))
      if (S.local.legModes[k] !== "train") delete S.local.legModes[k];
  }
  async function loadLocal() {
    if (!S.tripId) {
      S.local = null;
      return;
    }
    const d = await chrome.storage.local.get(lk(S.tripId));
    applyLocal(d[lk(S.tripId)]);
  }
  async function saveLocal() {
    if (!S.tripId || !S.local) return false;
    try {
      await chrome.storage.local.set({ [lk(S.tripId)]: S.local });
      return true;
    } catch (e) {
      flash("保存に失敗しました: " + e.message, "err");
      return false;
    }
  }
  async function selectTrip(id) {
    S.tripId = id || null;
    S.trip = null;
    S.events = null;
    S.regResults = null;
    S.delResults = null;
    S.selDel.clear();
    if (id) await chrome.storage.local.set({ [K.cur]: id });
    else await chrome.storage.local.remove(K.cur);
    await loadLocal();
    fb("watchTrip", { tripId: id || null }); // 開いた旅行を同期（招待された人は、ここで「参加済み」になる）
    render();
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch[K.auth]) S.auth = ch[K.auth].newValue || { state: "signedOut" };
    if (ch[K.trips]) S.trips = (ch[K.trips].newValue || {}).list || [];
    if (ch[K.trip]) S.trip = ch[K.trip].newValue || null;
    if (ch[K.spots]) {
      const value = ch[K.spots].newValue || {};
      S.spots = value.list || [];
      S.spotsError = value.error || "";
      updateOverlay();
    }
    if (ch[K.cur]) {
      const id = ch[K.cur].newValue || null;
      if (id !== S.tripId) {
        // 別のタブで旅行が切り替えられた
        S.tripId = id;
        if (!(S.trip && S.trip.id === id)) S.trip = null;
        loadLocal().then(() => scheduleRender(true));
        return;
      }
    }
    if (S.tripId && ch[lk(S.tripId)]) applyLocal(ch[lk(S.tripId)].newValue);
    scheduleRender(true);
  });

  // ---------- 共通部品 ----------
  function signinCard() {
    const a = S.auth;
    return h(
      "section",
      {},
      h("h3", {}, "サインイン"),
      a.state === "error" ? h("p", { class: "warn" }, a.error) : null,
      a.state === "unknown"
        ? h(
            "p",
            { class: "muted" },
            "Firebase に接続しています…（しばらく待っても変わらない場合は、拡張機能を再読み込みしてください）",
          )
        : null,
      h(
        "p",
        { class: "muted" },
        "旅行のデータを友達とリアルタイムに共有するため、Google アカウントでサインインします。",
      ),
      btn(
        "Google でサインイン",
        async () => {
          flash("サインイン中…");
          const r = await fb("signIn");
          flash(r.ok ? "サインインしました" : r.error, r.ok ? "ok" : "err");
        },
        "primary",
      ),
    );
  }
  // 画面を出せない状態（未サインイン・旅行未選択・同期中・権限なし）の案内。出せるなら null
  function gate(needOwner = false) {
    if (S.auth.state !== "signedIn") return [signinCard()];
    if (!S.tripId)
      return [
        h(
          "p",
          { class: "muted" },
          "「旅行」タブで旅行を選択、または新規作成してください。",
        ),
      ];
    const t = S.trip && S.trip.id === S.tripId ? S.trip : null;
    if (!t)
      return [h("p", { class: "muted" }, "旅行のデータを同期しています…")];
    if (!t.data) {
      return [
        h(
          "section",
          {},
          h(
            "p",
            { class: "warn" },
            t.error || "この旅行は削除されたか、アクセス権がありません。",
          ),
          btn("旅行の選択を解除", () => selectTrip(null)),
        ),
      ];
    }
    if (!S.local) return [h("p", { class: "muted" }, "読み込み中…")];
    if (needOwner && !isOwner()) {
      return [
        h(
          "section",
          {},
          h(
            "p",
            { class: "muted" },
            "この機能は幹事のみ利用できます。訪問地点・しおり・移動手段は幹事のローカルにのみ保存され、確定後はカレンダーの招待で共有されます。",
          ),
        ),
      ];
    }
    return null;
  }

  async function refreshEvents(manual) {
    const ds = T.datesOf(tripData());
    if (!ds.length) {
      if (manual) flash("候補日がありません", "err");
      return;
    }
    const min = ds.map((c) => c.s).sort()[0];
    const max = T.addDays(
      ds
        .map((c) => c.e)
        .sort()
        .pop(),
      1,
    );
    const r = await send({
      type: "cal:list",
      timeMin: new Date(min + "T00:00:00").toISOString(),
      timeMax: new Date(max + "T00:00:00").toISOString(),
    });
    if (!r.ok) {
      flash(r.error, "err");
      return;
    }
    S.events = r.items;
    flash(`カレンダーの予定を ${r.items.length} 件読み込みました`);
    render();
  }
  const warnFor = (c) => {
    if (!S.events) return null;
    const cf = T.conflicts(c, S.events);
    if (!cf.length) return null;
    return h(
      "div",
      { class: "warn" },
      "⚠ この日は既に予定が入っています",
      h(
        "ul",
        {},
        cf.slice(0, 4).map((e) => h("li", {}, e.summary)),
      ),
    );
  };

  // ======================= 旅行タブ =======================
  function viewTrip() {
    if (S.auth.state !== "signedIn") return [signinCard()];
    const m = me();
    const nameIn = h("input", {
      type: "text",
      placeholder: "新しい旅行の名前（例: 箱根旅行）",
      maxlength: 60,
    });
    const secUser = h(
      "section",
      {},
      h(
        "div",
        { class: "line" },
        h("span", { class: "muted" }, `サインイン中: ${m.email}`),
        btn(
          "サインアウト",
          async () => {
            const r = await fb("signOut");
            if (!r.ok) flash(r.error, "err");
          },
          "small",
        ),
      ),
    );
    const secList = h(
      "section",
      {},
      h("h3", {}, "旅行の一覧"),
      S.trips.length
        ? h(
            "ul",
            { class: "list" },
            S.trips.map((t) =>
              h(
                "li",
                { class: t.id === S.tripId ? "sel" : "" },
                h(
                  "div",
                  { class: "line" },
                  h(
                    "div",
                    {},
                    h("b", {}, t.name),
                    h(
                      "div",
                      { class: "muted" },
                      t.ownerEmail === m.email
                        ? "幹事: あなた"
                        : `幹事: ${t.ownerEmail}`,
                    ),
                  ),
                  h(
                    "div",
                    {},
                    t.id === S.tripId
                      ? h("span", { class: "badge ok" }, "表示中")
                      : btn("開く", () => selectTrip(t.id), "small primary"),
                    t.ownerEmail === m.email
                      ? btn("削除", () => deleteTrip(t), "small danger")
                      : null,
                  ),
                ),
              ),
            ),
          )
        : h(
            "p",
            { class: "muted" },
            "参加している旅行はまだありません。新規作成するか、幹事に招待してもらってください。",
          ),
      h("h3", {}, "新しい旅行を作る"),
      nameIn,
      btn(
        "作成（あなたが幹事になります）",
        async () => {
          const name = nameIn.value.trim();
          if (!name) return flash("旅行名を入力してください", "err");
          const r = await fb("createTrip", { name });
          if (!r.ok) return flash(r.error, "err");
          flash("旅行を作成しました");
          await selectTrip(r.id);
        },
        "primary",
      ),
    );
    return [secUser, secList, viewMembers()];
  }

  async function deleteTrip(t) {
    const ev =
      ((await chrome.storage.local.get(lk(t.id)))[lk(t.id)] || {}).events || [];
    const warn = ev.length
      ? `\n\nGoogle カレンダーに登録済みの予定（${ev.length} 件）は削除されません。先に「登録」タブで削除してください。`
      : "";
    if (
      !confirm(
        `旅行「${t.name}」を削除します。\nメンバー全員の画面からも消え、候補日・出欠・候補地点・投票もすべて削除されます。${warn}\n\nよろしいですか？`,
      )
    )
      return;
    const r = await fb("deleteTrip", { tripId: t.id });
    if (!r.ok) return flash(r.error, "err");
    await chrome.storage.local.remove(lk(t.id));
    if (S.tripId === t.id) await selectTrip(null);
    flash("旅行を削除しました");
  }

  function viewMembers() {
    const tr = S.trip && S.trip.id === S.tripId ? S.trip : null;
    if (!S.tripId || !tr) return null;
    if (!tr.data) return gate()[0];
    const owner = isOwner(),
      ms = T.membersOf(tr.data);
    const mailIn = h("input", {
      type: "email",
      placeholder: "招待するメールアドレス",
    });
    return h(
      "section",
      {},
      h("h3", {}, `メンバー — ${tr.data.meta.name}`),
      h(
        "ul",
        { class: "list" },
        ms.map((x) =>
          h(
            "li",
            {},
            h(
              "div",
              { class: "line" },
              h(
                "div",
                {},
                h("b", {}, T.memberLabel(x)),
                x.displayName ? h("div", { class: "muted" }, x.email) : null,
              ),
              h(
                "div",
                {},
                x.role === "owner"
                  ? h("span", { class: "badge" }, "幹事")
                  : null,
                x.joinedAt
                  ? h("span", { class: "badge ok" }, "参加済み")
                  : h("span", { class: "badge wait" }, "招待中（未参加）"),
                owner && x.role !== "owner"
                  ? btn(
                      "解除",
                      async () => {
                        if (
                          confirm(
                            `${x.email} を、この旅行から外します。よろしいですか？`,
                          )
                        )
                          await act(
                            "removeMember",
                            { tripId: S.tripId, email: x.email },
                            "メンバーを解除しました",
                          );
                      },
                      "small danger",
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
      owner
        ? h(
            "div",
            {},
            mailIn,
            btn(
              "メンバーを招待",
              async () => {
                const email = T.normalizeEmail(mailIn.value);
                if (!T.isValidEmail(email))
                  return flash(
                    "メールアドレスの形式が正しくありません（. # $ [ ] / は使えません）",
                    "err",
                  );
                const r = await act(
                  "inviteMember",
                  { tripId: S.tripId, email },
                  `${email} を招待しました`,
                );
                if (r.ok) mailIn.value = "";
              },
              "primary",
            ),
            h(
              "p",
              { class: "muted" },
              "招待するのは、相手が Google アカウントのサインインに使うメールアドレスです（大文字小文字は区別しません）。相手が拡張機能を開くと、この旅行が自動的に一覧に表示されます。",
            ),
          )
        : h("p", { class: "muted" }, "メンバーの招待は幹事のみ行えます。"),
    );
  }

  // ======================= 日程タブ（出欠のリアルタイム同期） =======================
  function viewSchedule() {
    const g = gate();
    if (g) return g;
    const d = tripData(),
      m = me(),
      owner = isOwner();
    const ms = T.membersOf(d),
      ds = T.datesOf(d);
    const ranked = T.rankDates(ds, ms, d.answers || {});
    const dS = h("input", { type: "date" }),
      dE = h("input", { type: "date" });
    const secAdd = owner
      ? h(
          "section",
          {},
          h("h3", {}, "候補日を追加（幹事）"),
          h(
            "div",
            { class: "row" },
            h("label", {}, "開始", dS),
            h("label", {}, "終了(任意)", dE),
            btn("追加", async () => {
              if (!dS.value) return flash("開始日を入力してください", "err");
              const e = dE.value || dS.value;
              if (e < dS.value)
                return flash("終了日は開始日以降にしてください", "err");
              if (ds.length >= T.MAX_DATES)
                return flash(`候補日は最大 ${T.MAX_DATES} 件です`, "err");
              await act(
                "addDate",
                { tripId: S.tripId, s: dS.value, e },
                "候補日を追加しました",
              );
            }),
          ),
        )
      : null;
    const secList = h(
      "section",
      {},
      h("h3", {}, "候補日と出欠（参加可能人数の多い順）"),
      h(
        "p",
        { class: "muted" },
        "誰かが出欠を入力すると、全員の画面がすぐに更新されます。",
      ),
      h(
        "div",
        { class: "row" },
        btn("自分のカレンダーの予定を重ねて表示", () => refreshEvents(true)),
      ),
      ranked.length
        ? h(
            "ul",
            { class: "list" },
            ranked.map((r) => {
              const c = r.date,
                mine = ((d.answers || {})[m.key] || {})[c.id];
              return h(
                "li",
                { class: L() && L().confirmedId === c.id ? "sel" : "" },
                h(
                  "div",
                  { class: "line" },
                  h("b", {}, T.fmtRange(c)),
                  h(
                    "span",
                    { class: "counts" },
                    `○${r.yes.length}  △${r.maybe.length}  ×${r.no.length}`,
                  ),
                ),
                r.yes.length
                  ? h("div", { class: "muted" }, "○ " + r.yes.join("、"))
                  : null,
                r.maybe.length
                  ? h("div", { class: "muted" }, "△ " + r.maybe.join("、"))
                  : null,
                r.no.length
                  ? h("div", { class: "muted" }, "× " + r.no.join("、"))
                  : null,
                r.none.length
                  ? h("div", { class: "muted" }, "未回答 " + r.none.join("、"))
                  : null,
                h(
                  "div",
                  { class: "row" },
                  h(
                    "label",
                    {},
                    "あなたの出欠",
                    h(
                      "select",
                      {
                        onchange: async (e) => {
                          const v = e.target.value;
                          e.target.blur();
                          await act(
                            "setAnswer",
                            {
                              tripId: S.tripId,
                              dateId: c.id,
                              v: v === "" ? null : +v,
                            },
                            "出欠を更新しました",
                          );
                        },
                      },
                      [
                        ["", "未回答"],
                        ["1", "○ 参加可"],
                        ["2", "△ 未定"],
                        ["0", "× 不可"],
                      ].map(([v, l]) =>
                        h(
                          "option",
                          { value: v, selected: String(mine ?? "") === v },
                          l,
                        ),
                      ),
                    ),
                  ),
                  owner
                    ? h(
                        "div",
                        {},
                        btn(
                          L().confirmedId === c.id ? "確定中" : "この日で確定",
                          async () => {
                            L().confirmedId = c.id;
                            await saveLocal();
                            render();
                          },
                          "small",
                        ),
                        btn(
                          "削除",
                          async () => {
                            if (
                              !confirm(
                                `候補日 ${T.fmtRange(c)} を削除します。よろしいですか？`,
                              )
                            )
                              return;
                            if (L().confirmedId === c.id) {
                              L().confirmedId = null;
                              await saveLocal();
                            }
                            await act(
                              "removeDate",
                              { tripId: S.tripId, dateId: c.id },
                              "候補日を削除しました",
                            );
                          },
                          "small danger",
                        ),
                      )
                    : null,
                ),
                warnFor(c),
              );
            }),
          )
        : h(
            "p",
            { class: "muted" },
            owner
              ? "候補日がまだありません。上のフォームから追加してください。"
              : "幹事が候補日を追加するまでお待ちください。",
          ),
    );
    return [secAdd, secList];
  }

  // ======================= 投票タブ（訪問地点の投票） =======================
  const TRANSPORT_OPTIONS = [
    { label: "電車",   svg: '<path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zm0 2c3.51 0 5.44.48 5.93 1H6.07C6.56 4.48 8.49 4 12 4zM6 7h5v3H6V7zm12 0v3h-5V7h5zM7.5 17C6.67 17 6 16.33 6 15.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>' },
    { label: "バス",   svg: '<path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/>' },
    { label: "車",     svg: '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>' },
    { label: "飛行機", svg: '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>' },
    { label: "自転車", svg: '<path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>' },
    { label: "徒歩",   svg: '<path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L9 8.3C9.2 8.5 9.5 8.9 9.8 8.9z"/>' },
  ];
  const BUDGET_OPTIONS = [
    { label: "〜5,000円", value: 5000 },
    { label: "〜10,000円", value: 10000 },
    { label: "〜20,000円", value: 20000 },
    { label: "〜30,000円", value: 30000 },
    { label: "30,000円〜", value: 99999 },
  ];
  // ---------- Google マップ上のメンバー希望フロートウィンドウ ----------
  const prefsFloat = (() => {
    let host = null;
    let wrap = null;

    function ensure() {
      if (host) return;
      host = document.createElement("div");
      host.id = "tripassist-prefs-float";
      document.documentElement.append(host);
      const shadow = host.attachShadow({ mode: "open" });

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("panel.css");

      const style = document.createElement("style");
      style.textContent = [
        "#pf-wrap{position:fixed;bottom:24px;left:24px;width:300px;max-height:55vh;",
        "background:#fff;border-radius:14px;box-shadow:0 6px 28px #0004;",
        "z-index:2147483640;display:flex;flex-direction:column;",
        "font:13px/1.5 'Google Sans',Arial,sans-serif;overflow:hidden;}",
        "#pf-head{display:flex;align-items:center;justify-content:space-between;",
        "padding:10px 14px;background:var(--accent,#1a73e8);color:#fff;",
        "font-weight:bold;font-size:13px;border-radius:14px 14px 0 0;flex-shrink:0;}",
        "#pf-close{background:none;border:none;color:#fff;font-size:20px;",
        "cursor:pointer;padding:0 2px;line-height:1;opacity:.85;}",
        "#pf-close:hover{opacity:1;}",
        "#pf-body{overflow-y:auto;padding:10px 14px;flex:1;}",
        ".pf-member{padding:8px 0;border-bottom:1px solid #f0f0f0;}",
        ".pf-member:last-child{border-bottom:none;}",
        ".pf-name{font-weight:bold;font-size:13px;margin-bottom:4px;}",
        ".pf-row{display:flex;align-items:center;gap:5px;margin-top:3px;",
        "font-size:12px;color:#5f6368;flex-wrap:wrap;}",
        ".pf-lbl{color:#9aa0a6;min-width:46px;flex-shrink:0;}",
        ".pf-dash{color:#bdc1c6;}",
        ".pf-chip{display:inline-flex;align-items:center;gap:3px;",
        "background:#f1f3f4;border-radius:8px;padding:2px 7px;font-size:11px;color:#3c4043;}",
        ".pf-empty{color:#9aa0a6;font-size:12px;margin:0;}",
      ].join("");

      shadow.append(link, style);

      wrap = document.createElement("div");
      wrap.id = "pf-wrap";
      wrap.style.display = "none";

      const head = document.createElement("div");
      head.id = "pf-head";
      const headTitle = document.createElement("span");
      headTitle.append(makeMsIcon(MS_GROUP_PATH, 18), document.createTextNode(" メンバーの希望"));
      head.append(headTitle);
      const closeBtn = document.createElement("button");
      closeBtn.id = "pf-close";
      closeBtn.textContent = "×";
      closeBtn.title = "閉じる";
      closeBtn.onclick = () => { wrap.style.display = "none"; };
      head.append(closeBtn);

      const body = document.createElement("div");
      body.id = "pf-body";

      wrap.append(head, body);
      shadow.append(wrap);
    }

    function renderContent(prefs, ms) {
      const body = wrap.querySelector("#pf-body");
      body.innerHTML = "";
      const rows = ms.filter((x) => prefs[x.key]);
      if (!rows.length) {
        const p = document.createElement("p");
        p.className = "pf-empty";
        p.textContent = "まだ誰も希望を登録していません。";
        body.append(p);
        return;
      }
      rows.forEach((x) => {
        const p = prefs[x.key];
        const div = document.createElement("div");
        div.className = "pf-member";

        const nameEl = document.createElement("div");
        nameEl.className = "pf-name";
        nameEl.textContent = x.name;
        div.append(nameEl);

        const budRow = document.createElement("div");
        budRow.className = "pf-row";
        const budLbl = document.createElement("span");
        budLbl.className = "pf-lbl";
        budLbl.textContent = "予算:";
        budRow.append(budLbl);
        const budOpt = p.budget ? BUDGET_OPTIONS.find((o) => o.value === p.budget) : null;
        if (budOpt) {
          const chip = document.createElement("span");
          chip.className = "pf-chip";
          chip.textContent = budOpt.label;
          budRow.append(chip);
        } else {
          const dash = document.createElement("span");
          dash.className = "pf-dash";
          dash.textContent = "—";
          budRow.append(dash);
        }
        div.append(budRow);

        const tRow = document.createElement("div");
        tRow.className = "pf-row";
        const tLbl = document.createElement("span");
        tLbl.className = "pf-lbl";
        tLbl.textContent = "交通:";
        tRow.append(tLbl);
        if (p.transport && p.transport.length) {
          p.transport.forEach((t) => {
            const opt = TRANSPORT_OPTIONS.find((o) => o.label === t);
            const chip = document.createElement("span");
            chip.className = "pf-chip";
            if (opt) chip.append(makeSvgIcon(opt.svg, 14));
            chip.append(document.createTextNode(t));
            tRow.append(chip);
          });
        } else {
          const dash = document.createElement("span");
          dash.className = "pf-dash";
          dash.textContent = "—";
          tRow.append(dash);
        }
        div.append(tRow);

        const cRow = document.createElement("div");
        cRow.className = "pf-row";
        const cLbl = document.createElement("span");
        cLbl.className = "pf-lbl";
        cLbl.textContent = "カテゴリ:";
        cRow.append(cLbl);
        if (p.categories && p.categories.length) {
          p.categories.forEach((cat) => {
            const ico = SPOT_ICONS[cat];
            const chip = document.createElement("span");
            chip.className = "pf-chip";
            if (ico) {
              chip.append(makeSvgIcon(ico.svg, 14));
              chip.append(document.createTextNode(ico.label));
            } else {
              chip.textContent = cat;
            }
            cRow.append(chip);
          });
        } else {
          const dash = document.createElement("span");
          dash.className = "pf-dash";
          dash.textContent = "—";
          cRow.append(dash);
        }
        div.append(cRow);

        body.append(div);
      });
    }

    return {
      toggle(prefs, ms) {
        ensure();
        if (wrap.style.display !== "none") {
          wrap.style.display = "none";
        } else {
          renderContent(prefs, ms);
          wrap.style.display = "flex";
        }
      },
      update(prefs, ms) {
        if (!wrap || wrap.style.display === "none") return;
        renderContent(prefs, ms);
      },
    };
  })();

  function viewVote() {
    const g = gate();
    if (g) return g;
    const d = tripData(),
      m = me(),
      owner = isOwner();
    const ms = T.membersOf(d),
      places = T.placesOf(d),
      votes = d.votes || {},
      adopted = d.adopted || {};
    const ranked = T.rankPlaces(places, ms, votes);
    const myPrefs = (d.preferences && d.preferences[m.key]) || {};
    let _budget = myPrefs.budget || null;
    let _transport = new Set(myPrefs.transport || []);
    let _prefCategories = new Set(myPrefs.categories || []);

    // ---- 希望登録セクション ----
    const budgetBtns = {};
    const transportBtns = {};
    const catPrefBtns = {};

    const budgetRow = h("div", { class: "toggle-group" },
      ...BUDGET_OPTIONS.map(({ label, value }) => {
        const btn2 = h("button", {
          class: "toggle-btn" + (_budget === value ? " selected" : ""),
          onclick: () => {
            _budget = _budget === value ? null : value;
            BUDGET_OPTIONS.forEach(({ value: v }) => {
              budgetBtns[v].classList.toggle("selected", _budget === v);
            });
          },
        }, label);
        budgetBtns[value] = btn2;
        return btn2;
      })
    );
    const transportRow = h("div", { class: "cat-grid" },
      ...TRANSPORT_OPTIONS.map(({ label, svg }) => {
        const btn2 = h("button", {
          class: "cat-btn" + (_transport.has(label) ? " selected" : ""),
          title: label,
          onclick: () => {
            const alreadySelected = _transport.has(label);
            _transport.clear();
            if (!alreadySelected) _transport.add(label);
            TRANSPORT_OPTIONS.forEach(({ label: l }) => {
              transportBtns[l].classList.toggle("selected", _transport.has(l));
            });
          },
        },
          makeSvgIcon(svg),
          h("span", { class: "cat-label" }, label)
        );
        transportBtns[label] = btn2;
        return btn2;
      })
    );
    const catPrefRow = h("div", { class: "cat-grid" },
      ...SPOT_CATEGORIES.map((cat) => {
        const { label, svg } = SPOT_ICONS[cat];
        const btn2 = h("button", {
          class: "cat-btn" + (_prefCategories.has(cat) ? " selected" : ""),
          title: cat,
          onclick: () => {
            // 単一選択：同じものを押したら解除、違うものを押したら切替
            const alreadySelected = _prefCategories.has(cat);
            _prefCategories.clear();
            if (!alreadySelected) _prefCategories.add(cat);
            SPOT_CATEGORIES.forEach((c) => {
              catPrefBtns[c].classList.toggle("selected", _prefCategories.has(c));
            });
          },
        },
          makeSvgIcon(svg),
          h("span", { class: "cat-label" }, label),
        );
        catPrefBtns[cat] = btn2;
        return btn2;
      })
    );

    // 他メンバーの希望まとめ表示
    const prefSummary = (() => {
      const prefs = d.preferences || {};
      const rows = ms
        .filter((x) => prefs[x.key])
        .map((x) => {
          const p = prefs[x.key];
          const budgetLabel = p.budget
            ? (BUDGET_OPTIONS.find((o) => o.value === p.budget) || {}).label || "`¥`" + p.budget
            : "—";
          const transLabel = (p.transport && p.transport.length)
            ? p.transport.map((t) => {
                const opt = TRANSPORT_OPTIONS.find((o) => o.label === t);
                return opt
                  ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="vertical-align:middle;margin:0 1px" title="${t}">${opt.svg}</svg>`
                  : t;
              }).join("")
            : "—";
          const catLabel = (p.categories && p.categories.length)
            ? p.categories.map((cat) => {
                const ico = SPOT_ICONS[cat];
                if (!ico) return cat;
                return `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="vertical-align:middle;margin:0 1px" title="${cat}">${ico.svg}</svg>`;
              }).join("")
            : "—";
          const li = h("li", {},
            h("b", {}, x.name),
          );
          const detail = h("span", { class: "muted pref-summary-detail" });
          detail.innerHTML = `　予算: ${budgetLabel}　交通: ${transLabel}　カテゴリ: ${catLabel}`;
          li.append(detail);
          return li;
        });
      return rows.length
        ? h("ul", { class: "list" }, ...rows)
        : h("p", { class: "muted" }, "まだ誰も希望を登録していません。");
    })();

    const memberPrefsToggle = h("button", {
      class: "member-prefs-toggle",
      onclick: () => {
        prefsFloat.toggle(d.preferences || {}, ms);
      },
    }, makeMsIcon(MS_GROUP_PATH, 18), " メンバーの希望");

    // ---- 行きたい場所：最大3件の入力リスト ----
    const MAX_WISH_PLACES = 3;
    // 自分が登録済みの候補地点
    const myPlaces = places.filter((p) => p.addedBy === m.key);
    const placeInputs = []; // { row, input, removeBtn } ← 新規追加用
    const placeList = h("div", { class: "wish-place-list" });

    // 既存地点の表示（編集フォーム内）
    const existingPlaceList = h("div", { class: "wish-place-list" });
    function buildExistingPlaceRows() {
      existingPlaceList.innerHTML = "";
      myPlaces.forEach((p) => {
        const row = h("div", { class: "wish-place-row wish-place-existing" },
          h("span", { class: "wish-place-name" }, p.name),
          h("button", {
            type: "button",
            class: "wish-place-remove",
            title: "削除",
            onclick: async () => {
              if (!confirm(`「${p.name}」を候補地点から削除します。よろしいですか？`)) return;
              await act("removePlace", { tripId: S.tripId, placeId: p.id }, "候補地点を削除しました");
              const idx = myPlaces.findIndex((x) => x.id === p.id);
              if (idx !== -1) myPlaces.splice(idx, 1);
              buildExistingPlaceRows();
              updateAddBtn();
            },
          }, "×"),
        );
        existingPlaceList.appendChild(row);
      });
    }
    buildExistingPlaceRows();

    function makePlaceInput(autoName) {
      const inp = h("input", {
        type: "text",
        placeholder: "地点名（空欄なら現在ページから自動取得）",
        maxlength: 60,
        value: autoName || "",
        class: "wish-place-input",
      });
      const removeBtn = h("button", {
        type: "button",
        class: "wish-place-remove",
        title: "削除",
        onclick: () => {
          const idx = placeInputs.findIndex((e) => e.row === row);
          if (idx !== -1) placeInputs.splice(idx, 1);
          row.remove();
          updateAddBtn();
        },
      }, "×");
      const row = h("div", { class: "wish-place-row" }, inp, removeBtn);
      placeInputs.push({ row, input: inp, removeBtn });
      placeList.appendChild(row);
      updateAddBtn();
      return { row, input: inp };
    }

    const addPlaceBtn = h("button", {
      type: "button",
      class: "wish-place-add",
      onclick: () => {
        const total = myPlaces.length + placeInputs.length;
        if (total < MAX_WISH_PLACES) {
          makePlaceInput("");
          updateAddBtn();
        }
      },
    },
      h("span", {}, "+"),
      " 行きたい場所を追加",
    );

    function updateAddBtn() {
      const total = myPlaces.length + placeInputs.length;
      addPlaceBtn.style.display = total >= MAX_WISH_PLACES ? "none" : "";
      placeInputs.forEach(({ removeBtn }) => {
        removeBtn.style.display = placeInputs.length <= 1 && myPlaces.length === 0 ? "none" : "";
      });
    }

    // 初期: 既存がなければ1件作成
    if (myPlaces.length === 0) {
      makePlaceInput(T.extractPlaceName(location.href) || "");
    }
    updateAddBtn();

    // ---- 登録済み希望の表示ビュー ----
    const hasMyPrefs = !!(myPrefs.budget || (myPrefs.transport && myPrefs.transport.length) || (myPrefs.categories && myPrefs.categories.length));

    function buildPrefView() {
      const budgetLabel = myPrefs.budget
        ? (BUDGET_OPTIONS.find((o) => o.value === myPrefs.budget) || {}).label || myPrefs.budget
        : "未設定";
      const transportLabel = (myPrefs.transport && myPrefs.transport.length)
        ? myPrefs.transport[0]
        : "未設定";
      const categoryLabel = (myPrefs.categories && myPrefs.categories.length)
        ? myPrefs.categories[0]
        : "未設定";
      const transportOpt = TRANSPORT_OPTIONS.find((o) => o.label === transportLabel);
      const catIcon = SPOT_ICONS[categoryLabel];

      const locationOnIcon = () => makeMsIcon('<path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-560q0-117-77.5-194.5T480-832q-85 0-162.5 77.5T240-560q0 71 59 162.5T480-186Z"/>', 16);
      const placeViewRows = myPlaces.length > 0
        ? myPlaces.map((p) =>
            h("div", { class: "pref-view-row" },
              h("span", { class: "pref-view-label" }, ""),
              h("span", { class: "pref-view-value pref-view-place" }, locationOnIcon(), p.name),
            )
          )
        : [h("div", { class: "pref-view-row" },
            h("span", { class: "pref-view-label" }, ""),
            h("span", { class: "pref-view-value" }, "未設定"),
          )];

      return h("div", { class: "pref-view" },
        h("div", { class: "pref-view-row pref-view-section-label" },
          h("span", { class: "pref-view-label" }, "希望地点"),
        ),
        ...placeViewRows,
        h("div", { class: "pref-view-row" },
          h("span", { class: "pref-view-label" }, "予算"),
          h("span", { class: "pref-view-value" }, budgetLabel),
        ),
        h("div", { class: "pref-view-row" },
          h("span", { class: "pref-view-label" }, "交通手段"),
          h("span", { class: "pref-view-value" },
            transportOpt ? makeSvgIcon(transportOpt.svg) : null,
            " " + transportLabel,
          ),
        ),
        h("div", { class: "pref-view-row" },
          h("span", { class: "pref-view-label" }, "カテゴリ"),
          h("span", { class: "pref-view-value" },
            catIcon ? makeSvgIcon(catIcon.svg) : null,
            " " + (catIcon ? catIcon.label : categoryLabel),
          ),
        ),
      );
    }

    // フォームと表示ビューを切り替えるコンテナ
    const prefFormWrap = h("div", {});
    const prefViewWrap = h("div", {});
    let _editMode = !hasMyPrefs; // 未登録なら最初からフォーム表示

    function showPrefForm() {
      _editMode = true;
      prefFormWrap.style.display = "";
      prefViewWrap.style.display = "none";
    }
    function showPrefView() {
      _editMode = false;
      prefFormWrap.style.display = "none";
      prefViewWrap.style.display = "";
      prefViewWrap.innerHTML = "";
      prefViewWrap.appendChild(buildPrefView());
      prefViewWrap.appendChild(
        btn("希望を変更する", showPrefForm, "small")
      );
    }

    // フォーム内容をprefFormWrapにセット
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "行きたい場所（最大3件）"));
    prefFormWrap.appendChild(existingPlaceList);
    prefFormWrap.appendChild(placeList);
    prefFormWrap.appendChild(addPlaceBtn);
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "予算（一人あたり目安）"));
    prefFormWrap.appendChild(budgetRow);
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "希望カテゴリ"));
    prefFormWrap.appendChild(catPrefRow);
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "希望の交通手段"));
    prefFormWrap.appendChild(transportRow);
    prefFormWrap.appendChild(btn("希望を登録", async () => {
      // 地点登録
      const ll = T.extractLatLng(location.href);
      let addedCount = 0;
      let skipCount = 0;
      for (const { input } of placeInputs) {
        const name = input.value.trim() || T.extractPlaceName(location.href);
        if (!name) continue;
        if (!ll) { skipCount++; continue; }
        if (places.length + addedCount >= T.MAX_CANDIDATE_PLACES) {
          flash(`候補地点は最大 ${T.MAX_CANDIDATE_PLACES} 件です`, "err");
          break;
        }
        await act("addPlace", { tripId: S.tripId, place: { name, lat: ll.lat, lng: ll.lng } }, null);
        addedCount++;
      }
      if (skipCount > 0 && addedCount === 0) {
        return flash("Google マップで場所を選択した状態でページを開いてから登録してください。", "err");
      }
      await act("setPreferences", {
        tripId: S.tripId,
        prefs: {
          budget: _budget,
          transport: [..._transport],
          categories: [..._prefCategories],
        },
      }, null);
      flash(addedCount > 0 ? `希望を登録しました（地点 ${addedCount} 件）` : "希望を保存しました");
      // 入力欄リセット
      while (placeInputs.length > 1) {
        const last = placeInputs.pop();
        last.row.remove();
      }
      if (placeInputs[0]) placeInputs[0].input.value = "";
      updateAddBtn();
      // 登録後は表示ビューに切替（myPrefsを更新して再描画）
      Object.assign(myPrefs, {
        budget: _budget,
        transport: [..._transport],
        categories: [..._prefCategories],
      });
      showPrefView();
    }, "primary"));

    // 初期表示
    if (_editMode) {
      showPrefForm();
    } else {
      prefViewWrap.appendChild(buildPrefView());
      prefViewWrap.appendChild(btn("希望を変更する", showPrefForm, "small"));
      prefFormWrap.style.display = "none";
    }

    const secPrefs = h("section", {},
      h("h3", {}, "旅行の希望を登録"),
      prefFormWrap,
      prefViewWrap,
      memberPrefsToggle,
    );
    const secList = h(
      "section",
      {},
      h("h3", {}, "候補地点（得票数の多い順）"),
      ranked.length
        ? h(
            "div",
            { class: "place-card-list" },
            ranked.map(({ place: p, voters }) => {
              const mine = !!(votes[m.key] && votes[m.key][p.id]);
              const mapsUrl = (p.lat != null && p.lng != null)
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&center=${p.lat},${p.lng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
              const openInCurrentTab = (url) => { window.open(url, "_blank"); };
              return h(
                "div",
                { class: "place-card" + (adopted[p.id] ? " adopted" : "") },
                h(
                  "div",
                  {
                    class: "place-card__header",
                    onclick: () => openInCurrentTab(mapsUrl),
                    title: "Google マップで開く",
                  },
                  h(
                    "div",
                    { class: "place-card__title-row" },
                    h("span", { class: "place-card__name" }, p.name),
                    adopted[p.id]
                      ? h("span", { class: "badge ok" }, "採用")
                      : null,
                    h(
                      "span",
                      { class: "place-card__map-icon" },
                      h("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", width: "16", height: "16", fill: "currentColor" },
                        h("path", { d: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" }),
                      ),
                    ),
                  ),
                  h(
                    "div",
                    { class: "place-card__meta" },
                    h("span", { class: "muted" }, `追加: ${p.addedByName || "—"}`),
                    h("span", { class: "place-card__votes" }, `${voters.length} 票`),
                  ),
                  voters.length
                    ? h("div", { class: "place-card__voters muted" }, "投票: " + voters.join("、"))
                    : h("div", { class: "place-card__voters muted" }, "投票: まだありません"),
                ),
                h(
                  "div",
                  { class: "place-card__actions" },
                  h(
                    "label",
                    { class: "inline" },
                    h("input", {
                      type: "checkbox",
                      checked: mine,
                      onchange: (e) =>
                        act(
                          "setVote",
                          {
                            tripId: S.tripId,
                            placeId: p.id,
                            on: e.target.checked,
                          },
                          e.target.checked
                            ? "行きたい場所に投票しました"
                            : "投票を取り消しました",
                        ),
                    }),
                    "行きたい",
                  ),
                  owner
                    ? h(
                        "label",
                        { class: "inline" },
                        h("input", {
                          type: "checkbox",
                          checked: !!adopted[p.id],
                          onchange: (e) =>
                            act(
                              "setAdopted",
                              {
                                tripId: S.tripId,
                                placeId: p.id,
                                on: e.target.checked,
                              },
                              e.target.checked
                                ? "採用しました"
                                : "採用を取り消しました",
                            ),
                        }),
                        "採用（幹事）",
                      )
                    : null,
                  p.addedBy === m.key || owner
                    ? btn(
                        "削除",
                        async () => {
                          if (
                            confirm(
                              `候補地点「${p.name}」を削除します。よろしいですか？`,
                            )
                          )
                            await act(
                              "removePlace",
                              { tripId: S.tripId, placeId: p.id },
                              "候補地点を削除しました",
                            );
                        },
                        "small danger",
                      )
                    : null,
                ),
              );
            }),
          )
        : h("p", { class: "muted" }, "候補地点がまだありません。"),
      owner
        ? h(
            "div",
            {},
            btn(
              "採用した地点を訪問地点リストに取り込む",
              importAdopted,
              "primary",
            ),

          )
        : h("p", { class: "muted" }, "採用する地点は幹事が選びます。"),
    );
    return [secPrefs, secList];
  }

  // ======================= 全体共有スポットカタログ =======================
  const spotDistance = (a, b) => {
    const r = 6371000,
      rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad,
      dLng = (b.lng - a.lng) * rad;
    const q =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(q));
  };
  function spotStars(rating, size = 14) {
    return h(
      "span",
      { class: "spot-stars", "aria-label": `${rating} / 5` },
      ...Array.from({ length: 5 }, (_, i) =>
        h(
          "span",
          {
            style: `font-size:${size}px;color:${i < rating ? "#fbbc04" : "#dadce0"}`,
          },
          "★",
        ),
      ),
    );
  }
  function viewSpots() {
    if (S.auth.state !== "signedIn") return [signinCard()];
    if (S.spots === null && !S.spotsError)
      return [
        h("p", { class: "muted" }, "おすすめスポットを読み込んでいます…"),
      ];
    const spots = S.spots || [];
    const autoName = T.extractPlaceName(location.href) || "";
    const nameIn = h("input", {
      type: "text",
      maxlength: 60,
      placeholder: autoName
        ? "地図から取得済み。変更できます"
        : "スポット名を入力",
      value: autoName,
    });

    let _categoryValue = "";
    const catBtns = {};
    const catGrid = h("div", { class: "cat-grid" },
      ...SPOT_CATEGORIES.map((cat) => {
        const { label, svg } = SPOT_ICONS[cat];
        const btn_ = h("button", {
          type: "button",
          class: "cat-btn",
          title: cat,
          onclick: () => {
            _categoryValue = _categoryValue === cat ? "" : cat;
            SPOT_CATEGORIES.forEach((c) => {
              catBtns[c].classList.toggle("selected", c === _categoryValue);
            });
          },
        },
          makeSvgIcon(svg),
          h("span", { class: "cat-label" }, label),
        );
        catBtns[cat] = btn_;
        return btn_;
      }),
    );
    const category = { get value() { return _categoryValue; } };
    const description = h("textarea", {
      rows: 3,
      maxlength: 500,
      placeholder: "レビュー（任意、500文字以内）",
    });
    const recommendation = h("textarea", {
      rows: 2,
      maxlength: 50,
      placeholder: "一言コメント（任意、50文字以内）",
    });
    const author = h("input", {
      type: "text",
      maxlength: 40,
      placeholder: "表示名（任意）",
      value: S.auth.name || "",
    });
    let rating = 0;
    const ratingButtons = h("div", { class: "spot-rating" });
    function paintRating() {
      ratingButtons.replaceChildren(
        ...Array.from({ length: 5 }, (_, i) =>
          h(
            "button",
            {
              type: "button",
              class: "spot-rate-button",
              title: `${i + 1}つ星`,
              "aria-pressed": rating === i + 1,
              onclick: () => {
                rating = rating === i + 1 ? 0 : i + 1;
                paintRating();
              },
            },
            h(
              "span",
              { style: `color:${i < rating ? "#fbbc04" : "#dadce0"}` },
              "★",
            ),
          ),
        ),
      );
    }
    paintRating();
    const current = T.extractLatLng(location.href);
    const nearby = current
      ? spots.filter((s) => spotDistance(current, s) < 100)
      : [];
    const form = h(
      "section",
      {},
      h("h3", {}, "おすすめスポットを共有"),

      S.spotsError ? h("p", { class: "warn" }, S.spotsError) : null,
      h("label", {}, "スポット名", nameIn),
      h("div", {},
        h("div", { class: "form-label" }, "カテゴリ"),
        catGrid,
      ),
      h("label", {}, "レビュー", description),
      h("label", {}, "一言コメント", recommendation),
      h(
        "label",
        {},
        "評価（必須）",
        h("div", { class: "row" }, ratingButtons),
      ),
      h("label", {}, "表示名", author),
      btn(
        "現在の場所を登録",
        async () => {
          const point = T.extractLatLng(location.href);
          if (!point)
            return flash(
              "Google マップで場所を選択してから登録してください。",
              "err",
            );
          const name = nameIn.value.trim() || autoName;
          if (!name || name.length > 60)
            return flash("スポット名を60文字以内で入力してください。", "err");
          if (!SPOT_CATEGORIES.includes(category.value))
            return flash("カテゴリを選択してください。", "err");
          if (!rating) return flash("評価（星）を選択してください。", "err");
          if (spots.some((s) => spotDistance(point, s) < 50))
            return flash("50m以内に登録済みのスポットがあります。", "err");
          const result = await fb("addSpot", {
            spot: {
              name,
              ...point,
              category: category.value,
              description: description.value.trim(),
              recommendation: recommendation.value.trim(),
              rating,
              registeredBy: author.value.trim(),
            },
          });
          if (!result.ok)
            return flash(
              "スポットを登録できませんでした: " + result.error,
              "err",
            );
          flash(`「${name}」を共有スポットに登録しました`);
          nameIn.value = "";
          description.value = "";
          recommendation.value = "";
          rating = 0;
          paintRating();
          render();
        },
        "primary",
      ),
    );

    const myEmail = me() && me().email;
    const rows = (items) =>
      items.map((spot) => {
        const color = SPOT_COLORS[spot.category] || SPOT_COLORS["その他"];
        const canDelete = spot.registeredByEmail === myEmail;
        const details = h(
          "div",
          { class: "spot-details", hidden: true },
          h(
            "div",
            { class: "muted" },
            `${(+spot.lat).toFixed(5)}, ${(+spot.lng).toFixed(5)}　${spot.registeredBy || "匿名"}　${spot.registeredAt ? new Date(+spot.registeredAt).toLocaleDateString("ja-JP") : ""}`,
          ),
          spot.description
            ? h("p", { class: "spot-text" }, spot.description)
            : null,
          spot.recommendation
            ? h(
                "p",
                { class: "spot-recommendation" },
                "💬 " + spot.recommendation,
              )
            : null,
          h(
            "a",
            {
              href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${spot.lat},${spot.lng}`)}`,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            "Google マップで開く",
          ),
        );
        return h(
          "li",
          {},
          h(
            "div",
            { class: "line" },
            h(
              "button",
              {
                type: "button",
                class: "spot-expand",
                onclick: (e) => {
                  details.hidden = !details.hidden;
                  e.currentTarget.classList.toggle("open", !details.hidden);
                },
              },
              h("b", {}, spot.name),
              h(
                "span",
                {
                  class: "spot-cat",
                  style: `color:${color};border-color:${color}66;background:${color}18`,
                },
                spot.category,
              ),
              spotStars(+spot.rating),
            ),
            canDelete
              ? btn(
                  "削除",
                  async () => {
                    if (
                      !confirm(
                        `「${spot.name}」を共有スポットから削除しますか？`,
                      )
                    )
                      return;
                    const result = await fb("deleteSpot", { spotId: spot.id });
                    if (!result.ok)
                      return flash(
                        "削除できませんでした: " + result.error,
                        "err",
                      );
                    flash(`「${spot.name}」を削除しました`);
                  },
                  "small danger",
                )
              : null,
          ),
          details,
        );
      });
    const list = h(
      "section",
      {},
      h("h3", {}, `共有スポット（最新${spots.length}件を表示）`),
      spots.length
        ? h("ul", { class: "list" }, ...rows(spots))
        : h("p", { class: "muted" }, "共有スポットはまだありません。"),
    );
    let nearbyOpen = false;
    const nearbyList = h("ul", { class: "list", hidden: true }, ...rows(nearby));
    const nearbyToggle = h("h3", {
      class: "nearby-toggle",
      onclick: () => {
        nearbyOpen = !nearbyOpen;
        nearbyList.hidden = !nearbyOpen;
        nearbyToggle.classList.toggle("open", nearbyOpen);
      },
    }, `この場所の近くのレビュー（${nearby.length}件）`);
    const nearbySection = nearby.length
      ? h("section", {}, nearbyToggle, nearbyList)
      : null;
    return [form, nearbySection, list];
  }

  // ---------- Google マップ上の共有スポットマーカー ----------
  const spotLayer = (() => {
    let el = document.getElementById("tripassist-spot-layer");
    if (!el) {
      el = document.createElement("div");
      el.id = "tripassist-spot-layer";
      document.documentElement.append(el);
    }
    if (!document.getElementById("tripassist-spot-style")) {
      const style = document.createElement("style");
      style.id = "tripassist-spot-style";
      style.textContent = `
        #tripassist-spot-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden}
        .tripassist-spot-marker{position:absolute;pointer-events:auto;cursor:pointer;transform:translate(-50%,-100%)}
        .tripassist-spot-callout{
          display:flex;flex-direction:column;gap:2px;
          padding:5px 9px;border-radius:8px;
          background:white;box-shadow:0 2px 8px #0004;
          font:12px/1.4 Arial,sans-serif;
          border:2px solid var(--sc,#1a73e8);color:#202124;
          max-width:160px;position:relative;
        }
        .tripassist-spot-name{
          font-weight:bold;font-size:12px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .tripassist-spot-rec{
          font-size:10px;color:#5f6368;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .tripassist-spot-marker:hover .tripassist-spot-rec{color:rgba(255,255,255,0.85)}
        .tripassist-spot-callout::after{
          content:"";position:absolute;bottom:-8px;left:50%;
          transform:translateX(-50%);
          border:4px solid transparent;
          border-top:5px solid var(--sc,#1a73e8);
        }
        .tripassist-spot-marker:hover .tripassist-spot-callout{
          background:var(--sc,#1a73e8);color:white;
        }
        .tripassist-spot-marker:hover .tripassist-spot-callout::after{
          border-top-color:var(--sc,#1a73e8);
        }
        .tripassist-spot-popup{position:absolute;width:260px;max-height:45vh;overflow:auto;padding:12px 14px;border-radius:10px;background:white;color:#202124;box-shadow:0 4px 16px #0005;pointer-events:auto;z-index:2;font:13px/1.5 Arial,sans-serif}
        .tripassist-spot-popup h4{margin:0 0 6px;font-size:14px}.tripassist-spot-popup p{margin:5px 0;color:#5f6368}
        .tripassist-spot-popup a{color:#1a73e8}.tripassist-spot-close{float:right;border:0;background:none;font-size:20px;cursor:pointer}
      `;
      document.head.append(style);
    }
    return el;
  })();
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
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${spot.lat},${spot.lng}`)}`;
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
      spot.recommendation
        ? h("p", {}, `💬 ${spot.recommendation}`)
        : null,
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
      const stars = "★".repeat(Math.max(0, Math.min(5, Math.round(+spot.rating))));
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
      const callout = h("div", { class: "tripassist-spot-callout" },
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
    for (const { ev, sendUpdates } of events) {
      const res = await send({ type: "cal:create", event: ev, sendUpdates });
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

  function viewRegister() {
    const g = gate(true);
    if (g) return g;
    const d = tripData(),
      st = L().settings,
      m = me();
    const others = T.membersOf(d).filter((x) => x.key !== m.key);
    const it = currentItinerary();
    const cand = T.datesOf(d).find((c) => c.id === L().confirmedId);
    const sec = h(
      "section",
      {},
      h("h3", {}, "Google カレンダーに登録"),
      cand
        ? h("p", {}, "確定日程: ", h("b", {}, T.fmtRange(cand)))
        : h(
            "p",
            { class: "warn" },
            "日程が未確定です。「日程」タブで「この日で確定」を押すか、下から選んでください。",
          ),
      h(
        "select",
        {
          onchange: async (e) => {
            L().confirmedId = e.target.value || null;
            await saveLocal();
            S.regResults = null;
            render();
          },
        },
        h("option", { value: "" }, "候補日から選択…"),
        T.datesOf(d).map((c) =>
          h(
            "option",
            { value: c.id, selected: c.id === L().confirmedId },
            T.fmtRange(c),
          ),
        ),
      ),
      h(
        "p",
        { class: "muted" },
        it
          ? `しおり: ${it.rows.length} 地点を予定の説明欄に記載し、最初の訪問地点を場所に設定します。`
          : "しおりが未作成です（日程のみ登録されます）。",
      ),
      h(
        "label",
        { class: "inline" },
        h("input", {
          type: "checkbox",
          checked: st.invite && others.length > 0,
          disabled: !others.length,
          onchange: async (e) => {
            st.invite = e.target.checked;
            await saveLocal();
            render();
          },
        }),
        others.length
          ? `メンバー ${others.length} 人を招待して、招待メールを送る`
          : "招待できるメンバーがいません",
      ),
      st.invite && others.length
        ? h("div", { class: "warn" }, "⚠ " + NOTICE)
        : null,
      h(
        "label",
        { class: "inline" },
        h("input", {
          type: "checkbox",
          checked: st.timed,
          disabled: !it,
          onchange: async (e) => {
            st.timed = e.target.checked;
            await saveLocal();
          },
        }),
        "各地点を時刻付きの予定としても登録（あなたのカレンダーのみ・開始日に作成）",
      ),
      btn("カレンダーに登録", registerToCalendar, "primary"),
      S.regResults
        ? h(
            "ul",
            { class: "list" },
            S.regResults.map((r) =>
              h(
                "li",
                { class: r.ok ? "okli" : "warn" },
                (r.ok ? "✔ " : "✖ ") + r.name + (r.ok ? "" : ` — ${r.error}`),
              ),
            ),
          )
        : null,
    );
    return [sec, viewMyEvents()];
  }

  // この拡張機能から登録した予定の一覧と削除
  function viewMyEvents() {
    const list = [...L().events].sort((a, b) => a.start.localeCompare(b.start));
    for (const id of [...S.selDel])
      if (!list.some((r) => r.id === id)) S.selDel.delete(id);
    return h(
      "section",
      {},
      h("h3", {}, "この拡張機能から登録した予定"),
      list.length
        ? h(
            "ul",
            { class: "list" },
            list.map((r) =>
              h(
                "li",
                {},
                h(
                  "label",
                  { class: "inline" },
                  h("input", {
                    type: "checkbox",
                    checked: S.selDel.has(r.id),
                    onchange: (e) => {
                      if (e.target.checked) S.selDel.add(r.id);
                      else S.selDel.delete(r.id);
                    },
                  }),
                  h(
                    "span",
                    {},
                    r.title,
                    r.attendees
                      ? h("span", { class: "badge" }, `ゲスト${r.attendees}人`)
                      : null,
                    h("div", { class: "muted" }, T.fmtEventWhen(r)),
                  ),
                ),
              ),
            ),
          )
        : h(
            "p",
            { class: "muted" },
            "登録した予定はありません。（カレンダー上のそれ以外の予定は、ここには表示されず削除もできません）",
          ),
      list.length
        ? h(
            "div",
            {},
            btn(
              "すべて選択",
              () => {
                list.forEach((r) => S.selDel.add(r.id));
                render();
              },
              "small",
            ),
            btn(
              "選択を解除",
              () => {
                S.selDel.clear();
                render();
              },
              "small",
            ),
            btn(
              "選択した予定を削除",
              async () => {
                const targets = list.filter((r) => S.selDel.has(r.id));
                if (!targets.length)
                  return flash("削除する予定を選択してください", "err");
                const lines = targets
                  .map((r) => `・${r.title}（${T.fmtEventWhen(r)}）`)
                  .join("\n");
                const mail = targets.some((r) => r.attendees)
                  ? "\nゲストには、予定のキャンセル通知メールが送信されます。"
                  : "";
                if (
                  !confirm(
                    `Google カレンダーから次の ${targets.length} 件の予定を削除します。この操作は取り消せません。${mail}\n\n${lines}\n\nよろしいですか？`,
                  )
                )
                  return;
                S.delResults = [];
                for (const r of targets) {
                  const res = await send({
                    type: "cal:delete",
                    eventId: r.id,
                    notify: r.attendees > 0,
                  });
                  const gone =
                    !res.ok && (res.status === 404 || res.status === 410);
                  if (res.ok || gone) {
                    // 成功、またはカレンダー側で削除済み → 記録を整理
                    L().events = L().events.filter((x) => x.id !== r.id);
                    S.selDel.delete(r.id);
                    S.delResults.push({
                      ok: true,
                      text: res.ok
                        ? `${r.title}: 削除しました`
                        : `${r.title}: カレンダー上に既に存在しない（手動で削除済み）ため、記録のみ整理しました`,
                    });
                  } else {
                    S.delResults.push({
                      ok: false,
                      text: `${r.title}: 削除に失敗しました — ${res.error}（記録は残してあります。再度お試しください）`,
                    });
                    if (/認証|client_id/.test(res.error)) break; // 認証系の失敗は打ち切り
                  }
                }
                await saveLocal();
                const ng = S.delResults.filter((x) => !x.ok).length;
                flash(
                  ng
                    ? `${ng} 件の削除に失敗しました`
                    : `${S.delResults.length} 件の予定を処理しました`,
                  ng ? "err" : "ok",
                );
                render();
              },
              "danger",
            ),
          )
        : null,
      S.delResults
        ? h(
            "ul",
            { class: "list" },
            S.delResults.map((x) =>
              h(
                "li",
                { class: x.ok ? "okli" : "warn" },
                (x.ok ? "✔ " : "✖ ") + x.text,
              ),
            ),
          )
        : null,
    );
  }

  // ======================= 描画・起動 =======================
  const TABS = [
    ["trip", "旅行", viewTrip],
    ["schedule", "日程", viewSchedule],
    ["vote", "投票", viewVote],
    ["route", "ルート", viewRoute],
    ["register", "登録", viewRegister],
    ["spots", "スポット", viewSpots],
  ];
  function render() {
    if (!S.open) return;
    dirty = false;
    const keep = body.scrollTop;
    const d = tripData();
    subEl.textContent =
      d && d.meta ? `／ ${d.meta.name}${isOwner() ? "（幹事）" : ""}` : "";
    tabsEl.replaceChildren(
      ...TABS.map(([k, label]) =>
        h(
          "button",
          {
            class: "tab" + (S.tab === k ? " active" : ""),
            type: "button",
            onclick: () => {
              S.tab = k;
              render();
            },
          },
          label,
        ),
      ),
    );
    const view = TABS.find(([k]) => k === S.tab)[2];
    body.replaceChildren(...view().filter(Boolean));
    navBar.hidden = !(S.nav && isDirPage());
    if (!navBar.hidden) {
      navBar.replaceChildren(
        h("span", {}, "ルート案内を表示中"),
        btn("← 元の画面に戻る", goBack, "small primary"),
        btn(
          "閉じる",
          async () => {
            await clearNav();
            render();
          },
          "small",
        ),
      );
    }
    if (S.pendingScroll !== null) {
      body.scrollTop = S.pendingScroll;
      S.pendingScroll = null;
    } else body.scrollTop = keep;
  }

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
  boot().catch((e) => flash("起動に失敗しました: " + e.message, "err"));
}

main();
