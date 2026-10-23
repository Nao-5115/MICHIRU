// 共通の画面部品（サインイン案内・表示ゲート・データ更新）
import * as T from "../../lib.js";

export function installCommon(c) {
  const { S, h, btn, flash, fb, selectTrip, isOwner, tripData, send } = c;
  const render = (...args) => c.render(...args);

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

  Object.assign(c, { signinCard, gate, refreshEvents, warnFor });
}
