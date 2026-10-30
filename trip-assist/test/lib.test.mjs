import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../src/lib.js";

test("メールアドレス: キー変換と検証", () => {
  assert.equal(
    T.emailKey(" Taro.Yamada@Example.COM "),
    "taro,yamada@example,com",
  );
  assert.ok(T.isValidEmail("a.b+c@example.co.jp"));
  for (const bad of [
    "",
    "abc",
    "a b@x.com",
    "a#b@x.com",
    "a$b@x.com",
    "a/b@x.com",
    "a[b]@x.com",
  ])
    assert.ok(!T.isValidEmail(bad), bad);
});

test("出欠の集計: ○が多い順、同数なら△が多い順", () => {
  const members = [
    { key: "a", email: "a@x.com" },
    { key: "b", email: "b@x.com", displayName: "Bさん" },
    { key: "c", email: "c@x.com" },
  ];
  const dates = [
    { id: "d1", s: "2026-11-01", e: "2026-11-01" },
    { id: "d2", s: "2026-11-08", e: "2026-11-09" },
    { id: "d3", s: "2026-11-15", e: "2026-11-15" },
  ];
  const answers = {
    a: { d1: 1, d2: 1, d3: 2 },
    b: { d1: 0, d2: 1, d3: 2 },
    c: { d2: 2 },
  };
  const r = T.rankDates(dates, members, answers);
  assert.deepEqual(
    r.map((x) => x.date.id),
    ["d2", "d1", "d3"],
  ); // d2:○2 → d1:○1 → d3:○0(△2)
  assert.deepEqual(r[0].yes, ["a@x.com", "Bさん"]);
  assert.deepEqual(r[0].maybe, ["c@x.com"]);
  assert.deepEqual(r[2].none, ["c@x.com"]);
});

test("投票の集計: 得票数の多い順・誰が投票したかを返す", () => {
  const members = [
    { key: "a", email: "a@x.com" },
    { key: "b", email: "b@x.com" },
  ];
  const places = [
    { id: "p1", addedAt: 1 },
    { id: "p2", addedAt: 2 },
    { id: "p3", addedAt: 3 },
  ];
  const votes = { a: { p2: true, p3: true }, b: { p3: true, p1: false } };
  const r = T.rankPlaces(places, members, votes);
  assert.deepEqual(
    r.map((x) => x.place.id),
    ["p3", "p2", "p1"],
  );
  assert.deepEqual(r[0].voters, ["a@x.com", "b@x.com"]);
  assert.deepEqual(r[2].voters, []);
});

test("全体ルート: waypoints は | を %7C、カンマを %2C にエンコードし、先頭が出発地・末尾が目的地", () => {
  const pts = Array.from({ length: 5 }, (_, i) => ({
    lat: 35 + i * 0.1,
    lng: 139 + i * 0.1,
  }));
  const r = T.mapsDirAllUrl(pts, "train", false);
  assert.ok(r.url.startsWith("https://www.google.com/maps/dir/?api=1&origin="));
  assert.ok(r.url.includes("origin=35%2C139"));
  assert.ok(r.url.includes("destination=35.4%2C139.4"));
  assert.ok(
    r.url.includes("waypoints=35.1%2C139.1%7C35.2%2C139.2%7C35.3%2C139.3"),
  );
  assert.ok(r.url.includes("travelmode=transit"));
  assert.ok(!r.url.includes("|") && !r.url.includes(","));
  assert.equal(r.truncated, false);
  assert.equal(
    T.mapsDirAllUrl(pts, "car").url.includes("travelmode=driving"),
    true,
  );
  assert.equal(T.mapsDirAllUrl([pts[0]], "car"), null);
});

test("全体ルート: 経由地の上限（モバイル3件・それ以外9件）で打ち切り、警告フラグを立てる", () => {
  const pts = Array.from({ length: 15 }, (_, i) => ({
    lat: 35 + i * 0.01,
    lng: 139 + i * 0.01,
  }));
  const pc = T.mapsDirAllUrl(pts, "car", false);
  assert.equal(pc.maxWaypoints, 9);
  assert.equal(pc.used, 11);
  assert.equal(pc.truncated, true);
  assert.equal(
    decodeURIComponent(new URL(pc.url).searchParams.get("waypoints")).split("|")
      .length,
    9,
  );
  const mb = T.mapsDirAllUrl(pts, "car", true);
  assert.equal(mb.maxWaypoints, 3);
  assert.equal(mb.used, 5);
  assert.equal(
    decodeURIComponent(new URL(mb.url).searchParams.get("waypoints")).split("|")
      .length,
    3,
  );
  assert.ok(
    new URL(mb.url).searchParams.get("destination") ===
      `${pts[4].lat},${pts[4].lng}`,
  );
});

test("全体ルート: URL が 2,048 文字を超えないよう地点を減らす", () => {
  const pts = Array.from({ length: 12 }, (_, i) => ({
    lat: 35.123456789012 + i,
    lng: 139.123456789012 + i,
  }));
  const r = T.mapsDirAllUrl(pts, "car", false);
  assert.ok(r.url.length <= 2048);
  const long = pts.map((p) => ({
    lat: +(p.lat + "0".repeat(100)),
    lng: p.lng,
  }));
  assert.ok(
    T.mapsDirAllUrl(
      Array.from({ length: 12 }, () => ({ lat: 1.1, lng: 2.2 })),
      "car",
    ).url.length <= 2048,
  );
});

test("区間リンク: waypoints を使わず 2 地点のみ", () => {
  const u = T.mapsDirUrl(
    { lat: 35.6812, lng: 139.7671 },
    { lat: 35.6586, lng: 139.7454 },
    "train",
  );
  assert.equal(
    u,
    "https://www.google.com/maps/dir/?api=1&origin=35.6812%2C139.7671&destination=35.6586%2C139.7454&travelmode=transit",
  );
  assert.ok(!u.includes("waypoints"));
});

test("カレンダー description: 各地点の時刻・滞在・移動手段・区間リンク・全体ルート・注記を含み、HTML をエスケープする", () => {
  const places = [
    { id: "a", name: "東京駅 <&>", lat: 35.6812, lng: 139.7671 },
    { id: "b", name: "浅草寺", lat: 35.7148, lng: 139.7967 },
    { id: "c", name: "上野公園", lat: 35.7156, lng: 139.7745 },
  ];
  const it = T.buildItinerary(places, {
    startMin: 540,
    speeds: { car: 40, train: 35 },
    detours: { car: 1.3, train: 1.3 },
    defaultStay: 60,
    stays: {},
    modeOf: (a) => (a.id === "a" ? "train" : "car"),
  });
  const html = T.itineraryHtml(it.rows, {
    title: "東京日帰り",
    dateText: "11/3(月)",
    wholeMode: "car",
  });
  assert.ok(
    html.includes(
      "<b>1. 東京駅 &lt;&amp;&gt;</b> 09:00到着 → 10:00出発（滞在60分）",
    ),
  );
  assert.ok(html.includes("電車で約") && html.includes("車で約"));
  assert.equal((html.match(/この区間のルート案内/g) || []).length, 2);
  assert.ok(
    html.includes('href="https://www.google.com/maps/dir/?api=1&amp;origin='),
  );
  assert.ok(html.includes("全体ルートを Google マップで見る"));
  assert.ok(html.includes("waypoints=%E6%B5%85%E8%8D%89%E5%AF%BA"));
  assert.ok(html.includes("概算"));
  assert.ok(!html.includes("<script"));
});

test("カレンダー description: 全体ルートは上限を超えると警告文を入れる", () => {
  const places = Array.from({ length: 8 }, (_, i) => ({
    id: "p" + i,
    name: "P" + i,
    lat: 35 + i * 0.01,
    lng: 139,
  }));
  const it = T.buildItinerary(places, {
    startMin: 540,
    speeds: {},
    detours: {},
    defaultStay: 30,
    stays: {},
  });
  const html = T.itineraryHtml(it.rows, { title: "t", dateText: "d" });
  assert.ok(html.includes("経由地の表示上限に達しました"));
});

test("迂回係数: 移動時間 = 直線距離 × 迂回係数 ÷ 想定速度", () => {
  const a = { id: "a", name: "A", lat: 35, lng: 139 },
    b = { id: "b", name: "B", lat: 35.2, lng: 139 };
  const km = T.haversine(a, b);
  const mk = (d) =>
    T.buildItinerary([a, b], {
      startMin: 0,
      speeds: { car: 40 },
      detours: { car: d },
      defaultStay: 0,
      stays: {},
    }).rows[1].travel;
  assert.equal(mk(1), Math.round((km / 40) * 60));
  assert.equal(mk(1.5), Math.round(((km * 1.5) / 40) * 60));
});

test("場所名・緯度経度の抽出（URL のみ）", () => {
  assert.equal(
    T.extractPlaceName(
      "https://www.google.com/maps/place/%E6%9D%B1%E4%BA%AC%E3%82%BF%E3%83%AF%E3%83%BC/@35.6586,139.7454,17z",
    ),
    "東京タワー",
  );
  assert.equal(
    T.extractPlaceName(
      "https://www.google.com/maps/place/Tokyo+Station/@35.68,139.76,17z",
    ),
    "Tokyo Station",
  );
  assert.equal(
    T.extractPlaceName("https://www.google.com/maps/@35.68,139.76,15z"),
    null,
  );
  assert.deepEqual(
    T.extractLatLng("https://www.google.com/maps/@35.6812,139.7671,15z"),
    { lat: 35.6812, lng: 139.7671 },
  );
});
