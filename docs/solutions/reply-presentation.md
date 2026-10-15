---
title: Machine reports and one-line replies in native clients
scope: repo
area: adapter
tags: [timeline, codex, javascriptcore]
created: 2026-10-15
status: active
---

## Problem
Replies could show transport fields and long unbroken prose in Mac and phone chats.

## Root cause
The versioned adapter passed every reply's text through unchanged. Native Markdown
renderers received no paragraph structure; transport envelopes became visible prose.

## Solution
The timeline rule formats complete known envelopes and long unmarked single-line
agent prose. Status and uncertainty remain visible. Exact source_text is retained.
Owner input, unknown envelopes, code, existing Markdown and row identity stay unchanged.
No model call, journal rewrite, routing inference or app rebuild is needed.

## How to apply
Run local-ci, then check the contract against the hub. Verify v1.js in JavaScriptCore
and the native client's Markdown parser using private API fixtures outside git.
Bump rev and manifest version together; verify the exact served script after updating.
Clients fetch it on connection and periodically. Roll back the plugin to undo.
