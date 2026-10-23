// 登録済みカレンダー予定の一覧と削除

export function installMyEvents(c) {
  const { viewTrip, viewSchedule, viewVote, viewRoute, viewRegister, viewSpots, S, body, tripData, subEl, isOwner, tabsEl, h, navBar, isDirPage, btn, goBack, clearNav } = c;

  // ======================= 描画・起動 =======================
  const TABS = [
    ["trip", "旅行", viewTrip],
    ["schedule", "日程", viewSchedule],
    ["vote", "投票", viewVote],
    ["route", "ルート", viewRoute],
    ["register", "登録", viewRegister],
    ["spots", "スポット", viewSpots],
  ];
  function render() {
    if (!S.open) return;
    S.dirty = false;
    const keep = body.scrollTop;
    const d = tripData();
    subEl.textContent =
      d && d.meta ? `／ ${d.meta.name}${isOwner() ? "（幹事）" : ""}` : "";
    tabsEl.replaceChildren(
      ...TABS.map(([k, label]) =>
        h(
          "button",
          {
            class: "tab" + (S.tab === k ? " active" : ""),
            type: "button",
            onclick: () => {
              S.tab = k;
              render();
            },
          },
          label,
        ),
      ),
    );
    const view = TABS.find(([k]) => k === S.tab)[2];
    body.replaceChildren(...view().filter(Boolean));
    navBar.hidden = !(S.nav && isDirPage());
    if (!navBar.hidden) {
      navBar.replaceChildren(
        h("span", {}, "ルート案内を表示中"),
        btn("← 元の画面に戻る", goBack, "small primary"),
        btn(
          "閉じる",
          async () => {
            await clearNav();
            render();
          },
          "small",
        ),
      );
    }
    if (S.pendingScroll !== null) {
      body.scrollTop = S.pendingScroll;
      S.pendingScroll = null;
    } else body.scrollTop = keep;
  }

  Object.assign(c, { TABS, render });
}
