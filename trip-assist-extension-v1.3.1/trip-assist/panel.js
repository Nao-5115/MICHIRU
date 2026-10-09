// Google マップ上に重ねて表示するサイドパネル（Shadow DOM で独立。マップの DOM には依存しない）
(() => {
  if (document.getElementById('tripassist-host')) return;
  const T = TripLib;
  const KEYS = ['title', 'candidates', 'responses', 'received', 'places', 'settings', 'inviteId', 'legModes', 'nav', 'tripId'];
const DEF = {
  title: '', candidates: [], responses: [], received: null, places: [], inviteId: null, legModes: {}, nav: null, tripId: null,
  settings: { speedCar: 40, speedTrain: 35, detourCar: 1.3, detourTrain: 1.3, startTime: '09:00', defaultStay: 60, stays: {}, confirmedId: null, timed: true }
  };
  const S = { events: null, tab: 'schedule', open: false, shareCode: '', replyCode: '', regResults: null, myEvents: [], selDel: new Set(), delResults: null, dragId: null, pendingScroll: null, trip: null, uid: null, tripTried: false };
  const rid = () => Math.random().toString(36).slice(2, 10);

  // ---------- ストレージ ----------
  async function load() {
    const all = await chrome.storage.sync.get(null);
    for (const k of KEYS) S[k] = all[k] !== undefined ? all[k] : structuredClone(DEF[k]);
    const oldSpeed = S.settings.speed; // v1.0 の設定からの移行
    S.settings = { ...DEF.settings, ...S.settings };
    if (oldSpeed > 0 && all.settings && all.settings.speedCar === undefined) S.settings.speedCar = oldSpeed;
    delete S.settings.speed; delete S.settings.startPlaceId;
    S.myEvents = Object.entries(all).filter(([k]) => k.startsWith('ev:')).map(([, v]) => v);
    for (const k of Object.keys(S.legModes)) if (S.legModes[k] !== 'train') delete S.legModes[k]; // 保存は「電車」の区間のみ
    // v1.1 以前は最適化後の順序を route に保存していた → places の並び（＝訪問順）に統合
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
  async function clearNav() {
    S.nav = null;
    try { await chrome.storage.sync.remove('nav'); } catch (_) {}
  }
  const isDirPage = () => location.pathname.startsWith('/maps/dir');
  // 元の画面（ルート案内へ遷移する直前の URL）へ戻る。タブ・スクロール位置は復帰後に復元される
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

    // 集計
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

    // 友達として回答
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
  // 訪問順 = S.places の並び。しおり・ルートリンクは常にこの並びから再計算される
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
  // 区間の移動手段は「2 地点の組み合わせ」に紐づけて保持（電車のみ保存、未設定は車）。
  // 存在しない地点を含む組み合わせは破棄し、肥大化したら現在隣り合う区間以外も整理する
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
    if (arr.every((x, i) => x.id === S.places[i].id)) return; // 変化なし
    S.places = arr;
    await placesChanged();
    flash('並べ替えました。しおりの時刻とルートリンクを更新しました。');
  }

  // ルート案内リンク: 現在のタブ内で遷移（遷移前の URL と画面状態を保存してから）
  async function openRoute(e, url) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // 修飾キー付きはブラウザ標準の動作
    e.preventDefault();
    const fromUrl = S.nav && isDirPage() ? S.nav.fromUrl : location.href;
    S.nav = { fromUrl, tab: S.tab, scroll: body.scrollTop, ts: Date.now() };
    if (!(await save('nav'))) flash('画面状態を保存できませんでした。ルート案内の後に「元の画面に戻る」が使えない場合があります。', 'err');
    location.assign(url);
  }

  // 区間（隣り合う 2 地点）: 移動手段の切替 + Google マップのルート案内リンク
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
        li.classList.toggle('drop-before', !after); li.classList.toggle('drop-after', after); // 挿入位置の表示
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
        S.places = T.optimize(S.places, 0).map((i) => S.places[i]); // 先頭の地点を出発地点として固定
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
        const saved = {}; // 削除用の記録（eventId・タイトル・日時）
        for (const ev of events) {
          const res = await send({ type: 'createEvent', event: ev });
          S.regResults.push({ name: ev.summary, ok: res.ok, error: res.error });
          if (res.ok && res.id) {
            saved['ev:' + res.id] = ev.start.date
              ? { id: res.id, title: ev.summary, start: ev.start.date, end: ev.end.date, allDay: true }
              : { id: res.id, title: ev.summary, start: ev.start.dateTime.slice(0, 16), end: ev.end.dateTime.slice(0, 16), allDay: false };
          }
          if (!res.ok && /認証|client_id|401|403/.test(res.error)) break; // 認証系の失敗は打ち切り
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

  // この拡張機能から登録した予定の一覧と削除
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
            if (res.ok || gone) { // 成功、またはカレンダー側で削除済み → 記録を整理
              try { await chrome.storage.sync.remove('ev:' + r.id); } catch (_) {}
              S.myEvents = S.myEvents.filter((x) => x.id !== r.id); S.selDel.delete(r.id);
              S.delResults.push({ ok: true, text: res.ok ? `${r.title}: 削除しました` : `${r.title}: カレンダー上に既に存在しない（手動で削除済み）ため、記録のみ整理しました` });
            } else {
              S.delResults.push({ ok: false, text: `${r.title}: 削除に失敗しました — ${res.error}（記録は残してあります。再度お試しください）` });
              if (/認証|client_id/.test(res.error)) break; // 認証系の失敗は打ち切り
            }
          }
          const ng = S.delResults.filter((x) => !x.ok).length;
          flash(ng ? `${ng} 件の削除に失敗しました` : `${S.delResults.length} 件の予定を処理しました`, ng ? 'err' : 'ok');
          render();
        }, 'danger')) : null,
      S.delResults ? h('ul', { class: 'list' }, S.delResults.map((x) => h('li', { class: x.ok ? 'okli' : 'warn' }, (x.ok ? '✔ ' : '✖ ') + x.text))) : null);
  }

    // ---------- 共有タブ（Firebase） ----------
  const TRIP_ID_RE = /^[A-Za-z0-9_-]{20}$/;
  async function loadTrip() {
    if (!S.tripId) return;
    const r = await send({ type: 'tripGet', id: S.tripId });
    if (!r.ok) return flash(r.error, 'err');
    if (!r.trip) return flash('旅が見つかりません。招待コードを確認してください', 'err');
    S.trip = r.trip; S.uid = r.uid; render();
  }
  async function enterTrip(id) {
    S.tripId = id; S.trip = null; S.tripTried = true;
    await save('tripId'); await loadTrip(); render();
  }
  async function leaveTrip() {
    if (!confirm('この端末の共有しおりから抜けます（データベース上のメンバー登録は残ります）。よろしいですか？')) return;
    S.tripId = null; S.trip = null; S.uid = null; S.tripTried = false;
    await save('tripId'); render();
  }

  function viewShared() {
    // 未参加：作成 or 参加
    if (!S.tripId) {
      const nameIn = h('input', { type: 'text', placeholder: 'あなたの名前', maxlength: 40 });
      const idIn = h('input', { type: 'text', placeholder: '招待コード（20文字）', maxlength: 20 });
      return [h('section', {},
        h('h3', {}, '共有しおり'),
        h('p', { class: 'muted' }, '旅を作ると招待コードが発行されます。友達はそのコードで参加すると、同じしおりを一緒に使えます。'),
        nameIn,
        btn('旅を新しく作る', async () => {
          const name = nameIn.value.trim();
          if (!name) return flash('名前を入力してください', 'err');
          const r = await send({ type: 'tripCreate', title: S.title || '旅行', name });
          if (!r.ok) return flash(r.error, 'err');
          flash('旅を作成しました。招待コードを友達に送ってください。');
          enterTrip(r.id);
        }, 'primary'),
        idIn,
        btn('招待コードで参加', async () => {
          const name = nameIn.value.trim(), id = idIn.value.trim();
          if (!name) return flash('名前を入力してください', 'err');
          if (!TRIP_ID_RE.test(id)) return flash('招待コードの形式が正しくありません', 'err');
          const r = await send({ type: 'tripJoin', id, name });
          if (!r.ok) return flash(r.error, 'err');
          flash('旅に参加しました');
          enterTrip(id);
        }))];
    }

    // 参加済み：初回表示時に読み込む（毎回の自動ログインを避けるため、タブを開いた時だけ）
    if (!S.trip && !S.tripTried) { S.tripTried = true; loadTrip(); }
    const t = S.trip || {};
    const memo = h('input', { type: 'text', placeholder: 'ひとこと（動作確認用）', maxlength: 100 });
    return [h('section', {},
      h('h3', {}, t.title || '共有しおり'),
      h('p', { class: 'muted' }, '招待コード（友達に送ってね）:'),
      codeBox(S.tripId),
      h('p', { class: 'muted' }, 'メンバー: ' + (Object.values(t.members || {}).join('、') || '（読み込み中…）')),
      memo,
      btn('送信', async () => {
        const v = memo.value.trim();
        if (!v) return flash('ひとことを入力してください', 'err');
        const r = await send({ type: 'tripSet', id: S.tripId, key: 'notes', value: v });
        r.ok ? loadTrip() : flash(r.error, 'err');
      }, 'primary'),
      btn('最新に更新', loadTrip),
      h('ul', { class: 'list' }, Object.entries(t.notes || {}).map(([uid, text]) =>
        h('li', {}, h('b', {}, (t.members || {})[uid] || '?'), '：' + text))),
      btn('この旅から抜ける', leaveTrip, 'small danger'))];
  }

  // ---------- 描画 ----------
  const TABS = [['schedule', '日程', viewSchedule], ['route', 'ルート', viewRoute], ['register', '登録', viewRegister], ['shared', '共有', viewShared]];
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

  // 起動時: ルート案内への遷移後（または元の画面への復帰後）はパネルを自動で再表示して状態を復元
  async function boot() {
    await load();
    const nav = S.nav;
    if (nav) {
      if (!nav.ts || Date.now() - nav.ts > 12 * 3600 * 1000) {
        await clearNav(); // 古い遷移記録は破棄
      } else {
        S.tab = ['schedule', 'route', 'register', 'shared'].includes(nav.tab) ? nav.tab : 'route';
        S.pendingScroll = nav.scroll || 0;
        if (nav.back || !isDirPage()) await clearNav(); // 元の画面に戻った → 復元して終了
        toggle(true);
        return;
      }
    }
    render();
  }
  boot().catch((e) => flash('設定の読み込みに失敗しました: ' + e.message, 'err'));
})();
