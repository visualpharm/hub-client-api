// node --test tests/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkCore, checkSendAudit, checkSnapshot, checkSnippets, checkTimeline, loadRules } from "../tools/check.mjs";

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

test("reactions: taken — всегда; правила подкладывают его хабам до модуля «Реакции»", () => {
  // модуль выключен (features без «reactions»): значков нет, taken остаётся — свёртка отвеченного не модуль (14.10)
  const off = snapshot();
  off.reactions = { taken: { hub: 12 } };
  assert.deepEqual(checkSnapshot(contract, v1, off), []);
  // договор требует: без правил хаб без reactions/taken — расхождение, сверка называет
  const emptied = snapshot();
  emptied.reactions = {};
  assert.deepEqual(checkSnapshot(contract, none, emptied), ["snapshot.reactions.taken: нет поля"]);
  const gone = snapshot();
  delete gone.reactions;
  assert.deepEqual(checkSnapshot(contract, none, gone), ["snapshot.reactions: нет поля"]);
  // хаб до модуля не слал reactions вовсе, ранний — значки без свёртки: правила подкладывают пустую свёртку
  assert.deepEqual(v1.snapshot(gone).reactions, { taken: {} });
  assert.deepEqual(checkSnapshot(contract, v1, gone), []);
  const early = snapshot();
  early.reactions = { badges: { m1: "👍" } };
  assert.deepEqual(checkSnapshot(contract, v1, early), []);
  // свой taken правило не трогает — неверный тип остаётся расхождением
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
import { checkCalls, checkJournal, checkLive, checkReference, fetches, journalEvents, journalMessages, messagesOf, ownerRows, pageCalls } from "../tools/watch.mjs";
import os from "node:os";

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
    { id: "m9", session: "hub", owner: true, channel: "web", text: "Ответ на вопрос: Да", took: ["hub"] },
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

test("сниппеты: ответ хаба — в виде договора; без обязательного поля сверка называет его", () => {
  const set = () => ({
    items: [{ id: "summary", title: "Сводка", text: "Сводка коротко", origin: "default", pinned: true, added: null },
            { id: "a1", title: "Идея", text: "Запрос", origin: "auto", pinned: false, added: 5 }],
    auto: { enabled: false, count: 2, last_run: null },
    brand_new: 1,
  });
  assert.deepEqual(checkSnippets(contract, set()), []);
  const bad = set();
  delete bad.items[1].pinned;
  delete bad.items[0].id;
  delete bad.auto.count;
  assert.deepEqual(checkSnippets(contract, bad), ["snippets.items[].id: нет поля (string)", "snippets.items[].pinned: нет поля (boolean)",
                                                  "snippets.auto.count: нет поля (number)"]);
  const none = set();
  delete none.auto;
  assert.deepEqual(checkSnippets(contract, none), ["snippets.auto: нет поля"]);
});

test("сниппеты и настройки: пути запросов — необязательные, привязаны к feature snippets; снимок со строками настроек проходит", () => {
  for (const [method, path] of [["GET", "/api/snippets"], ["POST", "/api/snippets"], ["POST", "/api/settings/set"]]) {
    const r = contract.requests.find((x) => x.method === method && x.path === path);
    assert.ok(r, `${method} ${path} есть в договоре`);
    assert.equal(r.optional, true);
    assert.equal(r.feature, "snippets");
  }
  const s = { ...snapshot(), features: ["push", "snippets"],
              settings: [{ key: "snippets.auto", kind: "bool", value: false, group: "Сниппеты", label: "x" },
                         { key: "snippets.count", kind: "num", value: 2, group: "Сниппеты", min: 0, max: 5 }] };
  assert.deepEqual(checkSnapshot(contract, v1, s), []);
  s.settings[1].value = 2;
  delete s.settings[0].key;
  assert.deepEqual(checkSnapshot(contract, v1, s), ["snapshot.settings[].key: нет поля (string)"]);
});

test("каталог моделей: tier необязателен (старое ядро без него — в виде договора); число в слое — да, текст — нет", () => {
  const s = snapshot();
  s.sessions[0].model_effective = "opus";
  s.models = [{ id: "haiku", title: "Haiku 5.5", vendor: "anthropic", rank: 3, tier: 2 }, { id: "glm", title: "GLM 5.3", vendor: "zai", rank: 0 },
              { id: "default", title: "Default", vendor: null, rank: 99 }];
  assert.deepEqual(checkSnapshot(contract, v1, s), []);
  s.models[0].tier = "2";
  assert.deepEqual(checkSnapshot(contract, v1, s), ["snapshot.models[].tier: string вместо number"]);
  assert.deepEqual(v1.snapshot({ ...snapshot(), models: [{ id: "opus", tier: 6 }] }).models, [{ id: "opus", tier: 6 }]);   // правила поле не трогают
});

test("аккаунты расхода, hints_seen и новые пути: все необязательны; снимок без них и с ними проходит", () => {
  for (const [path, feature] of [["/api/hints/seen", "hints"], ["/api/todo/undone", "todo.undone"]]) {
    const r = contract.requests.find((x) => x.method === "POST" && x.path === path);
    assert.ok(r, `${path} есть в договоре`);
    assert.equal(r.optional, true);
    assert.equal(r.feature, feature);
  }
  assert.deepEqual(checkSnapshot(contract, v1, snapshot()), []);
  const s = { ...snapshot(), hints_seen: ["a"], accounts: { pool: [{ name: "x" }], on: true, switch_at: 0.95 },
              account: { active: "x", seen: { x: { status: "allowed", provider: "claude", ts: 1, windows: { five_hour: { used: 0.3, unit: "fraction", resets: 5 } } } } } };
  assert.deepEqual(checkSnapshot(contract, v1, s), []);
  s.accounts.pool[0] = {};
  s.hints_seen = [1];
  assert.deepEqual(checkSnapshot(contract, v1, s), ["snapshot.accounts.pool[].name: нет поля (string)", "snapshot.hints_seen[]: number вместо string"]);
});

test("sidebar_hidden, space_bookmarks, quote у строки и их пути: необязательны; есть и нет — проходит", () => {
  for (const [path, feature] of [["/api/sidebar/hidden", "sidebar.hidden"], ["/api/space/bookmarks", "space.bookmarks"],
                                 ["/api/space/bookmarks/remove", "space.bookmarks"], ["/api/space/open", "space.bookmarks"]]) {
    const r = contract.requests.find((x) => x.method === "POST" && x.path === path);
    assert.ok(r, `${path} есть в договоре`);
    assert.equal(r.optional, true);
    assert.equal(r.feature, feature);
  }
  assert.deepEqual(checkSnapshot(contract, v1, snapshot()), []);
  const s = { ...snapshot(), sidebar_hidden: ["files"],
              space_bookmarks: [{ id: "b1", title: "Док", url: "https://x.y", icon: "doc", opened_at: 5, opens: 2, added_at: 1 }] };
  assert.deepEqual(checkSnapshot(contract, v1, s), []);
  s.sidebar_hidden = [1];
  s.space_bookmarks[0] = { id: "b1", opens: "2" };
  assert.deepEqual(checkSnapshot(contract, v1, s), ["snapshot.sidebar_hidden[]: number вместо string",
    "snapshot.space_bookmarks[].url: нет поля (string)", "snapshot.space_bookmarks[].opens: string вместо number"]);
  const t = timeline();
  t.items[0].quote = "цитата";
  assert.deepEqual(checkTimeline(contract, v1, t), []);
  t.items[0].quote = 5;
  assert.deepEqual(checkTimeline(contract, v1, t), ["timeline.items[in].quote: number вместо string"]);
});

test("поле из absent — не дефект ядра без него (notes нет в flagman v1.1.3), остальные поля сверяются", () => {
  const dir = fs.mkdtempSync(path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "core-")), ""));
  fs.mkdirSync(path.join(dir, "modules", "web"), { recursive: true });
  fs.writeFileSync(path.join(dir, "modules", "web", "server.py"), 'P = ("/api/answer", "session", "request_id")\n');
  const one = { ...contract, requests: contract.requests.filter((r) => r.path === "/api/answer") };
  const out = checkCore(one, v1, dir);
  assert.ok(!out.some((x) => x.includes("notes")), out.join("; "));
  assert.ok(out.some((x) => x.includes("answers")), "обязательное поле answers по-прежнему сверяется");
});

// ---- доставка по журналу: ядро отдало слово другой сессии, ротация журнала, настоящая потеря ----
const ev = (seq, type, entity, data, ts = 1792484000 + seq / 1000) => ({ seq, ts, src: "core", type, entity, data });
const said = (seq, to, extra = {}) => ev(seq, "message.received", null, { to, text: "слово " + seq, channel: "web", owner: true, ...extra });

test("журнал: слово спящему исполнителю ядро отдало тому, кто его поднял — не расхождение (m607245, m611723)", () => {
  const events = [
    said(607245, "inbox-wa-group-tour"),
    ev(607246, "host.done", "hub-dev", { do: "type", message: "m607245", attempt: 1, result: "sent" }),
    ev(607247, "turn.started", "hub-dev", { marker: "m607245" }),
    said(611723, "procurement", { quote: "Открой чат", todo: "t:1" }),
    ev(611724, "host.done", "hub-core", { do: "type", message: "m611723", attempt: 1, result: "sent" }),
    ev(611726, "turn.started", "hub-core", { marker: "m611723" }),
  ];
  const msgs = messagesOf(events);
  assert.deepEqual(msgs.map((m) => [m.id, m.took]), [["m607245", ["hub-dev"]], ["m611723", ["hub-core"]]]);
  // ленты адресатов доходят до этих сообщений, но их там нет — ядро показало слово у другой сессии
  const lines = { "inbox-wa-group-tour": [{ kind: "out", seq: 600000 }], procurement: [{ kind: "out", seq: 600000 }],
                  "hub-dev": [], "hub-core": [] };
  const states = { m607245: { state: "delivered" }, m611723: { state: "delivered" } };
  assert.deepEqual(checkJournal(msgs, lines, states), []);
});

test("журнал: настоящая потеря — принято, никому не отдано и нет в ленте; доставлено адресату, а в ленте нет", () => {
  const events = [
    said(700001, "procurement"),                                         // принято и потеряно
    said(700002, "procurement"),                                         // ещё в очереди спящей сессии
    said(700003, "procurement"),                                         // ход его взял, лента его потеряла
    ev(700004, "turn.started", "procurement", { marker: "m700099", also: ["m700003"] }),
    said(700005, "procurement"),                                         // ход взял и лента показывает
    ev(700006, "turn.started", "procurement", { marker: "m700005" }),
  ];
  const lines = { procurement: [{ kind: "out", seq: 690000 }, { kind: "in", id: "m700005", seq: 700005 }] };
  const states = { m700001: { state: "failed" }, m700002: { state: "queued" }, m700003: { state: "delivered" }, m700005: { state: "delivered" } };
  const out = checkJournal(messagesOf(events), lines, states);
  assert.equal(out.length, 2);
  assert.match(out[0], /procurement: слово владельца m700001 принято ядром, но не доставлено \(failed\) и нет в ленте/);
  assert.match(out[1], /procurement: слова владельца m700003 нет в ленте/);
});

test("журнал после ротации: ход с маркером остался только в архиве — доставка находится", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-journal-"));
  fs.mkdirSync(path.join(dir, "journal-archive"));
  const now = 1792490000;
  const line = (e) => JSON.stringify(e) + "\n";
  // архив: всё до ротации; журнал: выборка прежних событий (слово осталось, ход — нет) и новое после ротации
  fs.writeFileSync(path.join(dir, "journal-archive", "journal-1-607300.jsonl"),
    [ev(1, "core.snapshot", null, {}, now - 90000), said(607245, "inbox-wa-group-tour"), ev(607247, "turn.started", "hub-dev", { marker: "m607245" })]
      .map((e) => line({ ...e, ts: e.seq === 1 ? e.ts : now - 7000 + e.seq / 1e6 })).join(""));
  fs.writeFileSync(path.join(dir, "journal.jsonl"),
    [ev(1, "core.snapshot", null, {}, now - 90000), { ...said(607245, "inbox-wa-group-tour"), ts: now - 7000 },
     ev(607301, "core.snapshot", null, { why: "rotate" }, now - 3000), { ...said(607400, "hub"), ts: now - 100 }].map(line).join(""));
  const msgs = journalMessages(path.join(dir, "journal.jsonl"), 3, now);
  assert.deepEqual(msgs.map((m) => [m.id, m.took]), [["m607245", ["hub-dev"]], ["m607400", []]]);
  // мелкие куски чтения: строки на стыке кусков не теряются
  for (const f of [path.join(dir, "journal.jsonl"), path.join(dir, "journal-archive", "journal-1-607300.jsonl")]) {
    assert.deepEqual(journalEvents(f, now - 3 * 3600, 37), journalEvents(f, now - 3 * 3600));
  }
  fs.rmSync(dir, { recursive: true });
});

test("запросы страницы: POST не пробуется GET-ом — путь ищется в коде хаба; без --core не судим", () => {
  const src = `post("/api/x"); fetch("/api/hold", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab }) }); fetch(\`/api/flow?since=\${last}\`).then(r => r.json()); fetch("/api/usage", { headers: { "X-Hub": "1" } });`;
  assert.deepEqual(fetches(src), [{ url: "/api/hold", method: "POST" }, { url: "/api/flow?since=0", method: "GET" }, { url: "/api/usage", method: "GET" }]);
  assert.deepEqual(pageCalls("страница", src, ['if path == "/api/hold":']), { gets: ["/api/flow?since=0", "/api/usage"], missing: [] });
  assert.deepEqual(pageCalls("страница", src, ["нет его"]).missing, ["страница: запрос POST /api/hold — пути нет в коде хаба"]);
  assert.deepEqual(pageCalls("страница", src).missing, []);
});

test("журнал: до последней ротации живая лента держит лишь выборку — слова адресату оттуда не потеря; после — сверяем", () => {
  // m608937 и др. (20.10): доставлены hub-core, журнал ротирован на 613433, в живой ленте хвост 534700…613620 без них
  const events = [
    said(608937, "hub-core"), ev(608939, "turn.started", "hub-core", { marker: "m608937" }),
    ev(613433, "core.snapshot", null, { why: "rotate" }),
    said(613500, "hub-core"), ev(613502, "turn.started", "hub-core", { marker: "m613500" }),
  ];
  const lines = { "hub-core": [{ kind: "in", id: "m534700", seq: 534700, sender: "ядро" }, { kind: "out", seq: 613620 }] };
  const msgs = messagesOf(events);
  assert.deepEqual(msgs.map((m) => [m.id, m.fed]), [["m608937", false], ["m613500", true]]);
  const out = checkJournal(msgs, lines, { m608937: { state: "delivered" }, m613500: { state: "delivered" } });
  assert.equal(out.length, 1);
  assert.match(out[0], /hub-core: слова владельца m613500 нет в ленте/);
});

test("сверка отправок: запрос — необязательный, по feature send.audit, только владелец; ответ и ключ снимка — в виде договора", () => {
  const r = contract.requests.find((x) => x.method === "POST" && x.path === "/api/send/audit");
  assert.ok(r, "POST /api/send/audit есть в договоре");
  assert.equal(r.optional, true);
  assert.equal(r.feature, "send.audit");
  assert.equal(r.owner, true);
  assert.deepEqual(r.body, ["client", "sent", "unconfirmed"]);
  const answer = () => ({ ok: true, confirmed: ["A1B2C3D4"], seq: { A1B2C3D4: 608937 }, missing: ["E5F6A7B8"],
                          rejected: [{ client_id: "C9D0E1F2", seq: 12, reason: "сессия закрыта" }], pending: [], too_old: [] });
  assert.deepEqual(checkSendAudit(contract, answer()), []);
  const bad = answer();
  delete bad.missing;
  delete bad.rejected[0].client_id;
  assert.deepEqual(checkSendAudit(contract, bad), ["send_audit.missing: нет поля", "send_audit.rejected[].client_id: нет поля (string)"]);
  const s = { ...snapshot(), features: ["push", "send.audit"],
              send_audit: { since: 1, checked: 3, missing_total: 1, missing_open: 1, rejected_total: 0, late_total: 0,
                            last_missing: [{ client_id: "E5F6A7B8", ts: 2, client: "ios 1.80", to: "hub" }],
                            clients_without_id: { web: 3 }, clients_with_id: { web: 131 }, window: 86400 } };
  assert.deepEqual(checkSnapshot(contract, v1, s), []);
  delete s.send_audit.last_missing[0].client_id;
  assert.deepEqual(checkSnapshot(contract, v1, s), ["snapshot.send_audit.last_missing[].client_id: нет поля (string)"]);
});
