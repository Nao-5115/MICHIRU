const STORAGE_KEY = "tripassist-colorSelect";

// 色ごとの「ふつう」の設定（h:色相 s:彩度 l:明るさ）
const HUES = {
  blue: { label: "ブルー", h: 217, s: 80, l: 51 },
  green: { label: "グリーン", h: 152, s: 55, l: 40 },
  pink: { label: "ピンク", h: 338, s: 70, l: 60 },
  orange: { label: "オレンジ", h: 29, s: 85, l: 55 },
  purple: { label: "パープル", h: 257, s: 60, l: 60 },
  gray: { label: "グレー", h: 214, s: 5, l: 39 },
};

// 濃さ（dl: 明るさをどれだけずらすか）
const TONES = {
  light: { label: "うすめ", dl: 12 },
  normal: { label: "ふつう", dl: 0 },
  dark: { label: "こいめ", dl: -10 },
};

const DEFAULT_STATE = { hue: "blue", tone: "normal" };

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

// 色相 + 濃さ → CSS変数に入れる色を作る
function buildColors(hue, tone) {
  const c = HUES[hue];
  const l = clamp(c.l + TONES[tone].dl, 25, 75);
  return {
    accent: hsl(c.h, c.s, l),
    strong: hsl(c.h, c.s, clamp(l - 10, 15, 60)),
    soft: hsl(c.h, Math.min(c.s, 80), 94),
    // 明るい色の上は白文字だと読みにくいので、文字色も切り替える
    on: l > 66 ? "#222222" : "#ffffff",
  };
}

// 保存データを安全な形に直す（昔の "blue" みたいな文字列保存にも対応）
function normalize(v) {
  if (typeof v === "string") v = { hue: v };
  return {
    hue: HUES[v?.hue] ? v.hue : DEFAULT_STATE.hue,
    tone: TONES[v?.tone] ? v.tone : DEFAULT_STATE.tone,
  };
}

export function installColorSelect(ctx) {
  ctx.colorSelectState = { ...DEFAULT_STATE };

  ctx.applycolorSelect = (value) => {
    const s = normalize(value);
    ctx.colorSelectState = s;
    const host = ctx.host;
    if (!host) return;
    const c = buildColors(s.hue, s.tone);
    host.style.setProperty("--accent", c.accent);
    host.style.setProperty("--accent-strong", c.strong);
    host.style.setProperty("--accent-soft", c.soft);
    host.style.setProperty("--on-accent", c.on);
  };

  // patch は { hue } だけ / { tone } だけ でもOK
  ctx.setcolorSelect = async (patch) => {
    ctx.applycolorSelect({ ...ctx.colorSelectState, ...patch });
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: ctx.colorSelectState });
    } catch (e) {
      console.warn("テーマ保存に失敗", e);
    }
  };

  ctx.loadcolorSelect = async () => {
    let saved = null;
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      saved = r[STORAGE_KEY];
    } catch (e) {}
    ctx.applycolorSelect(saved);
  };

  // 選択UI（色の丸 + 濃さボタン）
  ctx.rendercolorSelectPicker = () => {
    const wrap = document.createElement("div");

    const draw = () => {
      const cur = ctx.colorSelectState;

      // 色の丸（今選んでる濃さでプレビュー）
      const grid = document.createElement("div");
      grid.className = "colorSelect-grid";
      for (const [id, c] of Object.entries(HUES)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className =
          "colorSelect-swatch" + (cur.hue === id ? " selected" : "");
        b.style.background = buildColors(id, cur.tone).accent;
        b.title = c.label;
        b.setAttribute("aria-label", `色: ${c.label}`);
        b.addEventListener("click", () => {
          ctx.setcolorSelect({ hue: id });
          draw();
        });
        grid.appendChild(b);
      }

      // 濃さボタン
      const tones = document.createElement("div");
      tones.className = "colorSelect-tones";
      for (const [id, t] of Object.entries(TONES)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "colorSelect-tone" + (cur.tone === id ? " selected" : "");
        b.textContent = t.label;
        b.addEventListener("click", () => {
          ctx.setcolorSelect({ tone: id });
          draw();
        });
        tones.appendChild(b);
      }

      wrap.replaceChildren(grid, tones);
    };

    draw();
    return wrap;
  };
}
