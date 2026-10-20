# watch: false "owner word is missing from the feed"

Symptom: `client-api-watch` reports `<session>: слова владельца mN нет в ленте`, while the message reached a session.

Causes (flagman core, 2026-10-20):
- The core hands a message for a sleeping executor to whoever raised it: `turn.started marker=mN` has another entity. The addressee feed never shows it.
- The journal rotates every ~1.5 h. The live feed after rotation is the kept selection plus new events, not a contiguous seq range, so "older than the oldest feed row" does not prove coverage. The delivery events (turn.started) of older messages live only in `journal-archive/`.
- `fetch("/api/hold", {method: "POST"})` probed with GET gets 404 "нет такой страницы" on a live path.

Fix: delivery from turn.started/host.done across journal + archives; compare with the addressee feed only after the last `why=rotate` snapshot; real loss = no delivery and a final state. POST paths are looked up in `--core` (pass the live core, ~/agents-hub-main).

Verify: `node --test tests/*.test.mjs`; on the live journal over 24 h the old check reported 2, the new one 0.
