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

// ---------- Firebase（共有しおり） ----------
const FB = {
  apiKey: 'AIzaSyAmDdh__tk-5OCx88KguX4ZJGWTTuAbGhI',
  dbUrl: 'https://sage-byte-510900-e0-default-rtdb.asia-southeast1.firebasedatabase.app'
};

async function fbSignIn() {
  const accessToken = await getToken(true);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FB.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `access_token=${accessToken}&providerId=google.com`,
      requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true
    })
  });
  if (!res.ok) throw new Error('Firebase ログインに失敗しました (' + res.status + ')');
  const d = await res.json();
  const a = { idToken: d.idToken, uid: d.localId, name: d.displayName || '', exp: Date.now() + (+d.expiresIn - 120) * 1000 };
  await chrome.storage.session.set({ fbAuth: a }); // Service Worker は止まるので退避
  return a;
}
async function fbEnsure() {
  const { fbAuth } = await chrome.storage.session.get('fbAuth');
  return fbAuth && fbAuth.exp > Date.now() ? fbAuth : fbSignIn();
}

const FB_PATH = /^trips\/[A-Za-z0-9_-]{20}(\/[A-Za-z0-9_-]{1,40})*$/; // 想定外のパスは拒否
async function fb(path, method = 'GET', body) {
  if (!FB_PATH.test(path)) throw new Error('不正なパスです');
  const a = await fbEnsure();
  const res = await fetch(`${FB.dbUrl}/${path}.json?auth=${a.idToken}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 401 || res.status === 403) throw new Error('権限がありません（旅に参加していない、または旅が存在しません）');
  if (!res.ok) throw new Error('Firebase エラー (' + res.status + ')');
  return res.json();
}
const newTripId = () => {
  const b = crypto.getRandomValues(new Uint8Array(15)); // 推測されにくい長さ
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 20);
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    try {
      if (msg.type === 'listEvents') {
        sendResponse({ ok: true, items: await listEvents(msg.timeMin, msg.timeMax) });
      } else if (msg.type === 'createEvent') {
        const e = await api(EVENTS_URL, { method: 'POST', body: JSON.stringify(msg.event) });
        sendResponse({ ok: true, link: e.htmlLink });
      } else if (msg.type === 'tripCreate') {      // ← ここから追加！
        const a = await fbEnsure(), id = newTripId();
        await fb(`trips/${id}`, 'PUT', { title: String(msg.title || '旅行').slice(0, 100), owner: a.uid, members: { [a.uid]: String(msg.name).slice(0, 40) } });
        sendResponse({ ok: true, id });
      } else if (msg.type === 'tripJoin') {
        const a = await fbEnsure();
        await fb(`trips/${msg.id}/members/${a.uid}`, 'PUT', String(msg.name).slice(0, 40));
        sendResponse({ ok: true, trip: await fb(`trips/${msg.id}`) });
      } else if (msg.type === 'tripGet') {
        sendResponse({ ok: true, trip: await fb(`trips/${msg.id}`), uid: (await fbEnsure()).uid });
      } else if (msg.type === 'tripSet') {
        const a = await fbEnsure();
        await fb(`trips/${msg.id}/${msg.key}/${a.uid}`, 'PUT', msg.value);
        sendResponse({ ok: true });                // ← ここまで追加！
      } else {
        sendResponse({ ok: false, error: '不明なリクエストです' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});
