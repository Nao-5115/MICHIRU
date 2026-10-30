// 「スポット」タブ（全体共有スポットのカタログ）

export function installSpotsTab(ctx) {

  // ---------- Google マップ上の共有スポットマーカー ----------
  const spotLayer = (() => {
    let element = document.getElementById("tripassist-spot-layer");
    if (!element) {
      element = document.createElement("div");
      element.id = "tripassist-spot-layer";
      document.documentElement.append(element);
    }
    if (!document.getElementById("tripassist-spot-style")) {
      const style = document.createElement("style");
      style.id = "tripassist-spot-style";
      style.textContent = `
        #tripassist-spot-layer{position:fixed;inset:0;pointer-events:none;z-index:1;overflow:hidden}
        .tripassist-spot-marker{position:absolute;pointer-events:auto;cursor:pointer;transform:translate(-50%,-100%)}
        .tripassist-spot-callout{
          display:flex;flex-direction:column;gap:2px;
          padding:5px 9px;border-radius:8px;
          background:white;box-shadow:0 2px 8px #0004;
          font:12px/1.4 Arial,sans-serif;
          border:2px solid var(--sc,#1a73e8);color:#202124;
          max-width:160px;position:relative;
        }
        .tripassist-spot-name{
          font-weight:bold;font-size:12px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .tripassist-spot-rec{
          font-size:10px;color:#5f6368;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .tripassist-spot-marker:hover .tripassist-spot-rec{color:rgba(255,255,255,0.85)}
        .tripassist-spot-callout::after{
          content:"";position:absolute;bottom:-8px;left:50%;
          transform:translateX(-50%);
          border:4px solid transparent;
          border-top:5px solid var(--sc,#1a73e8);
        }
        .tripassist-spot-marker:hover .tripassist-spot-callout{
          background:var(--sc,#1a73e8);color:white;
        }
        .tripassist-spot-marker:hover .tripassist-spot-callout::after{
          border-top-color:var(--sc,#1a73e8);
        }
        .tripassist-spot-popup{position:absolute;width:260px;max-height:45vh;overflow:auto;padding:12px 14px;border-radius:10px;background:white;color:#202124;box-shadow:0 4px 16px #0005;pointer-events:auto;z-index:2;font:13px/1.5 Arial,sans-serif}
        .tripassist-spot-popup h4{margin:0 0 6px;font-size:14px}.tripassist-spot-popup p{margin:5px 0;color:#5f6368}
        .tripassist-spot-popup a{color:#1a73e8}.tripassist-spot-close{float:right;border:0;background:none;font-size:20px;cursor:pointer}
      `;
      document.head.append(style);
    }
    return element;
  })();

  Object.assign(ctx, { spotLayer });
}
