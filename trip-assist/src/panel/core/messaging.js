// 再描画の制御・拡張機能内メッセージ・Firebase 操作（offscreen 経由）

export function installMessaging(c) {
  const { S, root, flash } = c;
  const render = (...args) => c.render(...args);

  // ---------- 再描画（他のメンバーの更新で入力中の欄を壊さない） ----------
  S.dirty = false;
  const editing = () => {
    const a = root.activeElement;
    return (
      !!a &&
      ["SELECT", "INPUT", "TEXTAREA"].includes(a.tagName) &&
      !["checkbox", "radio", "button"].includes(a.type)
    );
  };
  function scheduleRender(remote = false) {
    if (!S.open) return;
    if (remote && editing()) {
      S.dirty = true;
      return;
    }
    render();
  }
  root.addEventListener("focusout", () => {
    if (S.dirty)
      setTimeout(() => {
        if (!editing()) render();
      }, 0);
  });

  // ---------- 拡張機能内メッセージ ----------
  async function send(msg) {
    try {
      const r = await chrome.runtime.sendMessage(msg);
      if (!r) throw new Error("応答がありません");
      return r;
    } catch (e) {
      const m = String(e.message || e);
      return {
        ok: false,
        error: /context invalidated/i.test(m)
          ? "拡張機能が更新されました。ページを再読み込みしてください。"
          : m,
      };
    }
  }
  // Firebase 操作（offscreen.js が処理）。offscreen が無い場合は作り直して 1 回だけ再試行する
  const NO_RECEIVER =
    /Receiving end does not exist|Could not establish connection|message port closed|応答がありません/i;
  async function fb(op, args = {}) {
    let r = await send({ type: "fb:" + op, ...args });
    if (!r.ok && NO_RECEIVER.test(r.error || "")) {
      await send({ type: "app:ensure" });
      await new Promise((res) => setTimeout(res, 400));
      r = await send({ type: "fb:" + op, ...args });
      if (!r.ok && NO_RECEIVER.test(r.error || "")) {
        r = {
          ok: false,
          error:
            "Firebase との接続を開始できませんでした。拡張機能を再読み込みして、もう一度お試しください。",
        };
      }
    }
    return r;
  }
  async function act(op, args, okMsg) {
    const r = await fb(op, args);
    flash(r.ok ? okMsg : r.error, r.ok ? "ok" : "err");
    return r;
  }

  Object.assign(c, { editing, scheduleRender, send, NO_RECEIVER, fb, act });
}
