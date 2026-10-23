// 「登録」タブ（Google カレンダーへの予定登録）
import * as T from "../../lib.js";

export function installRegisterTab(c) {
  const { gate, tripData, L, me, currentItinerary, h, saveLocal, S, NOTICE, btn, registerToCalendar, flash, send } = c;
  const render = (...args) => c.render(...args);

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

  Object.assign(c, { viewRegister, viewMyEvents });
}
