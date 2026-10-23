// 「投票」タブ（候補地点の投票・採用）
import * as T from "../../lib.js";

export function installVoteTab(ctx) {
  const { gate, tripData, currentMember, isOwner, createEl, BUDGET_OPTIONS, TRANSPORT_OPTIONS, makeSvgIcon, SPOT_CATEGORIES, SPOT_ICONS, prefsFloat, makeMsIcon, MS_GROUP_PATH, runAction, state, makeButton, flash, callFirebase, sendMessage, signinCard, SPOT_COLORS } = ctx;
  const importAdopted = (...args) => ctx.importAdopted(...args);
  const render = (...args) => ctx.render(...args);

  function viewVote() {
    const gateView = gate();
    if (gateView) return gateView;
    const trip = tripData(),
      myMember = currentMember(),
      owner = isOwner();
    const members = T.membersOf(trip),
      places = T.placesOf(trip),
      votes = trip.votes || {},
      adopted = trip.adopted || {};
    const ranked = T.rankPlaces(places, members, votes);
    const myPrefs = (trip.preferences && trip.preferences[myMember.key]) || {};
    let _budget = myPrefs.budget || null;
    let _transport = new Set(myPrefs.transport || []);
    let _prefCategories = new Set(myPrefs.categories || []);

    // ---- 希望登録セクション ----
    const budgetBtns = {};
    const transportBtns = {};
    const catPrefBtns = {};

    const budgetRow = createEl("div", { class: "toggle-group" },
      ...BUDGET_OPTIONS.map(({ label, value }) => {
        const btn2 = createEl("button", {
          class: "toggle-btn" + (_budget === value ? " selected" : ""),
          onclick: () => {
            _budget = _budget === value ? null : value;
            BUDGET_OPTIONS.forEach(({ value: budgetValue }) => {
              budgetBtns[budgetValue].classList.toggle("selected", _budget === budgetValue);
            });
          },
        }, label);
        budgetBtns[value] = btn2;
        return btn2;
      })
    );
    const transportRow = createEl("div", { class: "cat-grid" },
      ...TRANSPORT_OPTIONS.map(({ label, svg: iconSvg }) => {
        const btn2 = createEl("button", {
          class: "cat-btn" + (_transport.has(label) ? " selected" : ""),
          title: label,
          onclick: () => {
            const alreadySelected = _transport.has(label);
            _transport.clear();
            if (!alreadySelected) _transport.add(label);
            TRANSPORT_OPTIONS.forEach(({ label: transportName }) => {
              transportBtns[transportName].classList.toggle("selected", _transport.has(transportName));
            });
          },
        },
          makeSvgIcon(iconSvg),
          createEl("span", { class: "cat-label" }, label)
        );
        transportBtns[label] = btn2;
        return btn2;
      })
    );
    const catPrefRow = createEl("div", { class: "cat-grid" },
      ...SPOT_CATEGORIES.map((spotCategory) => {
        const { label, svg: iconSvg } = SPOT_ICONS[spotCategory];
        const btn2 = createEl("button", {
          class: "cat-btn" + (_prefCategories.has(spotCategory) ? " selected" : ""),
          title: spotCategory,
          onclick: () => {
            // 単一選択：同じものを押したら解除、違うものを押したら切替
            const alreadySelected = _prefCategories.has(spotCategory);
            _prefCategories.clear();
            if (!alreadySelected) _prefCategories.add(spotCategory);
            SPOT_CATEGORIES.forEach((spotCategory) => {
              catPrefBtns[spotCategory].classList.toggle("selected", _prefCategories.has(spotCategory));
            });
          },
        },
          makeSvgIcon(iconSvg),
          createEl("span", { class: "cat-label" }, label),
        );
        catPrefBtns[spotCategory] = btn2;
        return btn2;
      })
    );

    // 他メンバーの希望まとめ表示
    const prefSummary = (() => {
      const prefs = trip.preferences || {};
      const rows = members
        .filter((member) => prefs[member.key])
        .map((member) => {
          const memberPrefs = prefs[member.key];
          const budgetLabel = memberPrefs.budget
            ? (BUDGET_OPTIONS.find((option) => option.value === memberPrefs.budget) || {}).label || "`¥`" + memberPrefs.budget
            : "—";
          const transLabel = (memberPrefs.transport && memberPrefs.transport.length)
            ? memberPrefs.transport.map((transport) => {
                const transportOption = TRANSPORT_OPTIONS.find((option) => option.label === transport);
                return transportOption
                  ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="vertical-align:middle;margin:0 1px" title="${transport}">${transportOption.svg}</svg>`
                  : transport;
              }).join("")
            : "—";
          const catLabel = (memberPrefs.categories && memberPrefs.categories.length)
            ? memberPrefs.categories.map((spotCategory) => {
                const icon = SPOT_ICONS[spotCategory];
                if (!icon) return spotCategory;
                return `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" style="vertical-align:middle;margin:0 1px" title="${spotCategory}">${icon.svg}</svg>`;
              }).join("")
            : "—";
          const listItem = createEl("li", {},
            createEl("b", {}, member.name),
          );
          const detail = createEl("span", { class: "muted pref-summary-detail" });
          detail.innerHTML = `　予算: ${budgetLabel}　交通: ${transLabel}　カテゴリ: ${catLabel}`;
          listItem.append(detail);
          return listItem;
        });
      return rows.length
        ? createEl("ul", { class: "list" }, ...rows)
        : createEl("p", { class: "muted" }, "まだ誰も希望を登録していません。");
    })();

    const memberPrefsToggle = createEl("button", {
      class: "member-prefs-toggle",
      onclick: () => {
        prefsFloat.toggle(trip.preferences || {}, members);
      },
    }, makeMsIcon(MS_GROUP_PATH, 18), " メンバーの希望");

    // ---- 行きたい場所：最大3件の入力リスト ----
    const MAX_WISH_PLACES = 3;
    // 自分が登録済みの候補地点
    const myPlaces = places.filter((wishPlace) => wishPlace.addedBy === myMember.key);
    const placeInputs = []; // { row, input, removeBtn } ← 新規追加用
    const placeList = createEl("div", { class: "wish-place-list" });

    // 既存地点の表示（編集フォーム内）
    const existingPlaceList = createEl("div", { class: "wish-place-list" });
    function buildExistingPlaceRows() {
      existingPlaceList.innerHTML = "";
      myPlaces.forEach((wishPlace) => {
        const row = createEl("div", { class: "wish-place-row wish-place-existing" },
          createEl("span", { class: "wish-place-name" }, wishPlace.name),
          createEl("button", {
            type: "button",
            class: "wish-place-remove",
            title: "削除",
            onclick: async () => {
              if (!confirm(`「${wishPlace.name}」を候補地点から削除します。よろしいですか？`)) return;
              await runAction("removePlace", { tripId: state.tripId, placeId: wishPlace.id }, "候補地点を削除しました");
              const index = myPlaces.findIndex((wishPlace) => wishPlace.id === wishPlace.id);
              if (index !== -1) myPlaces.splice(index, 1);
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
      const nameInput = createEl("input", {
        type: "text",
        placeholder: "地点名（空欄なら現在ページから自動取得）",
        maxlength: 60,
        value: autoName || "",
        class: "wish-place-input",
      });
      const removeBtn = createEl("button", {
        type: "button",
        class: "wish-place-remove",
        title: "削除",
        onclick: () => {
          const index = placeInputs.findIndex((entry) => entry.row === row);
          if (index !== -1) placeInputs.splice(index, 1);
          row.remove();
          updateAddBtn();
        },
      }, "×");
      const row = createEl("div", { class: "wish-place-row" }, nameInput, removeBtn);
      placeInputs.push({ row, input: nameInput, removeBtn });
      placeList.appendChild(row);
      updateAddBtn();
      return { row, input: nameInput };
    }

    const addPlaceBtn = createEl("button", {
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
      createEl("span", {}, "+"),
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
        ? (BUDGET_OPTIONS.find((option) => option.value === myPrefs.budget) || {}).label || myPrefs.budget
        : "未設定";
      const transportLabel = (myPrefs.transport && myPrefs.transport.length)
        ? myPrefs.transport[0]
        : "未設定";
      const categoryLabel = (myPrefs.categories && myPrefs.categories.length)
        ? myPrefs.categories[0]
        : "未設定";
      const transportOpt = TRANSPORT_OPTIONS.find((option) => option.label === transportLabel);
      const catIcon = SPOT_ICONS[categoryLabel];

      const locationOnIcon = () => makeMsIcon('<path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-560q0-117-77.5-194.5T480-832q-85 0-162.5 77.5T240-560q0 71 59 162.5T480-186Z"/>', 16);
      const placeViewRows = myPlaces.length > 0
        ? myPlaces.map((wishPlace) =>
            createEl("div", { class: "pref-view-row" },
              createEl("span", { class: "pref-view-label" }, ""),
              createEl("span", { class: "pref-view-value pref-view-place" }, locationOnIcon(), wishPlace.name),
            )
          )
        : [createEl("div", { class: "pref-view-row" },
            createEl("span", { class: "pref-view-label" }, ""),
            createEl("span", { class: "pref-view-value" }, "未設定"),
          )];

      return createEl("div", { class: "pref-view" },
        createEl("div", { class: "pref-view-row pref-view-section-label" },
          createEl("span", { class: "pref-view-label pref-view-section-title" }, "あなたの希望"),
        ),
        ...placeViewRows,
        createEl("div", { class: "pref-view-row" },
          createEl("span", { class: "pref-view-label" }, "予算"),
          createEl("span", { class: "pref-view-value" }, budgetLabel),
        ),
        createEl("div", { class: "pref-view-row" },
          createEl("span", { class: "pref-view-label" }, "交通手段"),
          createEl("span", { class: "pref-view-value" },
            transportOpt ? makeSvgIcon(transportOpt.svg) : null,
            " " + transportLabel,
          ),
        ),
        createEl("div", { class: "pref-view-row" },
          createEl("span", { class: "pref-view-label" }, "カテゴリ"),
          createEl("span", { class: "pref-view-value" },
            catIcon ? makeSvgIcon(catIcon.svg) : null,
            " " + (catIcon ? catIcon.label : categoryLabel),
          ),
        ),
      );
    }

    // フォームと表示ビューを切り替えるコンテナ
    const prefFormWrap = createEl("div", {});
    const prefViewWrap = createEl("div", {});
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
        makeButton("希望を変更する", showPrefForm, "small")
      );
    }

    // フォーム内容をprefFormWrapにセット
    prefFormWrap.appendChild(createEl("div", { class: "form-label" }, "行きたい場所（最大3件）"));
    prefFormWrap.appendChild(existingPlaceList);
    prefFormWrap.appendChild(placeList);
    prefFormWrap.appendChild(addPlaceBtn);
    prefFormWrap.appendChild(createEl("div", { class: "form-label" }, "予算（一人あたり目安）"));
    prefFormWrap.appendChild(budgetRow);
    prefFormWrap.appendChild(createEl("div", { class: "form-label" }, "希望カテゴリ"));
    prefFormWrap.appendChild(catPrefRow);
    prefFormWrap.appendChild(createEl("div", { class: "form-label" }, "希望の交通手段"));
    prefFormWrap.appendChild(transportRow);
    prefFormWrap.appendChild(makeButton("希望を登録", async () => {
      // 地点登録
      const latLng = T.extractLatLng(location.href);
      let addedCount = 0;
      let skipCount = 0;
      for (const { input } of placeInputs) {
        const name = input.value.trim() || T.extractPlaceName(location.href);
        if (!name) continue;
        if (!latLng) { skipCount++; continue; }
        if (places.length + addedCount >= T.MAX_CANDIDATE_PLACES) {
          flash(`候補地点は最大 ${T.MAX_CANDIDATE_PLACES} 件です`, "err");
          break;
        }
        await runAction("addPlace", { tripId: state.tripId, place: { name, lat: latLng.lat, lng: latLng.lng } }, null);
        addedCount++;
      }
      if (skipCount > 0 && addedCount === 0) {
        return flash("Google マップで場所を選択した状態でページを開いてから登録してください。", "err");
      }
      await runAction("setPreferences", {
        tripId: state.tripId,
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
      prefViewWrap.appendChild(makeButton("希望を変更する", showPrefForm, "small"));
      prefFormWrap.style.display = "none";
    }

    const secPrefs = createEl("section", {},
      createEl("h3", {}, "旅行の希望を登録"),
      prefFormWrap,
      prefViewWrap,
      memberPrefsToggle,
    );
    const secList = createEl(
      "section",
      {},
      createEl("h3", {}, "候補地点（得票数の多い順）"),
      ranked.length
        ? createEl(
            "div",
            { class: "place-card-list" },
            ranked.map(({ place: wishPlace, voters }) => {
              const mine = !!(votes[myMember.key] && votes[myMember.key][wishPlace.id]);
              const mapsUrl = (wishPlace.lat != null && wishPlace.lng != null)
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(wishPlace.name)}&center=${wishPlace.lat},${wishPlace.lng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(wishPlace.name)}`;
              const openInCurrentTab = (url) => { window.open(url, "_blank"); };
              return createEl(
                "div",
                { class: "place-card" + (adopted[wishPlace.id] ? " adopted" : "") },
                createEl(
                  "div",
                  {
                    class: "place-card__header",
                    onclick: () => openInCurrentTab(mapsUrl),
                    title: "Google マップで開く",
                  },
                  createEl(
                    "div",
                    { class: "place-card__title-row" },
                    createEl("span", { class: "place-card__name" }, wishPlace.name),
                    adopted[wishPlace.id]
                      ? createEl("span", { class: "badge ok" }, "採用")
                      : null,
                    createEl(
                      "span",
                      { class: "place-card__map-icon" },
                      createEl("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", width: "16", height: "16", fill: "currentColor" },
                        createEl("path", { d: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" }),
                      ),
                    ),
                  ),
                  createEl(
                    "div",
                    { class: "place-card__meta" },
                    createEl("span", { class: "muted" }, `追加: ${wishPlace.addedByName || "—"}`),
                    createEl("span", { class: "place-card__votes" }, `${voters.length} 票`),
                  ),
                  voters.length
                    ? createEl("div", { class: "place-card__voters muted" }, "投票: " + voters.join("、"))
                    : createEl("div", { class: "place-card__voters muted" }, "投票: まだありません"),
                ),
                createEl(
                  "div",
                  { class: "place-card__actions" },
                  createEl(
                    "label",
                    { class: "inline" },
                    createEl("input", {
                      type: "checkbox",
                      checked: mine,
                      onchange: (event) =>
                        runAction(
                          "setVote",
                          {
                            tripId: state.tripId,
                            placeId: wishPlace.id,
                            on: event.target.checked,
                          },
                          event.target.checked
                            ? "行きたい場所に投票しました"
                            : "投票を取り消しました",
                        ),
                    }),
                    "行きたい",
                  ),
                  owner
                    ? createEl(
                        "label",
                        { class: "inline" },
                        createEl("input", {
                          type: "checkbox",
                          checked: !!adopted[wishPlace.id],
                          onchange: (event) =>
                            runAction(
                              "setAdopted",
                              {
                                tripId: state.tripId,
                                placeId: wishPlace.id,
                                on: event.target.checked,
                              },
                              event.target.checked
                                ? "採用しました"
                                : "採用を取り消しました",
                            ),
                        }),
                        "採用（幹事）",
                      )
                    : null,
                  wishPlace.addedBy === myMember.key || owner
                    ? makeButton(
                        "削除",
                        async () => {
                          if (
                            confirm(
                              `候補地点「${wishPlace.name}」を削除します。よろしいですか？`,
                            )
                          )
                            await runAction(
                              "removePlace",
                              { tripId: state.tripId, placeId: wishPlace.id },
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
        : createEl("p", { class: "muted" }, "候補地点がまだありません。"),
      owner
        ? createEl(
            "div",
            {},
            makeButton(
              "採用した地点を訪問地点リストに取り込む",
              importAdopted,
              "primary",
            ),

          )
        : createEl("p", { class: "muted" }, "採用する地点は幹事が選びます。"),
    );

    // ---- AIスポット提案セクション ----
    const aiResultsEl = createEl("div", { class: "ai-results" });

    function buildAiResults() {
      aiResultsEl.innerHTML = "";
      if (state.aiSuggesting) {
        aiResultsEl.appendChild(createEl("p", { class: "muted" }, "✨ AIがスポットを考えています…"));
        return;
      }
      if (state.aiError) {
        aiResultsEl.appendChild(createEl("p", { class: "warn" }, state.aiError));
      }
      if (!state.aiResults || !state.aiResults.length) return;
      state.aiResults.forEach((spot) => {
        let _added = false;
        const addedBadge = createEl("span", { class: "badge ok", hidden: true }, "追加済み");
        const addBtn = createEl("button", {
          class: "btn small",
          type: "button",
          onclick: async () => {
            if (_added) return;
            const addResult = await callFirebase("addPlace", {
              tripId: state.tripId,
              place: { name: spot.name, lat: spot.lat, lng: spot.lng },
            });
            if (addResult.ok) {
              _added = true;
              addBtn.disabled = true;
              addBtn.textContent = "追加済み";
              addedBadge.hidden = false;
            } else {
              flash(addResult.error || "追加に失敗しました", "err");
            }
          },
        }, "候補に追加");
        aiResultsEl.appendChild(
          createEl("div", { class: "ai-spot-card" },
            createEl("div", { class: "ai-spot-header" },
              createEl("span", { class: "ai-spot-name" }, spot.name),
              spot.category ? createEl("span", { class: "badge" }, spot.category) : null,
              addedBadge,
            ),
            spot.area ? createEl("div", { class: "ai-spot-meta" }, "📍 " + spot.area) : null,
            spot.reason ? createEl("div", { class: "ai-spot-reason" }, spot.reason) : null,
            addBtn,
          )
        );
      });
    }
    buildAiResults();

    const suggestBtn = createEl("button", {
      class: "btn primary",
      type: "button",
      onclick: async () => {
        state.aiSuggesting = true;
        state.aiResults = null;
        state.aiError = "";
        buildAiResults();
        suggestBtn.disabled = true;
        const sendResult = await sendMessage({
          type: "gemini:suggest",
          preferences: trip.preferences || {},
          tripName: (trip.meta && trip.meta.name) || "旅行",
        });
        state.aiSuggesting = false;
        suggestBtn.disabled = false;
        if (sendResult.ok) {
          state.aiResults = sendResult.spots || [];
          state.aiError = sendResult.spots && sendResult.spots.length ? "" : "スポットが取得できませんでした。もう一度お試しください。";
        } else {
          state.aiResults = null;
          state.aiError = sendResult.error || "提案に失敗しました";
        }
        buildAiResults();
      },
    }, "✨ AIがスポットを提案");

    const secAI = createEl("section", {},
      createEl("h3", {}, "✨ AIスポット提案"),
      createEl("p", { class: "muted" }, "メンバーの希望をもとに、AIがおすすめスポットを5件提案します。"),
      suggestBtn,
      aiResultsEl,
    );

    return [secPrefs, secAI, secList];
  }

  // ======================= 全体共有スポットカタログ =======================
  const spotDistance = (from, to) => {
    const earthRadius = 6371000,
      degToRad = Math.PI / 180;
    const dLat = (to.lat - from.lat) * degToRad,
      dLng = (to.lng - from.lng) * degToRad;
    const haversineTerm =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(from.lat * degToRad) * Math.cos(to.lat * degToRad) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadius * Math.asin(Math.sqrt(haversineTerm));
  };
  const spotMapUrl = (spot) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${spot.name} ${spot.lat},${spot.lng}`)}`;
  function spotStars(rating, size = 14) {
    return createEl(
      "span",
      { class: "spot-stars", "aria-label": `${rating} / 5` },
      ...Array.from({ length: 5 }, (_, index) =>
        createEl(
          "span",
          {
            style: `font-size:${size}px;color:${index < rating ? "#fbbc04" : "#dadce0"}`,
          },
          "★",
        ),
      ),
    );
  }
  function viewSpots() {
    if (state.auth.state !== "signedIn") return [signinCard()];
    if (state.spots === null && !state.spotsError)
      return [
        createEl("p", { class: "muted" }, "おすすめスポットを読み込んでいます…"),
      ];
    const spots = state.spots || [];
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
      const svgNamespace = "http://www.w3.org/2000/svg";
      const svgElement = document.createElementNS(svgNamespace, "svg");
      svgElement.setAttribute("viewBox", "0 0 24 24");
      svgElement.setAttribute("width", "22");
      svgElement.setAttribute("height", "22");
      svgElement.setAttribute("fill", "currentColor");
      svgElement.innerHTML = svgPath;
      return svgElement;
    }
    let _categoryValue = "";
    const catBtns = {};
    const catGrid = createEl(
      "div",
      { class: "cat-grid" },
      ...SPOT_CATEGORIES.map((spotCategory) => {
        const { label, svg: iconSvg } = SPOT_ICONS[spotCategory];
        const btn_ = createEl(
          "button",
          {
            type: "button",
            class: "cat-btn",
            title: spotCategory,
            onclick: () => {
              _categoryValue = _categoryValue === spotCategory ? "" : spotCategory;
              SPOT_CATEGORIES.forEach((spotCategory) => {
                catBtns[spotCategory].classList.toggle("selected", spotCategory === _categoryValue);
              });
            },
          },
          makeSvgIcon(iconSvg),
          createEl("span", { class: "cat-label" }, label),
        );
        catBtns[spotCategory] = btn_;
        return btn_;
      }),
    );
    const category = {
      get value() {
        return _categoryValue;
      },
    };
    const description = createEl("textarea", {
      rows: 3,
      maxlength: 500,
      placeholder: "レビュー（任意、500文字以内）",
    });
    const recommendation = createEl("textarea", {
      rows: 2,
      maxlength: 50,
      placeholder: "一言コメント（任意、50文字以内）",
    });
    const author = createEl("input", {
      type: "text",
      maxlength: 40,
      placeholder: "表示名（任意）",
      value: state.auth.name || "",
    });
    let rating = 0;
    const ratingButtons = createEl("div", { class: "spot-rating" });
    function paintRating() {
      ratingButtons.replaceChildren(
        ...Array.from({ length: 5 }, (_, index) =>
          createEl(
            "button",
            {
              type: "button",
              class: "spot-rate-button",
              title: `${index + 1}つ星`,
              "aria-pressed": rating === index + 1,
              onclick: () => {
                rating = rating === index + 1 ? 0 : index + 1;
                paintRating();
              },
            },
            createEl(
              "span",
              { style: `color:${index < rating ? "#fbbc04" : "#dadce0"}` },
              "★",
            ),
          ),
        ),
      );
    }
    paintRating();
    const current = T.extractLatLng(location.href);
    const nearby = current
      ? spots.filter((nearbySpot) => spotDistance(current, nearbySpot) < 100)
      : [];
    const form = createEl(
      "section",
      {},
      createEl("h3", {}, "おすすめスポットを共有"),

      state.spotsError ? createEl("p", { class: "warn" }, state.spotsError) : null,
      createEl("div", {}, createEl("div", { class: "form-label" }, "カテゴリ"), catGrid),
      createEl("label", {}, "レビュー", description),
      createEl("label", {}, "一言コメント", recommendation),
      createEl("label", {}, "評価（必須）", createEl("div", { class: "row" }, ratingButtons)),
      createEl("label", {}, "表示名", author),
      makeButton(
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
          if (spots.some((nearbySpot) => spotDistance(point, nearbySpot) < 50))
            return flash("50m以内に登録済みのスポットがあります。", "err");
          const result = await callFirebase("addSpot", {
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

    const myEmail = currentMember() && currentMember().email;
    const rows = (items) =>
      items.map((spot) => {
        const color = SPOT_COLORS[spot.category] || SPOT_COLORS["その他"];
        const canDelete = spot.registeredByEmail === myEmail;
        const details = createEl(
          "div",
          { class: "spot-details", hidden: true },
          createEl(
            "div",
            { class: "muted" },
            `${(+spot.lat).toFixed(5)}, ${(+spot.lng).toFixed(5)}　${spot.registeredBy || "匿名"}　${spot.registeredAt ? new Date(+spot.registeredAt).toLocaleDateString("ja-JP") : ""}`,
          ),
          spot.description
            ? createEl("p", { class: "spot-text" }, spot.description)
            : null,
          spot.recommendation
            ? createEl(
                "p",
                { class: "spot-recommendation" },
                "💬 " + spot.recommendation,
              )
            : null,
          createEl(
            "a",
            {
              href: spotMapUrl(spot),
              target: "_blank",
              rel: "noopener noreferrer",
            },
            "Google マップで開く",
          ),
        );
        return createEl(
          "li",
          {},
          createEl(
            "div",
            { class: "line" },
            createEl(
              "button",
              {
                type: "button",
                class: "spot-expand",
                onclick: (event) => {
                  details.hidden = !details.hidden;
                  event.currentTarget.classList.toggle("open", !details.hidden);
                },
              },
              createEl("b", {}, spot.name),
              createEl(
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
              ? makeButton(
                  "削除",
                  async () => {
                    if (
                      !confirm(
                        `「${spot.name}」を共有スポットから削除しますか？`,
                      )
                    )
                      return;
                    const result = await callFirebase("deleteSpot", { spotId: spot.id });
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
    const list = createEl(
      "section",
      {},
      createEl("h3", {}, `共有スポット（最新${spots.length}件を表示）`),
      spots.length
        ? createEl("ul", { class: "list" }, ...rows(spots))
        : createEl("p", { class: "muted" }, "共有スポットはまだありません。"),
    );
    let nearbyOpen = false;
    const nearbyList = createEl(
      "ul",
      { class: "list", hidden: true },
      ...rows(nearby),
    );
    const nearbyToggle = createEl(
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
      ? createEl("section", {}, nearbyToggle, nearbyList)
      : null;
    return [form, nearbySection, list];
  }

  Object.assign(ctx, { viewVote, spotDistance, spotMapUrl, spotStars, viewSpots });
}
