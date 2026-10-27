// 「日程」タブ（候補日と出欠のリアルタイム同期）
import * as T from "../../lib.js";

export function installScheduleTab(ctx) {
  const { gate, tripData, currentMember, isOwner, createEl, makeButton, flash, runAction, callFirebase, state, refreshEvents, getLocal, saveLocal, warnFor } = ctx;
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
  let calPaint = null;    // 登録する印（1=○ 2=△ 0=×）。null のときは日付クリックで詳細を開く
  let calDrag = null;     // ドラッグ中の範囲（押した日・今の日・登録する値）
  // 押していた指を離したら、選んだ範囲に登録する
  const endCalDrag = () => {
    if (!calDrag) return;
    const drag = calDrag;
    calDrag = null;
    drag.finish(drag);
  };
  window.addEventListener("pointerup", endCalDrag);
  window.addEventListener("pointercancel", endCalDrag);

  // ======================= 日程タブ（出欠のリアルタイム同期） =======================
  function viewSchedule() {
    const gateView = gate();
    if (gateView) return gateView;
    const trip = tripData(),
      myMember = currentMember(),
      owner = isOwner();
    const members = T.membersOf(trip),
      dates = T.datesOf(trip);
    const startDateInput = createEl("input", { type: "date" }),
      endDateInput = createEl("input", { type: "date" });
    const secAdd = myMember
      ? createEl(
          "section",
          {},
          createEl("h3", {}, "候補日を追加"),
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
    const secCal = dates.length ? buildCalendar(trip, members, dates, myMember, owner) : null;
    return [secAdd, secCal];
  }

  // 自分のカレンダーの予定（候補日の期間内）を一覧で表示
  function calEventList(events) {
    const pad = (n) => String(n).padStart(2, "0");
    const whenOf = (event) => {
      if (event.start.dateTime) {
        const start = new Date(event.start.dateTime);
        return `${start.getMonth() + 1}/${start.getDate()} ${pad(start.getHours())}:${pad(start.getMinutes())}`;
      }
      return `${event.start.date.slice(5).replace("-", "/")} 終日`;
    };
    return createEl(
      "section",
      { class: "cal-events" },
      createEl("h3", {}, `自分のカレンダーの予定（${events.length} 件）`),
      events.length
        ? createEl(
            "ul",
            { class: "list" },
            ...events.map((event) =>
              createEl("li", {}, createEl("b", {}, whenOf(event)), " ", event.summary || "（予定名なし）"),
            ),
          )
        : createEl("p", { class: "muted" }, "候補日の期間に予定はありません。"),
    );
  }

  function buildCalendar(trip, members, dates, myMember, owner) {
    const answers = trip.answers || {};
    const answerOf = (member, date) => (answers[member.key] || {})[date.id];
    // 候補日以外の日の個人の予定
    const mark = (member, day) => ((trip.schedules || {})[member.key] || {})[day];
    const colorOf = (member) => MEMBER_COLORS[Math.max(0, members.indexOf(member)) % MEMBER_COLORS.length];
    // その日を含む候補日
    const coveringOn = (day) => dates.filter((date) => date.s <= day && day <= date.e);
    const cellEls = new Map(); // 日 → セル（ドラッグ中の強調表示に使う）
    const daysBetween = (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const out = [];
      const cur = new Date(lo + "T00:00:00");
      const end = new Date(hi + "T00:00:00");
      while (cur <= end) {
        out.push(ymd(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    };
    const highlightDrag = () => {
      if (!calDrag) return;
      const inRange = new Set(daysBetween(calDrag.startDay, calDrag.endDay));
      for (const [day, el] of cellEls) el.classList.toggle("is-drag", inRange.has(day));
    };
    const applyPaint = async (drag) => {
      const targets = new Map(); // 候補日（その日の出欠）
      const dayMarks = new Set(); // 候補日以外の日（個人の予定）
      for (const day of daysBetween(drag.startDay, drag.endDay)) {
        const covering = coveringOn(day);
        if (covering.length) for (const date of covering) targets.set(date.id, date);
        else dayMarks.add(day);
      }
      if (!targets.size && !dayMarks.size) return render();
      let done = 0;
      let failed = "";
      for (const date of targets.values()) {
        const result = await callFirebase("setAnswer", { tripId: state.tripId, dateId: date.id, v: drag.value });
        if (result.ok) done += 1;
        else failed = result.error;
      }
      for (const day of dayMarks) {
        const result = await callFirebase("setDayMark", { tripId: state.tripId, day, v: drag.value });
        if (result.ok) done += 1;
        else failed = result.error;
      }
      if (failed) flash(failed, "err");
      else
        flash(
          drag.value == null ? `${done} 件を取り消しました` : `${ANSWER_LABEL[drag.value]} を ${done} 件に登録しました`,
          "ok",
        );
      render();
    };

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
            .map((member) => createEl("span", { class: "cal-dot maybe", title: `${T.memberLabel(member)}：△`, style: `background:${colorOf(member)}` })),
        ),
      );
      const classes = ["cal-cell"];
      if (covering.length) classes.push("is-cand");
      if (day === todayStr) classes.push("is-today");
      if (day === calSelected) classes.push("is-sel");
      if (dow === 0) classes.push("sun");
      if (dow === 6) classes.push("sat");
      const personalRow = covering.length
        ? null
        : createEl(
            "div",
            { class: "cal-row" },
            members
              .filter((member) => mark(member, day) === 1)
              .map((member) => createEl("span", { class: "cal-dot", title: `${T.memberLabel(member)}：○`, style: `background:${colorOf(member)}` })),
            members
              .filter((member) => mark(member, day) === 2)
              .map((member) => createEl("span", { class: "cal-dot maybe", title: `${T.memberLabel(member)}：△`, style: `background:${colorOf(member)}` })),
          );
      const content = [
        createEl("span", { class: "cal-day" }, String(d)),
        ...rows,
        personalRow,
        covering.length > 2 ? createEl("span", { class: "cal-more" }, `他 ${covering.length - 2} 件`) : null,
      ];
      const cellProps = {
        class: classes.join(" "),
        onpointerdown: (event) => {
          if (calPaint === null || event.button !== 0) return;
          event.preventDefault();
          // 押した日の候補日がすべて同じ印なら取り消し、そうでなければ登録する
          const targets = coveringOn(day);
          const already = targets.length > 0 ? targets.every((date) => answerOf(myMember, date) === calPaint) : mark(myMember, day) === calPaint;
          calDrag = { startDay: day, endDay: day, value: already ? null : calPaint, finish: applyPaint };
          highlightDrag();
        },
        onpointerenter: () => {
          if (!calDrag) return;
          calDrag.endDay = day;
          highlightDrag();
        },
      };
      const el = createEl(
        "button",
        {
          ...cellProps,
          type: "button",
          "aria-label": covering.length ? `${month}月${d}日：候補日 ${covering.length} 件` : `${month}月${d}日`,
          onclick: () => {
            if (calPaint !== null) return; // 印を選んでいる間は詳細を開かない
            calSelected = calSelected === day ? null : day;
            render();
          },
        },
        ...content,
      );
      cellEls.set(day, el);
      cells.push(el);
    }
    while (cells.length % 7) cells.push(createEl("div", { class: "cal-cell blank" }));

    // 候補日ごとの操作（旧一覧と同じ処理）
    const candidateActions = (date) => {
      const mine = answerOf(myMember, date);
      return createEl(
        "div",
        { class: "cal-pop__actions" },
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
                  { tripId: state.tripId, dateId: date.id, v: value === "" ? null : +value },
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
              createEl("option", { value, selected: String(mine ?? "") === value }, label),
            ),
          ),
        ),
        owner
          ? createEl(
              "div",
              { class: "row" },
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
                  if (!confirm(`候補日 ${T.fmtRange(date)} を削除します。よろしいですか？`)) return;
                  if (getLocal().confirmedId === date.id) {
                    getLocal().confirmedId = null;
                    await saveLocal();
                  }
                  await runAction("removeDate", { tripId: state.tripId, dateId: date.id }, "候補日を削除しました");
                },
                "small danger",
              ),
            )
          : null,
        warnFor(date),
      );
    };

    // 候補日以外の日の詳細（個人の予定）
    const personalSection = (day) =>
      createEl(
        "div",
        { class: "cal-pop__cand" },
        createEl("div", { class: "cal-pop__range" }, "個人の予定（候補日以外）"),
        members.map((member) => {
          const value = mark(member, day);
          return createEl(
            "div",
            { class: "cal-pop__member" },
            createEl("span", { class: "cal-dot", style: `background:${colorOf(member)}` }),
            createEl("span", {}, T.memberLabel(member)),
            createEl("span", { class: "muted" }, value == null ? "未登録" : ANSWER_LABEL[value]),
          );
        }),
        createEl(
          "div",
          { class: "cal-pop__actions" },
          createEl(
            "label",
            {},
            "あなたの予定",
            createEl(
              "select",
              {
                onchange: async (event) => {
                  const value = event.target.value;
                  event.target.blur();
                  await runAction(
                    "setDayMark",
                    { tripId: state.tripId, day, v: value === "" ? null : +value },
                    "予定を更新しました",
                  );
                },
              },
              [
                ["", "未登録"],
                ["1", "○ 参加可"],
                ["2", "△ 未定"],
                ["0", "× 不可"],
              ].map(([value, label]) =>
                createEl("option", { value, selected: String(mark(myMember, day) ?? "") === value }, label),
              ),
            ),
          ),
        ),
      );

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
                candidateActions(date),
              );
            })
          : personalSection(calSelected),
      );
    }

    const PAINT_OPTIONS = [
      [1, "○", "参加可"],
      [2, "△", "未定"],
      [0, "×", "不可"],
    ];
    const paintBar = createEl(
      "div",
      {},
      createEl(
        "div",
        { class: "cal-paint" },
        ...PAINT_OPTIONS.map(([value, symbol, label]) =>
          createEl(
            "button",
            {
              class: "cal-paint__btn" + (calPaint === value ? " on" : ""),
              type: "button",
              "aria-pressed": String(calPaint === value),
              onclick: () => {
                calPaint = calPaint === value ? null : value;
                calDrag = null;
                calSelected = null;
                render();
              },
            },
            createEl("span", { class: "cal-paint__sym" }, symbol),
            label,
          ),
        ),
      ),
    );

    return createEl(
      "section",
      { class: "cal" },
      createEl("h3", {}, "カレンダー（候補日）"),
      createEl(
        "div",
        { class: "cal-nav-row" },
        createEl(
          "button",
          { class: "btn small cal-arrow", type: "button", "aria-label": "前の月", onclick: () => { calMonth = shiftMonth(calMonth, -1); calSelected = null; render(); } },
          "‹",
        ),
        createEl("b", {}, `${year}年${month}月`),
        createEl(
          "button",
          { class: "btn small cal-arrow", type: "button", "aria-label": "次の月", onclick: () => { calMonth = shiftMonth(calMonth, 1); calSelected = null; render(); } },
          "›",
        ),
      ),
      paintBar,
      createEl(
        "div",
        { class: "cal-grid" + (calPaint !== null ? " painting" : "") },
        ...["日", "月", "火", "水", "木", "金", "土"].map((label, index) =>
          createEl("div", { class: "cal-dow" + (index === 0 ? " sun" : index === 6 ? " sat" : "") }, label),
        ),
        ...cells,
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
        { class: "row" },
        makeButton("自分のカレンダーの予定を重ねて表示", () => refreshEvents(true)),
      ),
      state.events ? calEventList(state.events) : null,
      popup,
    );
  }

  Object.assign(ctx, { viewSchedule });
}
