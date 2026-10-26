# Changes

## Unreleased (API 1, rules rev 5)

The watch check retries the snapshot, the session feeds and the rules file up to
twice on 502, 503, 504 or a network failure, pausing 15 s (20 s after a network
failure; a longer Retry-After up to 60 s is honoured), and reports a problem only
if the hub still refuses. Under heavy machine load the hub answers a feed with 503
when it misses its own deadline, and the next request a few seconds later
succeeds. The check of client calls (contract requests, page and plugin files,
their data requests and streams) retries the same way on 502, 503, 504 and on
silence, waiting longer for the answer on a retry. Other codes are reported at
once, as before. No rule change in v1.js.

The contract describes the pool account keys of the module hubbahub-accounts-live
(both optional): accounts_machine {account, how: org|reset} (feature
accounts.machine) names the pool account that is this computer's login, and
accounts_meta {name: {email, plan, how, by, at}} (feature accounts.meta) labels
pool accounts; accounts.pool[].email is an optional string. Clients show the
computer login quota as that account's page instead of a separate "computer
login" page, and the account email from the pool first, accounts_meta second.
No rule change in v1.js.

The watch check counts a voice message from the client, sent by the module
hubbahub-voice-own (owner: true, channel mod:hubbahub-voice-own), as the owner's
words; other mod:* channels stay non-owner. No rule change in v1.js.

The contract describes the shots of a question (feature question.shots): the
snapshot key question_shots maps an open card id (qN, as in todo[] and
sessions[].pending[]) to {session, files: [{seq|null, path, url, name,
caption|null, kind image|video|file, ts, via turn|attach}]}; a closed card leaves
the key within ~2 s. Clients show image files as thumbnails under the first
question, before the options, and open them in the gallery. No rule change in
v1.js.

The contract describes device telemetry (module hubbahub-client-metrics, feature
client.metrics): POST /api/client/metrics {client_id, client, version, build,
kind, payload} sends a MetricKit report from the iPhone or Mac app, owner only;
202 {ok, id}, a repeated client_id returns the same id with duplicate: true.
400 and 413 are final for that report; 503 and network failures are retried with
the same client_id. Clients send nothing without the feature. No rule change in
v1.js.

The contract describes the link between a correction and the original message
(edit-message 0.2.0, feature send.correction.replaces): POST /api/send/correction
takes an optional replaces (exact original id mN); the snapshot key
correction_refs maps a correction id to {replaces, session}; GET
/api/correction-ref?message=mN (owner only) returns the same pair for a link the
snapshot left out, 404 when there is none. Clients put the correction's text in
place of the original bubble; without a link it stays a quoted correction.
tools/check.mjs reads one link through the handle when the live snapshot has
any. No rule change in v1.js.

The contract describes the thread of a To-do item (hubbahub-todo-own 0.8.0):
snapshot.todo[].thread and snapshot.todo_done[].thread are optional lists of feed
row numbers (seq) in the item's session: the owner's words from the item's field
and the session's reply. A reply from the field closes only an item of kind
asked; action and review stay open until ticked. No rule change in v1.js.

## 2026-10-20 · 1.1.5 (API 1, rules rev 5)

The contract describes three optional module additions on flagman hubs: send
audit (POST /api/send/audit, answer send_audit, snapshot key send_audit), the
limit pause of sessions (snapshot key sessions_extra, feature session.quota_hold)
and words sent on behalf of an agent (POST /api/send/agent, answer send_agent; its
feed row carries channel and from). Hubs without these modules are unaffected.
The v1.js adapter rules are unchanged.

## 2026-10-20 · 1.1.4 (API 1, rules rev 5)

Messages a schedule job, another session, a module or a plugin sends through the
owner's channels (hub send from a job arrives as cli) no longer appear as the
owner's words in Mac and phone clients. The author now comes from the timeline's
`from` field; hubs without that field keep the channel rule. The watch check
compares owner words the same way.

## 2026-10-15 · 1.1.3 (API 1, rules rev 4)

Codex and other agent replies use readable paragraphs in Mac and phone clients.
Recognized report headers become a visible status, result, evidence and next step;
original text remains in source_text. Existing Markdown, code, owner messages and
unknown report formats stay intact. Update the client-api plugin; apps fetch the
new rules automatically without a new build or hub restart.
