// 「登録」タブ（Google カレンダーへの予定登録）
import * as T from "../../lib.js";

export function installRegisterTab(ctx) {
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

  function viewRegister() {
    const gateView = gate(true);
    if (gateView) return gateView;
    const trip = tripData(),
      settings = getLocal().settings,
      myMember = currentMember();
    const others = T.membersOf(trip).filter(
      (member) => member.key !== myMember.key,
    );
    const itinerary = currentItinerary();
    const cand = T.datesOf(trip).find(
      (date) => date.id === getLocal().confirmedId,
    );
    const section = createEl(
      "section",
      {},
      createEl("h3", {}, "Google カレンダーに登録"),
      cand
        ? createEl("p", {}, "確定日程: ", createEl("b", {}, T.fmtRange(cand)))
        : createEl(
            "p",
            { class: "warn" },
            "日程が未確定です。「日程」タブで「この日で確定」を押すか、下から選んでください。",
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
        T.datesOf(trip).map((date) =>
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
            { class: "list trip-list" },
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
    return [section, viewMyEvents()];
  }

  // この拡張機能から登録した予定の一覧と削除
  function viewMyEvents() {
    const list = [...getLocal().events].sort((first, second) =>
      first.start.localeCompare(second.start),
    );
    for (const selectedId of [...state.selDel])
      if (!list.some((event) => event.id === selectedId))
        state.selDel.delete(selectedId);
    return createEl(
      "section",
      {},
      createEl("h3", {}, "この拡張機能から登録した予定"),
      createEl(
        "ul",
        { class: "list trip-list trip-list-divider", "aria-hidden": "true" },
        createEl("li", {}),
      ),
      list.length
        ? createEl(
            "ul",
            { class: "list trip-list" },
            list.map((event) =>
              createEl(
                "li",
                {},
                createEl(
                  "label",
                  { class: "inline" },
                  createEl("input", {
                    type: "checkbox",
                    checked: state.selDel.has(event.id),
                    onchange: (event) => {
                      if (event.target.checked) state.selDel.add(event.id);
                      else state.selDel.delete(event.id);
                    },
                  }),
                  createEl(
                    "span",
                    {},
                    event.title,
                    event.attendees
                      ? createEl(
                          "span",
                          { class: "badge" },
                          `ゲスト${event.attendees}人`,
                        )
                      : null,
                    createEl("div", { class: "muted" }, T.fmtEventWhen(event)),
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
                list.forEach((event) => state.selDel.add(event.id));
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
                const targets = list.filter((event) =>
                  state.selDel.has(event.id),
                );
                if (!targets.length)
                  return flash("削除する予定を選択してください", "err");
                const lines = targets
                  .map(
                    (event) => `・${event.title}（${T.fmtEventWhen(event)}）`,
                  )
                  .join("\n");
                const mail = targets.some((event) => event.attendees)
                  ? "\nゲストには、予定のキャンセル通知メールが送信されます。"
                  : "";
                if (
                  !confirm(
                    `Google カレンダーから次の ${targets.length} 件の予定を削除します。この操作は取り消せません。${mail}\n\n${lines}\n\nよろしいですか？`,
                  )
                )
                  return;
                state.delResults = [];
                for (const event of targets) {
                  const response = await sendMessage({
                    type: "cal:delete",
                    eventId: event.id,
                    notify: event.attendees > 0,
                  });
                  const gone =
                    !response.ok &&
                    (response.status === 404 || response.status === 410);
                  if (response.ok || gone) {
                    // 成功、またはカレンダー側で削除済み → 記録を整理
                    getLocal().events = getLocal().events.filter(
                      (event) => event.id !== event.id,
                    );
                    state.selDel.delete(event.id);
                    state.delResults.push({
                      ok: true,
                      text: response.ok
                        ? `${event.title}: 削除しました`
                        : `${event.title}: カレンダー上に既に存在しない（手動で削除済み）ため、記録のみ整理しました`,
                    });
                  } else {
                    state.delResults.push({
                      ok: false,
                      text: `${event.title}: 削除に失敗しました — ${response.error}（記録は残してあります。再度お試しください）`,
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
            createEl("div", { class: "calendar-events-divider", "aria-hidden": "true" }),
          )
        : null,
      state.delResults
        ? createEl(
            "ul",
            { class: "list trip-list" },
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

  Object.assign(ctx, { viewRegister, viewMyEvents });
}
