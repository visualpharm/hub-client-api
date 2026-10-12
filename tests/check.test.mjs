// node --test tests/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkSnapshot, checkTimeline, loadRules } from "../tools/check.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contract", "v1.json"), "utf8"));
const v1 = loadRules(path.join(root, "v1.js"));
const future = loadRules(path.join(root, "tests", "future-v1.js"));

const snapshot = () => ({
  seq: 7, epoch: "e1", version: "abc", timeline_rev: { hub: 3 },
  sessions: [{ name: "hub", kind: "hub", state: "idle", since: 5, recap: { text: "Готово", ts: 6 },
               pending: [{ request_id: "r1", tool: "AskUserQuestion", input: { questions: [] } }] }],
  messages: { m1: { state: "queued", removable: true } },
  schedule: [{ id: "j1", state: "active", next: 100, prompt: "Проверь почту" }],
  limits: { windows: { five_hour: { used: 0.4, resets: 200 } } },
  extensions: [{ name: "flow", main: "main.js" }], features: ["push"], owner: { lang: "ru" },
});
const timeline = () => ({
  epoch: "e1", rev: 3, full: true,
  items: [{ k: 1, seq: 1, ts: 1, kind: "in", id: "m1", text: "Привет", attachments: [] },
          { k: 2, seq: 2, ts: 2, kind: "out", text: "Здравствуйте" },
          { k: 3, seq: 3, ts: 3, kind: "later-kind", anything: 1 }],
});

test("нынешний хаб — в виде договора; новые поля и виды строк клиенту не мешают", () => {
  assert.deepEqual(checkSnapshot(contract, v1, { ...snapshot(), brand_new: 1 }), []);
  assert.deepEqual(checkTimeline(contract, v1, timeline()), []);
});

test("хаб переименовал или сменил тип поля — сверка называет, какое", () => {
  const s = snapshot();
  s.fleet = s.sessions.map(({ state, ...x }) => ({ ...x, status: state }));
  delete s.sessions;
  assert.deepEqual(checkSnapshot(contract, v1, s), ["snapshot.sessions: нет поля"]);
  const typed = snapshot();
  typed.sessions[0].since = "5";
  typed.messages.m1.removable = "yes";
  assert.deepEqual(checkSnapshot(contract, v1, typed),
                   ["snapshot.sessions[].since: string вместо number", "snapshot.messages.*.removable: string вместо boolean"]);
  const t = timeline();
  t.items[0] = { k: 1, kind: "in", text: "Привет" };
  delete t.rev;
  assert.deepEqual(checkTimeline(contract, v1, t), ["timeline.rev: нет поля (number)", "timeline.items[in].id: нет поля (string)"]);
});

test("правила возвращают изменённый хаб к виду версии 1", () => {
  const s = snapshot();
  s.fleet = s.sessions.map(({ state, ...x }) => ({ ...x, status: state }));
  delete s.sessions;
  const t = timeline();
  t.rows = t.items.map(({ kind, ...x }) => ({ ...x, type: kind }));
  delete t.items;
  assert.deepEqual(checkSnapshot(contract, future, s), []);
  assert.deepEqual(future.snapshot(s).sessions[0].state, "idle");
  assert.deepEqual(checkTimeline(contract, future, t), []);
  assert.deepEqual(future.request({ method: "GET", path: "/api/timeline", query: { session: "hub", since: "0" } }),
                   { method: "GET", path: "/api/lines", query: { since: "0", name: "hub" } });
  // те же правила на прежнем хабе ничего не портят
  assert.deepEqual(future.snapshot(snapshot()).sessions, snapshot().sessions);
});

test("v1: поле correction клиента до хаба не доходит, остальное — как есть", () => {
  const send = { method: "POST", path: "/api/send", query: {}, body: { session: "hub", text: "Два.", correction: true, quote: "Один" } };
  assert.deepEqual(v1.request(send).body, { session: "hub", text: "Два.", quote: "Один" });
  const answer = { method: "POST", path: "/api/answer", query: {}, body: { session: "hub", request_id: "r1", answers: {} } };
  assert.deepEqual(v1.request(answer), answer);
  assert.equal(v1.api, 1);
});
