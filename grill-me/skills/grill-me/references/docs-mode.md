# Docs Mode — artifacts, templates, write procedure

Read this only when Docs Mode is on (the user asked for ADRs / a decision log / a
glossary / a design doc). It is the durable-artifact layer on top of the core
Grill Me interview. **Still planning-only — these are planning docs, not code;
Law 2 still holds (no schemas, no signatures, no stubs).**

## When to use it

Offer (don't force) the docs pass when: the plan is long-lived, multiple people
will build it, the decisions are contested or expensive to reverse, or the
domain has fuzzy/overloaded terms the interview kept tripping over. For a
throwaway plan, the in-chat Shared Understanding is enough.

## What gets written, and when

| Artifact | When written | Purpose |
|---|---|---|
| `glossary.md` | Up front, in the domain-modeling pass | Shared vocabulary; ambiguous terms seed early questions |
| `adr/NNNN-<slug>.md` | The moment a branch resolves | One immutable decision record per resolved branch |
| `design.md` | At wrap-up | The Shared Understanding, linking the ADRs + glossary |

Write **incrementally**: the glossary before grilling, each ADR as its branch
closes, `design.md` at the end. The point is that an interrupted or wrapped-up
session still leaves a complete trail — never a single dump at the end.

## File layout

Confirm the location with the user; default:

```
docs/grill/<plan-slug>/
  glossary.md
  design.md
  adr/
    0001-data-model.md
    0002-auth-strategy.md
    ...
```

ADRs are numbered in resolution order and are **append-only**. If a later
decision reverses an earlier one, don't edit the old ADR — add a new one with
`Status: Supersedes 0002` and set the old one's `Status: Superseded by NNNN`.

## Domain-modeling pass (do this before grilling)

Run one short Socratic sub-loop over **vocabulary** (same one-question-at-a-time
contract), because ADRs are worthless if terms are ambiguous:

1. Read the plan + the code it references; pull every meaningful noun/entity/term
   and the relationships between them.
2. Prefer **discovery**: lift existing names from the codebase (models, table
   names, types) so the glossary matches reality instead of inventing terms.
3. For each ambiguous or overloaded term, grill it — "you've used 'account' and
   'workspace' interchangeably; one concept or two?" One question, wait, confirm.
   Disagreement on a word is usually a hidden disagreement on the design.
4. Draft `glossary.md`. Any term that's contested becomes one of your **first**
   grill questions — naming things wrong is cheap to fix now, expensive later.

### `glossary.md` template

```markdown
# Glossary — <plan name>

> Shared vocabulary for this design. One source of truth for what each term means.

| Term | Definition | Notes / synonyms-rejected |
|------|------------|---------------------------|
| Order | A confirmed customer purchase, post-payment | not "Cart" (pre-payment) |
| Session | Short-lived auth context for one device login | not "login"; stored in Redis |
```

One row per canonical term; record rejected synonyms so they don't creep back.

## ADR template

One file per resolved branch, written immediately on resolve. Keep it tight — an
ADR is a paragraph of context and a clear decision, not an essay.

```markdown
# ADR 0002 — Auth strategy

- **Status:** Accepted        <!-- Proposed | Accepted | Superseded by NNNN -->
- **Date:** 2026-06-28
- **Branch:** Auth (#2 in the coverage ledger)
- **Depends on:** ADR 0001 (data model — tenant is the isolation boundary)

## Context
What forced this decision; the constraints in play; what the codebase already does.

## Decision
The choice, stated in one or two sentences. Active voice: "We will …".

## Alternatives considered
- **Option B** — why not (the tradeoff that lost).
- **Option C** — why not.

## Consequences
- What this makes easy.
- What this makes hard / what we accept.
- New follow-on decisions this opens (link forward if already resolved).
```

Map the interview to the ADR fields as you go: the **recommended answer + the
user's response** → Decision; the **pushback / options** you raised →
Alternatives; the **dependencies you named out loud** → Depends on + Consequences.

Rules:
- One ADR = one decision. Two decisions on a branch = two ADRs.
- "Consequences" must include the dependency edges you surfaced live — this is
  where the decision tree becomes durable.
- An ADR records a decision the user **explicitly confirmed**, never a bare
  recommendation.

## `design.md` template (written at wrap-up)

This is the Shared Understanding from SKILL.md, persisted and linked.

```markdown
# Design — <plan name>

## Goal
One or two sentences: what we're building and why.

## Decisions
- [ADR 0001 — Data model](adr/0001-data-model.md): single Postgres table, soft-delete.
- [ADR 0002 — Auth strategy](adr/0002-auth-strategy.md): per-tenant JWT.

## Dependency map
0001 → constrains 0002, 0003. (Mirror the coverage ledger's blocks/blocked-by.)

## Open / deferred
- Rollback story — deferred to pre-launch (low risk pre-GA).

## Risks & mitigations
- <risk> → <guard>.

## Next step
The first concrete thing to build, described — not coded.

## Glossary
See [glossary.md](glossary.md).
```

## Writing the files

Prefer your native file-write tool. **If your runtime can't write files directly**
(e.g. a sandboxed workflow with no filesystem access), don't silently skip the
artifacts — dispatch a small helper agent (a cheap sub-agent with Bash/Write) to
persist the exact content you produced, or paste the full file contents into chat
clearly fenced and labeled with their target paths so the user can save them. The
artifacts are the deliverable in Docs Mode; **never claim they were written if
they weren't.**

## Boundaries

- **No code.** ADRs and the glossary describe decisions and vocabulary, not
  implementation. No source files, no schemas, no signatures, no pseudocode.
- **Append-only ADRs.** Reversals get a new superseding ADR, preserving history.
- **One ADR per branch**, not per question — a branch is the unit of decision.
