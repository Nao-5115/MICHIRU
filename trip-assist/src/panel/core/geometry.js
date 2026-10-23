// パネルの位置・サイズ・半透明表示・ドラッグ／リサイズ

export function installGeometry(c) {
  const { h, S, panel, ghostBtn } = c;

  // ---------- パネル位置・サイズ・半透明 ----------
  const MIN_W = 300,
    MIN_H = 240;
  const defaultGeo = () => {
    const w = Math.min(380, innerWidth);
    return { x: innerWidth - w - 12, y: 12, w, h: innerHeight - 24 };
  };
  function clampGeo(g) {
    const w = Math.min(Math.max(g.w, MIN_W), innerWidth),
      h = Math.min(Math.max(g.h, MIN_H), innerHeight);
    return {
      w,
      h,
      x: Math.min(Math.max(g.x, 0), innerWidth - w),
      y: Math.min(Math.max(g.y, 0), innerHeight - h),
    };
  }
  function applyGeo() {
    const g = (S.geo = clampGeo(S.geo || defaultGeo()));
    Object.assign(panel.style, {
      left: g.x + "px",
      top: g.y + "px",
      width: g.w + "px",
      height: g.h + "px",
      right: "auto",
    });
  }
  async function saveUi() {
    try {
      await chrome.storage.local.set({ ui: { geo: S.geo, ghost: S.ghost } });
    } catch (_) {}
  }
  async function loadUi() {
    try {
      const { ui } = await chrome.storage.local.get("ui");
      if (ui) {
        S.geo = ui.geo || null;
        S.ghost = ui.ghost !== false;
      }
    } catch (_) {}
  }
  function applyGhost() {
    panel.classList.toggle("ghost", S.ghost);
    ghostBtn.style.opacity = S.ghost ? 1 : 0.5;
  }
  function startDrag(e) {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    const el = e.currentTarget,
      sx = e.clientX,
      sy = e.clientY,
      g0 = { ...S.geo };
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      S.geo = { ...g0, x: g0.x + ev.clientX - sx, y: g0.y + ev.clientY - sy };
      applyGeo();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      saveUi();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
    el.addEventListener("pointercancel", up, { once: true });
  }
  function startResize(e, dir) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget,
      sx = e.clientX,
      sy = e.clientY,
      g0 = { ...S.geo };
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - sx,
        dy = ev.clientY - sy;
      let { x, y, w, h } = g0;
      if (dir.includes("e")) w = g0.w + dx;
      if (dir.includes("s")) h = g0.h + dy;
      if (dir.includes("w")) {
        w = g0.w - dx;
        x = g0.x + dx;
      }
      if (dir.includes("n")) {
        h = g0.h - dy;
        y = g0.y + dy;
      }
      if (w < MIN_W) {
        if (dir.includes("w")) x -= MIN_W - w;
        w = MIN_W;
      }
      if (h < MIN_H) {
        if (dir.includes("n")) y -= MIN_H - h;
        h = MIN_H;
      }
      S.geo = { x, y, w, h };
      applyGeo();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      saveUi();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
    el.addEventListener("pointercancel", up, { once: true });
  }
  window.addEventListener("resize", () => {
    if (S.open) applyGeo();
  });

  Object.assign(c, { MIN_W, MIN_H, defaultGeo, clampGeo, applyGeo, saveUi, loadUi, applyGhost, startDrag, startResize });
}
