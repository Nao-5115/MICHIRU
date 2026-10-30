// 各機能のロジック（DOM・chrome API 非依存）

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_DATES = 60;
export const MAX_CANDIDATE_PLACES = 50; // Firebase 上の候補地点
export const MAX_LOCAL_PLACES = 20; // 訪問地点リスト（幹事のローカル）
export const UNNAMED_PLACE = "名称未設定の地点";
export const MODE_LABEL = { car: "車", train: "電車" };
export const DEFAULT_SPEED = { car: 40, train: 35 };
export const DEFAULT_DETOUR = 1.3;
export const ESTIMATE_NOTE =
  "※移動時間は「直線距離 × 迂回係数 ÷ 想定速度」による概算です。実際の経路・交通状況・乗換や待ち時間は考慮していません。";
export const LIMIT_WARNING = "経由地の表示上限に達しました";

// ---------- メンバー / メールアドレス ----------
export const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();
// Realtime Database のキーに使えない文字（. # $ [ ] /）を含むアドレスは扱わない
export const isValidEmail = (email) => {
  const normalized = normalizeEmail(email);
  return (
    normalized.length <= 254 &&
    /^[^\s@#$\[\]\/]+@[^\s@#$\[\]\/]+\.[^\s@#$\[\]\/]+$/.test(normalized)
  );
};
// '.' は ',' に置き換える（セキュリティルール側も同じ変換: toLowerCase().replace('.', ',')）
export const emailKey = (email) => normalizeEmail(email).replace(/\./g, ",");
export const memberLabel = (member) => member.displayName || member.email;
export const shortName = (email, displayName) =>
  displayName || String(email || "").split("@")[0];

// ---------- 日付 ----------
export function addDays(dateStr, days) {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function fmtDate(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  return `${date.getMonth() + 1}/${date.getDate()}(${"日月火水木金土"[date.getDay()]})`;
}
export const fmtRange = (candidate) =>
  candidate.s === candidate.e
    ? fmtDate(candidate.s)
    : `${fmtDate(candidate.s)}〜${fmtDate(candidate.e)}`;
export const isDate = (value) => DATE_RE.test(value);

// 候補日と既存予定の重なり判定
export function conflicts(cand, events) {
  const startDate = new Date(cand.s + "T00:00:00");
  const endDate = new Date(addDays(cand.e, 1) + "T00:00:00");
  return events.filter((event) => {
    if (event.transparency === "transparent") return false;
    const start = new Date(
      event.start.dateTime || event.start.date + "T00:00:00",
    );
    const end = new Date(event.end.dateTime || event.end.date + "T00:00:00");
    return start < endDate && end > startDate;
  });
}

// 登録済み予定（{start, end, allDay}）の表示用文字列。終日予定の end は排他的終了日
export function fmtEventWhen(event) {
  if (event.allDay) {
    const endDay = addDays(event.end, -1);
    return event.start === endDay
      ? fmtDate(event.start)
      : `${fmtDate(event.start)}〜${fmtDate(endDay)}`;
  }
  const startDate = event.start.slice(0, 10),
    endDate = event.end.slice(0, 10);
  return `${fmtDate(startDate)} ${event.start.slice(11, 16)}〜${endDate === startDate ? "" : fmtDate(endDate) + " "}${event.end.slice(11, 16)}`;
}

// ---------- Firebase のスナップショット → 配列 ----------
export const entriesOf = (obj) =>
  Object.entries(obj || {}).map(([id, value]) => ({ id, ...value }));
export const membersOf = (data) =>
  Object.entries((data && data.members) || {})
    .map(([key, member]) => ({ key, ...member }))
    .sort(
      (first, second) =>
        (first.role === "owner" ? -1 : 0) -
          (second.role === "owner" ? -1 : 0) ||
        (first.invitedAt || 0) - (second.invitedAt || 0),
    );
export const datesOf = (data) =>
  entriesOf(data && data.dates).sort((first, second) =>
    first.s.localeCompare(second.s),
  );
export const placesOf = (data) => entriesOf(data && data.places);

// ---------- 集計 ----------
// 出欠: 1=○, 2=△, 0=×。参加可能人数（○）が多い順、同数なら△が多い順、さらに日付順
export function rankDates(dates, members, answers) {
  return dates
    .map((date) => {
      const row = { date: date, yes: [], maybe: [], no: [], none: [] };
      for (const member of members) {
        const answer =
          answers && answers[member.key]
            ? answers[member.key][date.id]
            : undefined;
        (answer === 1
          ? row.yes
          : answer === 2
            ? row.maybe
            : answer === 0
              ? row.no
              : row.none
        ).push(memberLabel(member));
      }
      return row;
    })
    .sort(
      (first, second) =>
        second.yes.length - first.yes.length ||
        second.maybe.length - first.maybe.length ||
        first.date.s.localeCompare(second.date.s),
    );
}
// 候補地点: 得票数の多い順（同数なら追加が早い順）。誰が投票したかも返す
export function rankPlaces(places, members, votes) {
  return places
    .map((place) => ({
      place: place,
      voters: members
        .filter(
          (member) =>
            votes && votes[member.key] && votes[member.key][place.id] === true,
        )
        .map(memberLabel),
    }))
    .sort(
      (first, second) =>
        second.voters.length - first.voters.length ||
        (first.place.addedAt || 0) - (second.place.addedAt || 0),
    );
}

// ---------- 緯度経度・場所名（URL のみから抽出） ----------
const okLL = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export function extractLatLng(href) {
  let url = href;
  try {
    url = decodeURIComponent(href);
  } catch (_) {}
  let match,
    last = null;
  const coordinatePattern = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g; // 場所そのものの座標（優先）
  while ((match = coordinatePattern.exec(url))) last = match;
  if (last && okLL(+last[1], +last[2])) return { lat: +last[1], lng: +last[2] };
  match = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/); // 地図の中心座標
  if (match && okLL(+match[1], +match[2]))
    return { lat: +match[1], lng: +match[2] };
  match = url.match(
    /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  );
  if (match && okLL(+match[1], +match[2]))
    return { lat: +match[1], lng: +match[2] };
  return null;
}
// /maps/place/<場所名>/@lat,lng,zoom... の <場所名> を取り出す。無ければ null
export function extractPlaceName(href) {
  const match = href.match(/\/maps\/place\/([^/@?#]+)/);
  if (!match) return null;
  let name = match[1].replace(/\+/g, " "); // + は空白に戻してからデコード（%2B はそのまま + になる）
  try {
    name = decodeURIComponent(name);
  } catch (_) {}
  name = name.trim().slice(0, 60);
  if (!name || /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(name)) return null; // 座標だけの名前は場所名とみなさない
  return name;
}
export const samePoint = (first, second) =>
  Math.abs(first.lat - second.lat) < 1e-5 &&
  Math.abs(first.lng - second.lng) < 1e-5;

// ---------- 距離・訪問順 ----------
export function haversine(from, to) {
  const EARTH_RADIUS_KM = 6371,
    degToRad = Math.PI / 180;
  const dLat = (to.lat - from.lat) * degToRad,
    dLng = (to.lng - from.lng) * degToRad;
  const haversineTerm =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from.lat * degToRad) *
      Math.cos(to.lat * degToRad) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversineTerm));
}
export const BRUTE_FORCE_MAX = 9; // これ以下は総当たり（最大 8! 通り）。超えたら最近傍法 + 2-opt
function pathLen(order, distances) {
  let total = 0;
  for (let index = 1; index < order.length; index++)
    total += distances[order[index - 1]][order[index]];
  return total;
}
// 出発地点 start を固定した開路の最短順（インデックス配列）を返す
export function optimize(pts, start = 0) {
  const count = pts.length;
  const distances = pts.map((fromPoint) =>
    pts.map((toPoint) => haversine(fromPoint, toPoint)),
  );
  const rest = [...Array(count).keys()].filter((index) => index !== start);
  if (count <= 2) return [start, ...rest];
  if (count <= BRUTE_FORCE_MAX) {
    let best = null,
      bestLen = Infinity;
    const dfs = (path, used, distance) => {
      if (distance >= bestLen) return;
      if (path.length === count) {
        best = path.slice();
        bestLen = distance;
        return;
      }
      for (const index of rest) {
        if (used.has(index)) continue;
        used.add(index);
        path.push(index);
        dfs(path, used, distance + distances[path[path.length - 2]][index]);
        path.pop();
        used.delete(index);
      }
    };
    dfs([start], new Set([start]), 0);
    return best;
  }
  let order = [start];
  const left = new Set(rest);
  while (left.size) {
    const cur = order[order.length - 1];
    let bestIndex = -1,
      bestDistance = Infinity;
    for (const index of left)
      if (distances[cur][index] < bestDistance) {
        bestDistance = distances[cur][index];
        bestIndex = index;
      }
    order.push(bestIndex);
    left.delete(bestIndex);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let startIndex = 1; startIndex < count - 1; startIndex++) {
      for (let endIndex = startIndex + 1; endIndex < count; endIndex++) {
        const cand = order
          .slice(0, startIndex)
          .concat(
            order.slice(startIndex, endIndex + 1).reverse(),
            order.slice(endIndex + 1),
          );
        if (pathLen(cand, distances) < pathLen(order, distances) - 1e-9) {
          order = cand;
          improved = true;
        }
      }
    }
  }
  return order;
}

// ---------- しおり ----------
export function parseTime(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return match
    ? Math.min(+match[1], 23) * 60 + Math.min(+match[2], 59)
    : 9 * 60;
}
export function fmtTime(minutes) {
  const day = Math.floor(minutes / 1440),
    minuteOfDay = minutes % 1440;
  const text = `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
  return day > 0 ? `${text}(+${day}日)` : text;
}
// places: 訪問順の地点配列 / speeds, detours: {car, train} / modeOf(前の地点, 次の地点) → 'car' | 'train'
export function buildItinerary(
  places,
  { startMin, speeds, detours, defaultStay, stays, modeOf, knownMinutes },
) {
  const rows = [];
  let totalKm = 0,
    totalRoadKm = 0;
  places.forEach((place, index) => {
    let arrive = startMin,
      distanceKm = 0,
      roadKm = 0,
      travel = 0,
      mode = null,
      detour = 1;
    if (index > 0) {
      mode = modeOf ? modeOf(places[index - 1], place) : "car";
      if (!MODE_LABEL[mode]) mode = "car";
      const speed =
        speeds && speeds[mode] > 0 ? speeds[mode] : DEFAULT_SPEED[mode];
      detour = detours && detours[mode] >= 1 ? detours[mode] : DEFAULT_DETOUR;
      distanceKm = haversine(places[index - 1], place);
      roadKm = distanceKm * detour;
      travel = Math.max(1, Math.round((roadKm / speed) * 60));
      const known = knownMinutes ? knownMinutes(places[index - 1], place, mode) : null;
      if (known != null) travel = known; // 取得済みの所要時間（Gemini の目安）があればそれを使う
      arrive = rows[index - 1].depart + travel;
      totalKm += distanceKm;
      totalRoadKm += roadKm;
    }
    const stay = Number.isFinite(stays[place.id])
      ? stays[place.id]
      : defaultStay;
    rows.push({
      place: place,
      arrive,
      stay,
      depart: arrive + stay,
      km: distanceKm,
      roadKm,
      travel,
      mode,
      detour,
    });
  });
  return { rows, totalKm, totalRoadKm };
}

// ---------- Google Maps URLs（API キー不要） ----------
const formatLatLng = (point) => `${point.lat},${point.lng}`;
// Google マップには地点名で渡し、名前で検索させる（手で検索したときと同じ候補になる）。
// 「現在地」「名称未設定」は名前では探せないので緯度経度を使う
const COORD_ONLY_NAMES = ["現在地", UNNAMED_PLACE];
const formatPoint = (point) =>
  point.name && !COORD_ONLY_NAMES.includes(point.name) ? point.name : formatLatLng(point);
const travelmode = (mode) => (mode === "train" ? "transit" : "driving");

// 区間（2 地点）。waypoints は使わない
export function mapsDirUrl(from, to, mode) {
  const params = new URLSearchParams(); // カンマは %2C にエンコードされる
  params.set("api", "1");
  params.set("origin", formatPoint(from));
  params.set("destination", formatPoint(to));
  params.set("travelmode", travelmode(mode));
  return "https://www.google.com/maps/dir/?" + params.toString();
}

export const isMobile = () =>
  typeof navigator !== "undefined" &&
  (navigator.userAgentData &&
  typeof navigator.userAgentData.mobile === "boolean"
    ? navigator.userAgentData.mobile
    : /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ""));

// 全体ルート（先頭=出発地、末尾=目的地、間を waypoints に `|` 区切りで列挙）。
// 経由地の上限（モバイル 3 件 / それ以外 9 件）と URL 2,048 文字を超える場合は、上限までの地点で案内する
export function mapsDirAllUrl(places, mode, mobile = false) {
  if (!places || places.length < 2) return null;
  const maxWaypoints = mobile ? 3 : 9;
  const build = (count) => {
    const params = new URLSearchParams(); // `|` は %7C、`,` は %2C にエンコードされる
    params.set("api", "1");
    params.set("origin", formatPoint(places[0]));
    params.set("destination", formatPoint(places[count - 1]));
    if (count > 2)
      params.set(
        "waypoints",
        places
          .slice(1, count - 1)
          .map(formatPoint)
          .join("|"),
      );
    params.set("travelmode", travelmode(mode));
    return "https://www.google.com/maps/dir/?" + params.toString();
  };
  let used = Math.min(places.length, maxWaypoints + 2);
  let url = build(used);
  while (url.length > 2048 && used > 2) url = build(--used);
  return {
    url,
    used,
    total: places.length,
    truncated: used < places.length,
    maxWaypoints,
  };
}

// ---------- カレンダー予定の description（HTML） ----------
export const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// スマートフォンの Google カレンダーからタップして開けるよう、リンクは https:// から始まる完全な URL
export function itineraryHtml(
  rows,
  { title, dateText, wholeMode = "car", withLegLinks = true },
) {
  const out = [`<b>${escapeHtml(title)}</b>`];
  if (dateText) out.push(escapeHtml(dateText));
  out.push("");
  rows.forEach((row, index) => {
    if (index > 0) {
      const prev = rows[index - 1];
      let line = `　↓ ${MODE_LABEL[row.mode]}で約${row.travel}分（${fmtTime(prev.depart)}出発 → ${fmtTime(row.arrive)}到着）`;
      if (withLegLinks)
        line += ` <a href="${escapeHtml(mapsDirUrl(prev.place, row.place, row.mode))}">この区間のルート案内</a>`;
      out.push(line);
    }
    out.push(
      `<b>${index + 1}. ${escapeHtml(row.place.name)}</b> ${fmtTime(row.arrive)}到着 → ${fmtTime(row.depart)}出発（滞在${row.stay}分）`,
    );
  });
  const whole = mapsDirAllUrl(
    rows.map((row) => row.place),
    wholeMode,
    true,
  ); // スマホで開く前提で、モバイルの上限(3件)に合わせる
  if (whole) {
    out.push(
      "",
      `<a href="${escapeHtml(whole.url)}">全体ルートを Google マップで見る</a>（${MODE_LABEL[wholeMode]}）`,
    );
    if (whole.truncated) {
      out.push(
        `⚠ ${LIMIT_WARNING}。最初の${whole.used}地点までの全体ルートです。残りの地点は、区間ごとのルート案内で確認してください。`,
      );
    }
  }
  out.push("", escapeHtml(ESTIMATE_NOTE));
  return out.join("<br>");
}
