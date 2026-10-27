#!/usr/bin/env node
// Постоянная сверка: то, что клиенты получают от хаба через правила, — правда?
//   node tools/watch.mjs --hub http://127.0.0.1:8787 [--journal <журнал хаба>] [--hours 6] [--rules <файл>]
//                        [--state <файл>] [--tell "<команда>"]
// Правила берутся с самого хаба (/ext/<…client-api>/v<N>.js) — те же, что у клиентов; --rules — из файла.
// Смотрит: 1) эталонные ленты (tests/reference) — слова владельца ровно те, что названы, ответы и файлы на месте;
// 2) живые ленты сессий — правила не теряют строк, ответов и файлов; словами владельца показано только пришедшее
// его каналами; 3) с --journal — по журналу хаба (и его архивам за окно): каждое слово владельца за --hours дошло до
// сессии, а доставленное адресату после последней ротации есть в его ленте его словами (ядро отдало слово другой
// сессии — с лентой адресата не сверяем); ни одно чужое сообщение (ядро, плагины, расписание, сессии) не показано
// его словами.
// 4) каждый вызов клиентов: запросы договора и то, что просят страницы разделов внутри приложений (поток страницы,
// модули плагинов, их запросы данных) — отвечает ли живой хаб; с --core <папка> (можно несколько: новый и прежний
// код хаба) — есть ли пути в коде.
// Норма — молчит, код 0. Расхождение — список в вывод, код 1; с --tell команда получает его аргументом, один раз
// на одно и то же расхождение (--state помнит, о чём уже сказано).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCore, coreCode, loadRules } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// Голосовое владельца с клиента отправляет модуль hubbahub-voice-own, правку текста его сообщения — модуль edit-message:
// owner:true, канал модуля. Другие mod:* — не владелец.
const OWNER_CHANNELS = ["web", "cli", "telegram", "mod:hubbahub-voice-own", "mod:edit-message"];

// Виды автора поля from (ядро, API 1.26), которые не владелец: такая строка служебная, каким бы каналом ни пришла
const NOT_OWNER = ["core", "hub", "schedule", "session", "module", "plugin"];
const fromKind = (it) => (it.from && typeof it.from === "object" ? it.from.kind : null);
/** Почему строка in не слово владельца (до правил): адресат, автор по полю from, канал; null — слово владельца. */
export function notOwner(it) {
  if (it.to) return "поручение для " + it.to;
  const kind = fromKind(it);
  if (NOT_OWNER.includes(kind)) return "от " + kind;
  if (kind === "owner") return null;
  return it.channel && !OWNER_CHANNELS.includes(it.channel) ? "канал " + it.channel : null;
}

/** Слова владельца, как их видит клиент версии 1: входящая строка без автора. */
export const ownerRows = (items) => items.filter((it) => it.kind === "in" && !it.sender);
const count = (items, kind) => items.filter((it) => it.kind === kind).length;
const cut = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 70);

export function checkReference(rules, ref, name) {
  const out = [];
  const items = rules.timeline(structuredClone(ref.timeline)).items || [];
  const got = ownerRows(items).map((it) => it.id);
  for (const id of ref.owner) if (!got.includes(id)) out.push(`эталон ${name}: слово владельца ${id} не показано его словами`);
  for (const id of got) if (!ref.owner.includes(id)) out.push(`эталон ${name}: служебное сообщение ${id} показано словами владельца`);
  for (const [kind, n] of Object.entries(ref.visible)) {
    if (count(items, kind) !== n) out.push(`эталон ${name}: строк ${kind} ${count(items, kind)} вместо ${n}`);
  }
  return out;
}

/** Живая лента сессии: до правил и после. */
export function checkLive(name, raw, adapted) {
  const out = [];
  const before = raw.items || [], after = adapted.items || [];
  if (after.length !== before.length) out.push(`${name}: после правил строк ${after.length} вместо ${before.length}`);
  for (const kind of ["out", "reply", "file", "ask", "answer"]) {
    if (count(after, kind) !== count(before, kind)) out.push(`${name}: строк ${kind} после правил ${count(after, kind)} вместо ${count(before, kind)}`);
  }
  for (const it of ownerRows(after)) {
    const why = notOwner(it);
    if (why) out.push(`${name}: ${it.id} (${why}) показано словами владельца: «${cut(it.text)}»`);
  }
  for (const it of before) {
    if (it.kind === "in" && !it.sender && !notOwner(it) && (fromKind(it) === "owner" || OWNER_CHANNELS.includes(it.channel))
        && !ownerRows(after).some((x) => x.id === it.id)) out.push(`${name}: слово владельца ${it.id} пропало: «${cut(it.text)}»`);
  }
  return out;
}

const WANT = ['"message.received"', '"session.stop_requested"', '"turn.started"', '"host.done"'];
const TS = /^\{"seq":(\d+),"ts":([\d.]+)/;

/** События журнала с ts не раньше since: файл читается с конца кусками, пока не встретится строка старше since.
 *  После ротации ядро оставляет в журнале выборку прежних событий (по порядку seq) — их время тоже растёт. */
export function journalEvents(file, since, chunk = 8 * 1024 * 1024) {
  const fd = fs.openSync(file, "r");
  const out = [];
  try {
    let pos = fs.fstatSync(fd).size, rest = Buffer.alloc(0), older = false;
    while (pos > 0 && !older) {
      const n = Math.min(chunk, pos);
      pos -= n;
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, pos);
      const all = Buffer.concat([buf, rest]);
      let start = 0;
      if (pos > 0) {   // первая строка куска может быть неполной — дочитается со следующим куском
        start = all.indexOf(10) + 1;
        if (start === 0) { rest = all; continue; }
      }
      rest = all.subarray(0, start);
      for (const line of all.subarray(start).toString("utf8").split("\n")) {
        const ts = TS.exec(line);
        if (!ts) continue;
        if (Number(ts[2]) < since) { older = true; continue; }
        // снимок ядра — строка на мегабайты: нужны только номер и причина (ротация)
        if (line.includes('"type":"core.snapshot"')) {
          const why = /"data":\{"why":"([\w-]+)"/.exec(line.slice(0, 400));
          out.push({ seq: Number(ts[1]), ts: Number(ts[2]), type: "core.snapshot", data: { why: why && why[1] } });
          continue;
        }
        if (!WANT.some((w) => line.includes(w))) continue;
        try { out.push(JSON.parse(line)); } catch { /* строка, которую пишут прямо сейчас */ }
      }
    }
  } finally { fs.closeSync(fd); }
  return out.sort((x, y) => x.seq - y.seq);
}

/** Журнал хаба и его архивы (папка journal-archive рядом): ядро ротирует журнал, события окна лежат в архивах,
 *  изменённых не раньше начала окна, и в самом журнале. Без повторов, по порядку seq. */
export function journalWindow(file, since) {
  const dir = path.join(path.dirname(file), "journal-archive");
  const archives = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).mtimeMs / 1000 >= since) : [];
  const seen = new Map();
  for (const f of [...archives, file]) for (const ev of journalEvents(f, since)) seen.set(ev.seq, ev);
  return [...seen.values()].sort((x, y) => x.seq - y.seq);
}

/** Слова из журнала за последние часы: {id, session, owner, channel, text, took, rerouted, fed}.
 *  took — сессии, которым ядро сообщение отдало (ход с его маркером, набор в сессию); fed — пришло после последней
 *  ротации журнала: живая лента держит такие подряд. Раньше ротации в ней только выборка прежних событий (история
 *  сессии — в архиве, «Показать раньше»), отсутствие там слова потерей не считается. */
export function journalMessages(file, hours, now = Date.now() / 1000) {
  return messagesOf(journalWindow(file, now - hours * 3600));
}

const mid = (m) => (/^m\d+/.exec(String(m || "")) || [""])[0];

export function messagesOf(events) {
  const out = [], stopped = new Map(), took = new Map();   // сессия → номер последней остановки; mN → сессии доставки
  let rotated = 0;   // номер последней ротации журнала
  const give = (id, who) => { if (id && who) took.set(id, new Set([...(took.get(id) || []), who])); };
  for (const ev of events) {
    const d = ev.data || {};
    if (ev.type === "session.stop_requested") stopped.set(ev.entity, ev.seq);
    else if (ev.type === "core.snapshot") { if (d.why === "rotate") rotated = Math.max(rotated, ev.seq); }
    else if (ev.type === "turn.started") for (const m of [d.marker, ...(d.also || [])]) give(mid(m), ev.entity);
    else if (ev.type === "host.done" && d.do === "type" && ["sent", "already sent"].includes(d.result)) give(mid(d.message), ev.entity);
    else if (ev.type === "message.received") {
      // silent: служебный запрос от имени владельца (ответ на снятую карточку) — ядро нарочно не кладёт его в ленту
      out.push({ id: `m${ev.seq}`, session: d.to, channel: d.channel || ev.src,
                 owner: d.owner === true && d.silent !== true && OWNER_CHANNELS.includes(d.channel), text: d.text });
    }
  }
  for (const m of out) {
    m.took = [...(took.get(m.id) || [])];
    m.fed = ev0(m) > rotated;
    // исполнителя остановили позже — его очередь ядро отдало тому, кто поднял: слово владельца ушло в ленту другой сессии
    m.rerouted = (stopped.get(m.session) || 0) > ev0(m);
  }
  return out;
}

const ev0 = (m) => Number(m.id.slice(1));
const MOVING = ["queued", "ready", "typing", "aside"];   // ещё в пути к сессии — не потеря

/** Журнал против лент после правил: lines — {сессия: строки после правил}, states — состояния сообщений снимка. */
export function checkJournal(messages, lines, states = {}) {
  const out = [];
  const shown = new Map();   // id → строки лент с этим сообщением
  for (const [name, items] of Object.entries(lines)) {
    for (const it of items) if (it.kind === "in" && it.id) shown.set(it.id, [...(shown.get(it.id) || []), { ...it, session: name }]);
  }
  for (const m of messages) {
    const rows = shown.get(m.id) || [];
    const mine = rows.filter((r) => !r.sender);
    if (!m.owner) {
      for (const r of mine) out.push(`${r.session}: ${m.id} (канал ${m.channel}) — не слова владельца, а показано его словами: «${cut(m.text)}»`);
      continue;
    }
    const state = (states[m.id] || {}).state;
    if (!rows.length) {
      const took = m.took || [];
      // ядро отдало слово другой сессии (спящий исполнитель → тот, кто его поднял): с лентой адресата не сверяем
      if (m.rerouted || (took.length && !took.includes(m.session))) continue;
      if (["cancelled", "removed"].includes(state)) continue;
      if (!took.length) {
        // ни одна сессия его не взяла и ни одна лента не показывает — настоящая потеря (в пути — ещё нет)
        if (state && !MOVING.includes(state)) out.push(`${m.session}: слово владельца ${m.id} принято ядром, но не доставлено (${state}) и нет в ленте: «${cut(m.text)}»`);
        continue;
      }
      // доставлено адресату — в его ленте должно быть, если живая лента держит это место (после ротации, в хвосте)
      if (m.fed === false) continue;
      const items = lines[m.session];
      const oldest = items && items.length ? Math.min(...items.map((it) => Number(it.seq) || Infinity)) : Infinity;
      if (items && ev0(m) > oldest) out.push(`${m.session}: слова владельца ${m.id} нет в ленте: «${cut(m.text)}»`);
    } else if (!mine.some((r) => !r.to)) {
      out.push(`${m.session}: слово владельца ${m.id} показано как чужое: «${cut(m.text)}»`);
    }
  }
  return out;
}

/** Временный отказ хаба: 502/503/504 (под нагрузкой машины лента не укладывается в срок сервера — 503, повтор через
 *  секунды отвечает) и сетевой сбой (хаб перезапускается). До двух повторов с паузой; молчит и тогда — расхождение.
 *  Retry-After хаба (1 с) — нижняя граница сверх паузы: повтор через секунду под той же нагрузкой снова 503. */
const BUSY = [502, 503, 504];
export const RETRIES = 2, PAUSE_MS = 15000, NET_PAUSE_MS = 20000, MAX_PAUSE_MS = 60000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export function pauseFor(retryAfter, base = PAUSE_MS) {
  const sec = Number(retryAfter);
  const asked = Number.isFinite(sec) && String(retryAfter).trim() !== "" ? sec * 1000 : Date.parse(retryAfter) - Date.now();
  return Math.min(MAX_PAUSE_MS, Math.max(base, Number.isFinite(asked) ? asked : 0));
}

/** Отвечает ли адрес: код и тип; поток — только заголовки (тело не ждём). */
export async function probe(url, ms = 8000) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "X-Hub": "1", "X-Hub-Api": "1" }, signal: stop.signal });
    // 404 бывает и у живого пути («нет такой сессии»): пути нет — только когда хаб так и говорит
    const lost = r.status === 404 ? (await r.text()).includes("нет такой страницы") : false;
    return { code: r.status, type: r.headers.get("content-type") || "", lost, retryAfter: r.headers.get("retry-after") };
  } catch (e) {
    return { code: 0, type: String(e.message) };
  } finally {
    clearTimeout(timer); stop.abort();
  }
}

/** Каждый вызов клиентов против живого хаба: запросы договора (после правила request) и то, что просят страницы
 *  разделов, открытые внутри приложений (страница хаба, её поток, модули плагинов и их запросы данных). */
/** Молчание хаба и 502/503/504 — ещё не расхождение: после перезапуска web первый запрос холодный (история потока —
 *  до 30 с), под нагрузкой ответ не укладывается в срок (хаб сам отвечает 503). До двух повторов через паузу (как у
 *  get: Retry-After — не короче паузы, до 60 с); повтор после молчания ждёт ответа дольше. Не ответил и тогда — сообщаем. */
const RETRY_MS = 30000;   // повтор ждёт дольше: под нагрузкой машины (14.10, load ~250) живой хаб отвечал за 10–17 с
export const patient = (ask, pause = PAUSE_MS, wait = sleep) => async (url) => {
  let got = await ask(url);
  for (let left = RETRIES; left > 0 && (got.code === 0 || BUSY.includes(got.code)); left--) {
    await wait(got.code === 0 ? pause : pauseFor(got.retryAfter, pause));
    got = await ask(url, RETRY_MS);
  }
  return got;
};

/** Вызовы fetch к /api/ в исходнике страницы: адрес (подстановки ${…} — нулём) и метод из второго аргумента. */
export function fetches(src) {
  const out = new Map();
  for (const m of src.matchAll(/fetch\(\s*["'`](\/api\/[^"'`]+)["'`]\s*(,\s*\{)?/g)) {
    let method = "GET";
    if (m[2]) {   // объект параметров — до парной скобки (внутри бывают headers: {…})
      let depth = 0, i = m.index + m[0].length - 1, end = i;
      for (; end < src.length; end++) {
        if (src[end] === "{") depth++;
        else if (src[end] === "}" && --depth === 0) break;
      }
      const verb = /method\s*:\s*["'`](\w+)["'`]/.exec(src.slice(i, end));
      if (verb) method = verb[1].toUpperCase();
    }
    const url = m[1].replace(/\$\{[^}]*\}/g, "0");
    out.set(`${method} ${url}`, { url, method });
  }
  return [...out.values()];
}

/** Запросы страницы раздела: GET — пробой живого хаба (адреса gets); POST и прочее пробой не проверить — хаб разбирает
 *  тело раньше пути, настоящий запрос изменит состояние, а GET такого пути — «нет такой страницы» и у живого.
 *  Их путь ищем в коде хаба (code — тексты --core, хватит одного); без --core не судим. */
export function pageCalls(who, src, code = []) {
  const gets = [], missing = [];
  for (const { url, method } of fetches(src)) {
    if (method === "GET") { gets.push(url); continue; }
    const bare = url.split("?")[0];
    if (code.length && !code.some((c) => c.includes(`"${bare}`))) missing.push(`${who}: запрос ${method} ${bare} — пути нет в коде хаба`);
  }
  return { gets, missing };
}

export async function checkCalls(base, contract, rules, snap, ask0 = probe, pause = PAUSE_MS, code = []) {
  const ask = patient(ask0, pause);
  const out = [];
  const hub = ((snap.sessions || []).find((s) => s.kind === "hub") || {}).name || "";
  for (const r of contract.requests.filter((r) => r.method === "GET" && (r.stream || r.probe !== undefined))) {
    const query = Object.fromEntries(new URLSearchParams((r.probe || "").replace("{hub}", hub)));
    const to = rules.request({ method: "GET", path: r.path, query });
    const qs = new URLSearchParams(to.query || {}).toString();
    const got = await ask(`${base}${to.path}${qs ? "?" + qs : ""}`);
    if (got.code === 404 && r.optional) continue;
    if (got.code !== 200) out.push(`запрос клиента GET ${r.path}: хаб отвечает ${got.code || "молчанием"}`);
    else if (r.stream && !got.type.includes("text/event-stream")) out.push(`запрос клиента GET ${r.path}: не поток событий (${got.type})`);
  }
  // страницы разделов: поток страницы и запросы данных модулей — тем же адресом, каким их зовёт страница
  const page = await ask(`${base}/`);
  if (page.code !== 200 || !page.type.includes("text/html")) out.push(`страница хаба: ${page.code || "молчит"} (${page.type})`);
  const sources = [["страница", "/static/js/api.js"], ...(snap.extensions || []).filter((e) => e.main).map((e) => [`раздел ${e.name}`, e.name.startsWith("mod:") ? `/mod/${e.name.slice(4)}/web/${e.main}` : `/ext/${e.name}/${e.main}`])];
  for (const [who, file] of sources) {
    let src = "";
    const head = await ask(`${base}${file}`);
    if (head.code !== 200 || !head.type.includes("javascript")) { out.push(`${who}: модуль ${file} — хаб отвечает ${head.code || "молчанием"} (${head.type})`); continue; }
    try { src = await get(`${base}${file}`, true); } catch (e) { out.push(`${who}: файл ${file} не отдаётся (${e.message})`); continue; }
    for (const m of src.matchAll(/new EventSource\(\s*["'`]([^"'`]+)["'`]/g)) {
      const got = await ask(`${base}${m[1]}`);
      if (got.code !== 200 || !got.type.includes("text/event-stream")) out.push(`${who}: поток ${m[1]} — хаб отвечает ${got.code || "молчанием"}: страница покажет «нет связи»`);
    }
    // адрес — как в исходнике, с параметрами; подстановки ${…} — нулём: путь должен найтись, данные не важны
    const { gets, missing } = pageCalls(who, src, code);
    out.push(...missing);
    for (const url of gets) {
      const got = await ask(`${base}${url}`);
      if (got.lost || got.code === 0 || got.code >= 500) out.push(`${who}: запрос ${url} — хаб отвечает ${got.code || "молчанием"}`);
    }
  }
  return out;
}

export async function get(url, text = false, { tries = RETRIES, wait = sleep } = {}) {
  for (let left = tries; ; left--) {
    let r;
    try {
      r = await fetch(url, { headers: { "X-Hub": "1", "X-Hub-Api": "1" } });
    } catch (e) {
      if (left <= 0) throw e;
      await wait(NET_PAUSE_MS);
      continue;
    }
    if (BUSY.includes(r.status) && left > 0) {
      await r.body?.cancel();
      await wait(pauseFor(r.headers.get("retry-after")));
      continue;
    }
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return text ? r.text() : r.json();
  }
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
  const base = (arg("--hub") || "").replace(/\/$/, "");
  if (!base) return console.log('usage: watch.mjs --hub <адрес> [--journal <файл>] [--hours 6] [--rules <файл>] [--state <файл>] [--tell "<команда>"]'), 2;
  const problems = [];
  let rules = null, lines = {}, snap = {};
  try {
    snap = await get(`${base}/api/snapshot`);
    let file = arg("--rules");
    if (!file) {
      const ext = (snap.extensions || []).map((e) => e.name).find((n) => n === "client-api" || n.endsWith(":client-api"));
      if (!ext) problems.push("плагин client-api на хабе не включён: клиенты читают хаб без правил");
      else {
        const text = await get(`${base}/ext/${ext}/v1.js`, true);   // сначала правила, потом папка: сбой не оставит пустую
        file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "client-api-")), "v1.js");
        fs.writeFileSync(file, text);
      }
    }
    rules = loadRules(file || path.join(here, "..", "v1.js"));
    // правила — каждый раз свежие с хаба; копию не храним (прогон раз в 10 мин оставлял папку во временных)
    if (file && !arg("--rules")) fs.rmSync(path.dirname(file), { recursive: true, force: true });
    const refs = path.join(here, "..", "tests", "reference");
    for (const f of fs.readdirSync(refs).filter((f) => f.endsWith(".json"))) {
      problems.push(...checkReference(rules, JSON.parse(fs.readFileSync(path.join(refs, f), "utf8")), f.replace(".json", "")));
    }
    const view = rules.snapshot(structuredClone(snap));
    for (const s of (view.sessions || []).filter((s) => s.state !== "removed")) {
      const req = rules.request({ method: "GET", path: "/api/timeline", query: { session: s.name, since: "0", epoch: "" } });
      const raw = await get(`${base}${req.path}?${new URLSearchParams(req.query)}`);
      const adapted = rules.timeline(structuredClone(raw));
      lines[s.name] = adapted.items || [];
      problems.push(...checkLive(s.name, raw, adapted));
    }
    const contract = JSON.parse(fs.readFileSync(path.join(here, "..", "contract", "v1.json"), "utf8"));
    const cores = argv.flatMap((a, i) => (a === "--core" ? [argv[i + 1]] : []));
    problems.push(...await checkCalls(base, contract, rules, view, probe, PAUSE_MS, cores.map(coreCode)));
    for (const dir of cores) {
      problems.push(...checkCore(contract, rules, dir).map((p) => `код хаба ${dir}: ${p}`));
    }
    if (arg("--journal")) {
      problems.push(...checkJournal(journalMessages(arg("--journal"), Number(arg("--hours") || 6)), lines, view.messages || {}));
    }
  } catch (e) {
    problems.push(`сверка не прошла: ${e.message}`);
  }
  const unique = [...new Set(problems)];
  const state = arg("--state");
  if (!unique.length) {
    if (state && fs.existsSync(state)) fs.rmSync(state);
    return 0;
  }
  const text = `Клиентское API (правила выпуска ${rules ? rules.rev : "?"}): расхождений ${unique.length}\n` + unique.slice(0, 20).map((p) => "- " + p).join("\n");
  console.log(text);
  // одно и то же расхождение — одно сообщение: номера новых сообщений в подписи не участвуют
  const sign = unique.map((p) => p.replace(/m\d+\w*/g, "m").replace(/«.*»/, "")).sort().filter((p, i, a) => a.indexOf(p) === i).join("\n");
  const told = state && fs.existsSync(state) ? fs.readFileSync(state, "utf8") : "";
  if (arg("--tell") && sign !== told) {
    const [cmd, ...args] = arg("--tell").split(" ");
    execFileSync(cmd, [...args, text], { stdio: "inherit" });
    if (state) fs.writeFileSync(state, sign);
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
