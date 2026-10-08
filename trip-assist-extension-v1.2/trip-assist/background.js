// Service Worker: OAuth と Google Calendar API 呼び出しを担当
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    const cid = (chrome.runtime.getManifest().oauth2 || {}).client_id || '';
    if (!cid || cid.includes('YOUR_CLIENT_ID')) {
      return reject(new Error('manifest.json の oauth2.client_id が未設定です。README の手順で設定してください。'));
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

function removeToken(token) {
  return new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
}

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
    const p = new URLSearchParams({
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin, timeMax
    });
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    try {
      if (msg.type === 'listEvents') {
        sendResponse({ ok: true, items: await listEvents(msg.timeMin, msg.timeMax) });
      } else if (msg.type === 'createEvent') {
        const e = await api(EVENTS_URL, { method: 'POST', body: JSON.stringify(msg.event) });
        sendResponse({ ok: true, id: e.id, link: e.htmlLink });
      } else if (msg.type === 'deleteEvent') {
        // この拡張機能が登録して記録した予定のみ削除可能（記録が無い eventId は拒否）
        const key = 'ev:' + msg.eventId;
        const rec = typeof msg.eventId === 'string' ? await chrome.storage.sync.get(key) : {};
        if (!rec[key]) {
          sendResponse({ ok: false, error: 'この拡張機能から登録した予定ではないため、削除できません。' });
          return;
        }
        await api(`${EVENTS_URL}/${encodeURIComponent(msg.eventId)}`, { method: 'DELETE' });
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
