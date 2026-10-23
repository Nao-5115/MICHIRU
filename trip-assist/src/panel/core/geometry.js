// パネルの位置・サイズ・半透明表示・ドラッグ／リサイズ

export function installGeometry(ctx) {
  const { createEl, state, panel, ghostBtn } = ctx;

  // ---------- パネル位置・サイズ・半透明 ----------
  const MIN_W = 300,
    MIN_H = 240;
  const defaultGeo = () => {
    const width = Math.min(380, innerWidth);
    return { x: innerWidth - width - 12, y: 12, w: width, h: innerHeight - 24 };
  };
  function clampGeo(geo) {
    const width = Math.min(Math.max(geo.w, MIN_W), innerWidth),
      height = Math.min(Math.max(geo.h, MIN_H), innerHeight);
    return {
      w: width,
      h: height,
      x: Math.min(Math.max(geo.x, 0), innerWidth - width),
      y: Math.min(Math.max(geo.y, 0), innerHeight - height),
    };
  }
  function applyGeo() {
    const geo = (state.geo = clampGeo(state.geo || defaultGeo()));
    Object.assign(panel.style, {
      left: geo.x + "px",
      top: geo.y + "px",
      width: geo.w + "px",
      height: geo.h + "px",
      right: "auto",
    });
  }
  async function saveUi() {
    try {
      await chrome.storage.local.set({ ui: { geo: state.geo, ghost: state.ghost } });
    } catch (_) {}
  }
  async function loadUi() {
    try {
      const { ui: savedUi } = await chrome.storage.local.get("ui");
      if (savedUi) {
        state.geo = savedUi.geo || null;
        state.ghost = savedUi.ghost !== false;
      }
    } catch (_) {}
  }
  function applyGhost() {
    panel.classList.toggle("ghost", state.ghost);
    ghostBtn.style.opacity = state.ghost ? 1 : 0.5;
  }
  function startDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    const handle = event.currentTarget,
      startX = event.clientX,
      startY = event.clientY,
      startGeo = { ...state.geo };
    handle.setPointerCapture(event.pointerId);
    const move = (event) => {
      state.geo = { ...startGeo, x: startGeo.x + event.clientX - startX, y: startGeo.y + event.clientY - startY };
      applyGeo();
    };
    const onPointerUp = () => {
      handle.removeEventListener("pointermove", move);
      saveUi();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
    handle.addEventListener("pointercancel", onPointerUp, { once: true });
  }
  function startResize(event, direction) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget,
      startX = event.clientX,
      startY = event.clientY,
      startGeo = { ...state.geo };
    handle.setPointerCapture(event.pointerId);
    const move = (event) => {
      const deltaX = event.clientX - startX,
        deltaY = event.clientY - startY;
      let { x, y, w: width, h: height } = startGeo;
      if (direction.includes("e")) width = startGeo.w + deltaX;
      if (direction.includes("s")) height = startGeo.h + deltaY;
      if (direction.includes("w")) {
        width = startGeo.w - deltaX;
        x = startGeo.x + deltaX;
      }
      if (direction.includes("n")) {
        height = startGeo.h - deltaY;
        y = startGeo.y + deltaY;
      }
      if (width < MIN_W) {
        if (direction.includes("w")) x -= MIN_W - width;
        width = MIN_W;
      }
      if (height < MIN_H) {
        if (direction.includes("n")) y -= MIN_H - height;
        height = MIN_H;
      }
      state.geo = { x, y, w: width, h: height };
      applyGeo();
    };
    const onPointerUp = () => {
      handle.removeEventListener("pointermove", move);
      saveUi();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
    handle.addEventListener("pointercancel", onPointerUp, { once: true });
  }
  window.addEventListener("resize", () => {
    if (state.open) applyGeo();
  });

  Object.assign(ctx, { MIN_W, MIN_H, defaultGeo, clampGeo, applyGeo, saveUi, loadUi, applyGhost, startDrag, startResize });
}
