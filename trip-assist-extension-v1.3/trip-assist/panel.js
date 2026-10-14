// Google マップ上に重ねて表示するサイドパネル（Shadow DOM で独立。マップの DOM には依存しない）
(() => {
  if (document.getElementById('tripassist-host')) return;
  const T = TripLib;
  const KEYS = ['title', 'candidates', 'responses', 'received', 'places', 'settings', 'inviteId', 'legModes', 'nav'];
  const DEF = {
    title: '', candidates: [], responses: [], received: null, places: [], inviteId: null, legModes: {}, nav: null,
    settings: { speedCar: 40, speedTrain: 35, detourCar: 1.3, detourTrain: 1.3, startTime: '09:00', defaultStay: 60, stays: {}, confirmedId: null, timed: true }
  };
  const S = {
    events: null, tab: 'schedule', open: false, shareCode: '', replyCode: '',
    regResults: null, myEvents: [], selDel: new Set(), delResults: null,
    dragId: null, pendingScroll: null,
    // v1.3 追加: おすすめスポット
    localSpots: []
  };
  const rid = () => Math.random().toString(36).slice(2, 10);

  // おすすめスポット定数
  const SPOT_CATEGORIES = ['観光スポット', '飲食店', '穴場スポット', 'カフェ', 'ショッピング', '自然・景色', 'その他'];
  const MAX_SPOTS = 100;

  // ---------- ストレージ（sync: 旅行データ / local: スポットデータ） ----------
  async function load() {
    const all = await chrome.storage.sync.get(null);
    for (const k of KEYS) S[k] = all[k] !== undefined ? all[k] : structuredClone(DEF[k]);
    const oldSpeed = S.settings.speed; // v1.0 の設定からの移行
    S.settings = { ...DEF.settings, ...S.settings };
    if (oldSpeed > 0 && all.settings && all.settings.speedCar === undefined) S.settings.speedCar = oldSpeed;
    delete S.settings.speed; delete S.settings.startPlaceId;
    S.myEvents = Object.entries(all).filter(([k]) => k.startsWith('ev:')).map(([, v]) => v);
    for (const k of Object.keys(S.legModes)) if (S.legModes[k] !== 'train') delete S.legModes[k];
    if (Array.isArray(all.route)) {
      const m = new Map(S.places.map((p) => [p.id, p]));
      const ordered = all.route.map((id) => m.get(id)).filter(Boolean);
      if (ordered.length === S.places.length) { S.places = ordered; await save('places'); }
      try { await chrome.storage.sync.remove('route'); } catch (_) {}
    }
    for (const p of S.places) if (!p.name) p.name = T.UNNAMED_PLACE;
  }
  async function save(k) {
    try { await chrome.storage.sync.set({ [k]: S[k] }); return true; }
    catch (e) { flash('保存に失敗しました（容量上限の可能性があります）: ' + e.message, 'err'); return false; }
  }

  // v1.3: スポットは Firestore に保存（複数ユーザーで共有、大容量対応）

  /** Firestore から最新 MAX_SPOTS 件を取得して S.localSpots に格納 */
  async function loadSpots() {
    const db = window._db;
    if (!db) {
      console.warn('[TripAssist] Firestore が初期化されていません。firebase/firebase-config.js を確認してください。');
      S.localSpots = [];
      return;
    }
    try {
      const snap = await db.collection('spots').orderBy('registeredAt', 'desc').limit(MAX_SPOTS).get();
      S.localSpots = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name ?? '',
          lat: d.lat ?? 0,
          lng: d.lng ?? 0,
          category: d.category ?? 'その他',
          description: d.description ?? '',
          recommendation: d.recommendation ?? '',
          registeredBy: d.registeredBy ?? '',
          registeredAt: d.registeredAt?.toDate?.().toISOString() ?? new Date().toISOString()
        };
      });
    } catch (e) {
      console.error('[TripAssist] スポットの読み込みに失敗しました:', e);
      S.localSpots = [];
    }
  }

  /** スポットを Firestore に追加し、新しいドキュメント ID を返す */
  async function addSpotToFirestore(spot) {
    const db = window._db;
    if (!db) throw new Error('Firestore が初期化されていません。firebase/firebase-config.js を確認してください。');
    const { id: _id, registeredAt: _ts, ...data } = spot;
    const ref = await db.collection('spots').add({
      ...data,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  }

  /** Firestore からスポットを削除する */
  async function deleteSpotFromFirestore(spotId) {
    const db = window._db;
    if (!db) throw new Error('Firestore が初期化されていません。firebase/firebase-config.js を確認してください。');
    await db.collection('spots').doc(spotId).delete();
  }

  async function clearNav() {
    S.nav = null;
    try { await chrome.storage.sync.remove('nav'); } catch (_) {}
  }
  const isDirPage = () => location.pathname.startsWith('/maps/dir');
  async function goBack() {
    if (!S.nav) return;
    if (!/^https:\/\/(www\.google\.(com|co\.jp)|maps\.google\.com)\/maps/.test(S.nav.fromUrl || '')) {
      await clearNav(); render(); return flash('元の画面の URL が不正なため戻れません', 'err');
    }
    S.nav.back = true;
    if (!(await save('nav'))) flash('状態を保存できませんでしたが、元の画面へ戻ります', 'err');
    location.assign(S.nav.fromUrl);
  }

  // ---------- DOM ヘルパ（textContent のみ使用） ----------
  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onclick }, label);

  const host = h('div', { id: 'tripassist-host' });
  const root = host.attachShadow({ mode: 'open' });
  const statusEl = h('div', { class: 'status', hidden: true });
  const body = h('div', { class: 'body' });
  const tabsEl = h('div', { class: 'tabs' });
  const navBar = h('div', { class: 'navbar', hidden: true });
  const panel = h('div', { class: 'panel', hidden: true },
    h('div', { class: 'head' }, h('strong', {}, '旅行アシスト'), btn('×', () => toggle(false), 'icon')),
    navBar, tabsEl, statusEl, body);
  const fab = h('button', { class: 'fab', type: 'button', title: '旅行アシストを開く', onclick: () => toggle(true) }, '旅');
  root.append(h('link', { rel: 'stylesheet', href: chrome.runtime.getURL('panel.css') }), panel, fab);
  document.documentElement.append(host);

  let flashTimer;
  function flash(text, type = 'ok') {
    statusEl.textContent = text;
    statusEl.className = 'status ' + type;
    statusEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (statusEl.hidden = true), 8000);
  }
  function toggle(open) { S.open = open; panel.hidden = !open; fab.hidden = open; if (open) render(); }

  async function send(msg) {
    try {
      const r = await chrome.runtime.sendMessage(msg);
      if (!r) throw new Error('応答がありません');
      return r;
    } catch (e) {
      return { ok: false, error: /context invalidated/i.test(e.message) ? '拡張機能が更新されました。ページを再読み込みしてください。' : e.message };
    }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); flash('クリップボードにコピーしました'); }
    catch (_) {
      const ta = h('textarea'); ta.value = text; root.append(ta); ta.select();
      const ok = document.execCommand && document.execCommand('copy'); ta.remove();
      flash(ok ? 'クリップボードにコピーしました' : 'コピーに失敗しました。下のコードを手動でコピーしてください。', ok ? 'ok' : 'err');
    }
  }
  const codeBox = (code) => h('div', {},
    h('textarea', { class: 'code', readonly: true, rows: 3, onclick: (e) => e.target.select() }, code),
    btn('コードをコピー', () => copy(code)));

  // ---------- カレンダー読み込み ----------
  function allCands() {
    return [...S.candidates, ...(S.received ? S.received.invite.cands : [])];
  }
  async function refreshEvents(manual) {
    const cs = allCands();
    if (!cs.length) { if (manual) flash('候補日がありません', 'err'); return; }
    const min = cs.map((c) => c.s).sort()[0];
    const max = T.addDays(cs.map((c) => c.e).sort().pop(), 1);
    const r = await send({ type: 'listEvents', timeMin: new Date(min + 'T00:00:00').toISOString(), timeMax: new Date(max + 'T00:00:00').toISOString() });
    if (!r.ok) { flash(r.error, 'err'); return; }
    S.events = r.items;
    flash(`カレンダーの予定を ${r.items.length} 件読み込みました`);
    render();
  }
  const warnFor = (c) => {
    if (!S.events) return null;
    const cf = T.conflicts(c, S.events);
    if (!cf.length) return null;
    return h('div', { class: 'warn' }, '⚠ この日は既に予定が入っています',
      h('ul', {}, cf.slice(0, 4).map((e) => h('li', {}, e.summary))));
  };

  // ---------- 日程タブ ----------
  function viewSchedule() {
    const dS = h('input', { type: 'date', id: 'c-s' }), dE = h('input', { type: 'date', id: 'c-e' });
    const sec1 = h('section', {},
      h('h3', {}, '① 候補日を作る（幹事）'),
      h('input', { type: 'text', placeholder: '旅行のタイトル（例: 箱根旅行）', value: S.title, maxlength: 100,
        onchange: (e) => { S.title = e.target.value.trim(); save('title'); } }),
      h('div', { class: 'row' }, h('label', {}, '開始', dS), h('label', {}, '終了(任意)', dE),
        btn('追加', async () => {
          if (!dS.value) return flash('開始日を入力してください', 'err');
          const e = dE.value || dS.value;
          if (e < dS.value) return flash('終了日は開始日以降にしてください', 'err');
          if (S.candidates.length >= T.MAX_CANDS) return flash(`候補日は最大 ${T.MAX_CANDS} 件です`, 'err');
          if (!S.inviteId) { S.inviteId = rid(); await save('inviteId'); }
          S.candidates.push({ id: rid(), s: dS.value, e });
          S.candidates.sort((a, b) => a.s.localeCompare(b.s));
          await save('candidates'); S.shareCode = '';
          if (S.events) await refreshEvents(); else render();
        })),
      S.candidates.length ? h('ul', { class: 'list' }, S.candidates.map((c) => h('li', {},
        h('div', { class: 'line' }, h('span', {}, T.fmtRange(c)),
          btn('削除', async () => {
            S.candidates = S.candidates.filter((x) => x.id !== c.id);
            if (S.settings.confirmedId === c.id) { S.settings.confirmedId = null; await save('settings'); }
            await save('candidates'); S.shareCode = ''; render();
          }, 'small danger')),
        warnFor(c)))) : h('p', { class: 'muted' }, '候補日がまだありません。'),
      h('div', { class: 'row' },
        btn('カレンダーの予定を読み込む', () => refreshEvents(true)),
        btn('共有コードを発行', () => {
          if (!S.candidates.length) return flash('先に候補日を追加してください', 'err');
          S.shareCode = T.makeInviteCode(S.inviteId, S.title, S.candidates); render();
          flash('共有コードを発行しました。LINE などで友達に送ってください。');
        }, 'primary')),
      S.shareCode ? codeBox(S.shareCode) : null);

    const paste = h('textarea', { rows: 3, placeholder: '友達から届いた返答コードを貼り付け' });
    const ranked = T.rank(S.candidates, S.responses);
    const sec2 = h('section', {},
      h('h3', {}, '② 返答を集計する（幹事）'),
      paste,
      btn('返答コードを取り込む', async () => {
        try {
          const r = T.parseReply(paste.value);
          if (r.id !== S.inviteId) throw new Error('このコードは、現在の共有コードに対する返答ではありません。');
          const i = S.responses.findIndex((x) => x.name === r.name);
          if (i >= 0) S.responses[i] = r; else S.responses.push(r);
          await save('responses');
          flash(i >= 0 ? `${r.name} さんの返答を更新しました` : `${r.name} さんの返答を取り込みました`);
          render();
        } catch (e) { flash(e.message, 'err'); }
      }, 'primary'),
      S.responses.length ? h('p', { class: 'muted' }, '取り込み済み: ',
        S.responses.map((r) => h('span', { class: 'chip' }, r.name,
          h('b', { onclick: async () => { S.responses = S.responses.filter((x) => x !== r); await save('responses'); render(); } }, '×')))) : null,
      S.responses.length ? h('table', {},
        h('tr', {}, h('th', {}, '候補日'), h('th', {}, '○'), h('th', {}, '△'), h('th', {}, '×'), h('th', {}, '')),
        ranked.map((r) => h('tr', { class: S.settings.confirmedId === r.cand.id ? 'sel' : '' },
          h('td', {}, T.fmtRange(r.cand), r.yes.length ? h('div', { class: 'muted' }, '○: ' + r.yes.join('、')) : null),
          h('td', {}, r.yes.length), h('td', {}, r.maybe.length), h('td', {}, r.no.length),
          h('td', {}, btn(S.settings.confirmedId === r.cand.id ? '確定中' : '確定', async () => {
            S.settings.confirmedId = r.cand.id; await save('settings'); render();
          }, 'small'))))) : h('p', { class: 'muted' }, 'まだ返答がありません。'));

    const rin = h('textarea', { rows: 3, placeholder: '幹事から届いた共有コードを貼り付け' });
    const sec3 = h('section', {},
      h('h3', {}, '③ 出欠を入力する（友達側）'),
      rin,
      btn('共有コードを読み込む', async () => {
        try {
          const inv = T.parseInvite(rin.value);
          const same = S.received && S.received.invite.id === inv.id;
          S.received = { invite: inv, name: same ? S.received.name : '', ans: same ? S.received.ans : {} };
          S.replyCode = ''; await save('received');
          flash('共有コードを読み込みました'); if (S.events) await refreshEvents(); else render();
        } catch (e) { flash(e.message, 'err'); }
      }, 'primary'),
      S.received ? viewAnswerForm() : null);
    return [sec1, sec2, sec3];
  }

  function viewAnswerForm() {
    const R = S.received;
    return h('div', { class: 'box' },
      h('strong', {}, R.invite.title || '（タイトルなし）'),
      h('input', { type: 'text', placeholder: 'あなたの名前', maxlength: 40, value: R.name,
        onchange: (e) => { R.name = e.target.value.trim(); save('received'); } }),
      h('ul', { class: 'list' }, R.invite.cands.map((c) => h('li', {},
        h('div', { class: 'line' }, h('span', {}, T.fmtRange(c)),
          h('select', { onchange: (e) => { const v = e.target.value; if (v === '') delete R.ans[c.id]; else R.ans[c.id] = +v; save('received'); } },
            [['', '未回答'], ['1', '○ 参加可'], ['2', '△ 未定'], ['0', '× 不可']].map(([v, l]) =>
              h('option', { value: v, selected: String(R.ans[c.id] ?? '') === v }, l)))),
        warnFor(c)))),
      btn('カレンダーの予定を重ねて表示', () => refreshEvents(true)),
      btn('返答コードを生成', () => {
        if (!R.name) return flash('名前を入力してください', 'err');
        if (R.invite.cands.some((c) => R.ans[c.id] === undefined)) return flash('すべての候補日に出欠を入力してください', 'err');
        S.replyCode = T.makeReplyCode(R.invite.id, R.name, R.ans); render();
        flash('返答コードを生成しました。幹事に送ってください。');
      }, 'primary'),
      S.replyCode ? codeBox(S.replyCode) : null);
  }

  // ---------- ルートタブ ----------
  const modeOf = (a, b) => S.legModes[a.id + '>' + b.id] || S.legModes[b.id + '>' + a.id] || 'car';
  function currentItinerary() {
    if (!S.places.length) return null;
    const st = S.settings;
    return T.buildItinerary(S.places, {
      startMin: T.parseTime(st.startTime),
      speeds: { car: st.speedCar, train: st.speedTrain },
      detours: { car: st.detourCar, train: st.detourTrain },
      defaultStay: st.defaultStay, stays: st.stays, modeOf
    });
  }
  function pruneLegModes() {
    const ids = new Set(S.places.map((p) => p.id));
    for (const k of Object.keys(S.legModes)) { const [x, y] = k.split('>'); if (!ids.has(x) || !ids.has(y)) delete S.legModes[k]; }
    const keys = Object.keys(S.legModes);
    if (keys.length > 40) {
      const adj = new Set();
      for (let i = 1; i < S.places.length; i++) { adj.add(S.places[i - 1].id + '>' + S.places[i].id); adj.add(S.places[i].id + '>' + S.places[i - 1].id); }
      for (const k of keys) if (!adj.has(k)) delete S.legModes[k];
    }
  }
  async function placesChanged() { pruneLegModes(); await save('places'); await save('legModes'); render(); }

  async function movePlace(fromId, toId, after) {
    const moving = S.places.find((x) => x.id === fromId);
    const arr = S.places.filter((x) => x.id !== fromId);
    const idx = arr.findIndex((x) => x.id === toId);
    if (!moving || idx < 0) return;
    arr.splice(after ? idx + 1 : idx, 0, moving);
    if (arr.every((x, i) => x.id === S.places[i].id)) return;
    S.places = arr;
    await placesChanged();
    flash('並べ替えました。しおりの時刻とルートリンクを更新しました。');
  }

  async function openRoute(e, url) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const fromUrl = S.nav && isDirPage() ? S.nav.fromUrl : location.href;
    S.nav = { fromUrl, tab: S.tab, scroll: body.scrollTop, ts: Date.now() };
    if (!(await save('nav'))) flash('画面状態を保存できませんでした。ルート案内の後に「元の画面に戻る」が使えない場合があります。', 'err');
    location.assign(url);
  }

  function legView(prev, r) {
    const a = prev.place, b = r.place;
    const setMode = async (m) => {
      delete S.legModes[a.id + '>' + b.id]; delete S.legModes[b.id + '>' + a.id];
      if (m === 'train') S.legModes[a.id + '>' + b.id] = 'train';
      await save('legModes'); render();
    };
    const seg = (m) => h('button', { class: 'seg' + (r.mode === m ? ' on' : ''), type: 'button', onclick: () => setMode(m) }, T.MODE_LABEL[m]);
    const url = T.mapsDirUrl(a, b, r.mode);
    return h('div', { class: 'leg' },
      h('div', { class: 'legnames' }, `${a.name} → ${b.name}`),
      `${T.fmtTime(prev.depart)}出発 → ${T.fmtTime(r.arrive)}到着（約${r.travel}分・直線${r.km.toFixed(1)}km→道路換算約${r.roadKm.toFixed(1)}km）`,
      h('div', { class: 'legctl' }, seg('car'), seg('train'),
        h('a', { href: url, onclick: (e) => openRoute(e, url) }, 'この区間のルートを見る')));
  }

  function placeItem(p, i) {
    const st = S.settings;
    const clearMarks = () => root.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after'));
    const li = h('li', {
      ondragover: (e) => {
        if (!S.dragId) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        li.classList.toggle('drop-before', !after); li.classList.toggle('drop-after', after);
      },
      ondragleave: (e) => { if (!li.contains(e.relatedTarget)) li.classList.remove('drop-before', 'drop-after'); },
      ondrop: (e) => {
        e.preventDefault();
        const after = li.classList.contains('drop-after'), from = S.dragId;
        clearMarks(); S.dragId = null;
        if (from && from !== p.id) movePlace(from, p.id, after);
      }
    },
      h('div', { class: 'placehead' },
        h('span', { class: 'handle', draggable: 'true', title: 'ドラッグして並べ替え',
          ondragstart: (e) => {
            S.dragId = p.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id);
            e.dataTransfer.setDragImage(li, 12, 12); li.classList.add('dragging');
          },
          ondragend: () => { S.dragId = null; clearMarks(); } }, '☰'),
        h('span', { class: 'idx' }, `${i + 1}.`),
        h('input', { type: 'text', class: 'pname' + (p.name === T.UNNAMED_PLACE ? ' unnamed' : ''), value: p.name, maxlength: 60,
          placeholder: '地点名を入力', 'aria-label': '地点名',
          onchange: async (e) => { p.name = e.target.value.trim() || T.UNNAMED_PLACE; await save('places'); render(); } }),
        btn('削除', async () => {
          S.places = S.places.filter((x) => x.id !== p.id); delete st.stays[p.id];
          await save('settings'); await placesChanged();
        }, 'small danger')),
      p.name === T.UNNAMED_PLACE ? h('div', { class: 'hint' }, '場所名が未設定です。名前を入力してください。') : null,
      h('div', { class: 'muted' }, `座標: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`),
      h('div', { class: 'row' },
        h('label', {}, '滞在(分)', h('input', { type: 'number', min: 0, step: 5, value: st.stays[p.id] ?? st.defaultStay,
          onchange: (e) => { const v = parseInt(e.target.value, 10); if (v >= 0) st.stays[p.id] = v; else delete st.stays[p.id]; save('settings'); render(); } }))));
    return li;
  }

  function viewRoute() {
    const st = S.settings;
    const nameIn = h('input', { type: 'text', placeholder: '地点名（空欄なら URL から自動取得）', maxlength: 60 });
    const num = (key, min, step) => h('input', { type: 'number', min, step, value: st[key],
      onchange: (e) => {
        const v = parseFloat(e.target.value);
        const valid = key.startsWith('detour') ? v >= 1 : (v > 0 || (key === 'defaultStay' && v >= 0));
        if (valid) { st[key] = v; save('settings'); render(); }
        else { flash(key.startsWith('detour') ? '迂回係数は 1.0 以上の数値にしてください' : '正しい数値を入力してください', 'err'); e.target.value = st[key]; }
      } });
    const sec1 = h('section', {},
      h('h3', {}, '訪問地点（上から順に訪問）'),
      h('p', { class: 'muted' }, 'Google マップで場所を開いてから登録してください。☰ をドラッグすると並べ替えられます（先頭が出発地点）。'),
      nameIn,
      btn('現在のページの地点を登録', async () => {
        const ll = T.extractLatLng(location.href);
        if (!ll) return flash('このページの URL から緯度経度を取得できませんでした。場所を検索・選択してからもう一度お試しください。', 'err');
        if (S.places.length >= 20) return flash('登録できる地点は最大 20 件です', 'err');
        if (S.places.some((p) => Math.abs(p.lat - ll.lat) < 1e-5 && Math.abs(p.lng - ll.lng) < 1e-5)) return flash('同じ地点が既に登録されています', 'err');
        const typed = nameIn.value.trim(), found = T.extractPlaceName(location.href);
        S.places.push({ id: rid(), name: typed || found || T.UNNAMED_PLACE, lat: ll.lat, lng: ll.lng });
        await placesChanged();
        if (typed || found) flash('地点を登録しました');
        else flash('場所名を URL から取得できなかったため「名称未設定の地点」として登録しました。一覧で名前を入力できます。', 'err');
      }, 'primary'),
      S.places.length ? h('ul', { class: 'list' }, S.places.map(placeItem)) : h('p', { class: 'muted' }, '登録済みの地点はありません。'));
    const sec2 = h('section', {},
      h('h3', {}, 'しおりの設定'),
      h('div', { class: 'row' },
        h('label', {}, '出発時刻', h('input', { type: 'time', value: st.startTime, onchange: (e) => { st.startTime = e.target.value || '09:00'; save('settings'); render(); } })),
        h('label', {}, '標準滞在(分)', num('defaultStay', 0, 5))),
      h('div', { class: 'row' },
        h('label', {}, '車の速度(km/h)', num('speedCar', 1, 1)),
        h('label', {}, '電車の速度(km/h)', num('speedTrain', 1, 1))),
      h('div', { class: 'row' },
        h('label', {}, '迂回係数・車', num('detourCar', 1, 0.05)),
        h('label', {}, '迂回係数・電車', num('detourTrain', 1, 0.05))),
      h('p', { class: 'muted' }, '移動時間 = 直線距離 × 迂回係数 ÷ 想定速度。迂回係数は直線距離を道路・路線に沿った距離へ近づける倍率です。'),
      btn('訪問順を自動最適化（手動の並べ替えを上書き）', async () => {
        if (S.places.length < 2) return flash('地点を 2 件以上登録してください', 'err');
        S.places = T.optimize(S.places, 0).map((i) => S.places[i]);
        await placesChanged();
        flash('先頭の地点を出発地点として、訪問順を最適化しました');
      }, 'primary'));
    const it = currentItinerary();
    const sec3 = it ? h('section', {},
      h('h3', {}, '旅のしおり'),
      it.rows.length > 1 ? h('p', { class: 'muted' }, `総移動距離: 直線 ${it.totalKm.toFixed(1)} km／道路換算 約 ${it.totalRoadKm.toFixed(1)} km`) : null,
      h('ol', { class: 'timeline' }, it.rows.map((r, i) => h('li', {},
        i > 0 ? legView(it.rows[i - 1], r) : null,
        h('div', { class: 'stop' }, h('b', {}, r.place.name), ` 滞在${r.stay}分 (${T.fmtTime(r.arrive)}〜${T.fmtTime(r.depart)})`)))),
      h('p', { class: 'note' }, T.ESTIMATE_NOTE)) : null;
    return [sec1, sec2, sec3];
  }

  // ---------- 登録タブ ----------
  function toLocalDT(dateStr, min) {
    const d = T.addDays(dateStr, Math.floor(min / 1440)), m = min % 1440;
    return `${d}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  }
  function viewRegister() {
    const st = S.settings;
    const cand = S.candidates.find((c) => c.id === st.confirmedId);
    const it = currentItinerary();
    const title = S.title || '旅行';
    const sec = h('section', {},
      h('h3', {}, 'Google カレンダーに登録'),
      cand ? h('p', {}, '確定日程: ', h('b', {}, T.fmtRange(cand))) : h('p', { class: 'warn' }, '日程が未確定です。「日程」タブの集計で「確定」を押すか、下から選んでください。'),
      h('select', { onchange: async (e) => { st.confirmedId = e.target.value || null; await save('settings'); S.regResults = null; render(); } },
        h('option', { value: '' }, '候補日から選択…'),
        S.candidates.map((c) => h('option', { value: c.id, selected: c.id === st.confirmedId }, T.fmtRange(c)))),
      h('p', { class: 'muted' }, it ? `しおり: ${it.rows.length} 地点を含めます` : 'しおりが未作成です（日程のみ登録されます）。'),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st.timed, disabled: !it,
        onchange: (e) => { st.timed = e.target.checked; save('settings'); } }), '各地点を時刻付きの予定としても登録（開始日に作成）'),
      btn('カレンダーに登録', async () => {
        if (!cand) return flash('日程を確定してください', 'err');
        const events = [{
          summary: title,
          description: it ? 'しおり（概算）\n' + T.itineraryText(it.rows) : '',
          start: { date: cand.s }, end: { date: T.addDays(cand.e, 1) }
        }];
        if (it && st.timed) {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          for (const r of it.rows) events.push({
            summary: `${title}: ${r.place.name}`,
            location: `${r.place.lat},${r.place.lng}`,
            description: `https://www.google.com/maps?q=${r.place.lat},${r.place.lng}`,
            start: { dateTime: toLocalDT(cand.s, r.arrive), timeZone: tz },
            end: { dateTime: toLocalDT(cand.s, r.depart), timeZone: tz }
          });
        }
        S.regResults = [];
        const saved = {};
        for (const ev of events) {
          const res = await send({ type: 'createEvent', event: ev });
          S.regResults.push({ name: ev.summary, ok: res.ok, error: res.error });
          if (res.ok && res.id) {
            saved['ev:' + res.id] = ev.start.date
              ? { id: res.id, title: ev.summary, start: ev.start.date, end: ev.end.date, allDay: true }
              : { id: res.id, title: ev.summary, start: ev.start.dateTime.slice(0, 16), end: ev.end.dateTime.slice(0, 16), allDay: false };
          }
          if (!res.ok && /認証|client_id|401|403/.test(res.error)) break;
        }
        let saveErr = '';
        if (Object.keys(saved).length) {
          try { await chrome.storage.sync.set(saved); S.myEvents.push(...Object.values(saved)); }
          catch (e) { saveErr = `（削除用の記録を保存できなかったため、この拡張機能からは削除できません: ${e.message}）`; }
        }
        const ng = S.regResults.filter((r) => !r.ok).length;
        flash((ng ? `${ng} 件の登録に失敗しました` : `${S.regResults.length} 件の予定を登録しました`) + saveErr, ng || saveErr ? 'err' : 'ok');
        render();
      }, 'primary'),
      S.regResults ? h('ul', { class: 'list' }, S.regResults.map((r) =>
        h('li', { class: r.ok ? 'okli' : 'warn' }, (r.ok ? '✔ ' : '✖ ') + r.name + (r.ok ? '' : ` — ${r.error}`)))) : null);
    return [sec, viewMyEvents()];
  }

  function viewMyEvents() {
    const list = [...S.myEvents].sort((a, b) => a.start.localeCompare(b.start));
    for (const id of [...S.selDel]) if (!list.some((r) => r.id === id)) S.selDel.delete(id);
    return h('section', {},
      h('h3', {}, 'この拡張機能から登録した予定'),
      list.length ? h('ul', { class: 'list' }, list.map((r) => h('li', {},
        h('label', { class: 'inline' },
          h('input', { type: 'checkbox', checked: S.selDel.has(r.id), onchange: (e) => { if (e.target.checked) S.selDel.add(r.id); else S.selDel.delete(r.id); } }),
          h('span', {}, r.title, h('div', { class: 'muted' }, T.fmtEventWhen(r))))))) :
        h('p', { class: 'muted' }, '登録した予定はありません。（カレンダー上のそれ以外の予定は、ここには表示されず削除もできません）'),
      list.length ? h('div', {},
        btn('すべて選択', () => { list.forEach((r) => S.selDel.add(r.id)); render(); }, 'small'),
        btn('選択を解除', () => { S.selDel.clear(); render(); }, 'small'),
        btn('選択した予定を削除', async () => {
          const targets = list.filter((r) => S.selDel.has(r.id));
          if (!targets.length) return flash('削除する予定を選択してください', 'err');
          const lines = targets.map((r) => `・${r.title}（${T.fmtEventWhen(r)}）`).join('\n');
          if (!confirm(`Google カレンダーから次の ${targets.length} 件の予定を削除します。この操作は取り消せません。\n\n${lines}\n\nよろしいですか？`)) return;
          S.delResults = [];
          for (const r of targets) {
            const res = await send({ type: 'deleteEvent', eventId: r.id });
            const gone = !res.ok && (res.status === 404 || res.status === 410);
            if (res.ok || gone) {
              try { await chrome.storage.sync.remove('ev:' + r.id); } catch (_) {}
              S.myEvents = S.myEvents.filter((x) => x.id !== r.id); S.selDel.delete(r.id);
              S.delResults.push({ ok: true, text: res.ok ? `${r.title}: 削除しました` : `${r.title}: カレンダー上に既に存在しない（手動で削除済み）ため、記録のみ整理しました` });
            } else {
              S.delResults.push({ ok: false, text: `${r.title}: 削除に失敗しました — ${res.error}（記録は残してあります。再度お試しください）` });
              if (/認証|client_id/.test(res.error)) break;
            }
          }
          const ng = S.delResults.filter((x) => !x.ok).length;
          flash(ng ? `${ng} 件の削除に失敗しました` : `${S.delResults.length} 件の予定を処理しました`, ng ? 'err' : 'ok');
          render();
        }, 'danger')) : null,
      S.delResults ? h('ul', { class: 'list' }, S.delResults.map((x) => h('li', { class: x.ok ? 'okli' : 'warn' }, (x.ok ? '✔ ' : '✖ ') + x.text))) : null);
  }

  // ========== v1.3: おすすめスポット機能 ==========

  // スポット入力バリデーション
  function validateSpotInput(name, category) {
    if (!name || name.length === 0) return 'スポット名を入力してください';
    if (name.length > 60) return 'スポット名は60文字以内で入力してください';
    if (!SPOT_CATEGORIES.includes(category)) return 'カテゴリを選択してください';
    return null;
  }

  // 重複スポット判定（50m 以内に同一スポットがある場合は重複と判定）
  function isDuplicateSpot(lat, lng) {
    const R = 6371000;
    return S.localSpots.some((s) => {
      const dLat = (s.lat - lat) * Math.PI / 180;
      const dLng = (s.lng - lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a)) < 50;
    });
  }

  // カテゴリ色のマッピング
  const CAT_COLOR = {
    '観光スポット': '#1a73e8', '飲食店': '#e53935', '穴場スポット': '#7b1fa2',
    'カフェ': '#f57c00', 'ショッピング': '#0097a7', '自然・景色': '#388e3c', 'その他': '#616161'
  };

  // ---------- スポットタブ ----------
  function viewSpots() {
    const nameIn = h('input', { type: 'text', placeholder: '名称（空欄なら Google マップの場所名を自動取得）', maxlength: 60 });
    const catSel = h('select', {},
      h('option', { value: '' }, 'カテゴリを選択…'),
      ...SPOT_CATEGORIES.map((c) => h('option', { value: c }, c)));
    const descIn = h('textarea', { placeholder: '説明・アクセスなど（任意、500文字以内）', maxlength: 500, rows: 3 });
    const recIn = h('textarea', { placeholder: 'おすすめポイント（任意、200文字以内）', maxlength: 200, rows: 2 });
    const byIn = h('input', { type: 'text', placeholder: '登録者名（地元民としての名前・ハンドル名など）', maxlength: 40 });

    const sec1 = h('section', {},
      h('h3', {}, '📍 地元おすすめスポットを登録'),
      h('p', { class: 'muted' }, 'Google マップで登録したい場所を開いてから「登録」ボタンを押してください。登録したスポットは地図上にマーカーで表示されます。'),
      h('label', {}, 'スポット名', nameIn),
      h('label', {}, 'カテゴリ', catSel),
      h('label', {}, '説明・アクセス', descIn),
      h('label', {}, 'おすすめポイント', recIn),
      h('label', {}, '登録者名（地元民として）', byIn),
      btn('このページのスポットを登録', async () => {
        const ll = T.extractLatLng(location.href);
        if (!ll) return flash('この URL から位置情報を取得できません。Google マップで場所を選択してからお試しください。', 'err');
        const typedName = nameIn.value.trim();
        const autoName = T.extractPlaceName(location.href);
        const name = typedName || autoName || '';
        const category = catSel.value;

        const err = validateSpotInput(name, category);
        if (err) return flash(err, 'err');
        if (S.localSpots.length >= MAX_SPOTS) return flash(`登録できるスポットは最大 ${MAX_SPOTS} 件です`, 'err');
        if (isDuplicateSpot(ll.lat, ll.lng)) return flash('同じ場所が既に登録されています（50m 以内）', 'err');

        const spot = {
          id: '',  // Firestore が採番するため、ひとまず空文字
          name: name.slice(0, 60),
          lat: ll.lat,
          lng: ll.lng,
          category,
          description: descIn.value.trim().slice(0, 500),
          recommendation: recIn.value.trim().slice(0, 200),
          registeredBy: byIn.value.trim().slice(0, 40),
          registeredAt: new Date().toISOString()
        };
        try {
          const newId = await addSpotToFirestore(spot);
          spot.id = newId;
          S.localSpots.unshift(spot); // 新しい順（先頭）に追加
          flash(`「${spot.name}」を${spot.category}として登録しました`);
          updateOverlay();
          // フォームをリセット
          nameIn.value = ''; catSel.value = ''; descIn.value = ''; recIn.value = ''; byIn.value = '';
          render();
        } catch (e) {
          flash('スポットの保存に失敗しました: ' + e.message, 'err');
        }
      }, 'primary'));

    // 一覧
    const sorted = [...S.localSpots].reverse(); // 新しい順
    const sec2 = h('section', {},
      h('h3', {}, `登録済みスポット（${S.localSpots.length} 件）`),
      S.localSpots.length === 0
        ? h('p', { class: 'muted' }, '登録されたスポットはまだありません。上のフォームから登録してください。')
        : h('ul', { class: 'list' }, sorted.map((spot) => {
          const color = CAT_COLOR[spot.category] || '#616161';
          return h('li', {},
            h('div', { class: 'line' },
              h('span', {}, h('b', {}, spot.name), ' ',
                h('span', { class: 'spot-cat', style: `background:${color}20;color:${color};border-color:${color}40` }, spot.category)),
              btn('削除', async () => {
                if (!confirm(`「${spot.name}」をスポット一覧から削除しますか？この操作は取り消せません。`)) return;
                const prev = S.localSpots;
                S.localSpots = S.localSpots.filter((s) => s.id !== spot.id);
                try {
                  await deleteSpotFromFirestore(spot.id);
                  updateOverlay();
                  flash(`「${spot.name}」を削除しました`);
                  render();
                } catch (e) {
                  S.localSpots = prev; // ロールバック
                  flash('スポットの削除に失敗しました: ' + e.message, 'err');
                }
              }, 'small danger')),
            h('div', { class: 'muted' },
              `📌 ${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`,
              spot.registeredBy ? `　👤 ${spot.registeredBy}` : '',
              `　${new Date(spot.registeredAt).toLocaleDateString('ja-JP')}`),
            spot.description ? h('p', { class: 'muted spot-desc' }, spot.description.slice(0, 100) + (spot.description.length > 100 ? '…' : '')) : null,
            spot.recommendation ? h('p', { class: 'muted spot-rec' }, '✨ ' + spot.recommendation.slice(0, 80) + (spot.recommendation.length > 80 ? '…' : '')) : null);
        })));

    return [sec1, sec2];
  }

  // ========== v1.3: マップマーカーオーバーレイ ==========

  // Mercator 投影の Y 座標（0〜0.5 の範囲）
  function mercY(latDeg) {
    const s = Math.sin(latDeg * Math.PI / 180);
    return Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }

  // URL から Google マップの中心座標とズームレベルを取得
  function getMapState() {
    const m = location.href.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+(?:\.\d+)?)z/);
    return m ? { lat: +m[1], lng: +m[2], zoom: +m[3] } : null;
  }

  // スポット座標 → スクリーン座標（px）
  function spotToScreen(spot, state) {
    const scale = 256 * Math.pow(2, state.zoom);
    const cx = (state.lng + 180) / 360 * scale;
    const cy = (0.5 - mercY(state.lat)) * scale;
    const wx = (spot.lng + 180) / 360 * scale;
    const wy = (0.5 - mercY(spot.lat)) * scale;
    return {
      x: window.innerWidth / 2 + (wx - cx),
      y: window.innerHeight / 2 + (wy - cy)
    };
  }

  // --- オーバーレイ DOM 初期化（Shadow DOM の外、通常の document に配置） ---
  if (!document.getElementById('ta-overlay-style')) {
    const style = document.createElement('style');
    style.id = 'ta-overlay-style';
    style.textContent = [
      '#ta-spot-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;}',
      '.ta-marker{position:absolute;pointer-events:auto;cursor:pointer;transform:translate(-12px,-28px);}',
      '.ta-pin{width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);',
      'border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);transition:transform .15s;}',
      '.ta-marker:hover .ta-pin{transform:rotate(-45deg) scale(1.2);}',
      '.ta-pin-dot{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(45deg);',
      'width:8px;height:8px;background:rgba(255,255,255,.9);border-radius:50%;}',
      '.ta-tooltip{position:absolute;left:28px;top:-4px;background:rgba(32,33,36,.85);color:#fff;',
      'font:bold 11px -apple-system,"Segoe UI",Meiryo,sans-serif;padding:3px 8px;border-radius:4px;',
      'white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s;max-width:180px;overflow:hidden;text-overflow:ellipsis;}',
      '.ta-marker:hover .ta-tooltip{opacity:1;}',
      '.ta-popup{position:absolute;background:#fff;border-radius:10px;',
      'box-shadow:0 4px 16px rgba(0,0,0,.3);padding:12px 14px;width:260px;',
      'pointer-events:auto;z-index:2;font:13px/1.5 -apple-system,"Segoe UI",Meiryo,sans-serif;}',
      '.ta-popup-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;}',
      '.ta-popup h4{margin:0;font-size:14px;color:#202124;flex:1;line-height:1.3;}',
      '.ta-cat-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;margin-bottom:6px;}',
      '.ta-popup-desc{margin:4px 0;font-size:12px;color:#5f6368;line-height:1.5;}',
      '.ta-popup-rec{margin:4px 0;font-size:12px;color:#1e6b3c;background:#e6f4ea;padding:4px 8px;border-radius:4px;}',
      '.ta-popup-meta{margin-top:6px;font-size:11px;color:#9aa0a6;}',
      '.ta-close-btn{border:none;background:none;font-size:20px;cursor:pointer;color:#9aa0a6;',
      'line-height:1;padding:0;flex-shrink:0;transition:color .1s;}',
      '.ta-close-btn:hover{color:#202124;}',
      '.ta-maps-link{display:inline-block;margin-top:6px;font-size:11px;color:#1a73e8;text-decoration:none;font-weight:bold;}',
      '.ta-maps-link:hover{text-decoration:underline;}'
    ].join('');
    document.head.appendChild(style);
  }

  const overlayEl = (() => {
    let el = document.getElementById('ta-spot-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ta-spot-overlay';
      document.documentElement.appendChild(el);
    }
    return el;
  })();

  let activePopupId = null;

  function clearPopup() {
    overlayEl.querySelectorAll('.ta-popup').forEach((el) => el.remove());
    activePopupId = null;
  }

  function showSpotPopup(spot, px, py) {
    // 同じスポットを再クリックした場合は閉じる
    if (activePopupId === spot.id) { clearPopup(); return; }
    clearPopup();
    activePopupId = spot.id;

    const popup = document.createElement('div');
    popup.className = 'ta-popup';

    // 画面端・パネルに重ならないよう位置を調整
    const panelW = S.open ? 380 : 56;
    const maxLeft = window.innerWidth - panelW - 270;
    const left = Math.min(Math.max(10, px + 20), maxLeft);
    const top = Math.max(10, Math.min(py - 40, window.innerHeight - 240));
    popup.style.cssText = `left:${left}px;top:${top}px;`;

    // ヘッダー（タイトル + 閉じるボタン）
    const head = document.createElement('div');
    head.className = 'ta-popup-head';
    const h4 = document.createElement('h4');
    h4.textContent = spot.name;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ta-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = '閉じる';
    closeBtn.onclick = (e) => { e.stopPropagation(); clearPopup(); };
    head.append(h4, closeBtn);
    popup.appendChild(head);

    // カテゴリバッジ
    const color = CAT_COLOR[spot.category] || '#616161';
    const catBadge = document.createElement('span');
    catBadge.className = 'ta-cat-badge';
    catBadge.style.cssText = `background:${color}20;color:${color};border:1px solid ${color}40;`;
    catBadge.textContent = spot.category;
    popup.appendChild(catBadge);

    // 説明
    if (spot.description) {
      const p = document.createElement('p');
      p.className = 'ta-popup-desc';
      p.textContent = spot.description;
      popup.appendChild(p);
    }

    // おすすめポイント
    if (spot.recommendation) {
      const p = document.createElement('p');
      p.className = 'ta-popup-rec';
      p.textContent = '✨ ' + spot.recommendation;
      popup.appendChild(p);
    }

    // Google マップリンク
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.lat + ',' + spot.lng)}`;
    const link = document.createElement('a');
    link.className = 'ta-maps-link';
    link.href = mapsUrl;
    link.textContent = '🗺 Google マップで開く';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    popup.appendChild(link);

    // 登録者・日時
    const metaParts = [];
    if (spot.registeredBy) metaParts.push('👤 ' + spot.registeredBy);
    if (spot.registeredAt) metaParts.push(new Date(spot.registeredAt).toLocaleDateString('ja-JP'));
    if (metaParts.length) {
      const meta = document.createElement('div');
      meta.className = 'ta-popup-meta';
      meta.textContent = metaParts.join('　');
      popup.appendChild(meta);
    }

    overlayEl.appendChild(popup);
  }

  // マーカーを再描画（ポップアップは保持）
  function updateOverlay() {
    overlayEl.querySelectorAll('.ta-marker').forEach((el) => el.remove());
    const state = getMapState();
    if (!state || !S.localSpots.length) return;

    const mapW = window.innerWidth;
    const mapH = window.innerHeight;
    const margin = 60; // 画面外のマーカーは非表示

    for (const spot of S.localSpots) {
      const { x: px, y: py } = spotToScreen(spot, state);
      if (px < -margin || px > mapW + margin || py < -margin || py > mapH + margin) continue;

      const color = CAT_COLOR[spot.category] || '#616161';
      const marker = document.createElement('div');
      marker.className = 'ta-marker';
      marker.style.cssText = `left:${px}px;top:${py}px;`;
      marker.setAttribute('data-spot-id', spot.id);

      // ピン（涙滴型）
      const pin = document.createElement('div');
      pin.className = 'ta-pin';
      pin.style.background = color;

      // 中央の白丸
      const dot = document.createElement('div');
      dot.className = 'ta-pin-dot';
      pin.appendChild(dot);
      marker.appendChild(pin);

      // ホバー時のラベル
      const tooltip = document.createElement('div');
      tooltip.className = 'ta-tooltip';
      tooltip.textContent = spot.name;
      marker.appendChild(tooltip);

      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        showSpotPopup(spot, px, py);
      });

      overlayEl.appendChild(marker);
    }
  }

  // マップのパン・ズーム（URL変化）を検知してマーカーを更新
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      clearPopup();
      updateOverlay();
    }
  }, 500);
  window.addEventListener('resize', () => { clearPopup(); updateOverlay(); });

  // ========== 描画 ==========
  const TABS = [
    ['schedule', '日程', viewSchedule],
    ['route', 'ルート', viewRoute],
    ['register', '登録', viewRegister],
    ['spots', 'スポット', viewSpots]  // v1.3 追加
  ];
  function render() {
    if (!S.open) return;
    tabsEl.replaceChildren(...TABS.map(([k, label]) =>
      h('button', { class: 'tab' + (S.tab === k ? ' active' : ''), type: 'button', onclick: () => { S.tab = k; render(); } }, label)));
    const view = TABS.find(([k]) => k === S.tab)[2];
    body.replaceChildren(...view());
    navBar.hidden = !(S.nav && isDirPage());
    if (!navBar.hidden) {
      navBar.replaceChildren(h('span', {}, 'ルート案内を表示中'),
        btn('← 元の画面に戻る', goBack, 'small primary'),
        btn('閉じる', async () => { await clearNav(); render(); }, 'small'));
    }
    if (S.pendingScroll !== null) { body.scrollTop = S.pendingScroll; S.pendingScroll = null; }
  }

  async function boot() {
    await load();
    await loadSpots(); // v1.3: Firestore からスポットを読み込む
    const nav = S.nav;
    if (nav) {
      if (!nav.ts || Date.now() - nav.ts > 12 * 3600 * 1000) {
        await clearNav();
      } else {
        S.tab = ['schedule', 'route', 'register', 'spots'].includes(nav.tab) ? nav.tab : 'route';
        S.pendingScroll = nav.scroll || 0;
        if (nav.back || !isDirPage()) await clearNav();
        toggle(true);
        updateOverlay(); // v1.3: パネル復元後にマーカーを表示
        return;
      }
    }
    updateOverlay(); // v1.3: 起動時にマーカーを表示
    render();
  }
  boot().catch((e) => flash('設定の読み込みに失敗しました: ' + e.message, 'err'));
})();
