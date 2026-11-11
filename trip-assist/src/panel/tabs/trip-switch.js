// 画面上部の「旅行の切り替え」。GitHub のブランチ切り替えと同じ操作:
// 検索欄に旅行名を入力すると一覧を絞り込み、登録されていない名前なら新しい旅行として作成する
import * as T from "../../lib.js";

const TRASH_PATH =
  '<path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>';

function tripDateSummary(trip) {
  if (!Object.prototype.hasOwnProperty.call(trip, "dates")) return "日程を読み込み中…";
  if (trip.dates === null) return "日程情報を取得できません";
  const dates = Array.isArray(trip.dates)
    ? trip.dates
    : Object.entries(trip.dates || {}).map(([id, date]) => ({ id, ...date }));
  if (!dates.length) return "日程: 候補日は未登録";
  const from = dates.map((date) => date.s).sort()[0];
  const to = dates.map((date) => date.e).sort().slice(-1)[0];
  const range = from === to ? T.fmtDate(from) : `${T.fmtDate(from)}〜${T.fmtDate(to)}`;
  return `日程: ${range}（候補${dates.length}件）`;
}

export function installTripSwitch(ctx) {
  const { state, switchEl, createEl, makeButton, makeMsIcon, callFirebase, flash, selectTrip, root, currentMember } = ctx;

  let open = false;
  let busy = false;

  const queryIn = createEl("input", {
    type: "text",
    class: "trip-switch__search",
    placeholder: "旅行を検索、または新しい旅行名を入力",
    maxlength: 60,
    "aria-label": "旅行を検索、または新しく作成",
    oninput: () => renderList(),
    onkeydown: (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") setOpen(false);
    },
  });
  const listEl = createEl("ul", { class: "trip-switch__list", role: "listbox" });
  const footEl = createEl("div", { class: "trip-switch__foot" });
  const labelEl = createEl("span", { class: "trip-switch__label" });
  const triggerEl = createEl(
    "button",
    {
      class: "trip-switch__btn",
      type: "button",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
      onclick: () => setOpen(!open),
    },
    labelEl,
    createEl("span", { class: "trip-switch__caret", "aria-hidden": "true" }, "▾"),
  );
  const menuEl = createEl(
    "div",
    { class: "trip-switch__menu", hidden: true },
    createEl(
      "div",
      { class: "trip-switch__head" },
      createEl("b", {}, "旅行を切り替え"),
      makeButton("×", () => setOpen(false), "icon"),
    ),
    queryIn,
    listEl,
    footEl,
  );
  switchEl.replaceChildren(triggerEl, menuEl);

  function setOpen(value) {
    open = value;
    menuEl.hidden = !value;
    triggerEl.setAttribute("aria-expanded", String(value));
    if (value) {
      queryIn.value = "";
      renderList();
      queryIn.focus();
    }
  }

  const trimmedQuery = () => queryIn.value.trim();

  function visibleTrips() {
    const q = trimmedQuery().toLowerCase();
    return q
      ? state.trips.filter((trip) => (trip.name || "").toLowerCase().includes(q))
      : state.trips;
  }

  async function choose(tripId) {
    setOpen(false);
    if (tripId === state.tripId) return ctx.render();
    await selectTrip(tripId);
  }

  async function createTrip(name) {
    if (busy) return;
    const existing = state.trips.find((trip) => trip.name === name);
    if (existing) return choose(existing.id);
    busy = true;
    queryIn.disabled = true;
    try {
      const result = await callFirebase("createTrip", { name });
      if (!result.ok) return flash(result.error, "err");
      flash(`旅行「${name}」を作成しました`);
      setOpen(false);
      await selectTrip(result.id);
    } finally {
      busy = false;
      queryIn.disabled = false;
    }
  }

  // Enter: 同じ名前の旅行があればそれを開き、なければ新しい旅行として作成する
  function submit() {
    const q = trimmedQuery();
    if (!q) return;
    const exact = state.trips.find((trip) => trip.name === q);
    if (exact) return choose(exact.id);
    return createTrip(q);
  }

  function tripRow(trip) {
    const me = currentMember();
    const isMine = !!me && trip.ownerEmail === me.email;
    const selected = trip.id === state.tripId;
    const detail =
      state.trip && state.trip.id === trip.id && state.trip.data
        ? { ...trip, dates: state.trip.data.dates }
        : trip;
    return createEl(
      "li",
      {
        class: "trip-switch__item" + (selected ? " sel" : ""),
        role: "option",
        "aria-selected": String(selected),
        onclick: () => choose(trip.id),
      },
      createEl("span", { class: "trip-switch__check", "aria-hidden": "true" }, selected ? "✓" : ""),
      createEl(
        "span",
        { class: "trip-switch__text" },
        createEl("b", {}, trip.name),
        createEl("span", { class: "muted" }, tripDateSummary(detail)),
      ),
      createEl(
        "span",
        { class: "trip-switch__actions" },
        createEl(
          "button",
          {
            class: "trip-switch__route",
            type: "button",
            title: "この旅行のルートを表示",
            "aria-label": "この旅行のルートを表示",
            onclick: (event) => {
              event.stopPropagation();
              state.tab = "route";
              choose(trip.id);
            },
          },
          "ルート",
        ),
        isMine
          ? createEl(
              "button",
              {
                class: "icon-delete",
                type: "button",
                title: "旅行を削除",
                "aria-label": "旅行を削除",
                onclick: (event) => {
                  event.stopPropagation();
                  ctx.deleteTrip(trip);
                },
              },
              makeMsIcon(TRASH_PATH, 18),
            )
          : null,
      ),
    );
  }

  function renderFoot() {
    const me = currentMember();
    footEl.replaceChildren(
      createEl("span", { class: "muted" }, me ? `サインイン中: ${me.email}` : ""),
      makeButton(
        "サインアウト",
        async () => {
          const result = await callFirebase("signOut");
          if (!result.ok) flash(result.error, "err");
        },
        "small",
      ),
    );
  }

  function renderList() {
    const q = trimmedQuery();
    const exact = !!q && state.trips.some((trip) => trip.name === q);
    const items = [];
    if (q && !exact)
      items.push(
        createEl(
          "li",
          { class: "trip-switch__create", role: "option", onclick: () => createTrip(q) },
          createEl("span", { class: "trip-switch__plus", "aria-hidden": "true" }, "＋"),
          createEl("span", {}, `「${q}」を新しい旅行として作成`),
        ),
      );
    items.push(...visibleTrips().map((trip) => tripRow(trip)));
    if (!items.length)
      items.push(
        createEl(
          "li",
          { class: "muted trip-switch__empty" },
          state.trips.length
            ? "該当する旅行がありません"
            : "旅行はまだありません。名前を入力すると作成できます。",
        ),
      );
    listEl.replaceChildren(...items);
    renderFoot();
  }

  // 画面の再描画のたびに呼ばれる。入力中の検索欄は作り直さない
  function renderSwitch() {
    const signedIn = state.auth.state === "signedIn";
    switchEl.hidden = !signedIn;
    if (!signedIn) return setOpen(false);
    const trip = state.trips.find((item) => item.id === state.tripId);
    const loadedName =
      state.trip && state.trip.id === state.tripId && state.trip.data && state.trip.data.meta
        ? state.trip.data.meta.name
        : "";
    labelEl.textContent = (trip && trip.name) || loadedName || "旅行を選択";
    if (open) renderList();
  }

  // ポップアップの外を押したら閉じる
  root.addEventListener("pointerdown", (event) => {
    if (open && !event.composedPath().includes(switchEl)) setOpen(false);
  });

  Object.assign(ctx, { renderSwitch });
}
