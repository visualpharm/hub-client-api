# hub-client-api

Versioned JSON adapters for Agents Hub clients. See README.md and contract/v1.json.

## Principles

- The hub journal owns state; adapters only transform client presentation and requests.
- Keep API 1 compatible with older hubs and clients. Detect fields, not hub versions.
- Preserve message identity, ordering, authorship, attachments and substantive content.
- Known regressions get a failing deterministic test before the fix.
- Use dependency-free JavaScript supported by JavaScriptCore and Node.

## Ivan decides

The owner decides product behavior, external services and access. Technical choices within
an authorized fix go in docs/decisions.md, including rationale and rollback.

## Work

- Before non-trivial work, read docs/solutions/INDEX.md; capture solved problems with compound.
- Tests/local CI: ~/.claude/bin/local-ci (node --test tests/*.test.mjs).
- Contract check: node tools/check.mjs --hub <hub> --core <core checkout>.
- Bump v1.js rev and hub-plugin.json version together for adapter releases.
- Commit small verified slices. Keep personal data and private fixtures out of git.
- Release through the existing plugin marketplace; verify the served script before reporting live.
