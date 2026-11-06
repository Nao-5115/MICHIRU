// パネル本体（Shadow DOM）・ボタン（FAB）・開閉・通知

export function installShell(ctx) {
  const { createEl, makeButton, state, makeMsIcon } = ctx;
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
  const switchEl = createEl("div", { class: "trip-switch", hidden: true });
  const subEl = createEl("span", { class: "sub" });
  // 設定（歯車）: 半透明・テーマカラー・サインアウト
  const SETTINGS_PATH = `<path d="M433-80q-27 0-46.5-18T363-142l-9-66q-13-5-24.5-12T307-235l-62 26q-25 11-50 2t-39-32l-47-82q-14-23 6-41l53-40q-1-7-1-13.5v-27q0-6.5 1-13.5l-53-40q-20-16-6-41l47-82q14-23 39-32t50 2l62 26q11-8 23-15t24-12l9-66q4-26 23.5-44t46.5-18h94q27 0 46.5 18t23.5 44l9 66q13 5 24.5 12t22.5 15l62-26q25-11 50-2t39 32l47 82q14 23-6 41l-53 40q1 7 1 13.5v27q0 6.5-2 13.5l53 40q20 16 6 41l-47 82q-14 23-39 32t-50-2l-62-26q-11 8-23 15t-24 12l-9 66q-4 26-23.5 44T527-80h-94Zm7-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/>`;
  const settingsBtn = makeButton("", () => toggleSettings(), "icon");
  settingsBtn.title = "設定";
  settingsBtn.setAttribute("aria-label", "設定を開く");
  settingsBtn.append(makeMsIcon(SETTINGS_PATH, 22));
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
        createEl("label", { class: "settings-row" }, createEl("span", {}, "離れたら半透明にする"), ghostIn),
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
