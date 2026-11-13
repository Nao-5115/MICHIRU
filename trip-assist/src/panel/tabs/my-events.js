// 登録済みカレンダー予定の一覧と削除

export function installMyEvents(ctx) {
  const {
    viewMembersTab,
    signinCard,
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
    ["members", "メンバー", viewMembersTab],
    ["schedule", "日程", viewSchedule],
    ["vote", "投票", viewVote],
    ["route", "ルート", viewRoute],
    ["spots", "スポット", viewSpots],
  ];
  // 各タブの一番上に表示する説明文
  const TAB_INTRO = {
    members: "旅行に参加するメンバーを確認・追加できます。",
    schedule: "旅程の日程を決めましょう。旅程の候補日を登録し、各自の出欠を確認入力できます。",
    vote: "予算等の希望や、行きたい場所を入力できます。AIがおすすめのスポットを提案する機能もあります。",
    route: "旅のしおりを作り、集合場所とルートを確認できます。",
    spots: "おすすめのスポットを共有・確認できます。",
  };
  function render() {
    if (!state.open) return;
    state.dirty = false;
    ctx.renderSwitch();
    const keep = body.scrollTop;
    const trip = tripData();
    // ヘッダーのロゴ横には旅行名を表示しない
    subEl.textContent = "";
    // サインイン前は、タブを隠してサインインの案内だけを表示する
    const signedIn = state.auth.state === "signedIn";
    tabsEl.hidden = !signedIn;
    tabsEl.replaceChildren(
      ...TABS.map(([key, label]) =>
        createEl(
          "button",
          {
            class: "tab" + (state.tab === key ? " active" : ""),
            type: "button",
            onclick: () => {
              state.tab = key;
              state.pendingScroll = 0; // タブを切り替えたら一番上から表示する
              render();
            },
          },
          label,
        ),
      ),
    );
    if (!signedIn) {
      body.replaceChildren(signinCard());
    } else {
      const [tabKey, , view] = TABS.find(([key]) => key === state.tab);
      body.replaceChildren(
        createEl(
          "div",
          { class: "tab-intro" },
          createEl("p", { class: "tab-intro__text" }, TAB_INTRO[tabKey]),
          createEl("div", { class: "tab-intro__line" }),
        ),
        ...(view() || []).filter(Boolean),
      );
    }
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
