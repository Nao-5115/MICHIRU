// 各機能のロジック（DOM 非依存）。グローバル TripLib として公開
(function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_CANDS = 60;

  // ---------- 共有コード（JSON → UTF-8 → Base64） ----------
  function encodeCode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }
  function decodeCode(str) {
    try {
      const bin = atob(String(str).trim().replace(/\s+/g, ''));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!obj || typeof obj !== 'object') throw new Error();
      return obj;
    } catch (_) {
      throw new Error('コードの形式が正しくありません。コピーし直して貼り付けてください。');
    }
  }
  const bad = () => new Error('コードの内容が不正です（バージョン違い、または破損している可能性があります）。');
  const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

  function parseInvite(str) {
    const o = decodeCode(str);
    if (o.t !== 'invite' || o.v !== 1 || !isStr(o.id, 32) || !Array.isArray(o.cands)) throw bad();
    if (o.cands.length === 0 || o.cands.length > MAX_CANDS) throw bad();
    const cands = o.cands.map((c) => {
      if (!c || !isStr(c.id, 32) || !DATE_RE.test(c.s) || !DATE_RE.test(c.e) || c.e < c.s) throw bad();
      return { id: c.id, s: c.s, e: c.e };
    });
    return { id: o.id, title: typeof o.title === 'string' ? o.title.slice(0, 100) : '', cands };
  }
  function parseReply(str) {
    const o = decodeCode(str);
    if (o.t !== 'reply' || o.v !== 1 || !isStr(o.id, 32) || !isStr(o.name, 40) || !o.ans || typeof o.ans !== 'object') throw bad();
    const ans = {};
    for (const [k, v] of Object.entries(o.ans)) {
      if (k.length > 32 || ![0, 1, 2].includes(v)) throw bad();
      ans[k] = v;
    }
    return { id: o.id, name: o.name, ans };
  }
  const makeInviteCode = (id, title, cands) =>
    encodeCode({ t: 'invite', v: 1, id, title, cands: cands.map((c) => ({ id: c.id, s: c.s, e: c.e })) });
  const makeReplyCode = (id, name, ans) => encodeCode({ t: 'reply', v: 1, id, name, ans });

  // ---------- 集計（1=○, 2=△, 0=×） ----------
  function rank(cands, responses) {
    return cands
      .map((c) => {
        const r = { cand: c, yes: [], maybe: [], no: [], none: [] };
        for (const resp of responses) {
          const a = resp.ans[c.id];
          (a === 1 ? r.yes : a === 2 ? r.maybe : a === 0 ? r.no : r.none).push(resp.name);
        }
        return r;
      })
      .sort((a, b) => b.yes.length - a.yes.length || b.maybe.length - a.maybe.length || a.cand.s.localeCompare(b.cand.s));
  }

  // ---------- 日付 ----------
  function addDays(s, n) {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmtDate(s) {
    const d = new Date(s + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
  }
  const fmtRange = (c) => (c.s === c.e ? fmtDate(c.s) : `${fmtDate(c.s)}〜${fmtDate(c.e)}`);

  // 候補日と既存予定の重なり判定
  function conflicts(cand, events) {
    const cs = new Date(cand.s + 'T00:00:00');
    const ce = new Date(addDays(cand.e, 1) + 'T00:00:00');
    return events.filter((ev) => {
      if (ev.transparency === 'transparent') return false;
      const s = new Date(ev.start.dateTime || ev.start.date + 'T00:00:00');
      const e = new Date(ev.end.dateTime || ev.end.date + 'T00:00:00');
      return s < ce && e > cs;
    });
  }

  // ---------- 緯度経度（URL のみから抽出） ----------
  const okLL = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  function extractLatLng(href) {
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
  const UNNAMED_PLACE = '名称未設定の地点';
  // /maps/place/<場所名>/@lat,lng,zoom... の <場所名> を取り出す。無ければ null
  function extractPlaceName(href) {
    const m = href.match(/\/maps\/place\/([^/@?#]+)/);
    if (!m) return null;
    let name = m[1].replace(/\+/g, ' '); // + は空白に戻してからデコード（%2B はそのまま + になる）
    try { name = decodeURIComponent(name); } catch (_) {}
    name = name.trim().slice(0, 60);
    if (!name || /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(name)) return null; // 座標だけの名前は場所名とみなさない
    return name;
  }

  // ---------- 距離・訪問順 ----------
  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const BRUTE_FORCE_MAX = 9; // これ以下は総当たり（最大 8! 通り）。超えたら最近傍法 + 2-opt
  function pathLen(order, D) {
    let s = 0;
    for (let i = 1; i < order.length; i++) s += D[order[i - 1]][order[i]];
    return s;
  }
  // 出発地点 start を固定した開路の最短順（インデックス配列）を返す
  function optimize(pts, start = 0) {
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
    // 最近傍法
    let order = [start];
    const left = new Set(rest);
    while (left.size) {
      const cur = order[order.length - 1];
      let bi = -1, bd = Infinity;
      for (const i of left) if (D[cur][i] < bd) { bd = D[cur][i]; bi = i; }
      order.push(bi); left.delete(bi);
    }
    // 2-opt で改善
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
  function parseTime(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? Math.min(+m[1], 23) * 60 + Math.min(+m[2], 59) : 9 * 60;
  }
  function fmtTime(min) {
    const day = Math.floor(min / 1440), m = min % 1440;
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return day > 0 ? `${t}(+${day}日)` : t;
  }
  const MODE_LABEL = { car: '車', train: '電車' };
  const DEFAULT_SPEED = { car: 40, train: 35 };
  const DEFAULT_DETOUR = 1.3;
  const ESTIMATE_NOTE = '※移動時間は「直線距離 × 迂回係数 ÷ 想定速度」による概算です。実際の経路・交通状況・乗換や待ち時間は考慮していません。';
  // places: 訪問順の地点配列 / speeds, detours: {car, train} / modeOf(前の地点, 次の地点) → 'car' | 'train'
  function buildItinerary(places, { startMin, speeds, detours, defaultStay, stays, modeOf }) {
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
  function itineraryText(rows) {
    const out = [];
    rows.forEach((r, i) => {
      if (i > 0) out.push(`  ↓ ${fmtTime(rows[i - 1].depart)}出発 → ${fmtTime(r.arrive)}到着（${MODE_LABEL[r.mode]}・直線${r.km.toFixed(1)}km×${r.detour}≒約${r.roadKm.toFixed(1)}km・約${r.travel}分）`);
      out.push(`■ ${r.place.name}（滞在${r.stay}分 / ${fmtTime(r.arrive)}〜${fmtTime(r.depart)}）`);
    });
    out.push('', ESTIMATE_NOTE);
    return out.join('\n');
  }

  // ---------- Google Maps URLs（区間ごと 2 地点のみ。waypoints は使わない） ----------
  function mapsDirUrl(from, to, mode) {
    const p = new URLSearchParams(); // カンマは %2C にエンコードされる
    p.set('api', '1');
    p.set('origin', `${from.lat},${from.lng}`);
    p.set('destination', `${to.lat},${to.lng}`);
    p.set('travelmode', mode === 'train' ? 'transit' : 'driving');
    return 'https://www.google.com/maps/dir/?' + p.toString();
  }

  // 登録済み予定（{start, end, allDay}）の表示用文字列。終日予定の end は排他的終了日
  function fmtEventWhen(r) {
    if (r.allDay) {
      const e = addDays(r.end, -1);
      return r.start === e ? fmtDate(r.start) : `${fmtDate(r.start)}〜${fmtDate(e)}`;
    }
    const sd = r.start.slice(0, 10), ed = r.end.slice(0, 10);
    return `${fmtDate(sd)} ${r.start.slice(11, 16)}〜${ed === sd ? '' : fmtDate(ed) + ' '}${r.end.slice(11, 16)}`;
  }

  window.TripLib = {
    encodeCode, decodeCode, parseInvite, parseReply, makeInviteCode, makeReplyCode, rank,
    addDays, fmtDate, fmtRange, conflicts, extractLatLng, extractPlaceName,
    haversine, optimize, parseTime, fmtTime, buildItinerary, itineraryText, mapsDirUrl, fmtEventWhen, MODE_LABEL, UNNAMED_PLACE, ESTIMATE_NOTE, MAX_CANDS
  };
})();
