// 再描画の制御・拡張機能内メッセージ・Firebase 操作（offscreen 経由）

export function installMessaging(ctx) {
  const { state, root, flash } = ctx;
  const render = (...args) => ctx.render(...args);

  // ---------- 再描画（他のメンバーの更新で入力中の欄を壊さない） ----------
  state.dirty = false;
  const editing = () => {
    const activeElement = root.activeElement;
    return (
      !!activeElement &&
      ["SELECT", "INPUT", "TEXTAREA"].includes(activeElement.tagName) &&
      !["checkbox", "radio", "button"].includes(activeElement.type)
    );
  };
  function scheduleRender(remote = false) {
    if (!state.open) return;
    if (remote && editing()) {
      state.dirty = true;
      return;
    }
    render();
  }
  root.addEventListener("focusout", () => {
    if (state.dirty)
      setTimeout(() => {
        if (!editing()) render();
      }, 0);
  });

  // ---------- 拡張機能内メッセージ ----------
  async function sendMessage(msg) {
    try {
      const result = await chrome.runtime.sendMessage(msg);
      if (!result) throw new Error("応答がありません");
      return result;
    } catch (error) {
      const message = String(error.message || error);
      return {
        ok: false,
        error: /context invalidated/i.test(message)
          ? "拡張機能が更新されました。ページを再読み込みしてください。"
          : message,
      };
    }
  }
  // Firebase 操作（offscreen.js が処理）。offscreen が無い場合は作り直して 1 回だけ再試行する
  const NO_RECEIVER =
    /Receiving end does not exist|Could not establish connection|message port closed|応答がありません/i;
  async function callFirebase(operation, args = {}) {
    let result = await sendMessage({ type: "fb:" + operation, ...args });
    if (!result.ok && NO_RECEIVER.test(result.error || "")) {
      await sendMessage({ type: "app:ensure" });
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = await sendMessage({ type: "fb:" + operation, ...args });
      if (!result.ok && NO_RECEIVER.test(result.error || "")) {
        result = {
          ok: false,
          error:
            "Firebase との接続を開始できませんでした。拡張機能を再読み込みして、もう一度お試しください。",
        };
      }
    }
    return result;
  }
  async function runAction(operation, args, okMsg) {
    const result = await callFirebase(operation, args);
    flash(result.ok ? okMsg : result.error, result.ok ? "ok" : "err");
    return result;
  }

  Object.assign(ctx, { editing, scheduleRender, sendMessage, NO_RECEIVER, callFirebase, runAction });
}
