// アイコン生成・DOM ヘルパ（h / btn）・旅行データへのアクセス
import * as T from "../../lib.js";

export function installDom(ctx) {
  const { state } = ctx;
  function makeSvgIcon(svgPath, size = 22) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svgElement = document.createElementNS(svgNamespace, "svg");
    svgElement.setAttribute("viewBox", "0 0 24 24");
    svgElement.setAttribute("width", size);
    svgElement.setAttribute("height", size);
    svgElement.setAttribute("fill", "currentColor");
    svgElement.innerHTML = svgPath;
    return svgElement;
  }
  // Material Symbols 用（viewBox: 0 -960 960 960）
  function makeMsIcon(svgPath, size = 22) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svgElement = document.createElementNS(svgNamespace, "svg");
    svgElement.setAttribute("viewBox", "0 -960 960 960");
    svgElement.setAttribute("width", size);
    svgElement.setAttribute("height", size);
    svgElement.setAttribute("fill", "currentColor");
    svgElement.innerHTML = svgPath;
    return svgElement;
  }
  const MS_GROUP_PATH = '<path d="M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v63H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100.5 15T325-320ZM160-440q-33 0-56.5-23.5T80-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-440Zm640 0q-33 0-56.5-23.5T720-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-440Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-80q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560Zm1 240Zm-1-280Z"/>';


  // ---------- 旅行データ（Firebase 由来）の取り出し ----------
  const tripData = () =>
    state.trip && state.trip.id === state.tripId ? state.trip.data : null;
  const currentMember = () =>
    state.auth.state === "signedIn"
      ? { uid: state.auth.uid, email: state.auth.email, key: T.emailKey(state.auth.email) }
      : null;
  const isOwner = () => {
    const trip = tripData(),
      myMember = currentMember();
    return !!(trip && trip.meta && myMember && trip.meta.ownerUid === myMember.uid);
  };

  // ---------- DOM ヘルパ（textContent のみ使用） ----------
  function createEl(tag, props = {}, ...kids) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") element.className = value;
      else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null && value !== false)
        element.setAttribute(key, value === true ? "" : value);
    }
    for (const child of kids.flat()) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return element;
  }
  const makeButton = (label, onclick, className = "") =>
    createEl("button", { class: "btn " + className, type: "button", onclick }, label);

  Object.assign(ctx, { makeSvgIcon, makeMsIcon, MS_GROUP_PATH, tripData, currentMember, isOwner, createEl, makeButton });
}
