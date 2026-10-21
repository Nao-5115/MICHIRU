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
  const ctx = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (ctx.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["DOM_SCRAPING"],
      justification:
        "Firebase Realtime Database への常時接続とログイン状態の保持（Service Worker では接続を維持できないため）",
    });
  } catch (e) {
    if (!/single offscreen/i.test(String(e && e.message))) throw e; // 同時に作成された場合は無視
  }
}
chrome.runtime.onStartup.addListener(() => ensureOffscreen().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => ensureOffscreen().catch(() => {}));

// ---------- OAuth ----------
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    const cid = (chrome.runtime.getManifest().oauth2 || {}).client_id || "";
    if (!cid || cid.includes("YOUR_CLIENT_ID")) {
      return reject(
        new Error(
          "manifest.json の oauth2.client_id が未設定です。README の手順で設定して、ビルドし直してください。",
        ),
      );
    }
    chrome.identity.getAuthToken({ interactive }, (t) => {
      if (chrome.runtime.lastError || !t) {
        const m = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : "トークンを取得できません";
        return reject(new Error("Google 認証に失敗しました: " + m));
      }
      resolve(typeof t === "string" ? t : t.token);
    });
  });
}
const removeToken = (token) =>
  new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));

// ---------- Google Calendar API ----------
async function api(url, opt = {}) {
  let token = await getToken(true);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      ...opt,
      headers: {
        ...(opt.headers || {}),
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
    });
    if (res.status === 401 && attempt === 0) {
      await removeToken(token);
      token = await getToken(true);
      continue;
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error.message || "";
      } catch (_) {}
      const err = new Error(`Calendar API エラー (${res.status}) ${detail}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null; // DELETE 成功は本文なし
    return res.json();
  }
}

// ---------- Gmail 送信 ----------
const utf8b64 = (s) => {
  let bin = "";
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};
const toB64Url = (s) =>
  utf8b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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
  for (let i = 0; i < 4; i++) {
    const p = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      timeMin,
      timeMax,
    });
    if (pageToken) p.set("pageToken", pageToken);
    const data = await api(`${EVENTS_URL}?${p}`);
    for (const e of data.items || []) {
      if (e.status === "cancelled") continue;
      items.push({
        summary: e.summary || "(タイトルなし)",
        start: e.start,
        end: e.end,
        transparency: e.transparency || "opaque",
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

// この拡張機能が登録して記録した予定か（全旅行のローカル記録を調べる）
async function isOurEvent(id) {
  if (typeof id !== "string" || !id) return false;
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).some(
    ([k, v]) =>
      k.startsWith("local:") &&
      v &&
      Array.isArray(v.events) &&
      v.events.some((e) => e.id === id),
  );
}

const SEND_UPDATES = new Set(["all", "none", "externalOnly"]);
const LEGACY_TYPES = new Set(["listEvents", "createEvent", "deleteEvent"]);

// ビルド時に rollup の replace プラグインが実際のキーに置き換える
const GEMINI_API_KEY = __GEMINI_KEY__;
const MAPS_API_KEY   = __MAPS_KEY__;


// ---------- Gemini AI スポット提案 ----------
async function callGeminiAPI(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini API エラー (${res.status}): ${(err.error || {}).message || ""}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function geocodePlace(name) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(name)}&language=ja&region=jp&key=${MAPS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.[0]) return null;
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

async function suggestSpotsWithGemini({ preferences, tripName }) {
  const budgetLabels = { 5000: "〜5,000円", 10000: "〜10,000円", 20000: "〜20,000円", 30000: "〜30,000円", 99999: "30,000円〜" };
  const prefEntries = Object.entries(preferences || {});
  const prefSummary = prefEntries.length === 0
    ? "特に指定なし"
    : prefEntries.map(([, p]) => {
        const parts = [];
        if (p.budget) parts.push(`予算: ${budgetLabels[p.budget] || p.budget + "円"}`);
        if (p.transport?.length) parts.push(`交通手段: ${p.transport.join("・")}`);
        if (p.categories?.length) parts.push(`希望カテゴリ: ${p.categories.join("・")}`);
        return parts.length ? parts.join(", ") : "特に指定なし";
      }).join("\n");

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
  } catch (e) {
    console.error("[MICHIRU] parse error:", e);
    throw new Error("Gemini の回答をパースできませんでした。もう一度お試しください。");
  }

  const results = [];
  for (const spot of spots.slice(0, 5)) {
    if (!spot || !spot.name) continue;
    let lat = null, lng = null;
    if (MAPS_API_KEY) {
      try {
        const geo = await geocodePlace(`${spot.name} ${spot.area || ""}`);
        if (geo) { lat = geo.lat; lng = geo.lng; }
      } catch (_) {}
    }
    results.push({ name: spot.name, category: spot.category || "その他", area: spot.area || "", reason: spot.reason || "", lat, lng });
  }
  return results;
}

// ---------- メッセージ ----------
// app:* / auth:* / cal:* をここで処理する。fb:* は offscreen.js が処理するので何も返さない。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== "string")
    return false;
  const t = msg.type;
  if (!/^(app|auth|cal|gemini|mail):/.test(t) && !LEGACY_TYPES.has(t)) return false;
  (async () => {
    try {
      if (t === "app:ensure") {
        await ensureOffscreen();
        sendResponse({ ok: true });
      } else if (t === "app:publish") {
        // offscreen は chrome.storage を使えないため、ここで保存する
        if (typeof msg.key !== "string" || !msg.key.startsWith("fb:"))
          throw new Error("不正なキーです");
        await chrome.storage.local.set({ [msg.key]: msg.value });
        sendResponse({ ok: true });
      } else if (t === "app:get") {
        const keys = (msg.keys || []).filter((k) => k === "app:currentTripId");
        sendResponse({
          ok: true,
          values: await chrome.storage.local.get(keys),
        });
      } else if (t === "auth:token") {
        sendResponse({ ok: true, token: await getToken(!!msg.interactive) });
      } else if (t === "auth:clear") {
        if (msg.token) await removeToken(msg.token);
        sendResponse({ ok: true });
      } else if (t === "cal:list" || t === "listEvents") {
        sendResponse({
          ok: true,
          items: await listEvents(msg.timeMin, msg.timeMax),
        });
      } else if (t === "cal:create" || t === "createEvent") {
        const su = SEND_UPDATES.has(msg.sendUpdates) ? msg.sendUpdates : "none";
        const e = await api(`${EVENTS_URL}?sendUpdates=${su}`, {
          method: "POST",
          body: JSON.stringify(msg.event),
        });
        sendResponse({ ok: true, id: e.id, link: e.htmlLink });
      } else if (t === "cal:delete" || t === "deleteEvent") {
        // この拡張機能が登録して記録した予定のみ削除可能（記録のない eventId は拒否）
        const eventId = msg.eventId;
        if (!(await isOurEvent(eventId))) {
          sendResponse({
            ok: false,
            error: "この拡張機能から登録した予定ではないため、削除できません。",
          });
          return;
        }
        const su = msg.notify ? "all" : "none"; // ゲストがいる予定は、キャンセル通知メールを送る
        await api(
          `${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=${su}`,
          { method: "DELETE" },
        );
        sendResponse({ ok: true });
      } else if (t === "app:navigateTab") {
        // 拡張機能以外のアクティブタブを探してナビゲート。なければ新規タブを作成
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const target = tabs.find((tb) => !tb.url?.startsWith("chrome-extension://"));
        if (target) {
          await chrome.tabs.update(target.id, { url: msg.url });
        } else {
          await chrome.tabs.create({ url: msg.url, active: true });
        }
        sendResponse({ ok: true });
      } else if (t === "gemini:suggest") {
        const spots = await suggestSpotsWithGemini(msg);
        sendResponse({ ok: true, spots });
      } else if (t === "mail:send") {
        await sendMail(msg);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "不明なリクエストです" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message, status: err.status });
    }
  })();
  return true;
});
