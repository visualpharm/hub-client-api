# Decisions

## 2026-10-15 · Versioned presentation boundary
Decided: keep client compatibility and presentation in the existing API plugin. The hub
journal and routing remain authoritative. Why: Mac and phone can consume the same update
without rebuilding the apps. Undo: restore the previous plugin release. By: agent.

## 2026-10-15 · Readable replies without semantic rewriting
Decided: recognize only complete known report envelopes; expose status, result, evidence
and follow-up as Markdown paragraphs. Format long unmarked one-line agent prose only by
replacing inter-sentence whitespace. Retain exact source_text and every row's identity,
order, actual author, links and attachments. Never derive authority or routing from prose.
Owner input, tools, existing Markdown, unknown/ambiguous envelopes and code pass through.
Why: client presentation can improve without another model, a lossy summary or changes
to the hub journal. Undo: restore v1.js rev 3; no data migration. By: agent.

## 2026-10-16 · Snippets in the contract without a rules release
Decided: describe /api/snippets, the snippets.* settings keys and the snapshot.settings rows in contract/v1.json
(optional, tied to feature `snippets`) and verify the live answer in check.mjs; checkCore also reads
modules/snippets because the hub page passes op fields through. v1.js rules and rev stay as they are: the hub already
serves the contract shape, so no adaptation is needed and a hub without the feature is not a mismatch. Why: clients
read one hub-wide snippet set; the contract names what they rely on. Undo: remove the entries; no data migration. By: agent.

## 2026-10-17 · Model class (tier) in the contract without a rules release
Decided: describe snapshot.models[] (id, title, vendor, rank, tier) and sessions[].model_effective in contract/v1.json,
all optional. tier is an integer 2-8: the number of working LEDs a client draws for the session's model class
(Haiku 2, Sonnet 4, Opus 6, Fable 8; other labs by analogue, chosen by the hub). v1.js rules and rev stay: the hub serves the
shape, clients that do not know the field draw six. Why: Mac and iPhone read the class from the catalog by the session's
model_effective; the contract names what they rely on. Undo: remove the entries; no data migration. By: agent.

## 2026-10-18 · Accounts, hints and todo.undone in the contract without a rules release
Decided: describe snapshot.account (active, since, pinned, seen[name] with windows), snapshot.accounts.pool, snapshot.limits.account/provider,
snapshot.hints_seen, POST /api/hints/seen (feature `hints`, hubbahub-hints 7e2c76a) and POST /api/todo/undone (feature `todo.undone`,
hubbahub-todo-own 5eecc35) in contract/v1.json, all optional. v1.js rules and rev stay: the live hub fork does not send the new fields yet.
Why: hub-ios builds usage-account pages from account.seen + accounts.pool; clients read the shared hint state. Undo: remove the entries. By: agent.
