// パネル本体（Shadow DOM）・ボタン（FAB）・開閉・通知

export function installShell(ctx) {
  const { createEl, makeButton, state } = ctx;
  const applyGhost = (...args) => ctx.applyGhost(...args);
  const saveUi = (...args) => ctx.saveUi(...args);
  const startDrag = (...args) => ctx.startDrag(...args);
  const startResize = (...args) => ctx.startResize(...args);
  const applyGeo = (...args) => ctx.applyGeo(...args);
  const render = (...args) => ctx.render(...args);

  const host = createEl("div", { id: "tripassist-host" });
  const root = host.attachShadow({ mode: "open" });
  for (const type of ["keydown", "keyup", "keypress"]) {
    window.addEventListener(
      type,
      (event) => {
        if (event.composedPath().includes(host))
          event.stopImmediatePropagation();
      },
      true,
    );
  }
  const statusEl = createEl("div", { class: "status", hidden: true });
  const body = createEl("div", { class: "body" });
  const tabsEl = createEl("div", { class: "tabs" });
  const navBar = createEl("div", { class: "navbar", hidden: true });
  const subEl = createEl("span", { class: "sub" });
  const EYE_ON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const ghostBtn = makeButton(
    "",
    () => {
      state.ghost = !state.ghost;
      applyGhost();
      updateGhostIcon();
      saveUi();
    },
    "icon",
  );

  ghostBtn.title = "離れたら半透明（オン/オフ）";
  ghostBtn.setAttribute("aria-label", "半透明モードの切り替え");
  const colorSelectBtn = makeButton("🎨", () => togglecolorSelectPop(), "icon");
  colorSelectBtn.title = "テーマカラー";
  colorSelectBtn.setAttribute("aria-label", "テーマカラーを選ぶ");
  const colorSelectPop = createEl("div", {
    class: "colorSelect-pop",
    hidden: true,
  });
  const panel = createEl(
    "div",
    { class: "panel", hidden: true },
    createEl(
      "div",
      { class: "head", onpointerdown: startDrag },
      createEl(
        "div",
        { class: "head-left" },
        createEl("img", {
          src: chrome.runtime.getURL("michiru-logo.png"),
          class: "head-logo",
          alt: "MICHIRU",
        }),
        subEl,
      ),
      createEl(
        "span",
        {},
        colorSelectBtn,
        ghostBtn,
        makeButton("×", () => toggle(false), "icon"),
      ),
    ),
    navBar,
    tabsEl,
    colorSelectPop,
    statusEl,
    body,
    ...["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((direction) =>
      createEl("div", {
        class: "grip " + direction,
        onpointerdown: (event) => startResize(event, direction),
      }),
    ),
  );
  const fab = createEl(
    "button",
    {
      class: "fab",
      type: "button",
      title: "旅行アシストを開く",
      "aria-label": "旅行アシストを開く",
      onclick: () => toggle(true),
    },
    createEl("img", {
      class: "fab-idle",
      src: chrome.runtime.getURL("michiru-fab-idle.png"),
      alt: "",
      "aria-hidden": "true",
    }),
    createEl("img", {
      class: "fab-hover",
      src: chrome.runtime.getURL("michiru-fab-hover.png"),
      alt: "",
      "aria-hidden": "true",
    }),
  );
  root.append(
    createEl("link", {
      rel: "stylesheet",
      href: chrome.runtime.getURL("panel.css"),
    }),
    panel,
    fab,
  );
  document.documentElement.append(host);

  function updateGhostIcon() {
    ghostBtn.innerHTML = state.ghost ? EYE_OFF : EYE_ON;
  }
  updateGhostIcon();

  let flashTimer;
  function flash(text, type = "ok") {
    statusEl.textContent = text;
    statusEl.className = "status " + type;
    statusEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (statusEl.hidden = true), 9000);
  }

  function togglecolorSelectPop(force) {
    const show = force ?? colorSelectPop.hidden;
    colorSelectPop.hidden = !show;
    if (show) {
      // colorSelect.js は shell より後に読み込まれるので、押された時点で呼ぶ
      colorSelectPop.replaceChildren(
        createEl("div", { class: "form-label" }, "テーマカラー"),
        ctx.rendercolorSelectPicker(),
      );
    }
  }
  // ポップアップの外を押したら閉じる
  root.addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    if (
      !colorSelectPop.hidden &&
      !path.includes(colorSelectPop) &&
      !path.includes(colorSelectBtn)
    ) {
      colorSelectPop.hidden = true;
    }
  });

  function toggle(open) {
    state.open = open;
    colorSelectPop.hidden = true;
    panel.hidden = !open;
    fab.hidden = open;
    if (open) {
      applyGeo();
      applyGhost();
      render();
    }
  }

  Object.assign(ctx, {
    host,
    root,
    statusEl,
    body,
    tabsEl,
    navBar,
    subEl,
    colorSelectPop,
    ghostBtn,
    panel,
    fab,
    flashTimer,
    flash,
    toggle,
  });
}
