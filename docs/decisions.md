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

## 2026-10-19 · sidebar_hidden, space_bookmarks and quote in the contract without a rules release
Decided: describe snapshot.sidebar_hidden + POST /api/sidebar/hidden (feature `sidebar.hidden`, hubbahub-sidebar ff36cfb), snapshot.space_bookmarks
+ POST /api/space/bookmarks, /remove, /open (feature `space.bookmarks`, hubbahub-space 0109a9c), and `quote` on timeline rows `in` and `reply`
(core/views.py) in contract/v1.json, all optional. v1.js rules and rev stay. Why: native and web clients read these shared settings and the
reply source; the contract names what they rely on. Undo: remove the entries. By: agent.

Check tool: body fields of an optional request whose path is absent from the core code (module outside core) are not compared with the core; the live hub covers them.

## 2026-10-20 · watch: owner words are checked by delivery, the feed only after the last journal rotation
Decided: tools/watch.mjs reads the journal window from journal.jsonl and journal-archive/*.jsonl (mtime inside the window). A word handed
by the core to another session (turn.started marker/also or host.done type sent with another entity — a sleeping executor's message goes to
whoever raised it) is not compared with the addressee feed. A word delivered to the addressee is compared with its feed only when it came
after the last `core.snapshot why=rotate`: before that the live flagman feed keeps only a selection (history is in the archive). A word with
no delivery at all, in a final state (delivered/failed), is reported as a real loss. Page fetch() calls with a non-GET method are not probed
with GET (flagman answers 404 "no such page" for POST-only paths, the body is parsed before the path); their path is looked up in --core.
Why: false alarms on redirected words and on words older than the journal rotation, POST /api/hold. Undo: revert the commit. By: agent.

## 2026-10-20 · Hub thread is the session with kind "hub"; hub_name is only a caption
Contract v1 now lists snapshot.hub_name and snapshot.hub_title as optional strings and states that the hub feed address is the
`sessions[]` entry with `kind == "hub"`. On flagman hub_name is the `title` from hub.json (empty by default since 19.10), not a session
name. The snapshot check reports a hub without a `kind: "hub"` session. Rules unchanged (rev 5): native clients already read the kind.
Why: a client taking the feed address from hub_name gets an empty feed on flagman. Undo: revert the commit. By: agent (d642567).
