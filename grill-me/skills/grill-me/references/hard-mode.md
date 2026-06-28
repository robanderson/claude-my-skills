# Hard mode — schemas, the drift algorithm, and a worked re-run

Read this before your first **`grill me hard`**. It is the detail layer behind the
three-stage flow in SKILL.md (ASSEMBLE → TOURNAMENT → INTERACT). Hard mode is still
**planning-only**: the tournament computes ranked *answer options*, never code, and
the interactive session never writes implementation.

---

## Stage 1 detail — the dual question-source

Every hard grill starts by deciding **where the questions come from**. Get this
right first; the rest of the stage depends on it.

| Source | You see… | You do… |
|--------|----------|---------|
| **(a) task-derived** | a stated task + the marker (*"make me a web page for X — grill me hard"*) | MAP the task's decision tree (branch menu) into a written question list, exactly as the basic MAP step — but recorded as structured items, not asked live |
| **(b) from-context** | the conversation already named the open issues (*assistant: "4 issues need confirming" → user: "grill me hard on the outstanding questions"*) | LIFT those already-surfaced issues verbatim into the list — **skip fresh mapping** |

**Disambiguation rule (apply in order):**
1. Did the marker phrase point at existing issues ("…on the outstanding
   questions / those / the issues above")? → **(b)**.
2. Is there an explicit, recent list of open issues in the conversation the user
   is plainly referring to? → **(b)**, lift it.
3. Otherwise → **(a)**, map the task.
4. Genuinely 50/50? Ask the **one** permitted up-front question:
   *"the N issues above, or a fresh decision-tree map of the task?"* — then proceed.

Why distinguish: re-mapping a task when the user already handed you the issue list
wastes effort and risks inventing branches they don't care about; conversely,
lifting "issues" that were never actually surfaced means you skipped the real
decision-tree work. The source decides whether you *generate* the list or *adopt* it.

> **From-context still gets the discover-first filter.** Surfaced "issues" routinely
> contain look-up-able facts ("which queue lib do we use?"). Filter them the same
> way — don't tournament a fact just because a human typed it as a question.

---

## Stage 1 detail — the discover-first filter

Run "discover, don't interrogate" **in bulk**, before the tournament, over every
candidate item from either source. Classify each:

- **`kind:"fact"`** — answerable from repo / git / configs / deps / docs / prior
  art. **Resolve it now** by exploring. Record the finding as an assumption line in
  `context`, e.g.:
  > `FACT: src/queue/ already wraps SQS with retry/backoff → assume SQS durable queue.`
  It does **not** enter `questions`. (If exploration is *inconclusive* — the repo
  hints but doesn't settle it, or it's genuinely a judgment dressed as a fact —
  promote it to `kind:"intent"` and tournament it. When unsure, prefer intent: a
  needless tournament option is cheaper than a wrong silent assumption.)
- **`kind:"intent"`** — needs human judgment, taste, priority, deadline, or a
  tradeoff call. It **enters** `questions`.

**Net effect:** the tournament only ever ranks options for things a human actually
has to decide. Facts are pre-baked into `context` as fixed ground truth, so the 5
generate agents answer *under the real constraints* instead of re-deriving (or
contradicting) them. (As a safety net the workflow also drops any `kind:"fact"`
that slips into `questions` and reports them in `skippedFacts`.)

### The question object

Each surviving intent item:

```jsonc
{
  "id":        "q3",                 // stable, short; referenced by dependsOn + assumes
  "branch":    "dedup",             // the branch-menu bucket, for the progress tally
  "text":      "Should every event carry an idempotency key the consumer dedupes on?",
  "kind":      "intent",            // facts are filtered out before this list is built
  "dependsOn": ["q1"]               // upstream question ids whose answer THIS answer hinges on
}
```

**`dependsOn` is the spine of drift handling — invest in it.** An edge `q3 → q1`
means "the right answer to q3 changes depending on how q1 was answered." Add an edge
whenever a question's best answer would flip under a different upstream choice; omit
it when the questions are genuinely independent. Over-linking creates needless
re-run offers; under-linking lets stale options slip through. A clean `dependsOn`
graph is also a DAG — if you find a cycle, two questions are really one; merge them.

---

## Stage 2 detail — what the workflow computes

`grill-hard.workflow.js` takes `{ task, questions, context }` and runs two phases:

- **Generate** — 5 agents, each independently answers the **whole** intent list as a
  coherent package (later answers consistent with the upstream stance they took).
  For every question with a `dependsOn`, each agent fills `assumes` — naming, in a
  short canonical phrase, exactly which upstream answer its answer presupposes.
  Five deterministic *lenses* (pragmatist / architect / risk-minimizer / UX /
  contrarian, indexed — no randomness) keep the five answers from collapsing into
  one. Exact-duplicate answers across attempts are merged as a convergence signal.
- **Judge** — for each question independently: the candidate answers are lettered
  A–E; **3 judges** rank them blind (round A — independent), then **cross-talk**
  (round B — each judge sees the other two's round-A ranking) and converge. The
  script then **tallies in-script**:
  - **Order by ≥2/3:** the ordering is the **Copeland pairwise-majority** of the
    judges (an edge needs a strict majority; Borda points break ties). Each adjacent
    edge is tagged `strong` when ≥2/3 of judges agree, else `split`. A Condorcet
    cycle or pairwise tie surfaces the winner as `consensus:"split"` — the skill's
    cue to push harder.
  - **Amalgam:** if ≥2/3 of the cross-talk judges flag a blend `worthwhile`, slot #1
    becomes a synthesized **amalgam** (text taken from the judge closest to the
    consensus order); otherwise `amalgam` is `null`. The amalgam is a **separate
    field**, not spliced into `ranked` — the skill presents it as option A above
    `ranked[0]`.
  - **Distinctness + cap:** options are de-duped by answer text and capped at top 4.
  - **`assumes` anchor:** the recommended #1's upstream presuppositions, taken from
    the closest-to-consensus judge's reconciled `assumes` (else the consensus top
    candidate's), filtered strictly to the question's real `dependsOn`.

### Return shape

```jsonc
{
  "task": "…",
  "skippedFacts": ["qf"],            // any kind:"fact" that slipped in; the workflow ignored them
  "perQuestion": [
    {
      "id": "q3",
      "branch": "dedup",
      "dependsOn": ["q1"],
      "assumes": [ { "onId": "q1", "assumedChoice": "at-least-once delivery" } ],
      "ranked": [                     // ordered top 3-4 DISTINCT options, best first
        { "answer": "stable event_id, consumer dedupes", "why": "…", "consensus": "lead" },
        { "answer": "dedupe by (type,resource,version)", "why": "…", "consensus": "strong" }
      ],
      "amalgam": { "answer": "stable event_id, consumer dedupes", "why": "…" },
      "consensus": "strong"           // strong | split | lead | single | none
    }
  ],
  "tournament": { "attempts": 5, "judgesPerQuestion": 3, "crosstalk": true, "rule": "…", "presenting": "…" }
}
```

Present slot A = `amalgam.answer` when `amalgam` is non-null (tag it `(synthesis)`),
else `ranked[0]`; then the rest of `ranked` (skip any the amalgam restates), then
the ✎ free-type slot. **Cache `perQuestion`** for the whole session — you re-read
`assumes` after every pick, and you splice fresh entries into it on a re-run.

### Invoking it (Workflow tool)

```
Workflow(
  scriptPath: "grill-hard.workflow.js",   // ships in THIS skill dir; installed at skills/grill-me/grill-hard.workflow.js
  args: { task, questions, context }
)
```

`questions` is intent-only; the discovered facts ride in `context`. The script
**writes no files and runs no interview** — you run the interview in Stage 3.

---

## Stage 3 detail — the full drift algorithm

You hold three structures through the interactive session:

- `perQuestion` — the cached tournament output (each entry carries `assumes`).
- `picks` — `{ questionId → the option the user actually confirmed }`, built live.
- `presented` — the set of question ids already shown (so drift only touches the
  *future*; a question already answered is settled, not re-opened by drift).

```
ON every confirmed pick (user confirms option P for question X):
  1. picks[X] = P
  2. driftSet = {}
     FOR each question j in perQuestion where X ∈ j.dependsOn AND j ∉ presented:
        a = j.assumes.find(onId == X)            // what j's baked answer assumed for X
        IF a is missing            → driftSet += j   // j depended on X but stated no assumption: re-check
        ELSE IF materiallyDiffers(P, a.assumedChoice) → driftSet += j
        // materiallyDiffers: would j's recommended answer plausibly change under P
        // vs a.assumedChoice? Judge semantically; when unsure, treat as DIFFERENT (fail safe).
  3. IF driftSet is empty → continue the interview normally.
  4. ELSE expand ONE hop:
        reRun = driftSet ∪ { direct, not-yet-presented dependents of each j in driftSet }
        // those dependents assumed j's now-stale answer, so their options may be stale too.
  5. FLAG each question in reRun (⚠ drifted) in the tally, and OFFER the re-run:
        "Your pick on X (<P>) diverges from what these N questions assumed
         (<old assumption>). Re-tournament just those with your real choices baked in? (y/n)"
  6a. IF yes → re-invoke grill-hard.workflow.js with:
          questions = reRun            (dependsOn edges unchanged; upstreams now resolved)
          context   = originalContext
                      + "\n\nCONFIRMED DECISIONS (treat as fixed):\n"
                      + every pick so far, one per line ("X = <P>", …)
        Splice each returned perQuestion entry over its old one (match by id).
        Clear the ⚠ flag on the spliced questions. Continue.
  6b. IF no → KEEP the stale options, but when each flagged question comes up,
        present it annotated: "(assumed X = <old>; you chose <new> — options may be
        stale; say 're-run this' to refresh)". Never present stale-as-fresh.
```

### Why one hop is sufficient (and bounded)

Re-tournamenting `j` may change `j`'s own answer. The questions that assumed `j`'s
*old* answer are exactly `j`'s direct dependents — so including them in the re-run
covers the immediate blast radius. You do **not** need the transitive closure up
front: if the re-run produces a new recommended answer for `j` and the user later
picks something that diverges from what `j`'s *grand*-dependents assumed, the **same
drift check fires again** at that pick. Drift propagation is therefore **lazy and
self-healing** — each pick repairs exactly its own one-hop neighbourhood, and the
chain extends only as far as real divergence actually reaches. This is what keeps a
re-run "targeted" instead of degenerating into a full re-grill, while still
guaranteeing no question is ever presented with options inconsistent with an
upstream pick.

### `materiallyDiffers` — calling it well

This is a **semantic** judgment, not string equality. `"at-least-once"` vs
`"at-least-once delivery (durable queue)"` is the **same** choice. `"at-least-once"`
vs `"best-effort"` is **different**. The bar: *would the downstream question's
recommended answer plausibly flip under the user's pick versus what was assumed?*
When you can't tell, **flag it** — a spurious re-run offer the user declines costs
one line; a missed drift ships stale options into a decision the user trusts.

### Edge cases

| Situation | Handling |
|---|---|
| User free-types a custom answer (not an option) | Treat the free-typed text as `picks[X]`; run the drift check against it like any pick (it diverges from *every* baked assumption more often, so expect more offers — correct). |
| User reopens an already-answered question and changes it | Re-run the drift check for it; its `presented` dependents may now drift "backwards" — offer the re-run for those too (drop them from `presented` if you re-present). |
| A question returns empty `ranked` (all attempts/judges failed for it) | Fall back to basic-mode inline option generation for that one question; note it. |
| `consensus:"split"` on a question | The panel didn't reach a clean ≥2/3 order — present it, but push harder and lean on the ✎ slot; don't rubber-stamp option A. |
| The drifted set is large (e.g. a foundational q1 flips) | Still offer the one-hop re-run; if the user wants everything downstream refreshed, that's their call — but default to targeted, and let lazy propagation handle the rest pick-by-pick. |
| User declines, then later wants it refreshed | "re-run this" on any ⚠-flagged question triggers a single-question re-tournament (questions = [that id], same enriched context). |

---

## Worked example — a drift re-run, end to end

Plan: *"Add a webhook system so customers get notified on order events — grill me hard."*
Source **(a) task-derived**. After the discover-first filter, `context` carries one
fact (`FACT: src/queue/ wraps SQS → assume SQS`), and `questions` =

```
q1 [delivery]              — at-least-once vs best-effort?            dependsOn: []
q2 [schema]                — flat envelope vs typed payloads?         dependsOn: []
q3 [dedup]                 — idempotency key?                         dependsOn: [q1]
q4 [retry]                 — retry/backoff policy?                    dependsOn: [q1, q3]
```

Stage 2 tournaments all four. The relevant baked `assumes`:
`q3.assumes = [{onId:q1, assumedChoice:"at-least-once"}]`,
`q4.assumes = [{onId:q1, assumedChoice:"at-least-once"}, {onId:q3, assumedChoice:"event_id dedupe"}]`.
Both recommend rich answers built on an **at-least-once** world.

Stage 3 opens on the highest-impact branch, q1:

> **Grill:**
> [Branch: delivery · resolved 0/4 · Q1 of 4]
> Q: Do webhooks need at-least-once delivery, or is best-effort acceptable for v1?
>
> &nbsp;&nbsp;A ★&nbsp; At-least-once, durable SQS queue + retry — order events are money-adjacent; a missed `order.paid` is a support ticket
> &nbsp;&nbsp;B&nbsp;&nbsp; Best-effort fire-and-forget — simpler, but silent drops
> &nbsp;&nbsp;✎&nbsp;&nbsp; other / refine
>
> → A / B, or ✎.&nbsp;&nbsp; · blocks: dedup (q3), retry (q4)

> **User:** Best-effort actually — this is just for a low-stakes activity feed, drops are fine.

The pick is **B (best-effort)**. DRIFT CHECK:
- Downstream of q1, not yet presented: **q3** (`assumed q1 = at-least-once`) and
  **q4** (`assumed q1 = at-least-once`). `best-effort` **materially differs** from
  `at-least-once` for both → `driftSet = {q3, q4}`.
- One-hop expand: q4 is already in the set (q3's dependent and q1's). `reRun = {q3, q4}`.

> **Grill:**
> ✓ delivery = **best-effort fire-and-forget** (low-stakes activity feed; drops acceptable).
> ⚠ Heads-up: the pre-computed options for **dedup (q3)** and **retry (q4)** assumed
> at-least-once — under best-effort they're likely stale. Re-tournament just those
> two with your real choice baked in? (y/n)

> **User:** Yes.

Re-invoke `grill-hard.workflow.js` with `questions = [q3, q4]` and
`context = <original> + "CONFIRMED DECISIONS (treat as fixed): q1 = best-effort fire-and-forget"`.
The fresh tournament now answers q3/q4 in a best-effort world — q3's new #1 is
*"skip idempotency keys for v1; activity-feed dupes are harmless"*; q4's is *"no
retry; log-and-drop on failure."* Splice both over the old entries, clear the ⚠
flags, and continue.

*Annotation:* the stale at-least-once options never reached the user. The re-run was
**targeted** (two questions, not a full re-grill), **anchored** to the real pick (the
`CONFIRMED DECISIONS` block), and **self-propagating** — if the user now overrides q3
back to "add `event_id`", q4's drift check fires again and offers to refresh just q4.
One pick, one one-hop repair, and the interview's options stay consistent with every
decision actually made.
