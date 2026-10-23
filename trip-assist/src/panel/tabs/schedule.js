// 「日程」タブ（候補日と出欠のリアルタイム同期）
import * as T from "../../lib.js";

export function installScheduleTab(c) {
  const { gate, tripData, me, isOwner, h, btn, flash, act, S, refreshEvents, L, saveLocal, warnFor } = c;
  const render = (...args) => c.render(...args);

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

  Object.assign(c, { viewSchedule });
}
