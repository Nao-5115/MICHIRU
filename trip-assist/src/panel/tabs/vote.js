// 「投票」タブ（候補地点の投票・採用）
import * as T from "../../lib.js";

export function installVoteTab(c) {
  const { gate, tripData, me, isOwner, h, BUDGET_OPTIONS, TRANSPORT_OPTIONS, makeSvgIcon, SPOT_CATEGORIES, SPOT_ICONS, prefsFloat, makeMsIcon, MS_GROUP_PATH, act, S, btn, flash, fb, send, signinCard, SPOT_COLORS } = c;
  const importAdopted = (...args) => c.importAdopted(...args);
  const render = (...args) => c.render(...args);

  function viewVote() {
    const g = gate();
    if (g) return g;
    const d = tripData(),
      m = me(),
      owner = isOwner();
    const ms = T.membersOf(d),
      places = T.placesOf(d),
      votes = d.votes || {},
      adopted = d.adopted || {};
    const ranked = T.rankPlaces(places, ms, votes);
    const myPrefs = (d.preferences && d.preferences[m.key]) || {};
    let _budget = myPrefs.budget || null;
    let _transport = new Set(myPrefs.transport || []);
    let _prefCategories = new Set(myPrefs.categories || []);

    // ---- 希望登録セクション ----
    const budgetBtns = {};
    const transportBtns = {};
    const catPrefBtns = {};

    const budgetRow = h("div", { class: "toggle-group" },
      ...BUDGET_OPTIONS.map(({ label, value }) => {
        const btn2 = h("button", {
          class: "toggle-btn" + (_budget === value ? " selected" : ""),
          onclick: () => {
            _budget = _budget === value ? null : value;
            BUDGET_OPTIONS.forEach(({ value: v }) => {
              budgetBtns[v].classList.toggle("selected", _budget === v);
            });
          },
        }, label);
        budgetBtns[value] = btn2;
        return btn2;
      })
    );
    const transportRow = h("div", { class: "cat-grid" },
      ...TRANSPORT_OPTIONS.map(({ label, svg }) => {
        const btn2 = h("button", {
          class: "cat-btn" + (_transport.has(label) ? " selected" : ""),
          title: label,
          onclick: () => {
            const alreadySelected = _transport.has(label);
            _transport.clear();
            if (!alreadySelected) _transport.add(label);
            TRANSPORT_OPTIONS.forEach(({ label: l }) => {
              transportBtns[l].classList.toggle("selected", _transport.has(l));
            });
          },
        },
          makeSvgIcon(svg),
          h("span", { class: "cat-label" }, label)
        );
        transportBtns[label] = btn2;
        return btn2;
      })
    );
    const catPrefRow = h("div", { class: "cat-grid" },
      ...SPOT_CATEGORIES.map((cat) => {
        const { label, svg } = SPOT_ICONS[cat];
        const btn2 = h("button", {
          class: "cat-btn" + (_prefCategories.has(cat) ? " selected" : ""),
          title: cat,
          onclick: () => {
            // 単一選択：同じものを押したら解除、違うものを押したら切替
            const alreadySelected = _prefCategories.has(cat);
            _prefCategories.clear();
            if (!alreadySelected) _prefCategories.add(cat);
            SPOT_CATEGORIES.forEach((c) => {
              catPrefBtns[c].classList.toggle("selected", _prefCategories.has(c));
            });
          },
        },
          makeSvgIcon(svg),
          h("span", { class: "cat-label" }, label),
        );
        catPrefBtns[cat] = btn2;
        return btn2;
      })
    );

    // 他メンバーの希望まとめ表示
    const prefSummary = (() => {
      const prefs = d.preferences || {};
      const rows = ms
        .filter((x) => prefs[x.key])
        .map((x) => {
          const p = prefs[x.key];
          const budgetLabel = p.budget
            ? (BUDGET_OPTIONS.find((o) => o.value === p.budget) || {}).label || "`¥`" + p.budget
            : "—";
          const transLabel = (p.transport && p.transport.length)
            ? p.transport.map((t) => {
                const opt = TRANSPORT_OPTIONS.find((o) => o.label === t);
                return opt
                  ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="vertical-align:middle;margin:0 1px" title="${t}">${opt.svg}</svg>`
                  : t;
              }).join("")
            : "—";
          const catLabel = (p.categories && p.categories.length)
            ? p.categories.map((cat) => {
                const ico = SPOT_ICONS[cat];
                if (!ico) return cat;
                return `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="vertical-align:middle;margin:0 1px" title="${cat}">${ico.svg}</svg>`;
              }).join("")
            : "—";
          const li = h("li", {},
            h("b", {}, x.name),
          );
          const detail = h("span", { class: "muted pref-summary-detail" });
          detail.innerHTML = `　予算: ${budgetLabel}　交通: ${transLabel}　カテゴリ: ${catLabel}`;
          li.append(detail);
          return li;
        });
      return rows.length
        ? h("ul", { class: "list" }, ...rows)
        : h("p", { class: "muted" }, "まだ誰も希望を登録していません。");
    })();

    const memberPrefsToggle = h("button", {
      class: "member-prefs-toggle",
      onclick: () => {
        prefsFloat.toggle(d.preferences || {}, ms);
      },
    }, makeMsIcon(MS_GROUP_PATH, 18), " メンバーの希望");

    // ---- 行きたい場所：最大3件の入力リスト ----
    const MAX_WISH_PLACES = 3;
    // 自分が登録済みの候補地点
    const myPlaces = places.filter((p) => p.addedBy === m.key);
    const placeInputs = []; // { row, input, removeBtn } ← 新規追加用
    const placeList = h("div", { class: "wish-place-list" });

    // 既存地点の表示（編集フォーム内）
    const existingPlaceList = h("div", { class: "wish-place-list" });
    function buildExistingPlaceRows() {
      existingPlaceList.innerHTML = "";
      myPlaces.forEach((p) => {
        const row = h("div", { class: "wish-place-row wish-place-existing" },
          h("span", { class: "wish-place-name" }, p.name),
          h("button", {
            type: "button",
            class: "wish-place-remove",
            title: "削除",
            onclick: async () => {
              if (!confirm(`「${p.name}」を候補地点から削除します。よろしいですか？`)) return;
              await act("removePlace", { tripId: S.tripId, placeId: p.id }, "候補地点を削除しました");
              const idx = myPlaces.findIndex((x) => x.id === p.id);
              if (idx !== -1) myPlaces.splice(idx, 1);
              buildExistingPlaceRows();
              updateAddBtn();
            },
          }, "×"),
        );
        existingPlaceList.appendChild(row);
      });
    }
    buildExistingPlaceRows();

    function makePlaceInput(autoName) {
      const inp = h("input", {
        type: "text",
        placeholder: "地点名（空欄なら現在ページから自動取得）",
        maxlength: 60,
        value: autoName || "",
        class: "wish-place-input",
      });
      const removeBtn = h("button", {
        type: "button",
        class: "wish-place-remove",
        title: "削除",
        onclick: () => {
          const idx = placeInputs.findIndex((e) => e.row === row);
          if (idx !== -1) placeInputs.splice(idx, 1);
          row.remove();
          updateAddBtn();
        },
      }, "×");
      const row = h("div", { class: "wish-place-row" }, inp, removeBtn);
      placeInputs.push({ row, input: inp, removeBtn });
      placeList.appendChild(row);
      updateAddBtn();
      return { row, input: inp };
    }

    const addPlaceBtn = h("button", {
      type: "button",
      class: "wish-place-add",
      onclick: () => {
        const total = myPlaces.length + placeInputs.length;
        if (total < MAX_WISH_PLACES) {
          makePlaceInput("");
          updateAddBtn();
        }
      },
    },
      h("span", {}, "+"),
      " 行きたい場所を追加",
    );

    function updateAddBtn() {
      const total = myPlaces.length + placeInputs.length;
      addPlaceBtn.style.display = total >= MAX_WISH_PLACES ? "none" : "";
      placeInputs.forEach(({ removeBtn }) => {
        removeBtn.style.display = placeInputs.length <= 1 && myPlaces.length === 0 ? "none" : "";
      });
    }

    // 初期: 既存がなければ1件作成
    if (myPlaces.length === 0) {
      makePlaceInput(T.extractPlaceName(location.href) || "");
    }
    updateAddBtn();

    // ---- 登録済み希望の表示ビュー ----
    const hasMyPrefs = !!(myPrefs.budget || (myPrefs.transport && myPrefs.transport.length) || (myPrefs.categories && myPrefs.categories.length));

    function buildPrefView() {
      const budgetLabel = myPrefs.budget
        ? (BUDGET_OPTIONS.find((o) => o.value === myPrefs.budget) || {}).label || myPrefs.budget
        : "未設定";
      const transportLabel = (myPrefs.transport && myPrefs.transport.length)
        ? myPrefs.transport[0]
        : "未設定";
      const categoryLabel = (myPrefs.categories && myPrefs.categories.length)
        ? myPrefs.categories[0]
        : "未設定";
      const transportOpt = TRANSPORT_OPTIONS.find((o) => o.label === transportLabel);
      const catIcon = SPOT_ICONS[categoryLabel];

      const locationOnIcon = () => makeMsIcon('<path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-560q0-117-77.5-194.5T480-832q-85 0-162.5 77.5T240-560q0 71 59 162.5T480-186Z"/>', 16);
      const placeViewRows = myPlaces.length > 0
        ? myPlaces.map((p) =>
            h("div", { class: "pref-view-row" },
              h("span", { class: "pref-view-label" }, ""),
              h("span", { class: "pref-view-value pref-view-place" }, locationOnIcon(), p.name),
            )
          )
        : [h("div", { class: "pref-view-row" },
            h("span", { class: "pref-view-label" }, ""),
            h("span", { class: "pref-view-value" }, "未設定"),
          )];

      return h("div", { class: "pref-view" },
        h("div", { class: "pref-view-row pref-view-section-label" },
          h("span", { class: "pref-view-label pref-view-section-title" }, "あなたの希望"),
        ),
        ...placeViewRows,
        h("div", { class: "pref-view-row" },
          h("span", { class: "pref-view-label" }, "予算"),
          h("span", { class: "pref-view-value" }, budgetLabel),
        ),
        h("div", { class: "pref-view-row" },
          h("span", { class: "pref-view-label" }, "交通手段"),
          h("span", { class: "pref-view-value" },
            transportOpt ? makeSvgIcon(transportOpt.svg) : null,
            " " + transportLabel,
          ),
        ),
        h("div", { class: "pref-view-row" },
          h("span", { class: "pref-view-label" }, "カテゴリ"),
          h("span", { class: "pref-view-value" },
            catIcon ? makeSvgIcon(catIcon.svg) : null,
            " " + (catIcon ? catIcon.label : categoryLabel),
          ),
        ),
      );
    }

    // フォームと表示ビューを切り替えるコンテナ
    const prefFormWrap = h("div", {});
    const prefViewWrap = h("div", {});
    let _editMode = !hasMyPrefs; // 未登録なら最初からフォーム表示

    function showPrefForm() {
      _editMode = true;
      prefFormWrap.style.display = "";
      prefViewWrap.style.display = "none";
    }
    function showPrefView() {
      _editMode = false;
      prefFormWrap.style.display = "none";
      prefViewWrap.style.display = "";
      prefViewWrap.innerHTML = "";
      prefViewWrap.appendChild(buildPrefView());
      prefViewWrap.appendChild(
        btn("希望を変更する", showPrefForm, "small")
      );
    }

    // フォーム内容をprefFormWrapにセット
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "行きたい場所（最大3件）"));
    prefFormWrap.appendChild(existingPlaceList);
    prefFormWrap.appendChild(placeList);
    prefFormWrap.appendChild(addPlaceBtn);
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "予算（一人あたり目安）"));
    prefFormWrap.appendChild(budgetRow);
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "希望カテゴリ"));
    prefFormWrap.appendChild(catPrefRow);
    prefFormWrap.appendChild(h("div", { class: "form-label" }, "希望の交通手段"));
    prefFormWrap.appendChild(transportRow);
    prefFormWrap.appendChild(btn("希望を登録", async () => {
      // 地点登録
      const ll = T.extractLatLng(location.href);
      let addedCount = 0;
      let skipCount = 0;
      for (const { input } of placeInputs) {
        const name = input.value.trim() || T.extractPlaceName(location.href);
        if (!name) continue;
        if (!ll) { skipCount++; continue; }
        if (places.length + addedCount >= T.MAX_CANDIDATE_PLACES) {
          flash(`候補地点は最大 ${T.MAX_CANDIDATE_PLACES} 件です`, "err");
          break;
        }
        await act("addPlace", { tripId: S.tripId, place: { name, lat: ll.lat, lng: ll.lng } }, null);
        addedCount++;
      }
      if (skipCount > 0 && addedCount === 0) {
        return flash("Google マップで場所を選択した状態でページを開いてから登録してください。", "err");
      }
      await act("setPreferences", {
        tripId: S.tripId,
        prefs: {
          budget: _budget,
          transport: [..._transport],
          categories: [..._prefCategories],
        },
      }, null);
      flash(addedCount > 0 ? `希望を登録しました（地点 ${addedCount} 件）` : "希望を保存しました");
      // 入力欄リセット
      while (placeInputs.length > 1) {
        const last = placeInputs.pop();
        last.row.remove();
      }
      if (placeInputs[0]) placeInputs[0].input.value = "";
      updateAddBtn();
      // 登録後は表示ビューに切替（myPrefsを更新して再描画）
      Object.assign(myPrefs, {
        budget: _budget,
        transport: [..._transport],
        categories: [..._prefCategories],
      });
      showPrefView();
    }, "primary"));

    // 初期表示
    if (_editMode) {
      showPrefForm();
    } else {
      prefViewWrap.appendChild(buildPrefView());
      prefViewWrap.appendChild(btn("希望を変更する", showPrefForm, "small"));
      prefFormWrap.style.display = "none";
    }

    const secPrefs = h("section", {},
      h("h3", {}, "旅行の希望を登録"),
      prefFormWrap,
      prefViewWrap,
      memberPrefsToggle,
    );
    const secList = h(
      "section",
      {},
      h("h3", {}, "候補地点（得票数の多い順）"),
      ranked.length
        ? h(
            "div",
            { class: "place-card-list" },
            ranked.map(({ place: p, voters }) => {
              const mine = !!(votes[m.key] && votes[m.key][p.id]);
              const mapsUrl = (p.lat != null && p.lng != null)
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&center=${p.lat},${p.lng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
              const openInCurrentTab = (url) => { window.open(url, "_blank"); };
              return h(
                "div",
                { class: "place-card" + (adopted[p.id] ? " adopted" : "") },
                h(
                  "div",
                  {
                    class: "place-card__header",
                    onclick: () => openInCurrentTab(mapsUrl),
                    title: "Google マップで開く",
                  },
                  h(
                    "div",
                    { class: "place-card__title-row" },
                    h("span", { class: "place-card__name" }, p.name),
                    adopted[p.id]
                      ? h("span", { class: "badge ok" }, "採用")
                      : null,
                    h(
                      "span",
                      { class: "place-card__map-icon" },
                      h("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", width: "16", height: "16", fill: "currentColor" },
                        h("path", { d: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" }),
                      ),
                    ),
                  ),
                  h(
                    "div",
                    { class: "place-card__meta" },
                    h("span", { class: "muted" }, `追加: ${p.addedByName || "—"}`),
                    h("span", { class: "place-card__votes" }, `${voters.length} 票`),
                  ),
                  voters.length
                    ? h("div", { class: "place-card__voters muted" }, "投票: " + voters.join("、"))
                    : h("div", { class: "place-card__voters muted" }, "投票: まだありません"),
                ),
                h(
                  "div",
                  { class: "place-card__actions" },
                  h(
                    "label",
                    { class: "inline" },
                    h("input", {
                      type: "checkbox",
                      checked: mine,
                      onchange: (e) =>
                        act(
                          "setVote",
                          {
                            tripId: S.tripId,
                            placeId: p.id,
                            on: e.target.checked,
                          },
                          e.target.checked
                            ? "行きたい場所に投票しました"
                            : "投票を取り消しました",
                        ),
                    }),
                    "行きたい",
                  ),
                  owner
                    ? h(
                        "label",
                        { class: "inline" },
                        h("input", {
                          type: "checkbox",
                          checked: !!adopted[p.id],
                          onchange: (e) =>
                            act(
                              "setAdopted",
                              {
                                tripId: S.tripId,
                                placeId: p.id,
                                on: e.target.checked,
                              },
                              e.target.checked
                                ? "採用しました"
                                : "採用を取り消しました",
                            ),
                        }),
                        "採用（幹事）",
                      )
                    : null,
                  p.addedBy === m.key || owner
                    ? btn(
                        "削除",
                        async () => {
                          if (
                            confirm(
                              `候補地点「${p.name}」を削除します。よろしいですか？`,
                            )
                          )
                            await act(
                              "removePlace",
                              { tripId: S.tripId, placeId: p.id },
                              "候補地点を削除しました",
                            );
                        },
                        "small danger",
                      )
                    : null,
                ),
              );
            }),
          )
        : h("p", { class: "muted" }, "候補地点がまだありません。"),
      owner
        ? h(
            "div",
            {},
            btn(
              "採用した地点を訪問地点リストに取り込む",
              importAdopted,
              "primary",
            ),

          )
        : h("p", { class: "muted" }, "採用する地点は幹事が選びます。"),
    );

    // ---- AIスポット提案セクション ----
    const aiResultsEl = h("div", { class: "ai-results" });

    function buildAiResults() {
      aiResultsEl.innerHTML = "";
      if (S.aiSuggesting) {
        aiResultsEl.appendChild(h("p", { class: "muted" }, "✨ AIがスポットを考えています…"));
        return;
      }
      if (S.aiError) {
        aiResultsEl.appendChild(h("p", { class: "warn" }, S.aiError));
      }
      if (!S.aiResults || !S.aiResults.length) return;
      S.aiResults.forEach((spot) => {
        let _added = false;
        const addedBadge = h("span", { class: "badge ok", hidden: true }, "追加済み");
        const addBtn = h("button", {
          class: "btn small",
          type: "button",
          onclick: async () => {
            if (_added) return;
            const r = await fb("addPlace", {
              tripId: S.tripId,
              place: { name: spot.name, lat: spot.lat, lng: spot.lng },
            });
            if (r.ok) {
              _added = true;
              addBtn.disabled = true;
              addBtn.textContent = "追加済み";
              addedBadge.hidden = false;
            } else {
              flash(r.error || "追加に失敗しました", "err");
            }
          },
        }, "候補に追加");
        aiResultsEl.appendChild(
          h("div", { class: "ai-spot-card" },
            h("div", { class: "ai-spot-header" },
              h("span", { class: "ai-spot-name" }, spot.name),
              spot.category ? h("span", { class: "badge" }, spot.category) : null,
              addedBadge,
            ),
            spot.area ? h("div", { class: "ai-spot-meta" }, "📍 " + spot.area) : null,
            spot.reason ? h("div", { class: "ai-spot-reason" }, spot.reason) : null,
            addBtn,
          )
        );
      });
    }
    buildAiResults();

    const suggestBtn = h("button", {
      class: "btn primary",
      type: "button",
      onclick: async () => {
        S.aiSuggesting = true;
        S.aiResults = null;
        S.aiError = "";
        buildAiResults();
        suggestBtn.disabled = true;
        const r = await send({
          type: "gemini:suggest",
          preferences: d.preferences || {},
          tripName: (d.meta && d.meta.name) || "旅行",
        });
        S.aiSuggesting = false;
        suggestBtn.disabled = false;
        if (r.ok) {
          S.aiResults = r.spots || [];
          S.aiError = r.spots && r.spots.length ? "" : "スポットが取得できませんでした。もう一度お試しください。";
        } else {
          S.aiResults = null;
          S.aiError = r.error || "提案に失敗しました";
        }
        buildAiResults();
      },
    }, "✨ AIがスポットを提案");

    const secAI = h("section", {},
      h("h3", {}, "✨ AIスポット提案"),
      h("p", { class: "muted" }, "メンバーの希望をもとに、AIがおすすめスポットを5件提案します。"),
      suggestBtn,
      aiResultsEl,
    );

    return [secPrefs, secAI, secList];
  }

  // ======================= 全体共有スポットカタログ =======================
  const spotDistance = (a, b) => {
    const r = 6371000,
      rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad,
      dLng = (b.lng - a.lng) * rad;
    const q =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(q));
  };
  const spotMapUrl = (spot) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${spot.name} ${spot.lat},${spot.lng}`)}`;
  function spotStars(rating, size = 14) {
    return h(
      "span",
      { class: "spot-stars", "aria-label": `${rating} / 5` },
      ...Array.from({ length: 5 }, (_, i) =>
        h(
          "span",
          {
            style: `font-size:${size}px;color:${i < rating ? "#fbbc04" : "#dadce0"}`,
          },
          "★",
        ),
      ),
    );
  }
  function viewSpots() {
    if (S.auth.state !== "signedIn") return [signinCard()];
    if (S.spots === null && !S.spotsError)
      return [
        h("p", { class: "muted" }, "おすすめスポットを読み込んでいます…"),
      ];
    const spots = S.spots || [];
    const currentPlaceName = () => {
      const heading =
        document.querySelector("h1.DUwDvf") ||
        document.querySelector('[role="main"] h1');
      const name = heading && heading.textContent.trim();
      return name ? name.slice(0, 60) : null;
    };
    // カテゴリアイコングリッド（SVGインライン）
    const SPOT_ICONS = {
      観光スポット: {
        label: "観光",
        svg: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>',
      },
      飲食店: {
        label: "飲食",
        svg: '<path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>',
      },
      穴場スポット: {
        label: "穴場",
        svg: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49 3.49-7.51-7.51 3.49-3.49 7.51zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1-1.1-.49-1.1-1.1.49-1.1 1.1-1.1z"/>',
      },
      カフェ: {
        label: "カフェ",
        svg: '<path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>',
      },
      ショッピング: {
        label: "ショッピング",
        svg: '<path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h12c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm0 10c-2.21 0-4-1.79-4-4h2c0 1.1.9 2 2 2s2-.9 2-2h2c0 2.21-1.79 4-4 4z"/>',
      },
      "自然・景色": {
        label: "自然",
        svg: '<path d="M17 12h2L12 2 5.05 12H7l-3.9 6h8.45V22h1.1v-4H21L17 12zm-9.24 4l2.99-4.52.25-.38.25.38L14.24 16H7.76z"/>',
      },
      その他: {
        label: "その他",
        svg: '<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>',
      },
    };
    function makeSvgIcon(svgPath) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      svg.setAttribute("fill", "currentColor");
      svg.innerHTML = svgPath;
      return svg;
    }
    let _categoryValue = "";
    const catBtns = {};
    const catGrid = h(
      "div",
      { class: "cat-grid" },
      ...SPOT_CATEGORIES.map((cat) => {
        const { label, svg } = SPOT_ICONS[cat];
        const btn_ = h(
          "button",
          {
            type: "button",
            class: "cat-btn",
            title: cat,
            onclick: () => {
              _categoryValue = _categoryValue === cat ? "" : cat;
              SPOT_CATEGORIES.forEach((c) => {
                catBtns[c].classList.toggle("selected", c === _categoryValue);
              });
            },
          },
          makeSvgIcon(svg),
          h("span", { class: "cat-label" }, label),
        );
        catBtns[cat] = btn_;
        return btn_;
      }),
    );
    const category = {
      get value() {
        return _categoryValue;
      },
    };
    const description = h("textarea", {
      rows: 3,
      maxlength: 500,
      placeholder: "レビュー（任意、500文字以内）",
    });
    const recommendation = h("textarea", {
      rows: 2,
      maxlength: 50,
      placeholder: "一言コメント（任意、50文字以内）",
    });
    const author = h("input", {
      type: "text",
      maxlength: 40,
      placeholder: "表示名（任意）",
      value: S.auth.name || "",
    });
    let rating = 0;
    const ratingButtons = h("div", { class: "spot-rating" });
    function paintRating() {
      ratingButtons.replaceChildren(
        ...Array.from({ length: 5 }, (_, i) =>
          h(
            "button",
            {
              type: "button",
              class: "spot-rate-button",
              title: `${i + 1}つ星`,
              "aria-pressed": rating === i + 1,
              onclick: () => {
                rating = rating === i + 1 ? 0 : i + 1;
                paintRating();
              },
            },
            h(
              "span",
              { style: `color:${i < rating ? "#fbbc04" : "#dadce0"}` },
              "★",
            ),
          ),
        ),
      );
    }
    paintRating();
    const current = T.extractLatLng(location.href);
    const nearby = current
      ? spots.filter((s) => spotDistance(current, s) < 100)
      : [];
    const form = h(
      "section",
      {},
      h("h3", {}, "おすすめスポットを共有"),

      S.spotsError ? h("p", { class: "warn" }, S.spotsError) : null,
      h("div", {}, h("div", { class: "form-label" }, "カテゴリ"), catGrid),
      h("label", {}, "レビュー", description),
      h("label", {}, "一言コメント", recommendation),
      h("label", {}, "評価（必須）", h("div", { class: "row" }, ratingButtons)),
      h("label", {}, "表示名", author),
      btn(
        "現在の場所を登録",
        async () => {
          const point = T.extractLatLng(location.href);
          if (!point)
            return flash(
              "Google マップで場所を選択してから登録してください。",
              "err",
            );
          const name = currentPlaceName();
          if (!name || name.length > 60)
            return flash(
              "Google マップで登録したい場所の詳細を開いてから登録してください。",
              "err",
            );
          if (!SPOT_CATEGORIES.includes(category.value))
            return flash("カテゴリを選択してください。", "err");
          if (!rating) return flash("評価（星）を選択してください。", "err");
          if (spots.some((s) => spotDistance(point, s) < 50))
            return flash("50m以内に登録済みのスポットがあります。", "err");
          const result = await fb("addSpot", {
            spot: {
              name,
              ...point,
              category: category.value,
              description: description.value.trim(),
              recommendation: recommendation.value.trim(),
              rating,
              registeredBy: author.value.trim(),
            },
          });
          if (!result.ok)
            return flash(
              "スポットを登録できませんでした: " + result.error,
              "err",
            );
          flash(`「${name}」を共有スポットに登録しました`);
          description.value = "";
          recommendation.value = "";
          rating = 0;
          paintRating();
          render();
        },
        "primary",
      ),
    );

    const myEmail = me() && me().email;
    const rows = (items) =>
      items.map((spot) => {
        const color = SPOT_COLORS[spot.category] || SPOT_COLORS["その他"];
        const canDelete = spot.registeredByEmail === myEmail;
        const details = h(
          "div",
          { class: "spot-details", hidden: true },
          h(
            "div",
            { class: "muted" },
            `${(+spot.lat).toFixed(5)}, ${(+spot.lng).toFixed(5)}　${spot.registeredBy || "匿名"}　${spot.registeredAt ? new Date(+spot.registeredAt).toLocaleDateString("ja-JP") : ""}`,
          ),
          spot.description
            ? h("p", { class: "spot-text" }, spot.description)
            : null,
          spot.recommendation
            ? h(
                "p",
                { class: "spot-recommendation" },
                "💬 " + spot.recommendation,
              )
            : null,
          h(
            "a",
            {
              href: spotMapUrl(spot),
              target: "_blank",
              rel: "noopener noreferrer",
            },
            "Google マップで開く",
          ),
        );
        return h(
          "li",
          {},
          h(
            "div",
            { class: "line" },
            h(
              "button",
              {
                type: "button",
                class: "spot-expand",
                onclick: (e) => {
                  details.hidden = !details.hidden;
                  e.currentTarget.classList.toggle("open", !details.hidden);
                },
              },
              h("b", {}, spot.name),
              h(
                "span",
                {
                  class: "spot-cat",
                  style: `color:${color};border-color:${color}66;background:${color}18`,
                },
                spot.category,
              ),
              spotStars(+spot.rating),
            ),
            canDelete
              ? btn(
                  "削除",
                  async () => {
                    if (
                      !confirm(
                        `「${spot.name}」を共有スポットから削除しますか？`,
                      )
                    )
                      return;
                    const result = await fb("deleteSpot", { spotId: spot.id });
                    if (!result.ok)
                      return flash(
                        "削除できませんでした: " + result.error,
                        "err",
                      );
                    flash(`「${spot.name}」を削除しました`);
                  },
                  "small danger",
                )
              : null,
          ),
          details,
        );
      });
    const list = h(
      "section",
      {},
      h("h3", {}, `共有スポット（最新${spots.length}件を表示）`),
      spots.length
        ? h("ul", { class: "list" }, ...rows(spots))
        : h("p", { class: "muted" }, "共有スポットはまだありません。"),
    );
    let nearbyOpen = false;
    const nearbyList = h(
      "ul",
      { class: "list", hidden: true },
      ...rows(nearby),
    );
    const nearbyToggle = h(
      "h3",
      {
        class: "nearby-toggle",
        onclick: () => {
          nearbyOpen = !nearbyOpen;
          nearbyList.hidden = !nearbyOpen;
          nearbyToggle.classList.toggle("open", nearbyOpen);
        },
      },
      `この場所の近くのレビュー（${nearby.length}件）`,
    );
    const nearbySection = nearby.length
      ? h("section", {}, nearbyToggle, nearbyList)
      : null;
    return [form, nearbySection, list];
  }

  Object.assign(c, { viewVote, spotDistance, spotMapUrl, spotStars, viewSpots });
}
