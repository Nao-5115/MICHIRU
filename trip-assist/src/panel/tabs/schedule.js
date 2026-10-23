// 「日程」タブ（候補日と出欠のリアルタイム同期）
import * as T from "../../lib.js";

export function installScheduleTab(ctx) {
  const { gate, tripData, currentMember, isOwner, createEl, makeButton, flash, runAction, state, refreshEvents, getLocal, saveLocal, warnFor } = ctx;
  const render = (...args) => ctx.render(...args);

  // ======================= 日程タブ（出欠のリアルタイム同期） =======================
  function viewSchedule() {
    const gateView = gate();
    if (gateView) return gateView;
    const trip = tripData(),
      myMember = currentMember(),
      owner = isOwner();
    const members = T.membersOf(trip),
      dates = T.datesOf(trip);
    const ranked = T.rankDates(dates, members, trip.answers || {});
    const startDateInput = createEl("input", { type: "date" }),
      endDateInput = createEl("input", { type: "date" });
    const secAdd = owner
      ? createEl(
          "section",
          {},
          createEl("h3", {}, "候補日を追加（幹事）"),
          createEl(
            "div",
            { class: "row" },
            createEl("label", {}, "開始", startDateInput),
            createEl("label", {}, "終了(任意)", endDateInput),
            makeButton("追加", async () => {
              if (!startDateInput.value) return flash("開始日を入力してください", "err");
              const dateValue = endDateInput.value || startDateInput.value;
              if (dateValue < startDateInput.value)
                return flash("終了日は開始日以降にしてください", "err");
              if (dates.length >= T.MAX_DATES)
                return flash(`候補日は最大 ${T.MAX_DATES} 件です`, "err");
              await runAction(
                "addDate",
                { tripId: state.tripId, s: startDateInput.value, e: dateValue },
                "候補日を追加しました",
              );
            }),
          ),
        )
      : null;
    const secList = createEl(
      "section",
      {},
      createEl("h3", {}, "候補日と出欠（参加可能人数の多い順）"),
      createEl(
        "p",
        { class: "muted" },
        "誰かが出欠を入力すると、全員の画面がすぐに更新されます。",
      ),
      createEl(
        "div",
        { class: "row" },
        makeButton("自分のカレンダーの予定を重ねて表示", () => refreshEvents(true)),
      ),
      ranked.length
        ? createEl(
            "ul",
            { class: "list" },
            ranked.map((candidate) => {
              const date = candidate.date,
                mine = ((trip.answers || {})[myMember.key] || {})[date.id];
              return createEl(
                "li",
                { class: getLocal() && getLocal().confirmedId === date.id ? "sel" : "" },
                createEl(
                  "div",
                  { class: "line" },
                  createEl("b", {}, T.fmtRange(date)),
                  createEl(
                    "span",
                    { class: "counts" },
                    `○${candidate.yes.length}  △${candidate.maybe.length}  ×${candidate.no.length}`,
                  ),
                ),
                candidate.yes.length
                  ? createEl("div", { class: "muted" }, "○ " + candidate.yes.join("、"))
                  : null,
                candidate.maybe.length
                  ? createEl("div", { class: "muted" }, "△ " + candidate.maybe.join("、"))
                  : null,
                candidate.no.length
                  ? createEl("div", { class: "muted" }, "× " + candidate.no.join("、"))
                  : null,
                candidate.none.length
                  ? createEl("div", { class: "muted" }, "未回答 " + candidate.none.join("、"))
                  : null,
                createEl(
                  "div",
                  { class: "row" },
                  createEl(
                    "label",
                    {},
                    "あなたの出欠",
                    createEl(
                      "select",
                      {
                        onchange: async (event) => {
                          const value = event.target.value;
                          event.target.blur();
                          await runAction(
                            "setAnswer",
                            {
                              tripId: state.tripId,
                              dateId: date.id,
                              v: value === "" ? null : +value,
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
                      ].map(([value, label]) =>
                        createEl(
                          "option",
                          { value: value, selected: String(mine ?? "") === value },
                          label,
                        ),
                      ),
                    ),
                  ),
                  owner
                    ? createEl(
                        "div",
                        {},
                        makeButton(
                          getLocal().confirmedId === date.id ? "確定中" : "この日で確定",
                          async () => {
                            getLocal().confirmedId = date.id;
                            await saveLocal();
                            render();
                          },
                          "small",
                        ),
                        makeButton(
                          "削除",
                          async () => {
                            if (
                              !confirm(
                                `候補日 ${T.fmtRange(date)} を削除します。よろしいですか？`,
                              )
                            )
                              return;
                            if (getLocal().confirmedId === date.id) {
                              getLocal().confirmedId = null;
                              await saveLocal();
                            }
                            await runAction(
                              "removeDate",
                              { tripId: state.tripId, dateId: date.id },
                              "候補日を削除しました",
                            );
                          },
                          "small danger",
                        ),
                      )
                    : null,
                ),
                warnFor(date),
              );
            }),
          )
        : createEl(
            "p",
            { class: "muted" },
            owner
              ? "候補日がまだありません。上のフォームから追加してください。"
              : "幹事が候補日を追加するまでお待ちください。",
          ),
    );
    return [secAdd, secList];
  }

  Object.assign(ctx, { viewSchedule });
}
