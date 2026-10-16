// Firebase SDK を偽物に差し替えて offscreen.js を実行し、書き込み先パスとデータ形式を確認する
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tdir = join(here, "../testing"); // テスト補助ファイル（test/ に置くとテスト本体として実行されてしまうため分けている）
const fake = pathToFileURL(join(tdir, "fake-firebase.mjs")).href;
const lib = pathToFileURL(join(here, "../src/lib.js")).href;
const src = readFileSync(join(here, "../src/offscreen.js"), "utf8")
  .replace(/from 'firebase\/[a-z/-]+'/g, `from '${fake}'`)
  .replace(
    "from '../firebase-config.json'",
    `from '${pathToFileURL(join(tdir, "fake-config.mjs")).href}'`,
  )
  .replace("from './lib.js'", `from '${lib}'`);
writeFileSync(join(tdir, ".offscreen.generated.mjs"), src);
writeFileSync(
  join(tdir, "fake-config.mjs"),
  "export default { apiKey: 'k', databaseURL: 'https://x.firebaseio.com', projectId: 'p', appId: 'a' };\n",
);

const published = {};
let handler;
globalThis.chrome = {
  runtime: {
    id: "ext",
    sendMessage: async (m) => {
      if (m.type === "app:publish") {
        published[m.key] = m.value;
        return { ok: true };
      }
      if (m.type === "app:get")
        return { ok: true, values: { "app:currentTripId": "T9" } };
      if (m.type === "auth:token")
        return { ok: true, token: "google-access-token" };
      return { ok: true };
    },
    onMessage: {
      addListener: (f) => {
        handler = f;
      },
    },
  },
};
const F = await import(fake);
await import(pathToFileURL(join(tdir, ".offscreen.generated.mjs")).href);
await new Promise((r) => setTimeout(r, 30));
const call = (type, args = {}) =>
  new Promise((res) => handler({ type, ...args }, { id: "ext" }, res));
const last = (op) => F.calls.findLast((c) => c[0] === op);

test("起動時に前回の旅行を復元し、サインイン状態を中継する", async () => {
  assert.equal(published["fb:auth"], undefined);
  const r = await call("fb:signIn");
  assert.ok(r.ok);
  assert.deepEqual(last("signIn")[1], {
    idToken: null,
    accessToken: "google-access-token",
  });
  assert.deepEqual(published["fb:auth"], {
    state: "signedIn",
    uid: "u-owner",
    email: "owner@example.com",
    name: "幹事さん",
  });
  assert.ok(
    "userTrips/owner@example,com" in F.watchers,
    "自分の旅行一覧を購読",
  );
  assert.ok("trips/T9" in F.watchers, "前回開いていた旅行を購読");
});

test("旅行の購読: データを中継し、招待された本人が初めて開くと「参加済み」を書き込む", async () => {
  F.watchers["userTrips/owner@example,com"]({
    val: () => ({
      A: { name: "古い", ownerEmail: "x@y.com", invitedAt: 1 },
      B: { name: "新しい", ownerEmail: "z@y.com", invitedAt: 9 },
    }),
  });
  assert.deepEqual(
    published["fb:trips"].list.map((t) => t.id),
    ["B", "A"],
  );
  F.calls.length = 0;
  F.watchers["trips/T9"]({
    val: () => ({
      meta: { name: "T" },
      members: {
        "owner@example,com": {
          email: "owner@example.com",
          role: "member",
          invitedAt: 1,
        },
      },
    }),
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(published["fb:trip"].id, "T9");
  const u = last("update")[2];
  assert.deepEqual(Object.keys(u).sort(), [
    "trips/T9/members/owner@example,com/displayName",
    "trips/T9/members/owner@example,com/joinedAt",
    "trips/T9/members/owner@example,com/uid",
  ]);
  assert.equal(u["trips/T9/members/owner@example,com/uid"], "u-owner");
  // 2 回目以降は書き込まない
  F.calls.length = 0;
  F.watchers["trips/T9"]({
    val: () => ({
      meta: { name: "T" },
      members: {
        "owner@example,com": {
          email: "owner@example.com",
          role: "member",
          invitedAt: 1,
        },
      },
    }),
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(F.calls.length, 0);
});

test("旅行の作成: meta・幹事の members・自分の索引を 1 回のアトミック更新で書く", async () => {
  F.calls.length = 0;
  const r = await call("fb:createTrip", { name: "  箱根旅行 " });
  assert.ok(r.ok && r.id);
  const [, root, u] = last("update");
  assert.equal(root, "");
  assert.deepEqual(
    Object.keys(u).sort(),
    [
      `trips/${r.id}/members/owner@example,com`,
      `trips/${r.id}/meta`,
      `userTrips/owner@example,com/${r.id}`,
    ].sort(),
  );
  assert.deepEqual(u[`trips/${r.id}/meta`], {
    name: "箱根旅行",
    ownerUid: "u-owner",
    ownerEmail: "owner@example.com",
    createdAt: "TS",
  });
  assert.equal(u[`trips/${r.id}/members/owner@example,com`].role, "owner");
  assert.ok(
    (await call("fb:createTrip", { name: "  " })).error.includes("旅行名"),
  );
});

test("招待: members と相手の索引（userTrips）を同時に書く。重複・不正なアドレスは拒否", async () => {
  F.store["trips/T1/meta"] = {
    name: "箱根旅行",
    ownerEmail: "owner@example.com",
  };
  F.calls.length = 0;
  const r = await call("fb:inviteMember", {
    tripId: "T1",
    email: " Friend.One@Example.com ",
  });
  assert.ok(r.ok);
  const u = last("update")[2];
  assert.deepEqual(u["trips/T1/members/friend,one@example,com"], {
    email: "friend.one@example.com",
    role: "member",
    invitedAt: "TS",
  });
  assert.deepEqual(u["userTrips/friend,one@example,com/T1"], {
    name: "箱根旅行",
    ownerEmail: "owner@example.com",
    invitedAt: "TS",
  });
  F.store["trips/T1/members/dup@example,com"] = {};
  assert.ok(
    (
      await call("fb:inviteMember", { tripId: "T1", email: "dup@example.com" })
    ).error.includes("既に招待"),
  );
  assert.ok(
    !(
      await call("fb:inviteMember", {
        tripId: "T1",
        email: "bad#x@example.com",
      })
    ).ok,
  );
});

test("削除: 旅行本体と全メンバーの索引を null で消す。幹事自身の解除は不可", async () => {
  F.store["trips/T1/members"] = {
    "owner@example,com": {},
    "friend@example,com": {},
  };
  F.calls.length = 0;
  assert.ok((await call("fb:deleteTrip", { tripId: "T1" })).ok);
  assert.deepEqual(last("update")[2], {
    "trips/T1": null,
    "userTrips/owner@example,com/T1": null,
    "userTrips/friend@example,com/T1": null,
  });
  assert.ok(
    !(
      await call("fb:removeMember", {
        tripId: "T1",
        email: "owner@example.com",
      })
    ).ok,
  );
  assert.ok(
    (
      await call("fb:removeMember", {
        tripId: "T1",
        email: "friend@example.com",
      })
    ).ok,
  );
  assert.deepEqual(last("update")[2], {
    "trips/T1/members/friend@example,com": null,
    "userTrips/friend@example,com/T1": null,
  });
});

test("出欠・候補地点・投票・採用: 自分のキーの配下だけに書く", async () => {
  F.calls.length = 0;
  await call("fb:setAnswer", { tripId: "T1", dateId: "d1", v: 1 });
  assert.deepEqual(last("set").slice(1), [
    "trips/T1/answers/owner@example,com/d1",
    1,
  ]);
  await call("fb:setAnswer", { tripId: "T1", dateId: "d1", v: null });
  assert.equal(last("remove")[1], "trips/T1/answers/owner@example,com/d1");
  await call("fb:addPlace", {
    tripId: "T1",
    place: { name: "大涌谷", lat: "35.24", lng: 139.02 },
  });
  const p = last("set")[2];
  assert.deepEqual(p, {
    name: "大涌谷",
    lat: 35.24,
    lng: 139.02,
    addedBy: "owner@example,com",
    addedByName: "幹事さん",
    addedAt: "TS",
  });
  await call("fb:setVote", { tripId: "T1", placeId: "p1", on: true });
  assert.deepEqual(last("set").slice(1), [
    "trips/T1/votes/owner@example,com/p1",
    true,
  ]);
  await call("fb:setVote", { tripId: "T1", placeId: "p1", on: false });
  assert.equal(last("remove")[1], "trips/T1/votes/owner@example,com/p1");
  await call("fb:setAdopted", { tripId: "T1", placeId: "p1", on: true });
  assert.deepEqual(last("set").slice(1), ["trips/T1/adopted/p1", true]);
  await call("fb:addDate", { tripId: "T1", s: "2026-11-03", e: "2026-11-04" });
  assert.deepEqual(last("set")[2], {
    s: "2026-11-03",
    e: "2026-11-04",
    createdAt: "TS",
  });
});

test("サインアウトすると未サインイン状態を中継し、操作はエラーになる", async () => {
  await call("fb:signOut");
  assert.deepEqual(published["fb:auth"], { state: "signedOut" });
  assert.equal(published["fb:trip"], null);
  const r = await call("fb:setVote", { tripId: "T1", placeId: "p", on: true });
  assert.ok(!r.ok && r.error.includes("サインイン"));
});
