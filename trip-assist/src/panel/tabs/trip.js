// 「旅行」タブ（作成・一覧・削除・招待）とメンバー管理
import * as T from "../../lib.js";
import { lk } from "../constants.js";

export function installTripTab(c) {
  const { S, signinCard, me, h, btn, fb, flash, selectTrip, body, send, gate, isOwner, act } = c;

  // ======================= 旅行タブ =======================
  function viewTrip() {
    if (S.auth.state !== "signedIn") return [signinCard()];
    const m = me();
    const nameIn = h("input", {
      type: "text",
      placeholder: "新しい旅行の名前（例: 箱根旅行）",
      maxlength: 60,
    });
    const secUser = h(
      "section",
      {},
      h(
        "div",
        { class: "line" },
        h("span", { class: "muted" }, `サインイン中: ${m.email}`),
        btn(
          "サインアウト",
          async () => {
            const r = await fb("signOut");
            if (!r.ok) flash(r.error, "err");
          },
          "small",
        ),
      ),
    );
    const secList = h(
      "section",
      {},
      h("h3", {}, "旅行の一覧"),
      S.trips.length
        ? h(
            "ul",
            { class: "list" },
            S.trips.map((t) =>
              h(
                "li",
                { class: t.id === S.tripId ? "sel" : "" },
                h(
                  "div",
                  { class: "line" },
                  h(
                    "div",
                    {},
                    h("b", {}, t.name),
                    h(
                      "div",
                      { class: "muted" },
                      t.ownerEmail === m.email
                        ? "幹事: あなた"
                        : `幹事: ${t.ownerEmail}`,
                    ),
                  ),
                  h(
                    "div",
                    {},
                    t.id === S.tripId
                      ? h("span", { class: "badge ok" }, "表示中")
                      : btn("開く", () => selectTrip(t.id), "small primary"),
                    t.ownerEmail === m.email
                      ? btn("削除", () => deleteTrip(t), "small danger")
                      : null,
                  ),
                ),
              ),
            ),
          )
        : h(
            "p",
            { class: "muted" },
            "参加している旅行はまだありません。新規作成するか、幹事に招待してもらってください。",
          ),
      h("h3", {}, "新しい旅行を作る"),
      nameIn,
      btn(
        "作成（あなたが幹事になります）",
        async () => {
          const name = nameIn.value.trim();
          if (!name) return flash("旅行名を入力してください", "err");
          const r = await fb("createTrip", { name });
          if (!r.ok) return flash(r.error, "err");
          flash("旅行を作成しました");
          await selectTrip(r.id);
        },
        "primary",
      ),
    );
    return [secUser, secList, viewMembers()];
  }

  async function deleteTrip(t) {
    const ev =
      ((await chrome.storage.local.get(lk(t.id)))[lk(t.id)] || {}).events || [];
    const warn = ev.length
      ? `\n\nGoogle カレンダーに登録済みの予定（${ev.length} 件）は削除されません。先に「登録」タブで削除してください。`
      : "";
    if (
      !confirm(
        `旅行「${t.name}」を削除します。\nメンバー全員の画面からも消え、候補日・出欠・候補地点・投票もすべて削除されます。${warn}\n\nよろしいですか？`,
      )
    )
      return;
    const r = await fb("deleteTrip", { tripId: t.id });
    if (!r.ok) return flash(r.error, "err");
    await chrome.storage.local.remove(lk(t.id));
    if (S.tripId === t.id) await selectTrip(null);
    flash("旅行を削除しました");
  }

  // 招待メールの送信。Gmail で送れなければ mailto: で幹事のメーラーを開く
  function inviteMailText(tripName) {
    const m = me();
    return {
      subject: `【旅行アシスト】「${tripName}」に招待されました`,
      body:
        `${m.email} さんから、旅行「${tripName}」に招待されました。\n\n` +
        `Chrome 拡張機能「旅行アシスト」を開き、このメールアドレスで Google サインインすると、` +
        `旅行が自動的に一覧に表示されます。日程の出欠や行きたい場所の投票ができます。`,
    };
  }
  async function notifyInvite(email, tripName) {
    const { subject, body } = inviteMailText(tripName);
    const r = await send({ type: "mail:send", to: email, subject, body });
    if (r.ok) return flash(`${email} に招待メールを送りました`);
    // フォールバック: mailto
    const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    flash(
      `メールを自動送信できなかったため、メーラーを開きます（${r.error}）`,
      "err",
    );
    window.open(url, "_blank");
  }

  function viewMembers() {
    const tr = S.trip && S.trip.id === S.tripId ? S.trip : null;
    if (!S.tripId || !tr) return null;
    if (!tr.data) return gate()[0];
    const owner = isOwner(),
      ms = T.membersOf(tr.data);
    const mailIn = h("input", {
      type: "email",
      placeholder: "招待するメールアドレス",
    });
    return h(
      "section",
      {},
      h("h3", {}, `メンバー — ${tr.data.meta.name}`),
      h(
        "ul",
        { class: "list" },
        ms.map((x) =>
          h(
            "li",
            {},
            h(
              "div",
              { class: "line" },
              h(
                "div",
                {},
                h("b", {}, T.memberLabel(x)),
                x.displayName ? h("div", { class: "muted" }, x.email) : null,
              ),
              h(
                "div",
                {},
                x.role === "owner"
                  ? h("span", { class: "badge" }, "幹事")
                  : null,
                x.joinedAt
                  ? h("span", { class: "badge ok" }, "参加済み")
                  : h("span", { class: "badge wait" }, "招待中（未参加）"),
                owner && x.role !== "owner"
                  ? btn(
                      "解除",
                      async () => {
                        if (
                          confirm(
                            `${x.email} を、この旅行から外します。よろしいですか？`,
                          )
                        )
                          await act(
                            "removeMember",
                            { tripId: S.tripId, email: x.email },
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
        ? h(
            "div",
            {},
            mailIn,
            h(
              "label",
              { class: "inline" },
              h("input", {
                type: "checkbox",
                checked: S.mailOnInvite,
                onchange: (e) => (S.mailOnInvite = e.target.checked),
              }),
              "招待メールも送る",
            ),
            btn(
              "メンバーを招待",
              async () => {
                const email = T.normalizeEmail(mailIn.value);
                if (!T.isValidEmail(email))
                  return flash(
                    "メールアドレスの形式が正しくありません（. # $ [ ] / は使えません）",
                    "err",
                  );
                const r = await act(
                  "inviteMember",
                  { tripId: S.tripId, email },
                  `${email} を招待しました`,
                );
                if (!r.ok) return;
                mailIn.value = "";
                if (S.mailOnInvite)
                  await notifyInvite(email, tr.data.meta.name);
              },
              "primary",
            ),
            h(
              "p",
              { class: "muted" },
              "招待するのは、相手が Google アカウントのサインインに使うメールアドレスです（大文字小文字は区別しません）。相手が拡張機能を開くと、この旅行が自動的に一覧に表示されます。",
            ),
          )
        : h("p", { class: "muted" }, "メンバーの招待は幹事のみ行えます。"),
    );
  }

  Object.assign(c, { viewTrip, deleteTrip, inviteMailText, notifyInvite, viewMembers });
}
