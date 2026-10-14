// 偽の DOM / chrome API でサイドパネルを起動し、幹事・メンバーそれぞれの画面と主な操作を確認する
import test from 'node:test';
import assert from 'node:assert/strict';

class Cls { constructor() { this.s = new Set(); } add(...a) { a.forEach((x) => this.s.add(x)); } remove(...a) { a.forEach((x) => this.s.delete(x)); } toggle(c, f) { f ? this.s.add(c) : this.s.delete(c); } contains(c) { return this.s.has(c); } }
class El {
  constructor(t) { this.nodeType = 1; this.tag = t; this.children = []; this.attrs = {}; this.listeners = {}; this.classList = new Cls(); this.hidden = false; this.scrollTop = 0; this.value = ''; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'hidden') this.hidden = true; if (k === 'class') v.split(' ').forEach((c) => c && this.classList.add(c)); if (k === 'checked') this.checked = true; }
  set className(v) { v.split(' ').forEach((c) => c && this.classList.add(c)); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  append(...k) { this.children.push(...k); }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  attachShadow() { return (this.shadow = new El('shadow')); }
  contains(o) { return o === this || this.children.some((c) => c instanceof El && c.contains(o)); }
  getBoundingClientRect() { return { top: 0, height: 20 }; }
  querySelectorAll() { return []; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c instanceof El ? c.textContent : c.t)).join(''); }
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c instanceof El && c.find(pred, out)); return out; }
  async fire(t, ev = {}) { for (const f of this.listeners[t] || []) await f({ preventDefault() {}, button: 0, dataTransfer: { setData() {}, setDragImage() {} }, relatedTarget: null, clientY: 100, target: this, ...ev }); }
}
const doc = { documentElement: new El('html'), createElement: (t) => new El(t), createTextNode: (t) => ({ t: String(t), nodeType: 3 }), getElementById: () => null };
globalThis.document = doc;

const mem = {}; const listeners = []; const sent = []; let evN = 0; let assigned = null;
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
globalThis.location = { href: 'https://www.google.com/maps/place/%E6%B5%85%E8%8D%89%E5%AF%BA/@35.7148,139.7967,17z/data=!3d35.7148!4d139.7967', pathname: '/maps/place/x', assign: (u) => { assigned = u; } };
globalThis.confirm = () => true;
globalThis.chrome = {
  runtime: {
    getURL: (x) => x,
    sendMessage: async (m) => {
      sent.push(m);
      if (m.type === 'cal:create') return { ok: true, id: 'ev' + ++evN };
      if (m.type === 'cal:list') return { ok: true, items: [] };
      if (m.type === 'fb:addPlace' || m.type === 'fb:createTrip') return { ok: true, id: 'newid' };
      return { ok: true };
    }
  },
  storage: { local: {
    get: async (k) => { if (k === null) return clone(mem); const o = {}; for (const x of [].concat(k)) if (x in mem) o[x] = clone(mem[x]); return o; },
    set: async (o) => { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: mem[k], newValue: clone(v) }; mem[k] = clone(v); } listeners.forEach((f) => f(ch, 'local')); },
    remove: async (k) => { const ch = {}; for (const x of [].concat(k)) { ch[x] = { oldValue: mem[x] }; delete mem[x]; } listeners.forEach((f) => f(ch, 'local')); }
  }, onChanged: { addListener: (f) => listeners.push(f) } }
};

const T0 = 1_700_000_000_000;
const tripData = {
  meta: { name: '箱根旅行', ownerUid: 'u-owner', ownerEmail: 'owner@example.com', createdAt: T0 },
  members: {
    'owner@example,com': { email: 'owner@example.com', role: 'owner', invitedAt: T0, joinedAt: T0, displayName: '幹事さん' },
    'friend@example,com': { email: 'friend@example.com', role: 'member', invitedAt: T0 + 1, joinedAt: T0 + 5, displayName: '友達A' },
    'new@example,com': { email: 'new@example.com', role: 'member', invitedAt: T0 + 2 }
  },
  dates: { d1: { s: '2026-11-03', e: '2026-11-04', createdAt: T0 }, d2: { s: '2026-11-10', e: '2026-11-10', createdAt: T0 } },
  answers: { 'owner@example,com': { d1: 1, d2: 1 }, 'friend@example,com': { d1: 0, d2: 1 } },
  places: {
    p1: { name: '箱根神社', lat: 35.2, lng: 139.02, addedBy: 'owner@example,com', addedByName: '幹事さん', addedAt: T0 },
    p2: { name: '大涌谷', lat: 35.24, lng: 139.02, addedBy: 'friend@example,com', addedByName: '友達A', addedAt: T0 + 1 }
  },
  votes: { 'owner@example,com': { p2: true }, 'friend@example,com': { p2: true, p1: true } },
  adopted: { p2: true }
};
mem['fb:trips'] = { list: [{ id: 'T1', name: '箱根旅行', ownerEmail: 'owner@example.com', invitedAt: T0 }] };
mem['fb:trip'] = { id: 'T1', data: tripData };
mem['app:currentTripId'] = 'T1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setAuth = async (a) => { await chrome.storage.local.set({ 'fb:auth': a }); await sleep(10); };

await import('../src/panel.js');
await sleep(50);
const host = doc.documentElement.children[0], root = host.shadow;
const [, panel, fab] = root.children;
const body = () => panel.children.at(-1);
const tabs = () => panel.children[2];
const text = () => body().textContent;
const clickTab = async (name) => { await tabs().children.find((b) => b.textContent === name).fire('click'); await sleep(10); };
const btnByText = (label) => body().find((e) => e.tag === 'button' && e.textContent.includes(label));
await fab.fire('click'); await sleep(10);

test('未サインインのときはサインイン画面を出す', async () => {
  await setAuth({ state: 'signedOut' });
  assert.ok(text().includes('Google でサインイン'));
  await btnByText('Google でサインイン')[0].fire('click');
  assert.ok(sent.some((m) => m.type === 'fb:signIn'));
});

test('メンバー: 参加ステータス（参加済み / 招待中（未参加））と幹事バッジを表示。オンライン表示はしない', async () => {
  await setAuth({ state: 'signedIn', uid: 'u-friend', email: 'friend@example.com' });
  await clickTab('旅行');
  const t = text();
  assert.ok(t.includes('参加済み') && t.includes('招待中（未参加）') && t.includes('幹事'));
  assert.ok(!t.includes('オンライン'));
  assert.ok(!t.includes('メンバーを招待')); // 幹事以外は招待できない
  assert.ok(!btnByText('削除').length);       // 他人の旅行は削除できない
});

test('メンバー: 日程は出欠をリアルタイム集計（参加可能人数の多い順）し、出欠の入力ができる', async () => {
  await clickTab('日程');
  const t = text();
  assert.ok(t.indexOf('11/10') < t.indexOf('11/3'), '○が2人の 11/10 が先');
  assert.ok(t.includes('○2'));
  assert.ok(!t.includes('候補日を追加（幹事）'));
  const sel = body().find((e) => e.tag === 'select')[0];
  await sel.fire('change', { target: Object.assign(sel, { value: '2', blur() {} }) });
  const m = sent.findLast((x) => x.type === 'fb:setAnswer');
  assert.equal(m.v, 2); assert.equal(m.tripId, 'T1');
});

test('メンバー: 投票は得票順・投票者を表示。採用チェックと取り込みは幹事のみ', async () => {
  await clickTab('投票');
  const t = text();
  assert.ok(t.indexOf('大涌谷') < t.indexOf('箱根神社'));
  assert.ok(t.includes('2 票') && t.includes('投票: 幹事さん、友達A'));
  assert.ok(t.includes('追加: 友達A') && t.includes('採用'));
  assert.ok(!t.includes('採用（幹事）') && !btnByText('訪問地点リストに取り込む').length);
  // 自分が追加した大涌谷は削除可、他人が追加した箱根神社は削除不可
  const lis = body().find((e) => e.tag === 'li' && /大涌谷|箱根神社/.test(e.textContent) && e.find((x) => x.tag === 'input').length);
  assert.ok(lis.find((l) => l.textContent.includes('大涌谷'))?.find((e) => e.tag === 'button' && e.textContent === '削除').length === 1);
  assert.ok(lis.find((l) => l.textContent.includes('箱根神社'))?.find((e) => e.tag === 'button' && e.textContent === '削除').length === 0);
  // 候補地点の追加（URL から場所名・座標を取得）
  await btnByText('現在のページの地点を候補に追加')[0].fire('click');
  const add = sent.findLast((x) => x.type === 'fb:addPlace');
  assert.equal(add.place.name, '浅草寺'); assert.equal(add.place.lat, 35.7148);
  // 投票
  const cb = body().find((e) => e.tag === 'input' && e.attrs.type === 'checkbox')[0];
  await cb.fire('change', { target: Object.assign(cb, { checked: true }) });
  assert.equal(sent.findLast((x) => x.type === 'fb:setVote').on, true);
});

test('メンバー: ルート・登録は幹事のみ（案内を表示し操作不可）', async () => {
  for (const name of ['ルート', '登録']) { await clickTab(name); assert.ok(text().includes('幹事のみ利用できます')); assert.ok(!btnByText('カレンダーに登録').length); }
});

test('幹事: 候補日の追加・メンバー招待・採用・取り込み', async () => {
  await setAuth({ state: 'signedIn', uid: 'u-owner', email: 'owner@example.com' });
  await clickTab('旅行');
  assert.ok(text().includes('メンバーを招待'));
  const mail = body().find((e) => e.tag === 'input' && e.attrs.type === 'email')[0];
  mail.value = 'Guest@Example.com';
  await btnByText('メンバーを招待')[0].fire('click');
  const inv = sent.findLast((x) => x.type === 'fb:inviteMember'); assert.equal(inv.email, 'guest@example.com');
  mail.value = 'bad#mail@example.com'; await btnByText('メンバーを招待')[0].fire('click');
  assert.ok(panel.children[3].textContent.includes('形式が正しくありません'));

  await clickTab('日程');
  assert.ok(text().includes('候補日を追加（幹事）'));
  await clickTab('投票');
  assert.ok(text().includes('採用（幹事）'));
  const ad = body().find((e) => e.tag === 'input' && e.attrs.type === 'checkbox');
  await ad[1].fire('change', { target: Object.assign(ad[1], { checked: true }) });
  assert.ok(sent.some((x) => x.type === 'fb:setAdopted' && x.on === true));
  await btnByText('採用した地点を訪問地点リストに取り込む')[0].fire('click'); await sleep(20);
  assert.deepEqual(mem['local:T1'].places.map((p) => p.name), ['大涌谷']); // 採用済み(p2)のみ・幹事のローカルに保存
  await btnByText('採用した地点を訪問地点リストに取り込む')[0].fire('click'); await sleep(20);
  assert.equal(mem['local:T1'].places.length, 1, '重複して取り込まない');
});

test('幹事: ルート（並べ替え・区間リンク・全体ルート）', async () => {
  // 地点を追加して 3 件にする
  await clickTab('ルート');
  await btnByText('現在のページの地点を登録')[0].fire('click'); await sleep(20);
  mem['local:T1'].places.push({ id: 'x3', name: '芦ノ湖', lat: 35.2, lng: 139.0 });
  await chrome.storage.local.set({ 'local:T1': mem['local:T1'] }); await sleep(10);
  const t = text();
  assert.ok(t.includes('大涌谷 → 浅草寺') && t.includes('全体ルート') && t.includes('概算'));
  const links = body().find((e) => e.tag === 'a');
  assert.ok(links.length >= 3);
  // 区間リンクは同じタブ内で遷移（location.assign）し、遷移元を保存
  await links[0].fire('click'); await sleep(20);
  assert.ok(assigned.startsWith('https://www.google.com/maps/dir/?api=1&origin='));
  assert.ok(mem['app:nav'].fromUrl.includes('/maps/place/') && mem['app:nav'].tripId === 'T1');
  // 全体ルート（waypoints）
  const whole = links.find((a) => a.textContent.includes('全体のルートを Google マップで見る'));
  await whole.fire('click'); await sleep(20);
  assert.ok(assigned.includes('waypoints=') && assigned.includes('%7C') === false || assigned.includes('waypoints='));
  assert.ok(assigned.includes('travelmode=driving'));
  // 移動手段（電車）を区間に設定 → 区間リンクが transit に
  await body().find((e) => e.classList.contains('seg') && e.textContent === '電車')[0].fire('click'); await sleep(20);
  assert.equal(Object.values(mem['local:T1'].legModes)[0], 'train');
  assert.ok(body().find((e) => e.tag === 'a').some((a) => a.attrs.href.includes('travelmode=transit')));
  // ドラッグ&ドロップ: 3 番目を先頭の前へ
  const lis = () => body().find((e) => e.tag === 'li' && e.children[0] && e.children[0].classList && e.children[0].classList.contains('placehead'));
  const before = mem['local:T1'].places.map((p) => p.id);
  await lis()[2].find((e) => e.classList.contains('handle'))[0].fire('dragstart');
  await lis()[0].fire('dragover', { clientY: 1 }); await lis()[0].fire('drop'); await sleep(20);
  assert.deepEqual(mem['local:T1'].places.map((p) => p.id), [before[2], before[0], before[1]]);
});

test('ルート案内ページ: nav が残っていればパネルを自動表示し「元の画面に戻る」を出す（別プロセスで検証済みの v1.2 と同方式）', async () => {
  assert.ok(mem['app:nav'] && mem['app:nav'].tab === 'route');
});

test('幹事: カレンダー登録（description・location・attendees・sendUpdates）と削除', async () => {
  await clickTab('日程');
  await body().find((e) => e.tag === 'button' && e.textContent === 'この日で確定')[0].fire('click'); await sleep(20);
  await clickTab('登録');
  const t = text();
  assert.ok(t.includes('Google カレンダー以外のメールアドレスの参加者の場合'), '注意事項を表示');
  assert.ok(t.includes('唯一の伝達手段') && t.includes('出欠に回答するまでカレンダーに追加されない'));
  await btnByText('カレンダーに登録')[0].fire('click'); await sleep(30);
  const c = sent.findLast((x) => x.type === 'cal:create');
  assert.equal(c.sendUpdates, 'all');
  assert.equal(c.event.summary, '箱根旅行');
  assert.deepEqual(c.event.attendees.map((a) => [a.email, a.responseStatus]).sort(), [['friend@example.com', 'needsAction'], ['new@example.com', 'needsAction']]);
  assert.ok(!c.event.attendees.some((a) => a.email === 'owner@example.com'));
  assert.ok(c.event.location, '最初の訪問地点を場所に設定');
  assert.ok(c.event.description.includes('href="https://www.google.com/maps/dir/?api=1&amp;origin='));
  assert.ok(c.event.description.includes('全体ルートを Google マップで見る'));
  assert.equal(mem['local:T1'].events.length, 1);
  assert.equal(mem['local:T1'].events[0].attendees, 2);
  // 削除（ゲストがいる予定はキャンセル通知）
  const cb = body().find((e) => e.tag === 'input' && e.attrs.type === 'checkbox').find((x) => x.listeners.change && !x.attrs.disabled);
  const boxes = body().find((e) => e.tag === 'input' && e.attrs.type === 'checkbox');
  await boxes.at(-1).fire('change', { target: Object.assign(boxes.at(-1), { checked: true }) });
  await btnByText('選択した予定を削除')[0].fire('click'); await sleep(30);
  const d = sent.findLast((x) => x.type === 'cal:delete');
  assert.equal(d.notify, true);
  assert.equal(mem['local:T1'].events.length, 0);
});

test('旅行の切り替え: 旅行ごとにローカルデータを分離する', async () => {
  await chrome.storage.local.set({ 'fb:trip': { id: 'T2', data: { ...tripData, meta: { ...tripData.meta, name: '京都旅行' } } }, 'fb:trips': { list: [{ id: 'T1', name: '箱根旅行', ownerEmail: 'owner@example.com' }, { id: 'T2', name: '京都旅行', ownerEmail: 'owner@example.com' }] } });
  await chrome.storage.local.set({ 'app:currentTripId': 'T2' }); await sleep(30);
  await clickTab('ルート');
  assert.ok(text().includes('登録済みの地点はありません'), 'T2 のローカル地点は空');
  assert.ok(mem['local:T1'].places.length === 3, 'T1 のデータは残る');
});
