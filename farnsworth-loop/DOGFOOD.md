# Farnsworth Loop — Dogfood Backlog

**The live dogfood backlog has moved to GitHub Issues** (label [`dogfood`](https://github.com/robanderson/claude-my-skills/issues?q=label%3Adogfood)).
This file is a stub kept as a discoverable pointer; it is no longer the roster.

- **Live backlog:** `gh issue list --label dogfood --state all` (or the link above).
- **File / claim / work an item:** `farnsworth-loop/bin/fl-issue.sh` (see below).
- **Convention + flow:** [`skills/farnsworth-loop/references/dogfood.md`](skills/farnsworth-loop/references/dogfood.md).
- **Historical items (legacy `D-NNNN`):** read-only under [`docs/dogfood/archive/`](docs/dogfood/archive/);
  each was also imported as a closed `[dogfood] D-NNNN:` issue.

```bash
bin/fl-issue.sh bootstrap                 # (once) create the dogfood label scheme
bin/fl-issue.sh new --sev sev2 --area parse --title "…" --evidence-file EV.md
bin/fl-issue.sh next                       # top open item (sev1 → sev3)
bin/fl-issue.sh claim <N> <run-id>         # best-effort claim (see convention doc)
# fix on a rob/dogfood-<N> branch, open one PR with "Closes #<N>"
```

> Migrated from the Markdown roster via the `@@FL` two-pass tournament
> `fl-dogfood-vs-issues-20260615-050637` (recommendation: HYBRID — Issues for live state,
> in-repo archive + committed inbox for durability). To roll back: `git revert` the migration PR.
