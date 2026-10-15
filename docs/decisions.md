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
