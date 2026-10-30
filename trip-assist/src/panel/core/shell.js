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
        if (event.composedPath().includes(host)) event.stopImmediatePropagation();
      },
      true,
    );
  }
  const statusEl = createEl("div", { class: "status", hidden: true });
  const body = createEl("div", { class: "body" });
  const tabsEl = createEl("div", { class: "tabs" });
  const navBar = createEl("div", { class: "navbar", hidden: true });
  const subEl = createEl("span", { class: "sub" });
  const ghostBtn = makeButton(
    "👻",
    () => {
      state.ghost = !state.ghost;
      applyGhost();
      saveUi();
    },
    "icon",
  );
  ghostBtn.title = "離れたら半透明（オン/オフ）";
  ghostBtn.setAttribute("aria-label", "半透明モードの切り替え");
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
        ghostBtn,
        makeButton("×", () => toggle(false), "icon"),
      ),
    ),
    navBar,
    tabsEl,
    statusEl,
    body,
    ...["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((direction) =>
      createEl("div", { class: "grip " + direction, onpointerdown: (event) => startResize(event, direction) }),
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
    createEl("link", { rel: "stylesheet", href: chrome.runtime.getURL("panel.css") }),
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
  function toggle(open) {
    state.open = open;
    panel.hidden = !open;
    fab.hidden = open;
    if (open) {
      applyGeo();
      applyGhost();
      render();
    }
  }

  Object.assign(ctx, { host, root, statusEl, body, tabsEl, navBar, subEl, ghostBtn, panel, fab, flashTimer, flash, toggle });
}
