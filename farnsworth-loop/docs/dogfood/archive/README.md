# Dogfood archive (read-only historical record)

These `D-NNNN.md` files are the **verbatim** evidence/repro/resolution records of dogfood items that
predate the migration to GitHub Issues. They are kept **as-is** (not scrubbed): for several items the
blind-candidate detail *is* the documented finding (e.g. D-0001), and the files were already public.

- They are **not** the live backlog — see GitHub Issues (label `dogfood`) and
  [`references/dogfood.md`](../../../skills/farnsworth-loop/references/dogfood.md).
- Each was also imported as a **closed** `[dogfood] D-NNNN:` issue (summary body + a link back here).
- Code comments that say `(dogfood D-NNNN)` point at these files.
- New findings use **GitHub issue numbers**, not `D-NNNN` ids.

Do not hand-edit for live status. New closed-issue snapshots (if wanted) are written here by
`bin/fl-issue.sh archive <issue-number>` as `ISSUE-<n>.md`.
