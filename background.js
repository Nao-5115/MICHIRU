// Service Worker: OAuth トークン取得、Google Calendar API、offscreen ドキュメントの管理、状態の中継。
// Service Worker はアイドルで終了するため、状態はモジュール変数に持たず chrome.storage に保存する。
// Firebase との常時接続は offscreen ドキュメント（offscreen.js）が担当する。
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const OFFSCREEN_URL = 'offscreen.html';

// ---------- offscreen ドキュメント ----------
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DOM_SCRAPING'],
      justification: 'Firebase Realtime Database への常時接続とログイン状態の保持（Service Worker では接続を維持できないため）'
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
    const cid = (chrome.runtime.getManifest().oauth2 || {}).client_id || '';
    if (!cid || cid.includes('YOUR_CLIENT_ID')) {
      return reject(new Error('manifest.json の oauth2.client_id が未設定です。README の手順で設定して、ビルドし直してください。'));
    }
    chrome.identity.getAuthToken({ interactive }, (t) => {
      if (chrome.runtime.lastError || !t) {
        const m = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'トークンを取得できません';
        return reject(new Error('Google 認証に失敗しました: ' + m));
      }
      resolve(typeof t === 'string' ? t : t.token);
    });
  });
}
const removeToken = (token) => new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));

// ---------- Google Calendar API ----------
async function api(url, opt = {}) {
  let token = await getToken(true);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      ...opt,
      headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    });
    if (res.status === 401 && attempt === 0) {
      await removeToken(token);
      token = await getToken(true);
      continue;
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error.message || ''; } catch (_) {}
      const err = new Error(`Calendar API エラー (${res.status}) ${detail}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null; // DELETE 成功は本文なし
    return res.json();
  }
}

async function listEvents(timeMin, timeMax) {
  const items = [];
  let pageToken = '';
  for (let i = 0; i < 4; i++) {
    const p = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin, timeMax });
    if (pageToken) p.set('pageToken', pageToken);
    const data = await api(`${EVENTS_URL}?${p}`);
    for (const e of data.items || []) {
      if (e.status === 'cancelled') continue;
      items.push({ summary: e.summary || '(タイトルなし)', start: e.start, end: e.end, transparency: e.transparency || 'opaque' });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

// この拡張機能が登録して記録した予定か（全旅行のローカル記録を調べる）
async function isOurEvent(id) {
  if (typeof id !== 'string' || !id) return false;
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).some(([k, v]) => k.startsWith('local:') && v && Array.isArray(v.events) && v.events.some((e) => e.id === id));
}

const SEND_UPDATES = new Set(['all', 'none', 'externalOnly']);

// ---------- メッセージ ----------
// app:* / auth:* / cal:* をここで処理する。fb:* は offscreen.js が処理するので何も返さない。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  const t = msg.type;
  if (!/^(app|auth|cal):/.test(t)) return false;
  (async () => {
    try {
      if (t === 'app:ensure') {
        await ensureOffscreen();
        sendResponse({ ok: true });
      } else if (t === 'app:publish') { // offscreen は chrome.storage を使えないため、ここで保存する
        if (typeof msg.key !== 'string' || !msg.key.startsWith('fb:')) throw new Error('不正なキーです');
        await chrome.storage.local.set({ [msg.key]: msg.value });
        sendResponse({ ok: true });
      } else if (t === 'app:get') {
        const keys = (msg.keys || []).filter((k) => k === 'app:currentTripId');
        sendResponse({ ok: true, values: await chrome.storage.local.get(keys) });
      } else if (t === 'auth:token') {
        sendResponse({ ok: true, token: await getToken(!!msg.interactive) });
      } else if (t === 'auth:clear') {
        if (msg.token) await removeToken(msg.token);
        sendResponse({ ok: true });
      } else if (t === 'cal:list') {
        sendResponse({ ok: true, items: await listEvents(msg.timeMin, msg.timeMax) });
      } else if (t === 'cal:create') {
        const su = SEND_UPDATES.has(msg.sendUpdates) ? msg.sendUpdates : 'none';
        const e = await api(`${EVENTS_URL}?sendUpdates=${su}`, { method: 'POST', body: JSON.stringify(msg.event) });
        sendResponse({ ok: true, id: e.id, link: e.htmlLink });
      } else if (t === 'cal:delete') {
        // この拡張機能が登録して記録した予定のみ削除可能（記録のない eventId は拒否）
        if (!(await isOurEvent(msg.eventId))) {
          sendResponse({ ok: false, error: 'この拡張機能から登録した予定ではないため、削除できません。' });
          return;
        }
        const su = msg.notify ? 'all' : 'none'; // ゲストがいる予定は、キャンセル通知メールを送る
        await api(`${EVENTS_URL}/${encodeURIComponent(msg.eventId)}?sendUpdates=${su}`, { method: 'DELETE' });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: '不明なリクエストです' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message, status: err.status });
    }
  })();
  return true;
});
