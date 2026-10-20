# Changes

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
