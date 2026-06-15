# Dogfood backlog — convention

The dogfood backlog records problems we hit while running `@@FL` tournaments, so they survive the
**gitignored** `.runs/` directory and can be triaged/fixed later.

- **Roster** (status index): [`farnsworth-loop/DOGFOOD.md`](../../DOGFOOD.md)
- **One evidence file per item**: `farnsworth-loop/docs/dogfood/D-NNNN.md`

Why the split: the roster is a small, greppable table (the index); each item's bulky body lives in
its own file. Two workers fixing two *different* items produce **disjoint diffs** and never
merge-conflict. The roster mutates exactly one row per claim/resolve.

## Schema

**Roster row** (`DOGFOOD.md`): `id | sev | area | status | title | evidence`

| field | values / format |
|-------|-----------------|
| `id` | `D-NNNN`, zero-padded 4 digits, monotonic, never reused/renumbered |
| `sev` | `sev1` (wrong winners / corrupts outcomes) · `sev2` (degraded but usable) · `sev3` (cosmetic/docs) |
| `area` | `review` · `runner` · `parse` · `git` · `skill` · `docs` · `infra` |
| `status` | `open` · `[in-progress] @who <ISO-8601-UTC> run:<run-id>` · `done` · `wontfix` |
| `title` | one line, ≤ ~90 chars |
| `evidence` | committed repo-relative path `docs/dogfood/D-NNNN.md` |

**Evidence file** (`docs/dogfood/D-NNNN.md`): front-matter (`id, status, severity, area, discovered,
reporter, provenance`) then `## Problem`, `## Durable evidence (verbatim excerpt)`, `## Repro`,
`## Suspected fix`, `## Resolution`. The **Durable evidence** section is mandatory and must quote an
excerpt from `review-*/verdict.md` / `guidance.md` / `SUMMARY.blind.md` (plus the relevant
`mapping.json` unblinding line) — that is how an item stays triageable after `.runs/` is gone.

## Recording a new issue (human or tournament)

1. Allocate the next ID = (highest `D-NNNN` in the roster) + 1.
2. Create `docs/dogfood/D-NNNN.md` from the schema. **Paste a verbatim excerpt** of the offending
   verdict/guidance — never rely on a `.runs/` path. Record the run-id + `mapping.json` line as
   *provenance* only.
3. Add one row to `DOGFOOD.md` with status `open`. Commit `dogfood: file D-NNNN`.

## Working an item from an `@@FL` dogfood run

1. Read `DOGFOOD.md`; choose the top `open` item (lowest sev number, then lowest ID).
2. **Claim it** (atomic — see below) → status `[in-progress] @you <UTC> run:<run-id>`.
3. Fix it on a feature branch. Fill the item file's `## Resolution` (what changed + PR/commit).
4. Flip the roster row to `done` (or `wontfix` + reason). Commit `dogfood: resolve D-NNNN`. Open
   one PR per item.

## Claiming (atomic, parallel-safe)

A single shared Markdown file has **no** atomic in-place edit — two agents can both read `open`,
both write `[in-progress]`, and both believe they own the item. So the claim is a **git ref
update**, which already is atomic against concurrent writers:

1. Edit *only that one row*: set `[in-progress] @you <now-UTC> run:<run-id>`. Commit
   `dogfood: claim D-NNNN`.
2. `git push origin HEAD:main` **before doing any work**.
   - Push **succeeds** → you own it. Proceed on your own feature branch.
   - Push **rejected (non-fast-forward)** → `git pull --rebase`, re-read the roster. If the item is
     now `[in-progress]`, it was taken — pick the next `open` item and retry.

The rejected push *is* the mutual exclusion. (Policy forbids pushing to `main`? Use a shared
`dogfood-claims` branch — same race. No remote at all? `mkdir farnsworth-loop/.runs/.dogfood-locks/D-NNNN`
is atomic on POSIX; the lock lives under gitignored `.runs/`.)

**Staleness:** an `[in-progress]` whose claim timestamp is older than the **TTL (2h)** may be
reclaimed via the same push race (`dogfood: reclaim stale D-NNNN`). A clean abandon flips back to
`open` immediately (`dogfood: release D-NNNN`). Before flipping to `done`, re-check the row's
`run:` token still matches you — if not, you were reclaimed; bail without overwriting.

## Merge conflicts

Different items → different evidence files → zero conflict. The only shared file is `DOGFOOD.md`,
and each PR mutates exactly one row; different rows merge cleanly. A *same-row* conflict means the
claim protocol was bypassed (treat as a signal). Append new rows at the bottom of their status
group to keep additions far apart.
