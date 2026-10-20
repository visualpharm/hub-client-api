#!/usr/bin/env node
// Сверка хаба с договором версии клиентского API: то, что хаб отдаёт (после правил v<N>.js), — в виде договора?
//   node tools/check.mjs --hub http://127.0.0.1:8787        живой хаб: снимок и ленты сессий
//   node tools/check.mjs --core <папка кода хаба>            код хаба: есть ли пути запросов клиента
//   node tools/check.mjs --files <snapshot.json> <timeline.json>
// Можно вместе. Ключ --api N — версия (по умолчанию 1), --rules <файл> — другой скрипт правил. Расхождения — в выводе, код выхода 1.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadRules(file) {
  const box = vm.createContext({});
  vm.runInContext(fs.readFileSync(file, "utf8"), box, { filename: file });
  const api = vm.runInContext("HubClientAPI", box);
  // правила получают и отдают чистый JSON — как в клиенте
  const rule = (name) => (v) =>
    typeof api[name] === "function" ? JSON.parse(vm.runInContext(`(v) => JSON.stringify(HubClientAPI.${name}(JSON.parse(v)))`, box)(JSON.stringify(v))) : v;
  return { api: api.api, rev: api.rev, snapshot: rule("snapshot"), timeline: rule("timeline"), request: rule("request") };
}

const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** Расхождения значения с описанием договора: [«путь: что не так»]. */
export function diff(value, spec, where, out = []) {
  if (typeof spec === "string") {
    const must = spec.endsWith("!"), want = must ? spec.slice(0, -1) : spec;
    if (value === undefined || value === null) {
      if (must) out.push(`${where}: нет поля (${want})`);
    } else if (want !== "any" && typeOf(value) !== want) {
      out.push(`${where}: ${typeOf(value)} вместо ${want}`);
    }
    return out;
  }
  if (value === undefined || value === null) return out;
  if (Array.isArray(spec)) {
    if (!Array.isArray(value)) return out.push(`${where}: ${typeOf(value)} вместо array`), out;
    const seen = new Set();   // одно расхождение на вид поля, а не на каждую строку
    value.forEach((item) => diff(item, spec[0], `${where}[]`, []).forEach((p) => seen.add(p)));
    return out.push(...seen), out;
  }
  if (typeOf(value) !== "object") return out.push(`${where}: ${typeOf(value)} вместо object`), out;
  for (const [key, sub] of Object.entries(spec)) {
    if (key === "*") {
      const seen = new Set();
      Object.values(value).forEach((v) => diff(v, sub, `${where}.*`, []).forEach((p) => seen.add(p)));
      out.push(...seen);
    } else if (key.endsWith("!")) {   // обязательный вложенный список или объект
      const name = key.slice(0, -1);
      if (value[name] === undefined || value[name] === null) out.push(`${where}.${name}: нет поля`);
      else diff(value[name], sub, `${where}.${name}`, out);
    } else {
      diff(value[key], sub, `${where}.${key}`, out);
    }
  }
  return out;
}

export function checkSnapshot(contract, rules, snap) {
  return diff(rules.snapshot(snap), contract.snapshot, "snapshot");
}

export function checkTimeline(contract, rules, answer) {
  const got = rules.timeline(answer);
  const out = diff(got, contract.timeline, "timeline");
  const seen = new Set();
  for (const item of Array.isArray(got.items) ? got.items : []) {
    const spec = contract.kinds[item.kind];
    if (spec) diff(item, spec, `timeline.items[${item.kind}]`, []).forEach((p) => seen.add(p));
  }
  return out.concat(...seen);
}

/** Ответ необязательного адреса (answers в договоре): сниппеты хаба, который объявил feature `snippets`. */
export function checkSnippets(contract, answer) {
  return diff(answer, contract.answers.snippets, "snippets");
}

/** Пути и поля запросов клиента (после правила request) — есть ли они в коде хаба. */
/** Код страницы хаба и модулей, чьи поля она передаёт дальше как есть (сниппеты разбирают op в своём модуле). */
export const coreCode = (dir) => ["web", "snippets"].map((m) => path.join(dir, "modules", m)).filter((d) => fs.existsSync(d))
  .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".py")).map((f) => fs.readFileSync(path.join(d, f), "utf8"))).join("\n");

export function checkCore(contract, rules, dir) {
  const code = coreCode(dir);
  const out = [];
  for (const r of contract.requests) {
    const body = r.body ? Object.fromEntries(r.body.map((k) => [k, ""])) : undefined;
    const to = rules.request({ method: r.method, path: r.path, query: {}, body });
    if (!code.includes(`"${to.path}`) && !r.optional) out.push(`${r.method} ${r.path}: в коде хаба нет пути ${to.path}`);
    // поля тела: хаб может не брать поле из договора в работу (card, client_id) — сверка назовёт
    // необязательный адрес из модуля вне ядра (sidebar, space) в этом коде не живёт — его поля сверяет живой хаб
    if (r.body && !(r.optional && !code.includes(`"${to.path}`))) for (const k of r.body) if (!(r.absent && k in r.absent) && !code.includes(k)) out.push(`${r.method} ${r.path}: в коде хаба нет поля ${k}`);
  }
  return out;
}

async function json(url) {
  const r = await fetch(url, { headers: { "X-Hub": "1" } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function checkHub(contract, rules, base) {
  const raw = await json(`${base}/api/snapshot`);
  const out = checkSnapshot(contract, rules, raw);
  const snap = rules.snapshot(raw);
  const sessions = (snap.sessions || []).filter((s) => s.state !== "removed");
  const hub = sessions.find((s) => s.kind === "hub");
  const names = [...new Set([hub, ...sessions.slice(0, 12)].filter(Boolean).map((s) => s.name))];
  for (const name of names) {
    const req = rules.request({ method: "GET", path: "/api/timeline", query: { session: name, since: "0", epoch: "" } });
    const answer = await json(`${base}${req.path}?${new URLSearchParams(req.query)}`);
    checkTimeline(contract, rules, answer).forEach((p) => out.includes(p) || out.push(p));
  }
  if ((snap.features || []).includes("snippets")) {   // набор сниппетов — живой ответ, в виде договора
    checkSnippets(contract, await json(`${base}/api/snippets?lang=en`)).forEach((p) => out.includes(p) || out.push(p));
  }
  return { out, note: `хаб ${snap.version || "?"}, сессий в сверке: ${names.length}` };
}

async function main(argv) {
  const arg = (name, n = 1) => { const i = argv.indexOf(name); return i < 0 ? null : argv.slice(i + 1, i + 1 + n); };
  const api = (arg("--api") || ["1"])[0];
  const contract = JSON.parse(fs.readFileSync(path.join(here, "..", "contract", `v${api}.json`), "utf8"));
  const rules = loadRules((arg("--rules") || [path.join(here, "..", `v${api}.js`)])[0]);
  const problems = [], notes = [`клиентское API ${rules.api}, выпуск правил ${rules.rev}`];
  const hub = arg("--hub"), core = arg("--core"), files = arg("--files", 2);
  if (!hub && !core && !files) {
    console.log("usage: check.mjs [--hub <адрес>] [--core <папка кода хаба>] [--files <snapshot.json> <timeline.json>] [--api N] [--rules <файл>]");
    return 2;
  }
  if (hub) { const r = await checkHub(contract, rules, hub[0].replace(/\/$/, "")); problems.push(...r.out); notes.push(r.note); }
  if (core) problems.push(...checkCore(contract, rules, core[0]));
  if (files) {
    problems.push(...checkSnapshot(contract, rules, JSON.parse(fs.readFileSync(files[0], "utf8"))));
    problems.push(...checkTimeline(contract, rules, JSON.parse(fs.readFileSync(files[1], "utf8"))));
  }
  console.log(notes.join(" · "));
  if (!problems.length) return console.log("OK: хаб в виде договора"), 0;
  console.log(`Расхождений: ${problems.length} — допишите правило в v${api}.js`);
  problems.forEach((p) => console.log("  " + p));
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
