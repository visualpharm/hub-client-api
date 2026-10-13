#!/usr/bin/env node
// Постоянная сверка: то, что клиенты получают от хаба через правила, — правда?
//   node tools/watch.mjs --hub http://127.0.0.1:8787 [--journal <журнал хаба>] [--hours 6] [--rules <файл>]
//                        [--state <файл>] [--tell "<команда>"]
// Правила берутся с самого хаба (/ext/<…client-api>/v<N>.js) — те же, что у клиентов; --rules — из файла.
// Смотрит: 1) эталонные ленты (tests/reference) — слова владельца ровно те, что названы, ответы и файлы на месте;
// 2) живые ленты сессий — правила не теряют строк, ответов и файлов; словами владельца показано только пришедшее
// его каналами; 3) с --journal — по журналу хаба: каждое слово владельца за --hours есть в ленте его словами, и ни
// одно чужое сообщение (ядро, плагины, расписание, сессии) не показано его словами.
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
import { checkCore, loadRules } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OWNER_CHANNELS = ["web", "cli", "telegram"];

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
    if (it.to || (it.channel && !OWNER_CHANNELS.includes(it.channel))) {
      out.push(`${name}: ${it.id} (${it.to ? "поручение для " + it.to : "канал " + it.channel}) показано словами владельца: «${cut(it.text)}»`);
    }
  }
  for (const it of before) {
    if (it.kind === "in" && !it.sender && !it.to && OWNER_CHANNELS.includes(it.channel)
        && !ownerRows(after).some((x) => x.id === it.id)) out.push(`${name}: слово владельца ${it.id} пропало: «${cut(it.text)}»`);
  }
  return out;
}

/** Сообщения из хвоста журнала хаба за последние часы: {id, session, owner, channel, text}. */
export function journalMessages(file, hours, now = Date.now() / 1000) {
  const size = fs.statSync(file).size, span = Math.min(size, 24 * 1024 * 1024);
  const fd = fs.openSync(file, "r"), buf = Buffer.alloc(span);
  fs.readSync(fd, buf, 0, span, size - span);
  fs.closeSync(fd);
  const out = [], stopped = new Map();   // сессия → номер последней остановки исполнителя
  for (const line of buf.toString("utf8").split("\n").slice(1)) {
    if (!line.includes('"message.received"') && !line.includes('"session.stop_requested"')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const d = ev.data || {};
    if (ev.type === "session.stop_requested") stopped.set(ev.entity, ev.seq);
    if (ev.type !== "message.received" || ev.ts < now - hours * 3600) continue;
    out.push({ id: `m${ev.seq}`, session: d.to, channel: d.channel || ev.src,
               owner: d.owner === true && OWNER_CHANNELS.includes(d.channel), text: d.text });
  }
  // исполнителя остановили позже — его очередь ядро отдало тому, кто поднял: слово владельца ушло в ленту другой сессии
  for (const m of out) m.rerouted = (stopped.get(m.session) || 0) > ev0(m);
  return out;
}

const ev0 = (m) => Number(m.id.slice(1));

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
      if (m.rerouted) continue;
      // лента сессии короче журнала, сообщение снято или сессии нет в выборке — не расхождение
      const items = lines[m.session];
      const oldest = items && items.length ? Math.min(...items.map((it) => Number(it.seq) || Infinity)) : Infinity;
      if (items && Number(m.id.slice(1)) > oldest && !["cancelled", "removed"].includes(state) && states[m.id]) {
        out.push(`${m.session}: слова владельца ${m.id} нет в ленте: «${cut(m.text)}»`);
      }
    } else if (!mine.some((r) => !r.to)) {
      out.push(`${m.session}: слово владельца ${m.id} показано как чужое: «${cut(m.text)}»`);
    }
  }
  return out;
}

/** Отвечает ли адрес: код и тип; поток — только заголовки (тело не ждём). */
async function probe(url) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { "X-Hub": "1", "X-Hub-Api": "1" }, signal: stop.signal });
    // 404 бывает и у живого пути («нет такой сессии»): пути нет — только когда хаб так и говорит
    const lost = r.status === 404 ? (await r.text()).includes("нет такой страницы") : false;
    return { code: r.status, type: r.headers.get("content-type") || "", lost };
  } catch (e) {
    return { code: 0, type: String(e.message) };
  } finally {
    clearTimeout(timer); stop.abort();
  }
}

/** Каждый вызов клиентов против живого хаба: запросы договора (после правила request) и то, что просят страницы
 *  разделов, открытые внутри приложений (страница хаба, её поток, модули плагинов и их запросы данных). */
export async function checkCalls(base, contract, rules, snap, ask = probe) {
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
  const sources = [["страница", "/static/js/api.js"], ...(snap.extensions || []).filter((e) => e.main).map((e) => [`раздел ${e.name}`, `/ext/${e.name}/${e.main}`])];
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
    const urls = new Set([...src.matchAll(/fetch\(\s*["'`](\/api\/[^"'`]+)["'`]/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, "0")));
    for (const url of urls) {
      const m = [null, url];
      const got = await ask(`${base}${url}`);
      if (got.lost || got.code === 0 || got.code >= 500) out.push(`${who}: запрос ${m[1]} — хаб отвечает ${got.code || "молчанием"}`);
    }
  }
  return out;
}

async function get(url, text = false) {
  const r = await fetch(url, { headers: { "X-Hub": "1", "X-Hub-Api": "1" } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return text ? r.text() : r.json();
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
        file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "client-api-")), "v1.js");
        fs.writeFileSync(file, await get(`${base}/ext/${ext}/v1.js`, true));
      }
    }
    rules = loadRules(file || path.join(here, "..", "v1.js"));
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
    problems.push(...await checkCalls(base, contract, rules, view));
    for (const dir of argv.flatMap((a, i) => (a === "--core" ? [argv[i + 1]] : []))) {
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
