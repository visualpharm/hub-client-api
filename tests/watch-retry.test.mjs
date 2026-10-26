// Временный отказ хаба (502/503/504, сетевой сбой) по ленте и снимку: до двух повторов, потом расхождение.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { PAUSE_MS, get, pauseFor } from "../tools/watch.mjs";

/** Подставной хаб: отвечает кодами по порядку, последний — повторяется. */
async function hub(codes, headers = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const code = codes[Math.min(seen.length, codes.length - 1)];
    seen.push(req.url);
    res.writeHead(code, { "Content-Type": "application/json", ...(code === 200 ? {} : headers) });
    res.end(code === 200 ? JSON.stringify({ items: [{ kind: "in", id: "m1" }] }) : "сервер не уложился в срок");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}/api/timeline?session=hub&since=0`;
  return { url, seen, close: () => new Promise((done) => server.close(done)) };
}
const pauses = () => { const got = []; return { got, wait: async (ms) => { got.push(ms); } }; };

test("503, потом 200 — лента получена, расхождения нет", async () => {
  const h = await hub([503, 200], { "Retry-After": "1" }), p = pauses();
  try {
    assert.deepEqual(await get(h.url, false, { wait: p.wait }), { items: [{ kind: "in", id: "m1" }] });
    assert.equal(h.seen.length, 2);
    assert.deepEqual(p.got, [PAUSE_MS], "Retry-After: 1 хаба — не короче своей паузы");
  } finally { await h.close(); }
});

test("503 три раза — расхождение с кодом после двух повторов", async () => {
  const h = await hub([503]), p = pauses();
  try {
    await assert.rejects(get(h.url, false, { wait: p.wait }), /: 503$/);
    assert.equal(h.seen.length, 3);
    assert.equal(p.got.length, 2);
  } finally { await h.close(); }
});

test("502 и 504 тоже повторяются; 404 и 500 — сразу, без повтора", async () => {
  for (const code of [502, 504]) {
    const h = await hub([code, 200]), p = pauses();
    try { await get(h.url, false, { wait: p.wait }); assert.equal(h.seen.length, 2); } finally { await h.close(); }
  }
  for (const code of [404, 500]) {
    const h = await hub([code, 200]), p = pauses();
    try {
      await assert.rejects(get(h.url, false, { wait: p.wait }), new RegExp(`: ${code}$`));
      assert.equal(h.seen.length, 1);
      assert.deepEqual(p.got, []);
    } finally { await h.close(); }
  }
});

test("сетевой сбой: два повтора, потом ошибка; хаб поднялся — данные", async () => {
  const h = await hub([200]);
  const url = h.url;
  await h.close();
  const p = pauses();
  await assert.rejects(get(url, false, { wait: p.wait }));
  assert.equal(p.got.length, 2);
  let n = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (...a) => (++n === 1 ? Promise.reject(new TypeError("fetch failed")) : real(...a));
  const up = await hub([200]);
  try {
    assert.equal((await get(up.url, false, { wait: pauses().wait })).items.length, 1);
    assert.equal(n, 2);
  } finally { globalThis.fetch = real; await up.close(); }
});

test("Retry-After: секунды и дата уважаются, но в пределах 15–60 с", () => {
  assert.equal(pauseFor(null), 15000);
  assert.equal(pauseFor("1"), 15000);
  assert.equal(pauseFor("40"), 40000);
  assert.equal(pauseFor("600"), 60000);
  assert.equal(pauseFor("мусор"), 15000);
  const at = pauseFor(new Date(Date.now() + 30000).toUTCString());
  assert.ok(at > 25000 && at <= 30000, String(at));
});
