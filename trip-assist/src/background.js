// Service Worker: OAuth トークン取得、Google Calendar API、offscreen ドキュメントの管理、状態の中継。
// Service Worker はアイドルで終了するため、状態はモジュール変数に持たず chrome.storage に保存する。
// Firebase との常時接続は offscreen ドキュメント（offscreen.js）が担当する。
const EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const OFFSCREEN_URL = "offscreen.html";
const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// ---------- offscreen ドキュメント ----------
async function ensureOffscreen() {
  const offscreenContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (offscreenContexts.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["DOM_SCRAPING"],
      justification:
        "Firebase Realtime Database への常時接続とログイン状態の保持（Service Worker では接続を維持できないため）",
    });
  } catch (error) {
    if (!/single offscreen/i.test(String(error && error.message))) throw error; // 同時に作成された場合は無視
  }
}
chrome.runtime.onStartup.addListener(() => ensureOffscreen().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => ensureOffscreen().catch(() => {}));

// ---------- OAuth ----------
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    const clientId =
      (chrome.runtime.getManifest().oauth2 || {}).client_id || "";
    if (!clientId || clientId.includes("YOUR_CLIENT_ID")) {
      return reject(
        new Error(
          "manifest.json の oauth2.client_id が未設定です。README の手順で設定して、ビルドし直してください。",
        ),
      );
    }
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const message = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : "トークンを取得できません";
        return reject(new Error("Google 認証に失敗しました: " + message));
      }
      resolve(typeof token === "string" ? token : token.token);
    });
  });
}
const removeToken = (token) =>
  new Promise((resolve) =>
    chrome.identity.removeCachedAuthToken({ token }, resolve),
  );
const clearAuthTokenCache = () =>
  new Promise((resolve, reject) => {
    chrome.identity.clearAllCachedAuthTokens(() => {
      if (chrome.runtime.lastError)
        reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });

// ---------- Google Calendar API ----------
async function api(url, options = {}, tokenState = null) {
  let token = tokenState ? tokenState.token : await getToken(false);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
    });
    if (response.status === 401 && attempt === 0) {
      await removeToken(token);
      token = await getToken(false);
      if (tokenState) tokenState.token = token;
      continue;
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json()).error.message || "";
      } catch (_) {}
      const apiError = new Error(
        `Calendar API エラー (${response.status}) ${detail}`,
      );
      apiError.status = response.status;
      throw apiError;
    }
    if (response.status === 204) return null; // DELETE 成功は本文なし
    return response.json();
  }
}

async function createEvents(events) {
  if (!Array.isArray(events) || events.length === 0)
    throw new Error("登録する予定がありません");

  const tokenState = { token: await getToken(false) };
  const results = [];
  for (const { event, sendUpdates } of events) {
    try {
      const safeSendUpdates = SEND_UPDATES.has(sendUpdates)
        ? sendUpdates
        : "none";
      const created = await api(
        `${EVENTS_URL}?sendUpdates=${safeSendUpdates}`,
        { method: "POST", body: JSON.stringify(event) },
        tokenState,
      );
      results.push({ ok: true, id: created.id });
    } catch (caught) {
      const error = String((caught && caught.message) || caught);
      results.push({ ok: false, error });
      if (/認証|client_id|401|403/.test(error)) {
        for (let index = results.length; index < events.length; index++)
          results.push({ ok: false, error });
        break;
      }
    }
  }
  return results;
}

// ---------- Gmail 送信 ----------
const utf8b64 = (text) => {
  let bin = "";
  new TextEncoder()
    .encode(text)
    .forEach((byte) => (bin += String.fromCharCode(byte)));
  return btoa(bin);
};
const toB64Url = (text) =>
  utf8b64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sendMail({ to, subject, body }) {
  // ヘッダインジェクション対策（改行・空白を含む宛先はNG）
  if (typeof to !== "string" || !/^[^\s<>,;"]+@[^\s<>,;"]+$/.test(to))
    throw new Error("宛先のメールアドレスが不正です");
  if (typeof subject !== "string" || typeof body !== "string")
    throw new Error("件名または本文が不正です");
  if (subject.length > 200 || body.length > 5000)
    throw new Error("件名または本文が長すぎます");

  const raw = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${utf8b64(subject.replace(/[\r\n]+/g, " "))}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    utf8b64(body)
      .match(/.{1,76}/g)
      .join("\r\n"),
  ].join("\r\n");

  await api(GMAIL_SEND_URL, {
    method: "POST",
    body: JSON.stringify({ raw: toB64Url(raw) }),
  });
}

async function listEvents(timeMin, timeMax) {
  const items = [];
  let pageToken = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      timeMin,
      timeMax,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api(`${EVENTS_URL}?${params}`);
    for (const event of data.items || []) {
      if (event.status === "cancelled") continue;
      items.push({
        summary: event.summary || "(タイトルなし)",
        start: event.start,
        end: event.end,
        transparency: event.transparency || "opaque",
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

// この拡張機能が登録して記録した予定か（全旅行のローカル記録を調べる）
async function isOurEvent(eventId) {
  if (typeof eventId !== "string" || !eventId) return false;
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).some(
    ([key, value]) =>
      key.startsWith("local:") &&
      value &&
      Array.isArray(value.events) &&
      value.events.some((event) => event.id === eventId),
  );
}

const SEND_UPDATES = new Set(["all", "none", "externalOnly"]);
const LEGACY_TYPES = new Set(["listEvents", "createEvent", "deleteEvent"]);

// ビルド時に rollup の replace プラグインが実際のキーに置き換える
const GEMINI_API_KEY = __GEMINI_KEY__;
const MAPS_API_KEY = __MAPS_KEY__;

// ---------- Gemini AI スポット提案 ----------
async function callGeminiAPI(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  });
  // 503 のときは最大3回、指数バックオフでリトライ
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt)); // 2s, 4s
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (response.status === 503) {
      if (attempt < 2) continue; // リトライ
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(
        `Gemini API エラー (${response.status}): ${(errorBody.error || {}).message || ""}`,
      );
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
  throw new Error(
    "Gemini API エラー (503): サーバーが混雑しています。しばらく待ってから再度お試しください。",
  );
}

async function geocodePlace(name) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(name)}&language=ja&region=jp&key=${MAPS_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.status !== "OK" || !data.results?.[0]) return null;
  const location = data.results[0].geometry.location;
  return { lat: location.lat, lng: location.lng };
}

async function suggestSpotsWithGemini({ preferences, tripName }) {
  const budgetLabels = {
    5000: "〜5,000円",
    10000: "〜10,000円",
    20000: "〜20,000円",
    30000: "〜30,000円",
    99999: "30,000円〜",
  };
  const prefEntries = Object.entries(preferences || {});
  const prefSummary =
    prefEntries.length === 0
      ? "特に指定なし"
      : prefEntries
          .map(([, prefs]) => {
            const parts = [];
            if (prefs.budget)
              parts.push(
                `予算: ${budgetLabels[prefs.budget] || prefs.budget + "円"}`,
              );
            if (prefs.transport?.length)
              parts.push(`交通手段: ${prefs.transport.join("・")}`);
            if (prefs.categories?.length)
              parts.push(`希望カテゴリ: ${prefs.categories.join("・")}`);
            return parts.length ? parts.join(", ") : "特に指定なし";
          })
          .join("\n");

  const prompt = `あなたは旅行プランナーです。以下のメンバーの希望に基づいて、日本国内のおすすめ旅行スポットを5件提案してください。

旅行名: ${tripName || "旅行"}

メンバーの希望:
${prefSummary}

以下のJSON形式のみで回答してください（説明文は不要です）:
[
  {"name": "スポット名（Googleマップで検索できる具体的な名称）", "category": "観光スポット|飲食店|穴場スポット|カフェ|ショッピング|自然・景色|その他 のいずれか", "area": "都道府県や市区町村名", "reason": "おすすめ理由（30文字以内）"},
  ...
]

条件:
- スポット名はGoogleマップで検索できる正式名称を使う
- 5件すべて異なるエリアから選ぶ
- JSONのみ返す（余分なテキスト不要）`;

  const text = await callGeminiAPI(prompt);
  console.log("[MICHIRU] Gemini raw response:", text);

  let spots = [];
  try {
    // ```json ... ``` のマークダウンブロックを除去してから抽出
    const stripped = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
    console.log("[MICHIRU] stripped:", stripped);
    const match = stripped.match(/\[[\s\S]*\]/);
    console.log("[MICHIRU] match:", match ? match[0].slice(0, 200) : null);
    spots = match ? JSON.parse(match[0]) : [];
    console.log("[MICHIRU] parsed spots:", spots);
  } catch (error) {
    console.error("[MICHIRU] parse error:", error);
    throw new Error(
      "Gemini の回答をパースできませんでした。もう一度お試しください。",
    );
  }

  const results = [];
  for (const spot of spots.slice(0, 5)) {
    if (!spot || !spot.name) continue;
    let lat = null,
      lng = null;
    if (MAPS_API_KEY) {
      try {
        const geocoded = await geocodePlace(`${spot.name} ${spot.area || ""}`);
        if (geocoded) {
          lat = geocoded.lat;
          lng = geocoded.lng;
        }
      } catch (_) {}
    }
    results.push({
      name: spot.name,
      category: spot.category || "その他",
      area: spot.area || "",
      reason: spot.reason || "",
      lat,
      lng,
    });
  }
  return results;
}

// ---------- メッセージ ----------
// app:* / auth:* / cal:* をここで処理する。fb:* は offscreen.js が処理するので何も返さない。
// ---------- 口コミ要約（Google Places API → Gemini API） ----------
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const REVIEW_CACHE_MS = 7 * 24 * 60 * 60 * 1000; // 要約は7日間キャッシュ（API 利用料の節約）

async function getReviewSettings() {
  const stored = await chrome.storage.local.get(["settings:placesKey"]);
  return { placesKey: stored["settings:placesKey"] || MAPS_API_KEY || "" };
}

// Places API（New）の searchText で地点を探し、口コミを取得する
async function fetchPlaceReviews(name, lat, lng, key) {
  const body = { textQuery: name, languageCode: "ja", maxResultCount: 1 };
  if (typeof lat === "number" && typeof lng === "number") {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 500 },
    };
  }
  const response = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.displayName,places.rating,places.userRatingCount,places.reviews",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      `Places API エラー (${response.status}): ${(errorBody.error || {}).message || ""}`,
    );
  }
  const data = await response.json();
  const place = data.places && data.places[0];
  if (!place) return null;
  const reviews = (place.reviews || [])
    .map((review) => ({ rating: review.rating, text: (review.text && review.text.text) || "" }))
    .filter((review) => review.text);
  return {
    placeName: (place.displayName && place.displayName.text) || name,
    reviews,
  };
}

// Gemini API で口コミを一言コメントに要約する（既存の callGeminiAPI を利用）
async function summarizeReviewsWithGemini(placeName, reviews) {
  const list = reviews
    .map((review, index) => `${index + 1}. (★${review.rating ?? "?"}) ${review.text.slice(0, 300)}`)
    .join("\n");
  const prompt = `以下は「${placeName}」の Google マップの口コミです。

${list}

この場所の評判を、日本語で1文（60文字程度）の一言コメントにまとめてください。良い点と注意点があれば両方含めてください。一言コメントだけを返してください。`;
  const text = (await callGeminiAPI(prompt)).trim();
  if (!text) throw new Error("要約を取得できませんでした。もう一度お試しください。");
  return text;
}

async function summarizeReviews({ name, lat, lng }) {
  // 開発用ビルド（npm run build:dev）だけ、表示確認用の固定テキストを返す（本番ビルドでは除かれる）
  if (process.env.NODE_ENV === "development")
    return { summary: "たくさん遊ぶところがあって時間を潰せる！", count: 0, cached: false };
  if (typeof name !== "string" || !name.trim())
    throw new Error("地点名がありません");
  const { placesKey } = await getReviewSettings();
  if (!placesKey)
    throw new Error(
      "Google Places API キーが未設定です。.env の MAPS_KEY を設定してビルドし直してください。",
    );
  if (!GEMINI_API_KEY)
    throw new Error(
      "Gemini API キーが未設定です。.env の GEMINI_KEY を設定してビルドし直してください。",
    );
  const cacheKey = `review:summary:${name.trim()}:${lat ?? ""}:${lng ?? ""}`;
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (cached && Date.now() - cached.at < REVIEW_CACHE_MS)
    return { summary: cached.summary, count: cached.count, cached: true };
  const place = await fetchPlaceReviews(name.trim(), lat, lng, placesKey);
  if (!place || !place.reviews.length)
    return { summary: "口コミがまだありません。", count: 0, cached: false };
  const summary = await summarizeReviewsWithGemini(
    place.placeName,
    place.reviews,
  );
  await chrome.storage.local.set({
    [cacheKey]: { summary, count: place.reviews.length, at: Date.now() },
  });
  return { summary, count: place.reviews.length, cached: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    !message ||
    typeof message.type !== "string"
  )
    return false;
  const type = message.type;
  if (!/^(app|auth|cal|gemini|mail|pdf|review|settings):/.test(type) && !LEGACY_TYPES.has(type))
    return false;
  (async () => {
    try {
      if (type === "app:ensure") {
        await ensureOffscreen();
        sendResponse({ ok: true });
      } else if (type === "app:publish") {
        // offscreen は chrome.storage を使えないため、ここで保存する
        if (typeof message.key !== "string" || !message.key.startsWith("fb:"))
          throw new Error("不正なキーです");
        await chrome.storage.local.set({ [message.key]: message.value });
        sendResponse({ ok: true });
      } else if (type === "app:get") {
        const keys = (message.keys || []).filter(
          (key) => key === "app:currentTripId",
        );
        sendResponse({
          ok: true,
          values: await chrome.storage.local.get(keys),
        });
      } else if (type === "auth:token") {
        if (message.refresh) await clearAuthTokenCache();
        sendResponse({
          ok: true,
          token: await getToken(!!message.interactive),
        });
      } else if (type === "auth:clear") {
        if (message.token) await removeToken(message.token);
        sendResponse({ ok: true });
      } else if (type === "cal:list" || type === "listEvents") {
        sendResponse({
          ok: true,
          items: await listEvents(message.timeMin, message.timeMax),
        });
      } else if (type === "cal:create" || type === "createEvent") {
        const sendUpdatesMode = SEND_UPDATES.has(message.sendUpdates)
          ? message.sendUpdates
          : "none";
        const createdEvent = await api(
          `${EVENTS_URL}?sendUpdates=${sendUpdatesMode}`,
          {
            method: "POST",
            body: JSON.stringify(message.event),
          },
        );
        sendResponse({
          ok: true,
          id: createdEvent.id,
          link: createdEvent.htmlLink,
        });
      } else if (type === "cal:createBatch") {
        sendResponse({ ok: true, results: await createEvents(message.events) });
      } else if (type === "cal:delete" || type === "deleteEvent") {
        // この拡張機能が登録して記録した予定のみ削除可能（記録のない eventId は拒否）
        const eventId = message.eventId;
        if (!(await isOurEvent(eventId))) {
          sendResponse({
            ok: false,
            error: "この拡張機能から登録した予定ではないため、削除できません。",
          });
          return;
        }
        const sendUpdatesMode = message.notify ? "all" : "none"; // ゲストがいる予定は、キャンセル通知メールを送る
        await api(
          `${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdatesMode}`,
          { method: "DELETE" },
        );
        sendResponse({ ok: true });
      } else if (type === "app:navigateTab") {
        // 拡張機能以外のアクティブタブを探してナビゲート。なければ新規タブを作成
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const target = tabs.find(
          (tab) => !tab.url?.startsWith("chrome-extension://"),
        );
        if (target) {
          await chrome.tabs.update(target.id, { url: message.url });
        } else {
          await chrome.tabs.create({ url: message.url, active: true });
        }
        sendResponse({ ok: true });
      } else if (type === "gemini:suggest") {
        const spots = await suggestSpotsWithGemini(message);
        sendResponse({ ok: true, spots });
      } else if (type === "settings:save") {
        const patch = {};
        if (typeof message.placesKey === "string" && message.placesKey.trim())
          patch["settings:placesKey"] = message.placesKey.trim();
        if (Object.keys(patch).length) await chrome.storage.local.set(patch);
        sendResponse({ ok: true });
      } else if (type === "review:summarize") {
        sendResponse({ ok: true, ...(await summarizeReviews(message)) });
      } else if (type === "mail:send") {
        await sendMail(message);
        sendResponse({ ok: true });
      } else if (type === "pdf:download") {
        if (typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:application/pdf;base64,") || message.dataUrl.length > 30_000_000)
          throw new Error("PDFデータが不正か、サイズが大きすぎます");
        const filename = typeof message.filename === "string"
          ? message.filename.replace(/[\\/:*?\"<>|]/g, "_").slice(0, 120)
          : "旅のしおり.pdf";
        const downloadId = await chrome.downloads.download({
          url: message.dataUrl,
          filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
          saveAs: true,
        });
        sendResponse({ ok: true, downloadId });
      } else {
        sendResponse({ ok: false, error: "不明なリクエストです" });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message, status: error.status });
    }
  })();
  return true;
});
