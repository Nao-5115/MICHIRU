// 「日程」タブ（候補日と出欠のリアルタイム同期 + Google カレンダー登録）
import * as T from "../../lib.js";

export function installScheduleTab(ctx) {
  const {
    gate,
    tripData,
    currentMember,
    isOwner,
    createEl,
    makeButton,
    flash,
    runAction,
    state,
    getLocal,
    saveLocal,
    sendMessage,
  } = ctx;
  const render = (...args) => ctx.render(...args);

  const refreshEvents = (...args) => ctx.refreshEvents(...args);
  const warnFor = (...args) => ctx.warnFor(...args);
  const currentItinerary = (...args) => ctx.currentItinerary(...args);
  const registerToCalendar = (...args) => ctx.registerToCalendar(...args);

  // ======================= 日程タブ =======================
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

    // --- 候補日の追加（幹事のみ） ---
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
              if (!startDateInput.value)
                return flash("開始日を入力してください", "err");
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

    // --- 候補日と出欠 ---
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
        makeButton("自分のカレンダーの予定を重ねて表示", () =>
          refreshEvents(true),
        ),
      ),
      createEl("div", { class: "calendar-events-divider", "aria-hidden": "true" }),
      ranked.length
        ? createEl(
            "ul",
            { class: "list trip-list" },
            ranked.map((candidate) => {
              const date = candidate.date,
                mine = ((trip.answers || {})[myMember.key] || {})[date.id];
              const isConfirmed = getLocal().confirmedId === date.id;
              return createEl(
                "li",
                { class: isConfirmed ? "sel" : "" },
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
                  ? createEl(
                      "div",
                      { class: "muted" },
                      "○ " + candidate.yes.join("、"),
                    )
                  : null,
                candidate.maybe.length
                  ? createEl(
                      "div",
                      { class: "muted" },
                      "△ " + candidate.maybe.join("、"),
                    )
                  : null,
                candidate.no.length
                  ? createEl(
                      "div",
                      { class: "muted" },
                      "× " + candidate.no.join("、"),
                    )
                  : null,
                candidate.none.length
                  ? createEl(
                      "div",
                      { class: "muted" },
                      "未回答 " + candidate.none.join("、"),
                    )
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
                          {
                            value: value,
                            selected: String(mine ?? "") === value,
                          },
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
                          isConfirmed ? "確定中" : "この日で確定",
                          async () => {
                            getLocal().confirmedId = date.id;
                            await saveLocal();
                            state.regResults = null;
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

    // --- Google カレンダーに登録 ---
    const settings = getLocal().settings;
    const others = members.filter((member) => member.key !== myMember.key);
    const itinerary = currentItinerary();
    const cand = dates.find((date) => date.id === getLocal().confirmedId);
    const secCalendar = createEl(
      "section",
      {},
      createEl("h3", {}, "Google カレンダーに登録"),
      cand
        ? createEl("p", {}, "確定日程: ", createEl("b", {}, T.fmtRange(cand)))
        : createEl(
            "p",
            { class: "warn" },
            "日程が未確定です。上の候補日で「この日で確定」を押すか、下から選んでください。",
          ),
      createEl(
        "select",
        {
          onchange: async (event) => {
            getLocal().confirmedId = event.target.value || null;
            await saveLocal();
            state.regResults = null;
            render();
          },
        },
        createEl("option", { value: "" }, "候補日から選択…"),
        dates.map((date) =>
          createEl(
            "option",
            { value: date.id, selected: date.id === getLocal().confirmedId },
            T.fmtRange(date),
          ),
        ),
      ),
      createEl(
        "p",
        { class: "muted" },
        itinerary
          ? `しおり: ${itinerary.rows.length} 地点を予定の説明欄に記載し、最初の訪問地点を場所に設定します。`
          : "しおりが未作成です（日程のみ登録されます）。",
      ),
      createEl(
        "label",
        { class: "inline" },
        createEl("input", {
          type: "checkbox",
          checked: settings.invite && others.length > 0,
          disabled: !others.length,
          onchange: async (event) => {
            settings.invite = event.target.checked;
            await saveLocal();
            render();
          },
        }),
        others.length
          ? `メンバー ${others.length} 人を招待して、招待メールを送る`
          : "招待できるメンバーがいません",
      ),
      settings.invite && others.length
        ? createEl("div", { class: "warn" }, "⚠ " + ctx.NOTICE)
        : null,
      createEl(
        "label",
        { class: "inline" },
        createEl("input", {
          type: "checkbox",
          checked: settings.timed,
          disabled: !itinerary,
          onchange: async (event) => {
            settings.timed = event.target.checked;
            await saveLocal();
          },
        }),
        "各地点を時刻付きの予定としても登録（あなたのカレンダーのみ・開始日に作成）",
      ),
      makeButton("カレンダーに登録", registerToCalendar, "primary"),
      state.regResults
        ? createEl(
            "ul",
            { class: "list" },
            state.regResults.map((result) =>
              createEl(
                "li",
                { class: result.ok ? "okli" : "warn" },
                (result.ok ? "✔ " : "✖ ") +
                  result.name +
                  (result.ok ? "" : ` — ${result.error}`),
              ),
            ),
          )
        : null,
    );

    // 全部まとめて返す（ここが抜けてた）
    return [secAdd, secList, secCalendar, viewMyEvents()];
  }

  // この拡張機能から登録した予定の一覧と削除
  function viewMyEvents() {
    const list = [...getLocal().events].sort((first, second) =>
      first.start.localeCompare(second.start),
    );
    for (const selectedId of [...state.selDel])
      if (!list.some((item) => item.id === selectedId))
        state.selDel.delete(selectedId);

    return createEl(
      "section",
      {},
      createEl("h3", {}, "この拡張機能から登録した予定"),
      list.length
        ? createEl(
            "ul",
            { class: "list" },
            list.map((item) =>
              createEl(
                "li",
                {},
                createEl(
                  "label",
                  { class: "inline" },
                  createEl("input", {
                    type: "checkbox",
                    checked: state.selDel.has(item.id),
                    onchange: (changeEvent) => {
                      if (changeEvent.target.checked) state.selDel.add(item.id);
                      else state.selDel.delete(item.id);
                    },
                  }),
                  createEl(
                    "span",
                    {},
                    item.title,
                    item.attendees
                      ? createEl(
                          "span",
                          { class: "badge" },
                          `ゲスト${item.attendees}人`,
                        )
                      : null,
                    createEl("div", { class: "muted" }, T.fmtEventWhen(item)),
                  ),
                ),
              ),
            ),
          )
        : createEl(
            "p",
            { class: "muted" },
            "登録した予定はありません。（カレンダー上のそれ以外の予定は、ここには表示されず削除もできません）",
          ),
      list.length
        ? createEl(
            "div",
            {},
            makeButton(
              "すべて選択",
              () => {
                list.forEach((item) => state.selDel.add(item.id));
                render();
              },
              "small",
            ),
            makeButton(
              "選択を解除",
              () => {
                state.selDel.clear();
                render();
              },
              "small",
            ),
            makeButton(
              "選択した予定を削除",
              async () => {
                const targets = list.filter((item) =>
                  state.selDel.has(item.id),
                );
                if (!targets.length)
                  return flash("削除する予定を選択してください", "err");
                const lines = targets
                  .map((item) => `・${item.title}（${T.fmtEventWhen(item)}）`)
                  .join("\n");
                const mail = targets.some((item) => item.attendees)
                  ? "\nゲストには、予定のキャンセル通知メールが送信されます。"
                  : "";
                if (
                  !confirm(
                    `Google カレンダーから次の ${targets.length} 件の予定を削除します。この操作は取り消せません。${mail}\n\n${lines}\n\nよろしいですか？`,
                  )
                )
                  return;
                state.delResults = [];
                for (const target of targets) {
                  const response = await sendMessage({
                    type: "cal:delete",
                    eventId: target.id,
                    notify: target.attendees > 0,
                  });
                  const gone =
                    !response.ok &&
                    (response.status === 404 || response.status === 410);
                  if (response.ok || gone) {
                    // 成功、またはカレンダー側で削除済み → 記録を整理
                    getLocal().events = getLocal().events.filter(
                      (saved) => saved.id !== target.id,
                    );
                    state.selDel.delete(target.id);
                    state.delResults.push({
                      ok: true,
                      text: response.ok
                        ? `${target.title}: 削除しました`
                        : `${target.title}: カレンダー上に既に存在しない（手動で削除済み）ため、記録のみ整理しました`,
                    });
                  } else {
                    state.delResults.push({
                      ok: false,
                      text: `${target.title}: 削除に失敗しました — ${response.error}（記録は残してあります。再度お試しください）`,
                    });
                    if (/認証|client_id/.test(response.error)) break; // 認証系の失敗は打ち切り
                  }
                }
                await saveLocal();
                const failedCount = state.delResults.filter(
                  (result) => !result.ok,
                ).length;
                flash(
                  failedCount
                    ? `${failedCount} 件の削除に失敗しました`
                    : `${state.delResults.length} 件の予定を処理しました`,
                  failedCount ? "err" : "ok",
                );
                render();
              },
              "danger",
            ),
          )
        : null,
      state.delResults
        ? createEl(
            "ul",
            { class: "list" },
            state.delResults.map((result) =>
              createEl(
                "li",
                { class: result.ok ? "okli" : "warn" },
                (result.ok ? "✔ " : "✖ ") + result.text,
              ),
            ),
          )
        : null,
    );
  }

  Object.assign(ctx, { viewSchedule });
}
