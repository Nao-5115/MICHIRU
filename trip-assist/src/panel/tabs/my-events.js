// 登録済みカレンダー予定の一覧と削除
import * as T from "../../lib.js";

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
    progressEl,
    createEl,
    navBar,
    isDirPage,
    makeButton,
    goBack,
    clearNav,
    getLocal,
    currentMember,
  } = ctx;

  // ======================= 描画・起動 =======================
  const TABS = [
    ["schedule", "日程", viewSchedule],
    ["vote", "投票", viewVote],
    ["route", "ルート", viewRoute],
    ["spots", "スポット", viewSpots],
    ["members", "メンバー", viewMembersTab],
  ];
  const PROGRESS_STEPS = [
    ["schedule", "日程"],
    ["vote", "行き先"],
    ["route", "ルート"],
    ["share", "共有"],
  ];

  function renderProgress(trip) {
    progressEl.hidden = false;
    const local = getLocal();
    if (!trip || !local) {
      progressEl.replaceChildren(createEl("p", { class: "progress-note muted" }, "旅行を選ぶと、準備の進み具合が表示されます。"));
      return;
    }

    const dates = T.datesOf(trip);
    const adoptedCount = Object.values(trip.adopted || {}).filter(Boolean).length;
    const owner = isOwner();
    const member = currentMember();
    const hasConfirmedDate = dates.some((date) => date.id === local.confirmedId);
    const availability = (trip.schedules || {})[member?.key] || {};
    const hasAnsweredAllDates = dates.length > 0 && dates.every((date) => {
      for (let day = date.s; day <= date.e; day = T.addDays(day, 1)) {
        if (!Object.prototype.hasOwnProperty.call(availability, day)) return false;
      }
      return true;
    });
    const placesCount = (local.places || []).length;
    const sharedCount = (local.events || []).length;
    const done = owner
      ? [hasConfirmedDate, adoptedCount > 0, placesCount > 0, sharedCount > 0]
      : [hasAnsweredAllDates || adoptedCount > 0, adoptedCount > 0, false, false];
    const activeIndex = Math.max(0, done.findIndex((value) => !value));

    const steps = PROGRESS_STEPS.map(([key, label], index) => {
      const status = done[index] ? "done" : index === activeIndex ? "current" : "upcoming";
      const canNavigate = key !== "share" && (key !== "route" || owner);
      const attrs = {
        class: `progress-step ${status}`,
        type: "button",
        "aria-current": status === "current" ? "step" : null,
        onclick: canNavigate ? () => {
          state.tab = key;
          state.pendingScroll = 0;
          render();
        } : undefined,
      };
      return createEl(canNavigate ? "button" : "div", attrs,
        createEl("span", { class: "progress-step__mark", "aria-hidden": "true" }, done[index] ? "✓" : String(index + 1)),
        createEl("span", {}, label),
      );
    });

    let note;
    let targetTab = null;
    let targetLabel = "";
    if (owner) {
      if (!hasConfirmedDate) {
        note = dates.length ? "候補日の出欠を集めて日程を確定しましょう。" : "日程タブで候補日を追加しましょう。";
        targetTab = "schedule";
        targetLabel = "日程を確認";
      } else if (!adoptedCount) {
        note = "投票タブで行き先候補を選び、採用しましょう。";
        targetTab = "vote";
        targetLabel = "行き先を決める";
      } else if (!placesCount) {
        note = "ルートタブで訪問地点や旅のしおりを整えましょう。";
        targetTab = "route";
        targetLabel = "ルートを作る";
      } else if (!sharedCount) {
        note = "ルートを確認したら、カレンダーに登録してメンバーと共有しましょう。";
        targetTab = "route";
        targetLabel = "ルートを確認";
      } else {
        note = "旅行の準備ができました。必要に応じて各タブから内容を更新できます。";
      }
    } else if (!dates.length) {
      note = "幹事が候補日を登録すると、日程タブで出欠を回答できます。";
      targetTab = "schedule";
      targetLabel = "日程を見る";
    } else if (!hasAnsweredAllDates && !adoptedCount) {
      note = "日程タブで候補日の参加可否を登録しましょう。";
      targetTab = "schedule";
      targetLabel = "出欠を登録";
    } else if (!adoptedCount) {
      note = "投票タブで行きたい場所に投票しましょう。";
      targetTab = "vote";
      targetLabel = "行き先に投票";
    } else {
      note = "行き先が決まりました。ルートやカレンダー共有は幹事が準備します。";
    }

    progressEl.replaceChildren(
      createEl("div", { class: "progress-steps", role: "group", "aria-label": "旅行の準備状況" }, ...steps),
      createEl("div", { class: "progress-summary" },
        createEl("p", { class: "progress-note" }, note),
        targetTab ? makeButton(targetLabel, () => {
          state.tab = targetTab;
          state.pendingScroll = 0;
          render();
        }, "small primary") : null,
      ),
    );
  }

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
    progressEl.hidden = !signedIn;
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
      renderProgress(trip);
      const view = (TABS.find(([key]) => key === state.tab) || TABS[0])[2];
      body.replaceChildren(...(view() || []).filter(Boolean));
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
