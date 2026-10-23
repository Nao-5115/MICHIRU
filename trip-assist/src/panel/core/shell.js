// パネル本体（Shadow DOM）・ボタン（FAB）・開閉・通知

export function installShell(c) {
  const { h, btn, S } = c;
  const applyGhost = (...args) => c.applyGhost(...args);
  const saveUi = (...args) => c.saveUi(...args);
  const startDrag = (...args) => c.startDrag(...args);
  const startResize = (...args) => c.startResize(...args);
  const applyGeo = (...args) => c.applyGeo(...args);
  const render = (...args) => c.render(...args);

  const host = h("div", { id: "tripassist-host" });
  const root = host.attachShadow({ mode: "open" });
  for (const type of ["keydown", "keyup", "keypress"]) {
    window.addEventListener(
      type,
      (e) => {
        if (e.composedPath().includes(host)) e.stopImmediatePropagation();
      },
      true,
    );
  }
  const statusEl = h("div", { class: "status", hidden: true });
  const body = h("div", { class: "body" });
  const tabsEl = h("div", { class: "tabs" });
  const navBar = h("div", { class: "navbar", hidden: true });
  const subEl = h("span", { class: "sub" });
  const ghostBtn = btn(
    "👻",
    () => {
      S.ghost = !S.ghost;
      applyGhost();
      saveUi();
    },
    "icon",
  );
  ghostBtn.title = "離れたら半透明（オン/オフ）";
  ghostBtn.setAttribute("aria-label", "半透明モードの切り替え");
  const panel = h(
    "div",
    { class: "panel", hidden: true },
    h(
      "div",
      { class: "head", onpointerdown: startDrag },
      h(
        "div",
        { class: "head-left" },
        h("img", {
          src: chrome.runtime.getURL("michiru-logo.png"),
          class: "head-logo",
          alt: "MICHIRU",
        }),
        subEl,
      ),
      h(
        "span",
        {},
        ghostBtn,
        btn("×", () => toggle(false), "icon"),
      ),
    ),
    navBar,
    tabsEl,
    statusEl,
    body,
    ...["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) =>
      h("div", { class: "grip " + d, onpointerdown: (e) => startResize(e, d) }),
    ),
  );
  const fab = h(
    "button",
    {
      class: "fab",
      type: "button",
      title: "旅行アシストを開く",
      onclick: () => toggle(true),
    },
    "旅",
  );
  root.append(
    h("link", { rel: "stylesheet", href: chrome.runtime.getURL("panel.css") }),
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
    S.open = open;
    panel.hidden = !open;
    fab.hidden = open;
    if (open) {
      applyGeo();
      applyGhost();
      render();
    }
  }

  Object.assign(c, { host, root, statusEl, body, tabsEl, navBar, subEl, ghostBtn, panel, fab, flashTimer, flash, toggle });
}
