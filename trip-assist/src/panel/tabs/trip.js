// 「メンバー」タブ（招待・解除）と旅行の削除。旅行の切り替え・作成は trip-switch.js
import * as T from "../../lib.js";
import { localKey } from "../constants.js";

const TRASH_PATH =
  '<path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>';

export function installTripTab(ctx) {
  const { state, signinCard, currentMember, createEl, makeButton, callFirebase, flash, selectTrip, body, sendMessage, gate, isOwner, runAction, makeMsIcon } = ctx;

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

  // 「メンバー」タブ: 旅行が選ばれていれば、その旅行のメンバー一覧と招待欄
  function viewMembersTab() {
    if (state.auth.state !== "signedIn") return [signinCard()];
    if (!state.tripId) return gate() || [];
    const section = viewMembers();
    return section ? [section] : gate() || [];
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
                createEl("b", { class: "member-name" }, T.memberLabel(member)),
                member.displayName ? createEl("div", { class: "muted" }, member.email) : null,
              ),
              createEl(
                "div",
                {},
                member.role === "owner"
                  ? createEl("span", { class: "badge" }, "幹事")
                  : null,
                member.joinedAt
                  ? createEl("span", { class: "badge ok" }, "参加済み")
                  : createEl("span", { class: "badge wait" }, "招待中（未参加）"),
                owner && member.role !== "owner"
                  ? createEl(
                      "button",
                      {
                        class: "icon-delete",
                        type: "button",
                        title: "メンバーを解除",
                        "aria-label": "メンバーを解除",
                        onclick: async () => {
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
                      },
                      makeMsIcon(TRASH_PATH, 18),
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
          )
        : createEl("p", { class: "muted" }, "メンバーの招待は幹事のみ行えます。"),
    );
  }

  Object.assign(ctx, { viewMembersTab, deleteTrip, inviteMailText, notifyInvite, viewMembers });
}
