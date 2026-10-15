import assert from "node:assert/strict";
import test from "node:test";
import { loadRules } from "../tools/check.mjs";

const rules = loadRules(new URL("../v1.js", import.meta.url).pathname);
const envelope = "request_id=audit-001\nfrom=reviewer; to=hub; status=in_progress; in_reply_to=\n\n"
  + "result: Eight sessions confirmed the stop. Two remain unverified.\n\n"
  + "evidence: The saved log contains three events. This does not prove the absence of background activity.\n\n"
  + "follow-up: Check the remaining sessions without opening the browser.";
const report = "The recovery fix is merged locally and preserves the original conversation identifier. "
  + "Selecting a model saves the choice and does not launch the failed session. "
  + "The next explicit reload resumes the existing conversation without creating another task. "
  + "The source checks passed, but runtime activation remains unverified and no restart has been requested. "
  + "Evidence is saved at /home/example/reports/recovery.json and https://example.com/audit. "
  + "The separate worker is already running and needs no additional recovery.";
const adapt = (row) => rules.timeline({ epoch: "e", rev: 2, full: true, items: [row] }).items[0];

test("machine report: show the result first, readable evidence and next step; retain the source", () => {
  const row = { k: 7, seq: 12, ts: 30, kind: "in", id: "m12", channel: "agent", sender: "codex", text: envelope,
    attachments: [{ path: "/home/example/chart.png" }], quote: "Original question", reply_to: "d10" };
  const saved = structuredClone(row), out = adapt(row);
  assert.equal(out.text, "**In progress.**\n\nEight sessions confirmed the stop. Two remain unverified.\n\n"
    + "**Evidence:** The saved log contains three events. This does not prove the absence of background activity.\n\n"
    + "**Next:** Check the remaining sessions without opening the browser.");
  assert.equal(out.source_text, envelope);
  assert.deepEqual({ ...out, text: envelope, source_text: undefined }, { ...saved, source_text: undefined });
  assert.deepEqual(row, saved);
});

test("long single-line reports become paragraphs without losing or rewriting any words", () => {
  for (const row of [
    { k: 1, kind: "in", id: "m1", channel: "agent", sender: "codex", text: report },
    { k: 2, kind: "out", text: report },
    { k: 3, kind: "reply", from: "worker", for: "m1", text: report },
  ]) {
    const out = adapt(row);
    assert.ok(out.text.includes("\n\n"));
    assert.equal(out.text.replace(/\s+/g, " "), report);
    assert.equal(out.source_text, report);
    assert.deepEqual(adapt(out), out); // cached/translated rows may pass through again
  }
});

test("trailing newlines do not hide a one-line report; adjacent report sections get separate paragraphs", () => {
  assert.ok(adapt({ k: 1, kind: "out", text: report + "\n" }).text.includes("\n\n"));
  const text = "request_id=audit-001\nfrom=reviewer; to=hub\nresult: Not activated.\n"
    + "evidence: Source only.\nfollow-up: Verify runtime.";
  assert.equal(adapt({ k: 1, kind: "out", text }).text,
    "Not activated.\n\n**Evidence:** Source only.\n\n**Next:** Verify runtime.");
});

test("owner messages, code, structured data, existing Markdown and short replies stay exact", () => {
  for (const row of [
    { k: 1, kind: "in", id: "m1", channel: "web", text: report },
    { k: 2, kind: "in", id: "m2", channel: "cli", text: envelope },
    { k: 3, kind: "out", text: "**Done.**\n\n- Checked the source.\n- Runtime still unverified." },
    { k: 4, kind: "out", text: "```text\n" + envelope + "\n```" },
    { k: 5, kind: "tool", name: "Bash", text: envelope },
    { k: 6, kind: "out", text: JSON.stringify({ result: report }) },
    { k: 7, kind: "out", text: "Use `example.test()` exactly. " + report },
    { k: 8, kind: "out", text: "Done. Runtime still unverified." },
    { k: 9, kind: "in", id: "m9", channel: "plugin", sender: "plugin", text: report },
  ]) assert.deepEqual(adapt(row), row);
});

test("unknown, incomplete, quoted or content-free envelopes are not stripped", () => {
  for (const text of [
    envelope.replace("status=in_progress", "unknown=must keep this"),
    envelope.replace("status=in_progress", "status=unknown_state"),
    envelope.replace("from=reviewer; to=hub; ", ""),
    "An example of the protocol:\n" + envelope,
    "request_id=audit-001\nfrom=reviewer; to=hub; status=in_progress",
    envelope.replace("in_reply_to=", "in_reply_to=keep this important note"),
    "request_id=audit-001\nfrom=reviewer; to=hub\nresult: ",
    "request_id=audit-001; from=reviewer; to=hub; unknown=preserve. " + report,
  ]) assert.deepEqual(adapt({ k: 1, kind: "out", text }), { k: 1, kind: "out", text });
});

test("blocked and failed status stays visible; envelope authors never replace the real sender", () => {
  for (const status of ["blocked", "failed"]) {
    const text = envelope.replace("status=in_progress", "status=" + status).replace("from=reviewer", "from=owner");
    const out = adapt({ k: 1, kind: "in", id: "m1", channel: "agent", sender: "codex", text });
    assert.ok(out.text.startsWith("**" + status[0].toUpperCase() + status.slice(1) + ".**"));
    assert.equal(out.sender, "codex");
    assert.equal(out.kind, "in");
  }
});

test("envelope body preserves unlabelled warnings, repeated sections, URLs, commands and code", () => {
  const text = "request_id=audit-001\nfrom=reviewer\nto=hub\n\n"
    + "result: Source fixed.\n\nWARNING: activation is unverified.\n\n"
    + "evidence: https://example.com/audit?x=1;result=unchanged\n\n"
    + "evidence: Keep this second finding.\n\n"
    + "```text\nresult: exact code\nrequest_id=literal\n```\n\n"
    + "follow-up: Run `hub session reload example`.";
  const out = adapt({ k: 1, kind: "out", text });
  for (const s of ["WARNING: activation is unverified.", "https://example.com/audit?x=1;result=unchanged",
    "Keep this second finding.", "```text\nresult: exact code\nrequest_id=literal\n```", "`hub session reload example`"])
    assert.ok(out.text.includes(s), s);
  assert.equal(out.source_text, text);
});

test("malformed API inputs remain safe and a release bumps both adapter and manifest", async () => {
  for (const value of [null, {}, { items: null }]) assert.deepEqual(rules.timeline(value), value);
  const t = { items: [null, {}, { kind: "out", text: null }, { kind: "out", text: 42 }] };
  assert.deepEqual(rules.timeline(t), t);
  const { readFileSync } = await import("node:fs");
  assert.ok(rules.rev >= 4);
  assert.equal(JSON.parse(readFileSync(new URL("../hub-plugin.json", import.meta.url))).version, "1.1.3");
});
