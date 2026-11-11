// パネル本体（Shadow DOM）・ボタン（FAB）・開閉・通知

export function installShell(ctx) {
  const { createEl, makeButton, state, makeSvgIcon } = ctx;
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
  const progressEl = createEl("div", { class: "trip-progress", hidden: true });
  const navBar = createEl("div", { class: "navbar", hidden: true });
  const switchEl = createEl("div", { class: "trip-switch", hidden: true });
  const subEl = createEl("span", { class: "sub" });
  // 設定（歯車）: 半透明・テーマカラー・サインアウト
  const SETTINGS_PATH = '<path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32C19.37,13.29,19.32,13.1,19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>';
  const settingsBtn = makeButton("", () => toggleSettings(), "icon");
  settingsBtn.title = "設定";
  settingsBtn.setAttribute("aria-label", "設定を開く");
  settingsBtn.append(makeSvgIcon(SETTINGS_PATH, 22));
  const settingsPop = createEl("div", { class: "settings-pop colorSelect-pop", hidden: true });
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
        settingsBtn,
        makeButton("×", () => toggle(false), "icon"),
      ),
    ),
    navBar,
    switchEl,
    tabsEl,
    progressEl,
    settingsPop,
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

  let flashTimer;
  function flash(text, type = "ok") {
    statusEl.textContent = text;
    statusEl.className = "status " + type;
    statusEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (statusEl.hidden = true), 9000);
  }

  // 設定ポップアップの中身は開くたびに作り直す（状態は設定の値から読む）
  function renderSettings() {
    const signedIn = state.auth.state === "signedIn";
    const ghostIn = createEl("input", {
      type: "checkbox",
      checked: state.ghost,
      onchange: (event) => {
        state.ghost = event.target.checked;
        applyGhost();
        saveUi();
      },
    });
    settingsPop.replaceChildren(
      createEl(
        "div",
        { class: "settings-head" },
        createEl("b", {}, "設定"),
        makeButton("×", () => toggleSettings(false), "icon"),
      ),
      createEl(
        "section",
        { class: "settings-sec" },
        createEl("div", { class: "form-label" }, "表示"),
        createEl("label", { class: "settings-row" }, createEl("span", {}, "離れたら薄く表示"), ghostIn),
      ),
      createEl(
        "section",
        { class: "settings-sec" },
        createEl("div", { class: "form-label" }, "テーマカラー"),
        ctx.rendercolorSelectPicker(),
      ),
      signedIn
        ? createEl(
            "section",
            { class: "settings-sec" },
            createEl("div", { class: "form-label" }, "アカウント"),
            createEl(
              "div",
              { class: "settings-row" },
              createEl("span", { class: "muted settings-email" }, state.auth.email || ""),
              makeButton("サインアウト", signOutFromSettings, "small"),
            ),
          )
        : null,
    );
  }

  async function signOutFromSettings() {
    const result = await ctx.callFirebase("signOut");
    if (!result.ok) return flash(result.error, "err");
    toggleSettings(false);
  }

  function toggleSettings(force) {
    const show = force ?? settingsPop.hidden;
    if (show) renderSettings();
    settingsPop.hidden = !show;
  }
  // ポップアップの外を押したら閉じる
  root.addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    if (!settingsPop.hidden && !path.includes(settingsPop) && !path.includes(settingsBtn))
      settingsPop.hidden = true;
  });

  function toggle(open) {
    state.open = open;
    settingsPop.hidden = true;
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
    progressEl,
    navBar,
    switchEl,
    subEl,
    settingsPop,
    settingsBtn,
    panel,
    fab,
    flashTimer,
    flash,
    toggle,
  });
}
