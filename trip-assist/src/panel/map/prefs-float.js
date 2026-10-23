// Google マップ上のメンバー希望フロートウィンドウ

export function installPrefsFloat(c) {
  const { host, makeMsIcon, MS_GROUP_PATH, body, makeSvgIcon, SPOT_ICONS } = c;

  // ======================= 投票タブ（訪問地点の投票） =======================
  const TRANSPORT_OPTIONS = [
    { label: "電車",   svg: '<path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zm0 2c3.51 0 5.44.48 5.93 1H6.07C6.56 4.48 8.49 4 12 4zM6 7h5v3H6V7zm12 0v3h-5V7h5zM7.5 17C6.67 17 6 16.33 6 15.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>' },
    { label: "バス",   svg: '<path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/>' },
    { label: "車",     svg: '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>' },
    { label: "飛行機", svg: '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>' },
    { label: "自転車", svg: '<path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>' },
    { label: "徒歩",   svg: '<path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L9 8.3C9.2 8.5 9.5 8.9 9.8 8.9z"/>' },
  ];
  const BUDGET_OPTIONS = [
    { label: "〜5,000円", value: 5000 },
    { label: "〜10,000円", value: 10000 },
    { label: "〜20,000円", value: 20000 },
    { label: "〜30,000円", value: 30000 },
    { label: "30,000円〜", value: 99999 },
  ];
  // ---------- Google マップ上のメンバー希望フロートウィンドウ ----------
  const prefsFloat = (() => {
    let host = null;
    let wrap = null;

    function ensure() {
      if (host) return;
      host = document.createElement("div");
      host.id = "tripassist-prefs-float";
      document.documentElement.append(host);
      const shadow = host.attachShadow({ mode: "open" });

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("panel.css");

      const style = document.createElement("style");
      style.textContent = [
        "#pf-wrap{position:fixed;bottom:24px;left:24px;width:300px;max-height:55vh;",
        "background:#fff;border-radius:14px;box-shadow:0 6px 28px #0004;",
        "z-index:2147483640;display:flex;flex-direction:column;",
        "font:13px/1.5 'Google Sans',Arial,sans-serif;overflow:hidden;}",
        "#pf-head{display:flex;align-items:center;justify-content:space-between;",
        "padding:10px 14px;background:var(--accent,#1a73e8);color:#fff;",
        "font-weight:bold;font-size:13px;border-radius:14px 14px 0 0;flex-shrink:0;}",
        "#pf-close{background:none;border:none;color:#fff;font-size:20px;",
        "cursor:pointer;padding:0 2px;line-height:1;opacity:.85;}",
        "#pf-close:hover{opacity:1;}",
        "#pf-body{overflow-y:auto;padding:10px 14px;flex:1;}",
        ".pf-member{padding:8px 0;border-bottom:1px solid #f0f0f0;}",
        ".pf-member:last-child{border-bottom:none;}",
        ".pf-name{font-weight:bold;font-size:13px;margin-bottom:4px;}",
        ".pf-row{display:flex;align-items:center;gap:5px;margin-top:3px;",
        "font-size:12px;color:#5f6368;flex-wrap:wrap;}",
        ".pf-lbl{color:#9aa0a6;min-width:46px;flex-shrink:0;}",
        ".pf-dash{color:#bdc1c6;}",
        ".pf-chip{display:inline-flex;align-items:center;gap:3px;",
        "background:#f1f3f4;border-radius:8px;padding:2px 7px;font-size:11px;color:#3c4043;}",
        ".pf-empty{color:#9aa0a6;font-size:12px;margin:0;}",
      ].join("");

      shadow.append(link, style);

      wrap = document.createElement("div");
      wrap.id = "pf-wrap";
      wrap.style.display = "none";

      const head = document.createElement("div");
      head.id = "pf-head";
      const headTitle = document.createElement("span");
      headTitle.append(makeMsIcon(MS_GROUP_PATH, 18), document.createTextNode(" メンバーの希望"));
      head.append(headTitle);
      const closeBtn = document.createElement("button");
      closeBtn.id = "pf-close";
      closeBtn.textContent = "×";
      closeBtn.title = "閉じる";
      closeBtn.onclick = () => { wrap.style.display = "none"; };
      head.append(closeBtn);

      const body = document.createElement("div");
      body.id = "pf-body";

      wrap.append(head, body);
      shadow.append(wrap);
    }

    function renderContent(prefs, ms) {
      const body = wrap.querySelector("#pf-body");
      body.innerHTML = "";
      const rows = ms.filter((x) => prefs[x.key]);
      if (!rows.length) {
        const p = document.createElement("p");
        p.className = "pf-empty";
        p.textContent = "まだ誰も希望を登録していません。";
        body.append(p);
        return;
      }
      rows.forEach((x) => {
        const p = prefs[x.key];
        const div = document.createElement("div");
        div.className = "pf-member";

        const nameEl = document.createElement("div");
        nameEl.className = "pf-name";
        nameEl.textContent = x.name;
        div.append(nameEl);

        const budRow = document.createElement("div");
        budRow.className = "pf-row";
        const budLbl = document.createElement("span");
        budLbl.className = "pf-lbl";
        budLbl.textContent = "予算:";
        budRow.append(budLbl);
        const budOpt = p.budget ? BUDGET_OPTIONS.find((o) => o.value === p.budget) : null;
        if (budOpt) {
          const chip = document.createElement("span");
          chip.className = "pf-chip";
          chip.textContent = budOpt.label;
          budRow.append(chip);
        } else {
          const dash = document.createElement("span");
          dash.className = "pf-dash";
          dash.textContent = "—";
          budRow.append(dash);
        }
        div.append(budRow);

        const tRow = document.createElement("div");
        tRow.className = "pf-row";
        const tLbl = document.createElement("span");
        tLbl.className = "pf-lbl";
        tLbl.textContent = "交通:";
        tRow.append(tLbl);
        if (p.transport && p.transport.length) {
          p.transport.forEach((t) => {
            const opt = TRANSPORT_OPTIONS.find((o) => o.label === t);
            const chip = document.createElement("span");
            chip.className = "pf-chip";
            if (opt) chip.append(makeSvgIcon(opt.svg, 14));
            chip.append(document.createTextNode(t));
            tRow.append(chip);
          });
        } else {
          const dash = document.createElement("span");
          dash.className = "pf-dash";
          dash.textContent = "—";
          tRow.append(dash);
        }
        div.append(tRow);

        const cRow = document.createElement("div");
        cRow.className = "pf-row";
        const cLbl = document.createElement("span");
        cLbl.className = "pf-lbl";
        cLbl.textContent = "カテゴリ:";
        cRow.append(cLbl);
        if (p.categories && p.categories.length) {
          p.categories.forEach((cat) => {
            const ico = SPOT_ICONS[cat];
            const chip = document.createElement("span");
            chip.className = "pf-chip";
            if (ico) {
              chip.append(makeSvgIcon(ico.svg, 14));
              chip.append(document.createTextNode(ico.label));
            } else {
              chip.textContent = cat;
            }
            cRow.append(chip);
          });
        } else {
          const dash = document.createElement("span");
          dash.className = "pf-dash";
          dash.textContent = "—";
          cRow.append(dash);
        }
        div.append(cRow);

        body.append(div);
      });
    }

    return {
      toggle(prefs, ms) {
        ensure();
        if (wrap.style.display !== "none") {
          wrap.style.display = "none";
        } else {
          renderContent(prefs, ms);
          wrap.style.display = "flex";
        }
      },
      update(prefs, ms) {
        if (!wrap || wrap.style.display === "none") return;
        renderContent(prefs, ms);
      },
    };
  })();

  Object.assign(c, { TRANSPORT_OPTIONS, BUDGET_OPTIONS, prefsFloat });
}
