// 登録済みカレンダー予定の一覧と削除

export function installMyEvents(ctx) {
  const {
    viewTrip,
    viewSchedule,
    viewVote,
    viewRoute,
    viewRegister,
    viewSpots,
    state,
    body,
    tripData,
    subEl,
    isOwner,
    tabsEl,
    createEl,
    navBar,
    isDirPage,
    makeButton,
    goBack,
    clearNav,
  } = ctx;

  // ======================= 描画・起動 =======================
  const TABS = [
    ["trip", "旅行", viewTrip],
    ["schedule", "日程", viewSchedule],
    ["vote", "投票", viewVote],
    ["route", "ルート", viewRoute],
    ["spots", "スポット", viewSpots],
  ];
  function render() {
    if (!state.open) return;
    state.dirty = false;
    const keep = body.scrollTop;
    const trip = tripData();
    subEl.textContent =
      trip && trip.meta
        ? `／ ${trip.meta.name}${isOwner() ? "（幹事）" : ""}`
        : "";
    tabsEl.replaceChildren(
      ...TABS.map(([key, label]) =>
        createEl(
          "button",
          {
            class: "tab" + (state.tab === key ? " active" : ""),
            type: "button",
            onclick: () => {
              state.tab = key;
              render();
            },
          },
          label,
        ),
      ),
    );
    const view = TABS.find(([key]) => key === state.tab)[2];
    body.replaceChildren(...view().filter(Boolean));
    navBar.hidden = !(state.nav && isDirPage());
    if (!navBar.hidden) {
      navBar.replaceChildren(
        createEl("span", {}, "ルート案内を表示中"),
        makeButton("← 元の画面に戻る", goBack, "small primary"),
        makeButton(
          "閉じる",
          async () => {
            await clearNav();
            render();
          },
          "small",
        ),
      );
    }
    if (state.pendingScroll !== null) {
      body.scrollTop = state.pendingScroll;
      state.pendingScroll = null;
    } else body.scrollTop = keep;
  }

  Object.assign(ctx, { TABS, render });
}
