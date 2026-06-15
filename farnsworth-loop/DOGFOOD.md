# Farnsworth Loop — Dogfood Backlog (roster)

Issues discovered while running `@@FL` tournaments, kept so they survive the **gitignored**
`.runs/` directory and can be triaged/fixed later. This file is the **roster** (index + status);
full evidence/repro/resolution for each item lives in `docs/dogfood/<id>.md`.

Every item must be triageable with its originating run directory **deleted** — so each evidence
file pastes a **verbatim excerpt** of the offending verdict/guidance. Run-ids here are provenance
breadcrumbs, **not** links.

Status legend: `open` · `[in-progress] @who <ISO-UTC> run:<run-id>` (claimed) · `done` · `wontfix`.
Claiming is a **git push race**, not an in-place edit — see [`docs/dogfood/README.md`](docs/dogfood/README.md).

Sort: `open` first, then by severity (`sev1` highest), newest IDs at the bottom of their group.
Append new items; never renumber.

| id     | sev  | area    | status | title                                                                            | evidence                 |
|--------|------|---------|--------|----------------------------------------------------------------------------------|--------------------------|
| D-0006 | sev2 | parse   | open   | Prose `two pass` / `two-pass` ignored; silently runs single pass                  | docs/dogfood/D-0006.md   |
| D-0007 | sev2 | parse   | open   | Task text after a leading `@@FL` marker silently dropped (`task:""`)              | docs/dogfood/D-0007.md   |
| D-0005 | sev2 | infra   | done   | fl-bench scores a *completed* claude-family call as FAIL on nonzero exit (haiku, glm-5.1) | docs/dogfood/D-0005.md |
| D-0001 | sev1 | review  | done   | Blind Opus judge assumes `node:fs` exists; ranks fs-plans over correct haiku+Bash | docs/dogfood/D-0001.md   |
| D-0004 | sev1 | review  | done   | Non-Anthropic round-1 winner excluded from final pool (carryover provenance re-check) | docs/dogfood/D-0004.md |
| D-0002 | sev2 | infra   | done   | Round-1 `verdict`/`guidance` silently not written on large two-pass runs         | docs/dogfood/D-0002.md   |
| D-0003 | sev3 | parse   | done   | `fl-parse.mjs` mis-reads prose `1 grand loop` and `2x opus` shorthand             | docs/dogfood/D-0003.md   |

<!-- Add new rows above this line. Allocate id = (highest D-NNNN) + 1; create docs/dogfood/D-NNNN.md first. -->
