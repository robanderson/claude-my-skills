# Dogfood backlog — convention (GitHub Issues)

The dogfood backlog records problems (and feature-requests) we hit while running `@@FL`
tournaments, so they survive the **gitignored** `.runs/` directory and get triaged/fixed later.

**The live backlog is GitHub Issues**, labelled `dogfood`. All forge access is confined to one
helper, `bin/fl-issue.sh` (plugin-root `bin/`, beside `fl-git.sh`), so the tournament engine
(`workflows/tournament.mjs`) stays forge-agnostic. The in-repo `docs/dogfood/archive/` keeps a
read-only, greppable historical record; it is **not** a second live backlog.

> **Why Issues (HYBRID), not pure Markdown and not pure Issues** — Issues add dedup, search,
> `Closes #N` PR cross-linking, labels, and a triage UI, and they are not gitignored. But the
> GitHub API has **no compare-and-swap**, so a label/assignee "claim" is best-effort, not a mutex
> (see *Claiming*). And a headless/offline run may have no `gh`. So: Issues for live state; a
> committed offline **inbox** + a committed **archive** for durability; a git-ref **escape hatch**
> for strict exclusivity. Designed via an `@@FL` two-pass tournament (run
> `fl-dogfood-vs-issues-20260615-050637`).

## Where things live

| Thing | Location |
|---|---|
| Live backlog (open/claimed/closed, sev/area) | GitHub Issues, label `dogfood` |
| The capability (file / claim / next / archive) | `farnsworth-loop/bin/fl-issue.sh` |
| Issue form (structural evidence enforcement) | `.github/ISSUE_TEMPLATE/dogfood.yml` |
| This convention | `farnsworth-loop/skills/farnsworth-loop/references/dogfood.md` |
| Historical evidence (read-only) | `farnsworth-loop/docs/dogfood/archive/D-NNNN.md` |
| Offline drafts (committed, transient) | `farnsworth-loop/docs/dogfood/inbox/` |

## Label scheme

- Marker: **`dogfood`** (every FL-filed item; the saved query keys off it).
- Severity: **`sev1`** (wrong winners / corrupts outcome) · **`sev2`** (degraded but usable) ·
  **`sev3`** (cosmetic/docs).
- Area: **`area:review` · `area:runner` · `area:parse` · `area:git` · `area:skill` · `area:docs` ·
  `area:infra`**.
- Claim state: **`claimed`** (transient). By-design closures carry **`wontfix`**.

Bootstrap once (idempotent, re-runnable): `bin/fl-issue.sh bootstrap`.

## PUBLIC repo — what must never go in an issue

This repo is public, so an issue body is world-visible. **Forbidden:** secrets/tokens, and the
`mapping.json` **unblinding** line (which says which blind candidate was which model — it
de-anonymises a blind review). Refer to a candidate only as **"blind B"**. Enforced three ways:
the form's warning, `fl-issue.sh`'s refusal greps (exit 4 = unblinding, 5 = secret), and the
migration scrub. The **verbatim-evidence** rule remains (it is required triage content), now
enforced structurally by the form's `required` field + the helper's empty/placeholder refusal
(exit 3) — not by convention alone.

## Recording a new issue (human or tournament)

- **From an `@@FL` run (preferred):**
  ```
  bin/fl-issue.sh new --sev sev2 --area parse \
     --title "<≤90 char one-liner>" \
     --evidence-file EV.md [--problem-file P.md --repro-file R.md --fix-file F.md --run-id <id>]
  ```
  Always pass a verbatim excerpt of the offending verdict/guidance as `--evidence-file`. The helper
  refuses empty/placeholder/unblinding/secret evidence and dedups before creating.
- **From a browser:** open an issue with the *Dogfood finding* template; required fields enforce the
  same minimum.

## Working an item (the `@@FL` dogfood-run flow)

1. **Pick** the top open item: `bin/fl-issue.sh next` (walks `sev1 → sev2 → sev3`, lowest issue #).
2. **Claim** it: `bin/fl-issue.sh claim <N> <run-id>` (best-effort — see below).
3. **Fix** on a feature branch `rob/dogfood-<N>` (honours the global `rob/` prefix rule).
4. **Open one PR** with `Closes #<N>` in the body → merging auto-closes the issue and cross-links
   the PR. No manual roster edit.
5. On close, optionally snapshot to the archive: `bin/fl-issue.sh archive <N>`.

## Claiming (best-effort, NOT a mutex)

The GitHub issue API has **no compare-and-swap**: `--add-assignee` / `--add-label` are
additive/idempotent, so two workers can both "succeed". `fl-issue.sh claim` is therefore a **TOCTOU
best-effort** claim with read-after-write and a **deterministic tiebreak**: it adds you as assignee
+ `claimed` + a `claim:` comment carrying your run-id, then re-reads; if there are multiple
assignees, **the lowest-numbered `claim:` comment wins and only the loser releases** (livelock-free).
There is a sub-second residual window; for the normal 1–3-worker dogfood fan-out this is fine.

**Strict-exclusivity escape hatch (high fan-out / grand loops).** Use the original push-race
primitive, decoupled from the backlog and **never against `main`** — claim a git ref whose creation
is atomic on the server:
```
git push origin "$(git rev-parse HEAD):refs/dogfood-claims/D-<N>"   # NO --force
#   success  -> you own D-<N> (ref creation is atomic; existing ref is rejected non-ff)
#   rejected -> someone owns it; pick the next item
```
Release by deleting the ref. The issue still holds human-facing state; the ref is purely the lock.

**Staleness/TTL (2h).** A `claimed` issue whose latest `claim:` comment is older than 2h may be
reclaimed via the same protocol. Before closing, re-verify your `claim:` comment is still the
winning one — if a reclaim superseded you, bail without closing.

## Dedup

`fl-issue.sh` matches a new item's title against existing open *and* closed `dogfood` issues before
creating; on a hit it points at the existing issue instead of filing a duplicate.

## Offline / headless / no-`gh` fallback

`gh` shares the "interactively-authed services may be absent in headless/cron runs" risk. On any gh
failure, `fl-issue.sh new` **degrades to a committed draft** under `docs/dogfood/inbox/`
(**never** `.runs/`, which is gitignored — that would silently lose the finding). Commit it; when
`gh` is reachable, `bin/fl-issue.sh drain-inbox` lists the drafts to re-file via `new` (then
`git rm`). The inbox is a **degradation mode of the one system**, not a parallel backlog.

## Historical items (legacy `D-NNNN` ids)

Before the migration, items were rostered in `farnsworth-loop/DOGFOOD.md` with one evidence file per
item. Those files are preserved **verbatim** under `docs/dogfood/archive/D-NNNN.md` (the unblinding
they contain *is* the documented finding for several of them, and they were already public). Each was
imported as a **closed** GitHub issue titled `[dogfood] D-NNNN: …`. Code comments that reference
`(dogfood D-NNNN)` point at those archive files. New items use issue numbers, not `D-NNNN` ids.

## Rollback

The migration is one PR: `git revert <merge-sha>` restores `DOGFOOD.md`, the README, and the
in-place evidence files, and removes the helper/form. Imported issues are harmless (closed,
labelled `dogfood`); delete them with
`gh issue list --label dogfood --state closed --json number --jq '.[].number' | xargs -I{} gh issue delete {} --yes`
if a full reversal is wanted. Because the archive preserved every evidence file, no information is
lost either direction.
