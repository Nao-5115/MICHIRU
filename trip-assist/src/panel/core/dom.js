// アイコン生成・DOM ヘルパ（h / btn）・旅行データへのアクセス
import * as T from "../../lib.js";

export function installDom(c) {
  const { S } = c;
  function makeSvgIcon(svgPath, size = 22) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "currentColor");
    svg.innerHTML = svgPath;
    return svg;
  }
  // Material Symbols 用（viewBox: 0 -960 960 960）
  function makeMsIcon(svgPath, size = 22) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "currentColor");
    svg.innerHTML = svgPath;
    return svg;
  }
  const MS_GROUP_PATH = '<path d="M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v63H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100.5 15T325-320ZM160-440q-33 0-56.5-23.5T80-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-440Zm640 0q-33 0-56.5-23.5T720-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-440Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-80q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560Zm1 240Zm-1-280Z"/>';


  // ---------- 旅行データ（Firebase 由来）の取り出し ----------
  const tripData = () =>
    S.trip && S.trip.id === S.tripId ? S.trip.data : null;
  const me = () =>
    S.auth.state === "signedIn"
      ? { uid: S.auth.uid, email: S.auth.email, key: T.emailKey(S.auth.email) }
      : null;
  const isOwner = () => {
    const d = tripData(),
      m = me();
    return !!(d && d.meta && m && d.meta.ownerUid === m.uid);
  };

  // ---------- DOM ヘルパ（textContent のみ使用） ----------
  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false)
        e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  const btn = (label, onclick, cls = "") =>
    h("button", { class: "btn " + cls, type: "button", onclick }, label);

  Object.assign(c, { makeSvgIcon, makeMsIcon, MS_GROUP_PATH, tripData, me, isOwner, h, btn });
}
