# Changes

## Unreleased (API 1, rules rev 5)

snapshot.files_port (number, optional) — the port of the hub's "Files" module (8788 by
default; a second hub has its own, HUB_FILES_PORT). Clients build file links
(/raw?path=, /open?path=) on the hub host from settings with this port; without the key
they use their own HUB_FILES_PORT or 8788. v1.js unchanged.

The contract describes the bell keys (both optional). snapshot.notifications —
rows {id, kind blocker|info|inbox, title, body, since, updated, expires, type,
target {kind, id, session, plugin}}; a blocker row of todo-own 0.18.0 (feature
notifications.actions) also carries awaits_reply, request_id, card, tool and
actions [{id, label, kind option|reply|allow|deny|open, question, command, link}],
the buttons the clients show on the notification. snapshot.alerts (feature
push.alerts, Plugin API 1.26) — push reasons {id, key, kind, session, card, title,
body, since, v, sender, urgent}; key is the push hub.key and apns-collapse-id, the
client finds the bell row by it. The push payload carries the same sender as an optional hub.sender
(next to hub.key and hub.kind): for a notice the id of its sender (a session, mod:<name>, ext:<name>,
schedule:<name>, core…), for a question or tool request the session; alerts[].sender is absent for those two.
The clients show it as the second line of the notification when it is not there yet and fall back to the
payload's top-level session when a hub sends no hub.sender. No rule change in v1.js.

A To-do row (snapshot.todo, GET /api/mod/hubbahub-todo-own/open and /later) of todo-own
0.25.0 (feature todo.actions) ends with actions [{id, label, kind later|selfdo, post
{method, path, body, needs}}], ready requests for the row buttons; labels follow the
owner's language (ru, es, else en). There is no "done" action: the client has the
checkbox (POST /api/todo/done). later: POST /api/mod/hubbahub-todo-own/later with body
{id} plus when (text or epoch) chosen by the client (post.needs ["when"]); any row.
selfdo: POST /api/send {session, todo, text} puts the owner's words into the item's
thread and sends them to the author session; only for action and asked rows of a
session that are not in progress, never for review rows or hub blockers. No rule
change in v1.js.

The selfdo action of todo-own 0.26.0 also carries mode "compose" and quote (string): the
client does not send post but puts quote into the item's reply field (below any words
already there, a blank line after it), focuses the field with the cursor at the end and
scrolls to it; the owner adds a comment and sends it himself (the usual reply with todo
set). quote is a Markdown block quote built by the module: the first line is the label in
the owner's language ("> Сделай сам:"), then the title, what and need of the row as
paragraphs. A client that ignores mode keeps sending post as before. Other actions have
neither field. No rule change in v1.js.

The watch check counts a correction of the owner's message, sent by the module
edit-message (POST /api/send/correction, owner: true, channel mod:edit-message), as
the owner's words, like the voice module below. No rule change in v1.js.

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
