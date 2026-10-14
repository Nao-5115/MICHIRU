// 各機能のロジック（DOM・chrome API 非依存）

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_DATES = 60;
export const MAX_CANDIDATE_PLACES = 50; // Firebase 上の候補地点
export const MAX_LOCAL_PLACES = 20;     // 訪問地点リスト（幹事のローカル）
export const UNNAMED_PLACE = '名称未設定の地点';
export const MODE_LABEL = { car: '車', train: '電車' };
export const DEFAULT_SPEED = { car: 40, train: 35 };
export const DEFAULT_DETOUR = 1.3;
export const ESTIMATE_NOTE = '※移動時間は「直線距離 × 迂回係数 ÷ 想定速度」による概算です。実際の経路・交通状況・乗換や待ち時間は考慮していません。';
export const LIMIT_WARNING = '経由地の表示上限に達しました';

// ---------- メンバー / メールアドレス ----------
export const normalizeEmail = (s) => String(s || '').trim().toLowerCase();
// Realtime Database のキーに使えない文字（. # $ [ ] /）を含むアドレスは扱わない
export const isValidEmail = (s) => {
  const e = normalizeEmail(s);
  return e.length <= 254 && /^[^\s@#$\[\]\/]+@[^\s@#$\[\]\/]+\.[^\s@#$\[\]\/]+$/.test(e);
};
// '.' は ',' に置き換える（セキュリティルール側も同じ変換: toLowerCase().replace('.', ',')）
export const emailKey = (s) => normalizeEmail(s).replace(/\./g, ',');
export const memberLabel = (m) => m.displayName || m.email;
export const shortName = (email, displayName) => displayName || String(email || '').split('@')[0];

// ---------- 日付 ----------
export function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function fmtDate(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
}
export const fmtRange = (c) => (c.s === c.e ? fmtDate(c.s) : `${fmtDate(c.s)}〜${fmtDate(c.e)}`);
export const isDate = (s) => DATE_RE.test(s);

// 候補日と既存予定の重なり判定
export function conflicts(cand, events) {
  const cs = new Date(cand.s + 'T00:00:00');
  const ce = new Date(addDays(cand.e, 1) + 'T00:00:00');
  return events.filter((ev) => {
    if (ev.transparency === 'transparent') return false;
    const s = new Date(ev.start.dateTime || ev.start.date + 'T00:00:00');
    const e = new Date(ev.end.dateTime || ev.end.date + 'T00:00:00');
    return s < ce && e > cs;
  });
}

// 登録済み予定（{start, end, allDay}）の表示用文字列。終日予定の end は排他的終了日
export function fmtEventWhen(r) {
  if (r.allDay) {
    const e = addDays(r.end, -1);
    return r.start === e ? fmtDate(r.start) : `${fmtDate(r.start)}〜${fmtDate(e)}`;
  }
  const sd = r.start.slice(0, 10), ed = r.end.slice(0, 10);
  return `${fmtDate(sd)} ${r.start.slice(11, 16)}〜${ed === sd ? '' : fmtDate(ed) + ' '}${r.end.slice(11, 16)}`;
}

// ---------- Firebase のスナップショット → 配列 ----------
export const entriesOf = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));
export const membersOf = (data) =>
  Object.entries((data && data.members) || {})
    .map(([key, m]) => ({ key, ...m }))
    .sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || (a.invitedAt || 0) - (b.invitedAt || 0));
export const datesOf = (data) => entriesOf(data && data.dates).sort((a, b) => a.s.localeCompare(b.s));
export const placesOf = (data) => entriesOf(data && data.places);

// ---------- 集計 ----------
// 出欠: 1=○, 2=△, 0=×。参加可能人数（○）が多い順、同数なら△が多い順、さらに日付順
export function rankDates(dates, members, answers) {
  return dates
    .map((d) => {
      const r = { date: d, yes: [], maybe: [], no: [], none: [] };
      for (const m of members) {
        const a = answers && answers[m.key] ? answers[m.key][d.id] : undefined;
        (a === 1 ? r.yes : a === 2 ? r.maybe : a === 0 ? r.no : r.none).push(memberLabel(m));
      }
      return r;
    })
    .sort((a, b) => b.yes.length - a.yes.length || b.maybe.length - a.maybe.length || a.date.s.localeCompare(b.date.s));
}
// 候補地点: 得票数の多い順（同数なら追加が早い順）。誰が投票したかも返す
export function rankPlaces(places, members, votes) {
  return places
    .map((p) => ({
      place: p,
      voters: members.filter((m) => votes && votes[m.key] && votes[m.key][p.id] === true).map(memberLabel)
    }))
    .sort((a, b) => b.voters.length - a.voters.length || (a.place.addedAt || 0) - (b.place.addedAt || 0));
}

// ---------- 緯度経度・場所名（URL のみから抽出） ----------
const okLL = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export function extractLatLng(href) {
  let url = href;
  try { url = decodeURIComponent(href); } catch (_) {}
  let m, last = null;
  const re = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g; // 場所そのものの座標（優先）
  while ((m = re.exec(url))) last = m;
  if (last && okLL(+last[1], +last[2])) return { lat: +last[1], lng: +last[2] };
  m = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/); // 地図の中心座標
  if (m && okLL(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  m = url.match(/[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m && okLL(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  return null;
}
// /maps/place/<場所名>/@lat,lng,zoom... の <場所名> を取り出す。無ければ null
export function extractPlaceName(href) {
  const m = href.match(/\/maps\/place\/([^/@?#]+)/);
  if (!m) return null;
  let name = m[1].replace(/\+/g, ' '); // + は空白に戻してからデコード（%2B はそのまま + になる）
  try { name = decodeURIComponent(name); } catch (_) {}
  name = name.trim().slice(0, 60);
  if (!name || /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(name)) return null; // 座標だけの名前は場所名とみなさない
  return name;
}
export const samePoint = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

// ---------- 距離・訪問順 ----------
export function haversine(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const BRUTE_FORCE_MAX = 9; // これ以下は総当たり（最大 8! 通り）。超えたら最近傍法 + 2-opt
function pathLen(order, D) {
  let s = 0;
  for (let i = 1; i < order.length; i++) s += D[order[i - 1]][order[i]];
  return s;
}
// 出発地点 start を固定した開路の最短順（インデックス配列）を返す
export function optimize(pts, start = 0) {
  const n = pts.length;
  const D = pts.map((a) => pts.map((b) => haversine(a, b)));
  const rest = [...Array(n).keys()].filter((i) => i !== start);
  if (n <= 2) return [start, ...rest];
  if (n <= BRUTE_FORCE_MAX) {
    let best = null, bestLen = Infinity;
    const dfs = (path, used, len) => {
      if (len >= bestLen) return;
      if (path.length === n) { best = path.slice(); bestLen = len; return; }
      for (const i of rest) {
        if (used.has(i)) continue;
        used.add(i); path.push(i);
        dfs(path, used, len + D[path[path.length - 2]][i]);
        path.pop(); used.delete(i);
      }
    };
    dfs([start], new Set([start]), 0);
    return best;
  }
  let order = [start];
  const left = new Set(rest);
  while (left.size) {
    const cur = order[order.length - 1];
    let bi = -1, bd = Infinity;
    for (const i of left) if (D[cur][i] < bd) { bd = D[cur][i]; bi = i; }
    order.push(bi); left.delete(bi);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        if (pathLen(cand, D) < pathLen(order, D) - 1e-9) { order = cand; improved = true; }
      }
    }
  }
  return order;
}

// ---------- しおり ----------
export function parseTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Math.min(+m[1], 23) * 60 + Math.min(+m[2], 59) : 9 * 60;
}
export function fmtTime(min) {
  const day = Math.floor(min / 1440), m = min % 1440;
  const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return day > 0 ? `${t}(+${day}日)` : t;
}
// places: 訪問順の地点配列 / speeds, detours: {car, train} / modeOf(前の地点, 次の地点) → 'car' | 'train'
export function buildItinerary(places, { startMin, speeds, detours, defaultStay, stays, modeOf }) {
  const rows = [];
  let totalKm = 0, totalRoadKm = 0;
  places.forEach((p, i) => {
    let arrive = startMin, km = 0, roadKm = 0, travel = 0, mode = null, detour = 1;
    if (i > 0) {
      mode = modeOf ? modeOf(places[i - 1], p) : 'car';
      if (!MODE_LABEL[mode]) mode = 'car';
      const v = speeds && speeds[mode] > 0 ? speeds[mode] : DEFAULT_SPEED[mode];
      detour = detours && detours[mode] >= 1 ? detours[mode] : DEFAULT_DETOUR;
      km = haversine(places[i - 1], p);
      roadKm = km * detour;
      travel = Math.max(1, Math.round((roadKm / v) * 60));
      arrive = rows[i - 1].depart + travel;
      totalKm += km;
      totalRoadKm += roadKm;
    }
    const stay = Number.isFinite(stays[p.id]) ? stays[p.id] : defaultStay;
    rows.push({ place: p, arrive, stay, depart: arrive + stay, km, roadKm, travel, mode, detour });
  });
  return { rows, totalKm, totalRoadKm };
}

// ---------- Google Maps URLs（API キー不要） ----------
const ll = (p) => `${p.lat},${p.lng}`;
const travelmode = (mode) => (mode === 'train' ? 'transit' : 'driving');

// 区間（2 地点）。waypoints は使わない
export function mapsDirUrl(from, to, mode) {
  const p = new URLSearchParams(); // カンマは %2C にエンコードされる
  p.set('api', '1');
  p.set('origin', ll(from));
  p.set('destination', ll(to));
  p.set('travelmode', travelmode(mode));
  return 'https://www.google.com/maps/dir/?' + p.toString();
}

export const isMobile = () =>
  typeof navigator !== 'undefined' &&
  (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean'
    ? navigator.userAgentData.mobile
    : /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''));

// 全体ルート（先頭=出発地、末尾=目的地、間を waypoints に `|` 区切りで列挙）。
// 経由地の上限（モバイル 3 件 / それ以外 9 件）と URL 2,048 文字を超える場合は、上限までの地点で案内する
export function mapsDirAllUrl(places, mode, mobile = false) {
  if (!places || places.length < 2) return null;
  const maxWaypoints = mobile ? 3 : 9;
  const build = (n) => {
    const p = new URLSearchParams(); // `|` は %7C、`,` は %2C にエンコードされる
    p.set('api', '1');
    p.set('origin', ll(places[0]));
    p.set('destination', ll(places[n - 1]));
    if (n > 2) p.set('waypoints', places.slice(1, n - 1).map(ll).join('|'));
    p.set('travelmode', travelmode(mode));
    return 'https://www.google.com/maps/dir/?' + p.toString();
  };
  let used = Math.min(places.length, maxWaypoints + 2);
  let url = build(used);
  while (url.length > 2048 && used > 2) url = build(--used);
  return { url, used, total: places.length, truncated: used < places.length, maxWaypoints };
}

// ---------- カレンダー予定の description（HTML） ----------
export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// スマートフォンの Google カレンダーからタップして開けるよう、リンクは https:// から始まる完全な URL
export function itineraryHtml(rows, { title, dateText, wholeMode = 'car', withLegLinks = true }) {
  const out = [`<b>${escapeHtml(title)}</b>`];
  if (dateText) out.push(escapeHtml(dateText));
  out.push('');
  rows.forEach((r, i) => {
    if (i > 0) {
      const prev = rows[i - 1];
      let line = `　↓ ${MODE_LABEL[r.mode]}で約${r.travel}分（${fmtTime(prev.depart)}出発 → ${fmtTime(r.arrive)}到着）`;
      if (withLegLinks) line += ` <a href="${escapeHtml(mapsDirUrl(prev.place, r.place, r.mode))}">この区間のルート案内</a>`;
      out.push(line);
    }
    out.push(`<b>${i + 1}. ${escapeHtml(r.place.name)}</b> ${fmtTime(r.arrive)}到着 → ${fmtTime(r.depart)}出発（滞在${r.stay}分）`);
  });
  const whole = mapsDirAllUrl(rows.map((r) => r.place), wholeMode, true); // スマホで開く前提で、モバイルの上限(3件)に合わせる
  if (whole) {
    out.push('', `<a href="${escapeHtml(whole.url)}">全体ルートを Google マップで見る</a>（${MODE_LABEL[wholeMode]}）`);
    if (whole.truncated) {
      out.push(`⚠ ${LIMIT_WARNING}。最初の${whole.used}地点までの全体ルートです。残りの地点は、区間ごとのルート案内で確認してください。`);
    }
  }
  out.push('', escapeHtml(ESTIMATE_NOTE));
  return out.join('<br>');
}
