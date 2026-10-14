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
  reactions: { taken: {} },   // taken — всегда, даже без модуля «Реакции»
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

test("v1: card и client_id в /api/send доходят до хаба как есть — ответ на карточку и идемпотентность", () => {
  const send = { method: "POST", path: "/api/send", query: {},
                 body: { session: "hub", text: "Два.", card: "q12", client_id: "c47b8f2a-1_" } };
  assert.deepEqual(v1.request(send), send);
});

test("reactions: taken — всегда, даже с выключенным модулем; badges и значок сообщения — с включённым", () => {
  // модуль выключен (features без «reactions»): значков нет, taken остаётся — свёртка отвеченного не модуль (14.10)
  const off = snapshot();
  off.reactions = { taken: { hub: 12 } };
  assert.deepEqual(checkSnapshot(contract, v1, off), []);
  // хаб забрал taken вместе с модулем — нарушение договора, сверка называет
  const emptied = snapshot();
  emptied.reactions = {};
  assert.deepEqual(checkSnapshot(contract, v1, emptied), ["snapshot.reactions.taken: нет поля"]);
  const gone = snapshot();
  delete gone.reactions;
  assert.deepEqual(checkSnapshot(contract, v1, gone), ["snapshot.reactions: нет поля"]);
  const typed = snapshot();
  typed.reactions = { taken: { hub: "12" } };
  assert.deepEqual(checkSnapshot(contract, v1, typed), ["snapshot.reactions.taken.*: string вместо number"]);
  // модуль включён: значки ленты (badges, прежние места — ключ-номер события и messages[].reaction) на месте
  const on = snapshot();
  on.features = ["push", "reactions"];
  on.reactions = { "218545": "👍", badges: { m1: "👍" }, taken: { hub: 12 } };
  on.messages = { m1: { state: "queued", removable: true, reaction: "👍" } };
  assert.deepEqual(checkSnapshot(contract, v1, on), []);
  const badgeTyped = snapshot();
  badgeTyped.features = ["reactions"];
  badgeTyped.reactions = { badges: { m1: 7 }, taken: {} };
  assert.deepEqual(checkSnapshot(contract, v1, badgeTyped), ["snapshot.reactions.badges.*: number вместо string"]);
});

// ---- чьё сообщение: tools/watch.mjs и правило timeline ----
import { checkCalls, checkJournal, checkLive, checkReference, ownerRows } from "../tools/watch.mjs";

const ref = JSON.parse(fs.readFileSync(path.join(root, "tests", "reference", "hub.json"), "utf8"));
const none = { api: 1, rev: 0, snapshot: (x) => x, timeline: (x) => x, request: (x) => x };

test("эталон: словами владельца — только его сообщения; ответы и файлы на месте", () => {
  assert.deepEqual(checkReference(v1, ref, "hub"), []);
  const items = v1.timeline(structuredClone(ref.timeline)).items;
  assert.deepEqual(ownerRows(items).map((it) => it.id), ["m1", "m2", "m3", "m9"]);
  assert.deepEqual(items.filter((it) => ["m5", "m6", "m7", "m15"].includes(it.id)).map((it) => it.sender), ["hub", "плагин", "ядро", "watch"]);
  assert.equal(items.find((it) => it.id === "m11").sender, "report-maker");   // названный автор не меняется
  assert.deepEqual(v1.timeline({ epoch: "e", rev: 1 }), { epoch: "e", rev: 1 });
});

test("без правила сверка ловит служебное в роли владельца — на эталоне и на живой ленте", () => {
  const bad = checkReference(none, ref, "hub");
  assert.equal(bad.length, 4);
  assert.match(bad[0], /служебное сообщение m5 показано словами владельца/);
  const live = checkLive("hub", ref.timeline, ref.timeline);
  assert.equal(live.length, 4);
  assert.match(live[1], /m6 \(канал plugin\) показано словами владельца/);
  assert.deepEqual(checkLive("hub", ref.timeline, v1.timeline(structuredClone(ref.timeline))), []);
  // правило потеряло ответ или слово владельца — тоже расхождение
  const fixed = v1.timeline(structuredClone(ref.timeline));
  const lost = { ...fixed, items: fixed.items.filter((it) => it.k !== 4 && it.id !== "m1") };
  assert.deepEqual(checkLive("hub", ref.timeline, lost).slice(0, 2), ["hub: после правил строк 13 вместо 15", "hub: строк out после правил 1 вместо 2"]);
  assert.match(checkLive("hub", ref.timeline, lost)[2], /слово владельца m1 пропало/);
});

test("журнал против ленты: слово владельца на месте и его словами, чужое — нет", () => {
  const items = v1.timeline(structuredClone(ref.timeline)).items;
  const journal = [
    { id: "m1", session: "hub", owner: true, channel: "web", text: "Сделай отчёт" },
    { id: "m6", session: "hub", owner: false, channel: "plugin", text: "Новые входящие" },
    { id: "m9", session: "hub", owner: true, channel: "web", text: "Ответ на вопрос: Да" },
  ];
  const states = { m1: {}, m6: {}, m9: {}, m12: {} };
  assert.deepEqual(checkJournal(journal, { hub: items }, states), []);
  assert.match(checkJournal(journal, { hub: ref.timeline.items }, states)[0], /m6 \(канал plugin\) — не слова владельца/);
  const gone = items.filter((it) => it.id !== "m9");
  assert.match(checkJournal(journal, { hub: gone }, states)[0], /слова владельца m9 нет в ленте/);
  const foreign = items.map((it) => (it.id === "m1" ? { ...it, sender: "плагин" } : it));
  assert.match(checkJournal(journal, { hub: foreign }, states)[0], /слово владельца m1 показано как чужое/);
  // старше ленты или снято — не расхождение
  assert.deepEqual(checkJournal([{ id: "m0", session: "hub", owner: true, channel: "web" }], { hub: items }, { m0: {} }), []);
  assert.deepEqual(checkJournal([{ id: "m12", session: "hub", owner: true, channel: "web" }], { hub: items }, { m12: { state: "cancelled" } }), []);
  // остановленному исполнителю слово ушло тому, кто поднял: в его ленте его нет — не расхождение
  assert.deepEqual(checkJournal([{ id: "m9", session: "hub", owner: true, channel: "web", rerouted: true }], { hub: gone }, states), []);
});

test("вызовы клиентов: хаб не отвечает на запрос договора — расхождение; необязательное на этом хабе — нет", async () => {
  const snap = { sessions: [{ name: "hub", kind: "hub" }], extensions: [] };
  const seen = [];
  const ask = (dead) => async (url) => {
    seen.push(url);
    const p = new URL(url).pathname + new URL(url).search;
    if (dead.some((d) => p.startsWith(d))) return { code: 404, type: "application/json" };
    return { code: 200, type: p.startsWith("/api/stream") ? "text/event-stream" : "application/json" };
  };
  const quiet = await checkCalls("http://127.0.0.1:9", contract, v1, snap, ask([]));
  assert.deepEqual(quiet.filter((p) => p.startsWith("запрос клиента")), []);
  assert.ok(seen.includes("http://127.0.0.1:9/api/timeline?session=hub&since=0&epoch="));
  // холодный первый запрос после перезапуска web (хаб молчит) — не расхождение: один повтор; молчит и тогда — сообщаем
  let cold = new Set();
  const flaky = async (url) => (url.includes("/api/timeline") && !cold.has(url) ? (cold.add(url), { code: 0, type: "aborted" }) : ask([])(url));
  const warmed = await checkCalls("http://127.0.0.1:9", contract, v1, snap, flaky, 0);
  assert.deepEqual(warmed.filter((p) => p.includes("молчанием")), []);
  assert.ok(cold.size > 0);
  // под нагрузкой (load ~250) ответ дольше 8 с: повтор ждёт дольше первого запроса (RETRY_MS)
  const slow = async (url, ms = 8000) => (url.includes("/api/timeline") && ms < 20000 ? { code: 0, type: "aborted" } : ask([])(url));
  assert.deepEqual((await checkCalls("http://127.0.0.1:9", contract, v1, snap, slow, 0)).filter((p) => p.includes("молчанием")), []);
  const dead = async (url) => (url.includes("/api/timeline") ? { code: 0, type: "aborted" } : ask([])(url));
  assert.ok((await checkCalls("http://127.0.0.1:9", contract, v1, snap, dead, 0)).some((p) => p.includes("молчанием")));
  const bad = await checkCalls("http://127.0.0.1:9", contract, v1, snap, ask(["/api/flow", "/api/files"]));
  assert.deepEqual(bad.filter((p) => p.startsWith("запрос клиента")),
                   ["запрос клиента GET /api/flow: хаб отвечает 404", "запрос клиента GET /api/flow/history: хаб отвечает 404"]);
});
