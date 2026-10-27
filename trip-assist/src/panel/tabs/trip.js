// 「旅行」タブ（作成・一覧・削除・招待）とメンバー管理
import * as T from "../../lib.js";
import { localKey } from "../constants.js";

// 候補日から「日程: 11/1(日)〜11/3(火)（候補2件）」の要約文を作る
function tripDateSummary(trip) {
  const dates = trip.dates || [];
  if (!dates.length) return "日程: 候補日は未登録";
  const from = dates.map((d) => d.s).sort()[0];
  const to = dates.map((d) => d.e).sort().slice(-1)[0];
  const range = from === to ? T.fmtDate(from) : `${T.fmtDate(from)}〜${T.fmtDate(to)}`;
  return `日程: ${range}（候補${dates.length}件）`;
}

export function installTripTab(ctx) {
  const { state, signinCard, currentMember, createEl, makeButton, callFirebase, flash, selectTrip, body, sendMessage, gate, isOwner, runAction, makeMsIcon } = ctx;

  // ======================= 旅行タブ =======================
  function viewTrip() {
    if (state.auth.state !== "signedIn") return [signinCard()];
    const myMember = currentMember();
    const nameIn = createEl("input", {
      type: "text",
      placeholder: "新しい旅行の名前（例: 箱根旅行）",
      maxlength: 60,
    });
    const secUser = createEl(
      "section",
      {},
      createEl(
        "div",
        { class: "line" },
        createEl("span", { class: "muted" }, `サインイン中: ${myMember.email}`),
        makeButton(
          "サインアウト",
          async () => {
            const result = await callFirebase("signOut");
            if (!result.ok) flash(result.error, "err");
          },
          "small",
        ),
      ),
    );
    const secList = createEl(
      "section",
      {},
      createEl("h3", {}, "旅行の選択"),
      state.trips.length
        ? createEl(
            "ul",
            { class: "trip-list" },
            state.trips.map((trip) => {
              const isMine = trip.ownerEmail === myMember.email;
              return createEl(
                "li",
                {
                  class: "trip-row" + (trip.id === state.tripId ? " sel" : ""),
                  onclick: () => {
                    if (trip.id !== state.tripId) selectTrip(trip.id);
                  },
                },
                createEl(
                  "div",
                  { class: "trip-row__info" },
                  createEl(
                    "div",
                    { class: "trip-row__head" },
                    createEl("b", { class: "trip-row__name" }, trip.name),
                    isMine
                      ? createEl(
                          "button",
                          {
                            class: "icon-delete",
                            type: "button",
                            title: "旅行を削除",
                            "aria-label": "旅行を削除",
                            onclick: (event) => {
                              event.stopPropagation(); // 行全体の選択を発火させない
                              deleteTrip(trip);
                            },
                          },
                          makeMsIcon('<path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>', 18),
                        )
                      : null,
                  ),
                  createEl("div", { class: "muted" }, tripDateSummary(trip)),
                ),
                createEl(
                  "button",
                  {
                    class: "trip-route-btn",
                    type: "button",
                    title: "この旅行のルートを表示",
                    "aria-label": "この旅行のルートを表示",
                    onclick: async (event) => {
                      event.stopPropagation(); // 行の選択と二重に動かさない
                      state.tab = "route";
                      await selectTrip(trip.id); // 選択して描画（ルートタブ）
                    },
                  },
                  makeMsIcon('<path d="M320-360h80v-120h140v100l140-140-140-140v100H360q-17 0-28.5 11.5T320-520v160ZM480-80q-15 0-29.5-6T424-104L104-424q-12-12-18-26.5T80-480q0-15 6-29.5t18-26.5l320-320q12-12 26.5-18t29.5-6q15 0 29.5 6t26.5 18l320 320q12 12 18 26.5t6 29.5q0 15-6 29.5T856-424L536-104q-12 12-26.5 18T480-80ZM320-320l160 160 320-320-320-320-320 320 160 160Zm160-160Z"/>', 22),
                  createEl("span", {}, "ルート"),
                ),
              );
            }),
          )
        : createEl(
            "p",
            { class: "muted" },
            "参加している旅行はまだありません。新規作成するか、幹事に招待してもらってください。",
          ),
      createEl("h3", { class: "divided" }, "新しい旅行を作る"),
      nameIn,
      makeButton(
        "作成（あなたが幹事になります）",
        async () => {
          const name = nameIn.value.trim();
          if (!name) return flash("旅行名を入力してください", "err");
          const result = await callFirebase("createTrip", { name });
          if (!result.ok) return flash(result.error, "err");
          flash("旅行を作成しました");
          await selectTrip(result.id);
        },
        "primary",
      ),
    );
    return [secUser, secList, viewMembers()];
  }

  async function deleteTrip(trip) {
    const registeredEvents =
      ((await chrome.storage.local.get(localKey(trip.id)))[localKey(trip.id)] || {}).events || [];
    const warn = registeredEvents.length
      ? `\n\nGoogle カレンダーに登録済みの予定（${registeredEvents.length} 件）は削除されません。先に「登録」タブで削除してください。`
      : "";
    if (
      !confirm(
        `旅行「${trip.name}」を削除します。\nメンバー全員の画面からも消え、候補日・出欠・候補地点・投票もすべて削除されます。${warn}\n\nよろしいですか？`,
      )
    )
      return;
    const result = await callFirebase("deleteTrip", { tripId: trip.id });
    if (!result.ok) return flash(result.error, "err");
    await chrome.storage.local.remove(localKey(trip.id));
    if (state.tripId === trip.id) await selectTrip(null);
    flash("旅行を削除しました");
  }

  // 招待メールの送信。Gmail で送れなければ mailto: で幹事のメーラーを開く
  function inviteMailText(tripName) {
    const myMember = currentMember();
    return {
      subject: `【旅行アシスト】「${tripName}」に招待されました`,
      body:
        `${myMember.email} さんから、旅行「${tripName}」に招待されました。\n\n` +
        `Chrome 拡張機能「旅行アシスト」を開き、このメールアドレスで Google サインインすると、` +
        `旅行が自動的に一覧に表示されます。日程の出欠や行きたい場所の投票ができます。`,
    };
  }
  async function notifyInvite(email, tripName) {
    const { subject, body } = inviteMailText(tripName);
    const result = await sendMessage({ type: "mail:send", to: email, subject, body });
    if (result.ok) return flash(`${email} に招待メールを送りました`);
    // フォールバック: mailto
    const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    flash(
      `メールを自動送信できなかったため、メーラーを開きます（${result.error}）`,
      "err",
    );
    window.open(url, "_blank");
  }

  function viewMembers() {
    const currentTrip = state.trip && state.trip.id === state.tripId ? state.trip : null;
    if (!state.tripId || !currentTrip) return null;
    if (!currentTrip.data) return gate()[0];
    const owner = isOwner(),
      members = T.membersOf(currentTrip.data);
    const mailIn = createEl("input", {
      type: "email",
      placeholder: "招待するメールアドレス",
    });
    return createEl(
      "section",
      {},
      createEl("h3", {}, "メンバー"),
      createEl(
        "ul",
        { class: "list" },
        members.map((member) =>
          createEl(
            "li",
            {},
            createEl(
              "div",
              { class: "line" },
              createEl(
                "div",
                {},
                createEl("b", {}, T.memberLabel(member)),
                member.displayName ? createEl("div", { class: "muted" }, member.email) : null,
              ),
              createEl(
                "div",
                {},
                member.role === "owner"
                  ? createEl("span", { class: "badge" }, "幹事")
                  : member.joinedAt
                    ? createEl("span", { class: "badge ok" }, "参加済み")
                    : createEl("span", { class: "badge wait" }, "招待中（未参加）"),
                owner && member.role !== "owner"
                  ? makeButton(
                      "解除",
                      async () => {
                        if (
                          confirm(
                            `${member.email} を、この旅行から外します。よろしいですか？`,
                          )
                        )
                          await runAction(
                            "removeMember",
                            { tripId: state.tripId, email: member.email },
                            "メンバーを解除しました",
                          );
                      },
                      "small danger",
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
      owner
        ? createEl(
            "div",
            {},
            mailIn,
            createEl(
              "label",
              { class: "inline" },
              createEl("input", {
                type: "checkbox",
                checked: state.mailOnInvite,
                onchange: (event) => (state.mailOnInvite = event.target.checked),
              }),
              "招待メールも送る",
            ),
            makeButton(
              "メンバーを招待",
              async () => {
                const email = T.normalizeEmail(mailIn.value);
                if (!T.isValidEmail(email))
                  return flash(
                    "メールアドレスの形式が正しくありません（. # $ [ ] / は使えません）",
                    "err",
                  );
                const result = await runAction(
                  "inviteMember",
                  { tripId: state.tripId, email },
                  `${email} を招待しました`,
                );
                if (!result.ok) return;
                mailIn.value = "";
                if (state.mailOnInvite)
                  await notifyInvite(email, currentTrip.data.meta.name);
              },
              "primary",
            ),
            createEl(
              "p",
              { class: "muted" },
              "招待するのは、相手が Google アカウントのサインインに使うメールアドレスです（大文字小文字は区別しません）。相手が拡張機能を開くと、この旅行が自動的に一覧に表示されます。",
            ),
          )
        : createEl("p", { class: "muted" }, "メンバーの招待は幹事のみ行えます。"),
    );
  }

  Object.assign(ctx, { viewTrip, deleteTrip, inviteMailText, notifyInvite, viewMembers });
}
