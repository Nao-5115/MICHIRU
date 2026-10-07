// Google マップ上に重ねて表示するサイドパネル（Shadow DOM で独立。マップの DOM には依存しない）
(() => {
  if (document.getElementById('tripassist-host')) return;
  const T = TripLib;
  const KEYS = ['title', 'candidates', 'responses', 'received', 'places', 'route', 'settings', 'inviteId'];
  const DEF = {
    title: '', candidates: [], responses: [], received: null, places: [], route: null, inviteId: null,
    settings: { speed: 40, startTime: '09:00', defaultStay: 60, stays: {}, startPlaceId: null, confirmedId: null, timed: true }
  };
  const S = { events: null, tab: 'schedule', open: false, shareCode: '', replyCode: '', regResults: null };
  const rid = () => Math.random().toString(36).slice(2, 10);

  // ---------- ストレージ ----------
  async function load() {
    const d = await chrome.storage.sync.get(KEYS);
    for (const k of KEYS) S[k] = d[k] !== undefined ? d[k] : structuredClone(DEF[k]);
    S.settings = { ...DEF.settings, ...S.settings };
  }
  async function save(k) {
    try { await chrome.storage.sync.set({ [k]: S[k] }); }
    catch (e) { flash('保存に失敗しました（容量上限の可能性があります）: ' + e.message, 'err'); }
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
  const panel = h('div', { class: 'panel', hidden: true },
    h('div', { class: 'head' }, h('strong', {}, '旅行アシスト'), btn('×', () => toggle(false), 'icon')),
    tabsEl, statusEl, body);
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
  function orderedPlaces() {
    if (!S.route) return null;
    const m = new Map(S.places.map((p) => [p.id, p]));
    const arr = S.route.map((id) => m.get(id)).filter(Boolean);
    return arr.length === S.places.length ? arr : null;
  }
  function currentItinerary() {
    const pl = orderedPlaces();
    if (!pl) return null;
    const st = S.settings;
    return T.buildItinerary(pl, { startMin: T.parseTime(st.startTime), speed: st.speed, defaultStay: st.defaultStay, stays: st.stays });
  }
  async function placesChanged() { S.route = null; await save('places'); await save('route'); render(); }

  function viewRoute() {
    const st = S.settings;
    const nameIn = h('input', { type: 'text', placeholder: '地点名（空欄なら自動取得）', maxlength: 60 });
    const num = (key, min, step) => h('input', { type: 'number', min, step, value: st[key],
      onchange: (e) => { const v = parseFloat(e.target.value); if (v > 0 || (key === 'defaultStay' && v >= 0)) { st[key] = v; save('settings'); } } });
    const sec1 = h('section', {},
      h('h3', {}, '訪問地点'),
      h('p', { class: 'muted' }, 'Google マップで場所を開いてから登録してください（URL の座標を使います）。'),
      nameIn,
      btn('現在のページの地点を登録', async () => {
        const ll = T.extractLatLng(location.href);
        if (!ll) return flash('このページのURLから緯度経度を取得できませんでした。場所を選択してから試してください。', 'err');
        if (S.places.length >= 20) return flash('登録できる地点は最大 20 件です', 'err');
        if (S.places.some((p) => Math.abs(p.lat - ll.lat) < 1e-5 && Math.abs(p.lng - ll.lng) < 1e-5)) return flash('同じ地点が既に登録されています', 'err');
        S.places.push({ id: rid(), name: nameIn.value.trim() || T.extractPlaceName(location.href, document.title), lat: ll.lat, lng: ll.lng });
        flash('地点を登録しました'); await placesChanged();
      }, 'primary'),
      S.places.length ? h('ul', { class: 'list' }, S.places.map((p) => h('li', {},
        h('div', { class: 'line' }, h('span', {}, p.name),
          btn('削除', async () => {
            S.places = S.places.filter((x) => x.id !== p.id); delete st.stays[p.id];
            if (st.startPlaceId === p.id) st.startPlaceId = null;
            await save('settings'); await placesChanged();
          }, 'small danger')),
        h('div', { class: 'muted' }, `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`),
        h('div', { class: 'row' },
          h('label', {}, '滞在(分)', h('input', { type: 'number', min: 0, step: 5, value: st.stays[p.id] ?? st.defaultStay,
            onchange: (e) => { const v = parseInt(e.target.value, 10); if (v >= 0) st.stays[p.id] = v; else delete st.stays[p.id]; save('settings'); } })),
          h('label', {}, h('input', { type: 'radio', name: 'startp', checked: (st.startPlaceId || S.places[0].id) === p.id,
            onchange: () => { st.startPlaceId = p.id; S.route = null; save('settings'); save('route'); render(); } }), '出発地点'))))) :
        h('p', { class: 'muted' }, '登録済みの地点はありません。'));
    const sec2 = h('section', {},
      h('h3', {}, 'しおりの設定'),
      h('div', { class: 'row' },
        h('label', {}, '出発時刻', h('input', { type: 'time', value: st.startTime, onchange: (e) => { st.startTime = e.target.value || '09:00'; save('settings'); render(); } })),
        h('label', {}, '想定速度(km/h)', num('speed', 1, 1)),
        h('label', {}, '標準滞在(分)', num('defaultStay', 0, 5))),
      h('p', { class: 'muted' }, '直線距離 ÷ 想定速度で概算します。実際の道路距離より短く出るため、速度は低めがおすすめです。'),
      btn('訪問順を最適化してしおりを作る', async () => {
        if (S.places.length < 2) return flash('地点を 2 件以上登録してください', 'err');
        const start = Math.max(0, S.places.findIndex((p) => p.id === st.startPlaceId));
        S.route = T.optimize(S.places, start).map((i) => S.places[i].id);
        await save('route'); flash('訪問順を最適化しました'); render();
      }, 'primary'));
    const it = currentItinerary();
    const sec3 = it ? h('section', {},
      h('h3', {}, '旅のしおり'),
      h('p', { class: 'muted' }, `総移動距離（直線）: ${it.totalKm.toFixed(1)} km`),
      h('ol', { class: 'timeline' }, it.rows.map((r, i) => h('li', {},
        i > 0 ? h('div', { class: 'leg' }, `${T.fmtTime(it.rows[i - 1].depart)}出発 → ${T.fmtTime(r.arrive)}到着（約${r.travel}分・${r.km.toFixed(1)}km）`) : null,
        h('div', { class: 'stop' }, h('b', {}, r.place.name), ` 滞在${r.stay}分 (${T.fmtTime(r.arrive)}〜${T.fmtTime(r.depart)})`))))) : null;
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
          description: it ? 'しおり（直線距離ベースの概算）\n' + T.itineraryText(it.rows) : '',
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
        for (const ev of events) {
          const res = await send({ type: 'createEvent', event: ev });
          S.regResults.push({ name: ev.summary, ok: res.ok, error: res.error });
          if (!res.ok && /認証|client_id|401|403/.test(res.error)) break; // 認証系の失敗は打ち切り
        }
        const ng = S.regResults.filter((r) => !r.ok).length;
        flash(ng ? `${ng} 件の登録に失敗しました` : `${S.regResults.length} 件の予定を登録しました`, ng ? 'err' : 'ok');
        render();
      }, 'primary'),
      S.regResults ? h('ul', { class: 'list' }, S.regResults.map((r) =>
        h('li', { class: r.ok ? 'okli' : 'warn' }, (r.ok ? '✔ ' : '✖ ') + r.name + (r.ok ? '' : ` — ${r.error}`)))) : null);
    return [sec];
  }

  // ---------- 描画 ----------
  const TABS = [['schedule', '日程', viewSchedule], ['route', 'ルート', viewRoute], ['register', '登録', viewRegister]];
  function render() {
    if (!S.open) return;
    tabsEl.replaceChildren(...TABS.map(([k, label]) =>
      h('button', { class: 'tab' + (S.tab === k ? ' active' : ''), type: 'button', onclick: () => { S.tab = k; render(); } }, label)));
    const view = TABS.find(([k]) => k === S.tab)[2];
    body.replaceChildren(...view());
  }

  load().then(() => render()).catch((e) => flash('設定の読み込みに失敗しました: ' + e.message, 'err'));
})();
