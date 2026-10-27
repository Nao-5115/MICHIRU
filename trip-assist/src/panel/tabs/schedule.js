// 「日程」タブ（候補日と出欠のリアルタイム同期）
import * as T from "../../lib.js";

export function installScheduleTab(ctx) {
  const { gate, tripData, currentMember, isOwner, createEl, makeButton, flash, runAction, state, refreshEvents, getLocal, saveLocal, warnFor } = ctx;
  const render = (...args) => ctx.render(...args);

  // ======================= カレンダー表示（候補日をメンバーごとの色で表示） =======================
  const MEMBER_COLORS = ["#1a73e8", "#e53935", "#43a047", "#fb8c00", "#8e24aa", "#00897b", "#6d4c41", "#d81b60"];
  const ANSWER_LABEL = { 1: "○ 参加可", 2: "△ 未定", 0: "× 不可" };
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const shiftMonth = (ym, delta) => {
    let [y, m] = ym.split("-").map(Number);
    m += delta;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    return `${y}-${pad2(m)}`;
  };
  let calMonth = null;    // 表示中の月（"YYYY-MM"）
  let calSelected = null; // 詳細を開いている日（"YYYY-MM-DD"）

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
        "p",
        { class: "note" },
        owner
          ? "※「この日で確定」は、あなた（幹事）のブラウザにだけ保存されます。メンバーの画面には表示されません。確定日を共有するには「登録」タブでカレンダーに登録してください（招待メールで伝わります）。"
          : "※確定日は幹事がカレンダーに登録したときに、招待メールで伝わります。",
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
    const secCal = dates.length ? buildCalendar(trip, members, dates) : null;
    return [secAdd, secCal, secList];
  }

  function buildCalendar(trip, members, dates) {
    const answers = trip.answers || {};
    const answerOf = (member, date) => (answers[member.key] || {})[date.id];
    const colorOf = (member) => MEMBER_COLORS[Math.max(0, members.indexOf(member)) % MEMBER_COLORS.length];
    // その日を含む候補日
    const coveringOn = (day) => dates.filter((date) => date.s <= day && day <= date.e);

    const now = new Date();
    const todayStr = ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
    if (!calMonth) {
      const firstDay = dates.map((date) => date.s).sort()[0];
      calMonth = firstDay ? firstDay.slice(0, 7) : todayStr.slice(0, 7);
    }
    const [year, month] = calMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDow = new Date(year, month - 1, 1).getDay();

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(createEl("div", { class: "cal-cell blank" }));
    for (let d = 1; d <= daysInMonth; d++) {
      const day = ymd(year, month, d);
      const covering = coveringOn(day);
      const dow = new Date(year, month - 1, d).getDay();
      const rows = covering.slice(0, 2).map((date) =>
        createEl(
          "div",
          { class: "cal-row" },
          members
            .filter((member) => answerOf(member, date) === 1)
            .map((member) => createEl("span", { class: "cal-dot", title: `${T.memberLabel(member)}：○`, style: `background:${colorOf(member)}` })),
          members
            .filter((member) => answerOf(member, date) === 2)
            .map((member) => createEl("span", { class: "cal-dot maybe", title: `${T.memberLabel(member)}：△`, style: `border-color:${colorOf(member)}` })),
        ),
      );
      const classes = ["cal-cell"];
      if (covering.length) classes.push("is-cand");
      if (day === todayStr) classes.push("is-today");
      if (day === calSelected) classes.push("is-sel");
      if (dow === 0) classes.push("sun");
      if (dow === 6) classes.push("sat");
      const content = [
        createEl("span", { class: "cal-day" }, String(d)),
        ...rows,
        covering.length > 2 ? createEl("span", { class: "cal-more" }, `他 ${covering.length - 2} 件`) : null,
      ];
      cells.push(
        covering.length
          ? createEl(
              "button",
              {
                class: classes.join(" "),
                type: "button",
                "aria-label": `${month}月${d}日：候補日 ${covering.length} 件`,
                onclick: () => {
                  calSelected = calSelected === day ? null : day;
                  render();
                },
              },
              ...content,
            )
          : createEl("div", { class: classes.join(" ") }, ...content),
      );
    }
    while (cells.length % 7) cells.push(createEl("div", { class: "cal-cell blank" }));

    // 日付をクリックした時の詳細（候補日ごとに、メンバーの出欠を色つきで表示）
    let popup = null;
    if (calSelected && calSelected.slice(0, 7) === calMonth) {
      const covering = coveringOn(calSelected);
      const dayNum = Number(calSelected.slice(8, 10));
      popup = createEl(
        "div",
        { class: "cal-pop", role: "dialog", "aria-label": `${dayNum}日の候補日` },
        createEl(
          "div",
          { class: "cal-pop__head" },
          createEl("b", {}, `${month}/${dayNum} の候補日`),
          createEl(
            "button",
            {
              class: "cal-pop__close",
              type: "button",
              "aria-label": "閉じる",
              onclick: () => {
                calSelected = null;
                render();
              },
            },
            "×",
          ),
        ),
        covering.length
          ? covering.map((date) => {
              const yes = members.filter((member) => answerOf(member, date) === 1).length;
              const maybe = members.filter((member) => answerOf(member, date) === 2).length;
              const no = members.filter((member) => answerOf(member, date) === 0).length;
              return createEl(
                "div",
                { class: "cal-pop__cand" },
                createEl(
                  "div",
                  { class: "cal-pop__range" },
                  T.fmtRange(date),
                  " ",
                  createEl("span", { class: "counts" }, `○${yes}  △${maybe}  ×${no}`),
                ),
                members.map((member) => {
                  const answer = answerOf(member, date);
                  return createEl(
                    "div",
                    { class: "cal-pop__member" },
                    createEl("span", { class: "cal-dot", style: `background:${colorOf(member)}` }),
                    createEl("span", {}, T.memberLabel(member)),
                    createEl("span", { class: "muted" }, answer == null ? "未回答" : ANSWER_LABEL[answer]),
                  );
                }),
              );
            })
          : createEl("p", { class: "muted" }, "この日を含む候補日はありません。"),
      );
    }

    return createEl(
      "section",
      { class: "cal" },
      createEl("h3", {}, "カレンダー（候補日）"),
      createEl(
        "div",
        { class: "cal-nav-row" },
        createEl(
          "button",
          { class: "btn small", type: "button", "aria-label": "前の月", onclick: () => { calMonth = shiftMonth(calMonth, -1); calSelected = null; render(); } },
          "‹ 前月",
        ),
        createEl("b", {}, `${year}年${month}月`),
        createEl(
          "button",
          { class: "btn small", type: "button", "aria-label": "次の月", onclick: () => { calMonth = shiftMonth(calMonth, 1); calSelected = null; render(); } },
          "次月 ›",
        ),
      ),
      createEl(
        "div",
        { class: "cal-legend" },
        ...members.map((member) =>
          createEl("span", {}, createEl("span", { class: "cal-dot", style: `background:${colorOf(member)}` }), T.memberLabel(member)),
        ),
        createEl("span", {}, createEl("span", { class: "cal-dot" }), "○ 参加可"),
        createEl("span", {}, createEl("span", { class: "cal-dot maybe" }), "△ 未定"),
      ),
      createEl(
        "div",
        { class: "cal-grid" },
        ...["日", "月", "火", "水", "木", "金", "土"].map((label, index) =>
          createEl("div", { class: "cal-dow" + (index === 0 ? " sun" : index === 6 ? " sat" : "") }, label),
        ),
        ...cells,
      ),
      popup,
    );
  }

  Object.assign(ctx, { viewSchedule });
}
