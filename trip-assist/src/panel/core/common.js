// 共通の画面部品（サインイン案内・表示ゲート・データ更新）
import * as T from "../../lib.js";

export function installCommon(ctx) {
  const { state, createEl, makeButton, flash, callFirebase, selectTrip, isOwner, tripData, sendMessage } = ctx;
  const render = (...args) => ctx.render(...args);

  // ---------- 共通部品 ----------
  function signinCard() {
    const auth = state.auth;
    return createEl(
      "section",
      {},
      createEl("h3", {}, "サインイン"),
      auth.state === "error" ? createEl("p", { class: "warn" }, auth.error) : null,
      auth.state === "unknown"
        ? createEl(
            "p",
            { class: "muted" },
            "Firebase に接続しています…（しばらく待っても変わらない場合は、拡張機能を再読み込みしてください）",
          )
        : null,
      createEl(
        "p",
        { class: "muted" },
        "旅行のデータを友達とリアルタイムに共有するため、Google アカウントでサインインします。",
      ),
      makeButton(
        "Google でサインイン",
        async () => {
          flash("サインイン中…");
          const result = await callFirebase("signIn");
          flash(result.ok ? "サインインしました" : result.error, result.ok ? "ok" : "err");
        },
        "primary",
      ),
    );
  }
  // 画面を出せない状態（未サインイン・旅行未選択・同期中・権限なし）の案内。出せるなら null
  function gate(needOwner = false) {
    if (state.auth.state !== "signedIn") return [signinCard()];
    if (!state.tripId)
      return [
        createEl(
          "p",
          { class: "muted" },
          "「旅行」タブで旅行を選択、または新規作成してください。",
        ),
      ];
    const currentTrip = state.trip && state.trip.id === state.tripId ? state.trip : null;
    if (!currentTrip)
      return [createEl("p", { class: "muted" }, "旅行のデータを同期しています…")];
    if (!currentTrip.data) {
      return [
        createEl(
          "section",
          {},
          createEl(
            "p",
            { class: "warn" },
            currentTrip.error || "この旅行は削除されたか、アクセス権がありません。",
          ),
          makeButton("旅行の選択を解除", () => selectTrip(null)),
        ),
      ];
    }
    if (!state.local) return [createEl("p", { class: "muted" }, "読み込み中…")];
    if (needOwner && !isOwner()) {
      return [
        createEl(
          "section",
          {},
          createEl(
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
    const dates = T.datesOf(tripData());
    if (!dates.length) {
      if (manual) flash("候補日がありません", "err");
      return;
    }
    const minDate = dates.map((date) => date.s).sort()[0];
    const maxDate = T.addDays(
      dates
        .map((date) => date.e)
        .sort()
        .pop(),
      1,
    );
    const result = await sendMessage({
      type: "cal:list",
      timeMin: new Date(minDate + "T00:00:00").toISOString(),
      timeMax: new Date(maxDate + "T00:00:00").toISOString(),
    });
    if (!result.ok) {
      flash(result.error, "err");
      return;
    }
    state.events = result.items;
    flash(`カレンダーの予定を ${result.items.length} 件読み込みました`);
    render();
  }
  const warnFor = (candidate) => {
    if (!state.events) return null;
    const conflicts = T.conflicts(candidate, state.events);
    if (!conflicts.length) return null;
    return createEl(
      "div",
      { class: "warn" },
      "⚠ この日は既に予定が入っています",
      createEl(
        "ul",
        {},
        conflicts.slice(0, 4).map((conflict) => createEl("li", {}, conflict.summary)),
      ),
    );
  };

  Object.assign(ctx, { signinCard, gate, refreshEvents, warnFor });
}
