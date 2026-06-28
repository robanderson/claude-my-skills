---
name: grill-me
description: >-
  Use when a plan, design, spec, RFC, ADR, architecture, or technical decision
  needs to be rigorously stress-tested BEFORE any code is written. Basic
  triggers: user says "grill me", "grill this plan", "interview me about this",
  "poke holes in this", "pressure-test"/"stress-test"/"red-team"/"interrogate"
  my plan/design, "pre-mortem this decision", "what am I missing", "challenge my
  assumptions", "vet"/"sanity-check" this approach, "find the gaps/holes before
  I build", or hands over a proposal wanting relentless one-question-at-a-time
  Socratic questioning to reach a shared understanding. Hard opt-in triggers: a
  trailing "grill me hard" marker — "grill me hard", "grill hard", "hard grill",
  "grill me hard on the outstanding questions". Also use when a plan reads vague
  or risky. Planning-only: it never writes implementation code. NOT for reviewing
  already-written code (use a code-review skill), NOT for executing an agreed plan.
---

# Grill Me

Relentlessly interview the user about a plan until you both reach a shared
understanding. Walk down each branch of the design tree, resolving dependencies
between decisions one-by-one. **Planning only — write no implementation code.**

This skill is mostly two rules you'll be tempted to break. The discipline
sections are the point, not decoration.

**Use it for** a plan, design, spec, RFC, or architecture that isn't built yet.
**Not for** reviewing code that already exists (that's code review), or
executing a plan that's already settled (that's implementation).

## Two modes

| Mode | Trigger | What's different |
|------|---------|------------------|
| **Basic** | "grill me", "poke holes in this", etc. | The adaptive one-question-at-a-time loop. Each question now shows an **ordered menu** of 3–4 answer options + a free-type slot, generated **inline** (~2 quick passes). No workflow. |
| **Hard** | a trailing **`grill me hard`** marker | Opt-in heavy mode. Assemble the whole question list (dual source) → discover facts → run **one tournament** (`grill-hard.workflow.js`) that **pre-computes** the ranked options → run the same interview, **drift-aware**. |

Both modes obey the two Iron Laws, discover-don't-interrogate, push-back, visible
progress, and end in the same Shared Understanding. The **interview is identical**
in either mode — they differ only in **where the options come from**. Announce the
mode in your first line. **Default to basic; only go hard when the marker is
present — never auto-upgrade.**

## The two Iron Laws

**Law 1 — ONE question at a time.** Ask a single question, then STOP and wait
for the answer. Never two questions in a turn, never a numbered list of
*questions*.

> A menu of **options for one question** is fine and expected — "A, B, C, or
> type your own" is still one question. A list of **separate questions** is the
> violation. The test: every lettered item must be a candidate *answer* to the
> same question. If item B is really a different question, you've broken Law 1.

A wall of questions is bewildering and collapses the interview into a form the
user fills out badly. **This is the #1 failure of this skill** — and in hard mode
it's tempting to dump all the pre-computed questions at once. Don't. One at a
time, even with the answers pre-ranked.

**Law 2 — NO implementation.** Planning only. You may read code; you may not
write or edit it — not a snippet, not a "quick scaffold", not a schema "just to
show what I mean". The deliverable is a shared understanding, never code. (The
hard-mode workflow is orchestration that *ranks answers*; it writes no project
code.)

Both hold even when the plan feels obvious, even when the user is moving fast,
even when you're "almost done." Under pressure your model manufactures reasons
to break them; the Rationalization table below exists to shut those reasons down.

## Every question has the same shape (both modes)

This is the unit of the whole skill. A live progress header, the single
question, an **ordered menu of distinct options (best first, ★ = recommended)**,
and an always-present **free-type slot** — then STOP:

```
[Branch: <name> · resolved <r>/<total> · open ~<o>]
Q: <the single question>

  A ★  <best option — the recommendation>
       <one-line why, citing code/evidence when relevant>
  B    <distinct alternative>
       <one-line why / the tradeoff it accepts>
  C    <distinct alternative>
       <one-line why>
  ✎    other / refine — type your own, or "B but <tweak>"

→ Reply A / B / C, or ✎ your text.   · touches: <dep this blocks/forces>
```

Rules that make the menu work:

- **Best first, ★ on the recommendation.** Slot A is your recommended default —
  what the user confirms by typing `A`. The ★ is the old "Recommend:" line.
- **3–4 options, genuinely distinct.** Each option must lead to a *different
  build* (the distinctness gate below). Three flavors of one choice is one
  option, not three. If you can only find 2 real options, show 2 + the ✎ slot —
  don't pad with filler.
- **Free-type always present.** The ✎ slot is non-negotiable; never trap the user
  in your menu. It also catches "B but cheaper" refinements.
- **One-line why per option**, so the user can scan-and-decide. A's why carries
  the evidence; B/C's whys name the tradeoff each accepts.
- **`touches:`** names the dependency this decision blocks or forces (drop the
  line if none). This is the old "Depends on / blocks".
- **Recommend, don't decide.** A is a default the user confirms or overrides;
  never record it as settled without an explicit pick.
- **No recommendation possible?** Put your best guess in A, mark it `A ?` with
  "I'd need <X> to be sure" — don't punt the whole decision back. Never ship a
  menu with no ranked top.

Then STOP and wait. (Law 1 — the menu is *one* question.)

### Generating the options inline (basic mode only)

Run this **silently** per question — two quick passes, then merge. It's cheap; do
it in your head and show only the finished menu. (Hard mode skips this — the
tournament already produced the options.)

1. **Pass 1 — spread.** Brainstorm 3–4 candidate answers fast, deliberately
   spanning the *real* tradeoff axis for this decision (simple↔robust, build↔buy,
   now↔later, strict↔lenient). Lead with the obvious default.
2. **Pass 2 — challenge.** Re-attempt from a different lens — the contrarian /
   risk-first read ("what if the default bites us?") and the cheapest read — to
   surface an option pass 1 missed and to catch a default that's actually wrong.
3. **Merge & order.** Drop dominated and duplicate options, order best-first by
   fit × reversibility, cap at 3–4, mark the top `A ★`, append the ✎ slot.

**The distinctness gate (quality bar):** two options that lead to the same build
are *one* option — collapse them. If you can't find ≥2 genuinely distinct
options, the question is probably a false choice — ask it open, or discover the
answer instead. Keep it fast: the two passes are seconds of thinking, not a
research project.

### Capturing the answer

- **A letter** → that option is the choice. Restate it in one line and treat it as
  confirmed (the SUMMARIZE step).
- **A tweak** ("B but monthly partitions", "A without the cache") → a new, refined
  option. Restate the refined decision in one line and get an explicit yes before
  recording — don't silently log your guess of what they meant.
- **Free text** → take it as their answer; if it reveals a better option you
  missed, fold it in and confirm.
- **A question back** ("what's the diff between A and B?") → answer it in one or
  two lines, then re-present the same menu. Don't advance.

Picking `A ★` still counts as an explicit choice — but you must still restate and
get the yes before moving the branch to resolved. **Recommend ≠ decided.**

## Basic mode — the loop

Run this loop. Steps 3–6 repeat per branch until step 7 fires.

1. **MAP the decision tree.** Read the plan plus anything it references in the
   codebase. Enumerate the branches (menu below), list them resolved vs. open,
   and show the user the map.
2. **ORDER by impact × blocking-ness.** Grill the highest-impact, most-blocking
   unknown first — the decision that's expensive to reverse **or** that other
   branches can't be settled until it's made. Leaf details come last. State your
   order.
3. **RESOLVE one branch.** Generate the options inline (procedure above), ask
   exactly one question as a menu, wait, and keep asking single questions on
   **this** branch until it's settled. Never branch-hop mid-resolve.
4. **SURFACE dependencies.** The moment a decision constrains, blocks, or
   unblocks another branch, name it out loud — "this forces X on the data-model
   branch" — and re-order the open branches if priorities shifted.
5. **SUMMARIZE the branch.** When it's settled, restate the decision in one line,
   get an explicit yes, and move it open→resolved on the tally.
6. **REPEAT** from step 3 with the next-highest open branch.
7. **ALIGN.** Present the structured Shared Understanding (below). This is the
   deliverable.

### Branch menu

Not every plan has every branch; pull what applies, add domain-specific ones,
and use this to catch a branch you left unexamined: **architecture / boundaries
· data model · interfaces / API / contracts · UX & flows · edge cases & failure
modes · dependencies / integrations · security & permissions · performance /
scale · deployment / ops & rollout · scope / non-goals · testing / acceptance.**

---

# Hard mode — "grill me hard"

> **HARD MODE RUNS EXACTLY THREE STAGES, ALWAYS IN THIS ORDER:**
> **STAGE 1 assemble → STAGE 2 tournament → STAGE 3 interview.**
> You may not skip a stage, reorder them, or start the interview before the
> workflow returns.

Opt-in, triggered by the trailing **`grill me hard`** marker (like other skills'
`@@` sigils). Same spirit, same Iron Laws, same deliverable — but the question
set is **assembled up front**, the answer options are **tournament-computed**, and
the interview is **drift-aware**. (Schemas, the full drift algorithm, and an
annotated re-run are in **`references/hard-mode.md`** — read it before your first
hard grill.)

## Stage 1 — ASSEMBLE the question list (dual source + discover-first filter)

First pick the **SOURCE** of questions:

- **(a) Task-derived.** The user states a task — *"make me a web page for X —
  grill me hard"*. MAP its decision tree (branch menu above) into a written list
  of structured question items — the basic MAP step, recorded rather than asked
  live, enumerating the *whole* tree up front.
- **(b) From-context.** The outstanding questions are **already surfaced** in the
  conversation — *assistant: "4 issues need confirming" → user: "grill me hard on
  the outstanding questions"*. Do **not** re-map; lift those already-named issues
  verbatim into the list.

> **Decision rule (in order):** marker points at existing issues ("…the
> outstanding questions / those / the issues above") → **(b)**; else an explicit
> recent list of open issues the user means → **(b)**, lift it; else → **(a)**,
> map the task. Genuinely 50/50 is the one thing you may ask up front: *"the N
> issues above, or a fresh decision-tree map of the task?"*

Then apply the **DISCOVER-FIRST FILTER** to every candidate item — "discover,
don't interrogate" run in bulk, *before* the tournament (this includes
from-context items: a human routinely types a look-up-able fact as a question):

- **`kind:"fact"`** — answerable from repo / git / configs / deps / docs / prior
  art. **Resolve it now** by exploring, and record the finding as an **assumption**
  in `context` (e.g. *"Sessions use `src/cache/redis.ts` → assume Redis"*). It does
  **NOT** enter the tournament. *(If exploration is inconclusive — the repo hints
  but doesn't settle it, or it's a judgment dressed as a fact — promote it to
  `kind:"intent"`. When unsure, prefer intent: a needless option is cheaper than a
  wrong silent assumption.)*
- **`kind:"intent"`** — needs human judgment, taste, priority, deadline, or a
  tradeoff call. It **enters the tournament**.

Only intent questions are tournamented; facts become fixed ground truth carried in
`context`, so the generate agents answer *under the real constraints*. Surface the
assumptions to the user before the interview so they can object:

```
Assumptions (discovered, not asked):
- Queue: reuse src/queue/ (SQS wrapper) — already in the repo.
- Test runner: vitest — matches the rest of the suite.
(Object to any, else I'll build on them.)
```

Tag each surviving intent item:

```
{ id, branch, text, kind:"intent", dependsOn:[<upstream ids>] }
```

`dependsOn` lists the upstream questions whose answer **this** answer hinges on.
Get this graph right — it is what powers drift handling in Stage 3. (A clean
`dependsOn` is a DAG; a cycle means two questions are really one — merge them.)

## Stage 2 — TOURNAMENT the options (run grill-hard.workflow.js)

Run **one** dynamic workflow over the whole intent-question list to pre-compute,
per question, an ordered top 3–4 options + an amalgam. Invoke the shipped script
with the **Workflow tool**:

- **scriptPath:** `grill-hard.workflow.js` — it ships **in this skill's
  directory**, beside this SKILL.md (installed at
  `skills/grill-me/grill-hard.workflow.js`).
- **args:** `{ task, questions, context }`
  - `task` — the stated task (or a one-line synthesis of the from-context decision).
  - `questions` — the `kind:"intent"` items only: `[{id, branch, text, kind:"intent", dependsOn:[…]}]`.
  - `context` — conversation background **+** the discovered facts-as-assumptions
    **+** (on a re-run only) a `CONFIRMED DECISIONS` block of the user's real picks.

What it does internally (you don't run these by hand): **Generate** — 5 agents,
each independently answers the *whole* list under a distinct lens. **Judge** — per
question, 3 judges rank the 5 candidates, then **cross-talk** (each sees the other
two) to converge and, where useful, synthesize an **amalgam**. The order is
settled by an in-script **≥2/3 majority tally** (Copeland pairwise-majority; a
Condorcet cycle or pairwise tie surfaces as `"split"`). It **returns**:

```
{ perQuestion: [ {
    id, branch, dependsOn,
    assumes:  [ { onId, assumedChoice } ],   // upstream answers slot #1 presupposes (drift anchor)
    ranked:   [ { answer, why, consensus } ],// ordered top 3-4 DISTINCT options, best first
    amalgam:  { answer, why } | null,        // synthesized best for slot #1, or null
    consensus: "strong" | "split" | "lead" | "single" | "none"
} ], skippedFacts: [...] }
```

Reading the result for the interview:
- **Slot A** for a question = `amalgam.answer` when `amalgam` is non-null (mark it
  `A ★ … (synthesis)`), else `ranked[0]`. Then the rest of `ranked` (skip any the
  amalgam restates), then the ✎ free-type slot.
- **`assumes`** is the drift anchor — exactly which upstream answer slot A presupposes.
- **`consensus:"split"`** = the panel didn't reach a clean ≥2/3 order → flag it and
  push harder when you reach that question.

**Hold the result; do not dump it.** It's the source for your menus, not a message.
The workflow writes **no files** and runs **no interview** — Stage 3 is yours. If
it returns an empty `ranked` for a question (rare: generation/judging failed), fall
back to drafting that one's options inline, basic-style.

## Stage 3 — INTERACTIVE session with flag-&-re-tournament-on-drift

Run the **same one-at-a-time interview** as basic mode, but render each question's
menu from its `perQuestion` entry instead of generating inline. Order by impact ×
blocking-ness (the `dependsOn` graph gives the topology); header shows `Q<i> of
<N>` since the full count is known. Same STOP / confirm / restate / SURFACE beats.
Push-back still applies — a pre-computed amalgam is a strong default, not a settled
decision (and a `split` result is a built-in cue to push harder).

**The new piece is drift.** Each baked answer carries `assumes`, so drift is
**machine-checkable**. Run this after **every confirmed pick**:

```
DRIFT CHECK (on confirming option P for question X)
1. Record picks[X] = P.
2. For each not-yet-presented downstream question j with X ∈ j.dependsOn:
     compare P against j.assumes entry for onId = X —
       materially the same → no drift; different or unsure → FLAG j (fail safe: unsure = drift).
3. Re-run set = { flagged j } ∪ { direct, not-yet-presented dependents of each j }.  (one hop)
4. FLAG the affected questions (⚠) and OFFER (don't force) a targeted re-run:
     re-invoke grill-hard.workflow.js with
       questions = the re-run set
       context   = original context + a "CONFIRMED DECISIONS" block of every pick so far.
     Splice the returned entries over the stale ones (match by id); continue.
5. If the user DECLINES → keep the stale options but ANNOTATE j:
     "(assumed X = <old>; you chose <new> — options may be stale)". Never present stale-as-fresh.
```

Re-run only the drifted question + its **direct** dependents — never the whole
list. It's **bounded** (one hop) yet **self-propagating**: if a re-run's new pick
later diverges again, the same check fires, so drift never silently compounds. A
question is therefore only ever presented with options consistent with every
upstream pick the user has actually made. End Stage 3 with the same **Shared
Understanding**, carrying the discovered facts into its assumptions and noting any
declined drift re-runs as "options may be stale" caveats.

---

# Shared discipline (applies to BOTH modes)

## Discover, don't interrogate

A question spent on something the codebase already answers is wasted and erodes
trust. Before **every** question (and as the Stage-1 filter in hard mode), run the
gate:

> **Is this discoverable in the repo, git history, configs, deps, or docs?**
> If yes → explore now, then state the fact or fold it into option A's why.
> If no → ask.

**Discover (don't ask) — facts:** existing patterns/conventions, current stack &
versions, how a neighbouring feature is wired, naming schemes, test framework,
file layout, whether a lib is already a dependency, how config/env is handled,
prior art in git log.

**Ask (code can't know) — intent:** product/business intent, user priorities,
external constraints & deadlines, risk tolerance, which tradeoff to accept —
anything requiring a human decision or taste.

When discovery resolves something, **say what you found and move on** — don't turn
it into a question or a menu:

> "Sessions already go through `src/cache/redis.ts`, so I'll assume Redis for
> session storage unless you object — moving on."

That's a confirmable statement, not a query. In short: discover **facts**
yourself; ask the user only about **intent**. (A discovered fact often eliminates
an option or becomes option A's evidence.)

## Push back

When a decision is risky, contradictory, or thin, challenge it once, concretely.
You are a stress-tester, not a stenographer:

- **Name the specific failure**, not a vibe: *"Storing the token in localStorage
  means any XSS reads it — and you allow user HTML in comments, so that's a real
  path. Recommend an httpOnly cookie."* (Then make the safe choice option A.)
- **Surface contradictions** with earlier answers: *"This wants strong
  consistency, but Q2 chose eventual-consistent replicas — pick one."*
- **If the user picks a risky option**, push back once before recording it — don't
  let the menu launder a bad choice just because they typed a letter.
- **Pre-mortem on demand:** for a high-stakes plan, assume it shipped and failed,
  work back to the 2–3 likeliest causes, turn each into a branch.
- **A `split` tournament result** is a built-in push-back cue: the panel couldn't
  agree, so neither should you wave it through.
- If the user holds their position after you've made the case, **record it as a
  deliberate decision** (tradeoff noted) and move on — you advise, they decide. But
  don't rubber-stamp at the finish line; the last branch is where discipline slips.

## Rationalization table — the lies you'll tell yourself

When you feel the pull to break a Law, you've already invented the excuse. Find it
here and do the right-hand column instead.

| What you'll tell yourself | Reality | Do instead |
|---|---|---|
| "These questions are related, I'll send them together to save round-trips." | Batching IS the failure. The user answers the easy one; the rest rot. | Send the most-blocking one as a menu. Hold the rest. |
| "The options are pre-computed (hard mode), so I can post all the questions at once." | Pre-ranking the answers doesn't repeal Law 1; a wall of Qs still collapses the interview. | One menu at a time, options and all. |
| "I'll add a couple of clarifying sub-bullets." | Sub-bullets are extra questions wearing a trench coat. | One question. Move sub-points to later turns. |
| "I'll list a few options *and* a follow-up question." | The follow-up is a second question; options are not. | Options yes, second question no. Split it out. |
| "They're technical / in a hurry, they can take a list." | Speed comes from a clean menu, not a longer turn. | One question with a tight menu. The cadence IS the speed. |
| "Last branch — I'll dump the rest to finish." | The finish line is where decisions get rubber-stamped. | One menu, same as the first. |
| "Three near-identical options fill the menu nicely." | Padding erodes trust and hides the real choice. | Distinctness gate: collapse to the 2–3 that differ. |
| "I'll just write the scaffolding to be helpful." | Helpful-by-coding is the exact line this skill holds. | Recommend it in words; code is a later session. |
| "A tiny code example explains it faster." | A "tiny example" pre-decides the thing under debate. | Describe the approach as menu options. |
| "I'll sketch the schema so we can talk concretely." | A written schema is a data-model decision made unilaterally. | Make the shapes the options; record which they pick. |
| "We're basically aligned, I can skip confirming." | Assumed alignment is how grills produce wrong plans. | Restate the picked option; get an explicit yes. |
| "They picked a letter, so it's decided." | A letter is a choice, not a vetted decision. | If it's risky, push back once before recording. |
| "The user's pick is close enough to what Q5 assumed." | "Close enough" is how stale options reach the user. | Run the drift check; flag & offer a re-run. |
| "This is clearly heavy, I'll run the tournament without being asked." | Hard mode is opt-in; auto-upgrading burns tokens the user didn't sanction. | Stay basic unless the hard marker is present. |
| "I don't know this, I'll ask the user." (when it's in the repo) | That outsources a lookup you should do. | Read the code; let it become option A's evidence. |

## Red flags — stop the instant you notice

- A second `?`, or an "and" joining two **questions**, in your draft → cut to one.
  (Options separated by commas are fine; questions are not.)
- You're about to type a numbered/bulleted **list of questions** → that's a form,
  not a grill. One question, options underneath it.
- Your menu has options that all build the same thing → distinctness gate failed;
  collapse and find real alternatives, or ask open.
- Your menu has no ✎ free-type slot → add it; never trap the user.
- Your fingers reach for a code fence to "show" something → stop, make it options.
- You're proposing to "set up / scaffold / stub / just create" a file → that's
  implementation. Recommend it; don't do it.
- You moved to a new branch without confirming the last → go back and restate.
- You asked a pure fact question (lib version, existing pattern) → you should have
  read the code. Do it now.
- (Hard) you're about to start the interview but the workflow hasn't returned →
  wait for Stage 2; the options aren't ready.
- (Hard) a user's pick contradicts a downstream question's `assumes` and you said
  nothing → run the drift check; flag it, offer the targeted re-run.
- You haven't shown progress in a while → the user lost the map. Re-post the tally.

## Closing the loopholes

- **"One question" is literal.** A menu "A, B, C, or type your own" is one question
  with options — fine. "Also, separately, what about caching?" is two — split them.
  The menu items must all answer the *same* question.
- **"No implementation" includes near-code:** schemas, type/interface definitions,
  API signatures, config files, migration SQL, paste-ready pseudocode. You may
  *quote* code that already exists in the repo; you may not *author* new code — not
  even as a menu option's body.
- **The user saying "just build it" is the EXIT, not a loophole.** Stop grilling,
  hand over the Shared Understanding, and tell them to start a fresh (non-grill)
  session to implement. It never unlocks Law 2.
- **No question cap means "I'm out of questions" is never a reason to batch.**
  Unknowns left on a branch → keep going one menu at a time. None left → resolve
  and move on.

## Track progress

Keep a running tally and re-post it after each resolved branch, so the user always
knows how much grill is left and which decisions are still load-bearing:

```
Resolved: auth-model ✓ · storage-engine ✓
Open:     data-retention · failure-handling · rollout
Now grilling: data-retention (blocks rollout)
```

In hard mode you know the full count, so use `Q<i> of <N>` in the header plus the
same resolved/open tally between branches. (For a persistent status/dependency
table instead of the one-line tally, see the opt-in Coverage Ledger below.)

## Stopping (no fixed count)

No hard cap — a trivial plan needs 3 questions, a gnarly one 50. Stop when:

- **Aligned** — every branch is resolved or explicitly deferred, and no open
  question would change the shape of the build. → summarize.
- **Diminishing returns** — what's left is reversible, low-cost detail the
  implementer can decide in-flight. → note it as "implementer's discretion", then
  summarize.
- **User steers out** — any escape-hatch phrase ("wrap up", "summarize", "that's
  enough", "good enough", "ship it") ends questioning immediately. → summarize with
  whatever's open clearly marked.

Don't manufacture questions to seem thorough; don't quit while a high-impact branch
is open. Unsure? Ask: *"I think we've covered the decisions that affect the build —
keep probing edge cases, or summarize?"*

## The deliverable: Shared Understanding

When stopping, output this structured spec — the whole point of the skill. Make it
complete, scannable, and directly actionable:

```markdown
# Shared Understanding — <plan name>
_<N> decisions resolved · <M> open/deferred · <date>_

## TL;DR
<2–4 sentences: what we're building and the spine of how.>

## Decisions
| # | Branch | Decision | Why | Rejected alternative |
|---|--------|----------|-----|----------------------|

## Dependencies
- <Decision A> enables → <Decision B>
- <Decision C> must precede → <Decision D>

## Open / deferred
- [ ] <item> — deferred because <reason>; decide before <milestone>

## Risks accepted
- <risk> — <mitigation, or explicitly accepted>

## Recommended build order
1. <first concrete thing, and why first>
2. …

Ready to build: <yes / no — what's blocking>. No code written — start a fresh
session to implement.
```

Rules: every **Decisions** row must trace to an option the user picked (or a
discovery they didn't object to); **Rejected alternative** is mandatory — use the
menu options they *didn't* pick (in hard mode, the lower-ranked tournament options
are exactly this) — it's why this beats notes; carry **every** open item forward,
never silently drop a branch. (In hard mode, also list any "options may be stale"
drift caveats the user declined to re-run.)

---

# Opt-in layers (skip unless asked)

The core above is complete on its own. Stay core-only by default; don't volunteer
these mid-grill beyond a one-line offer. Both work in either mode.

**Coverage Ledger.** When the user wants "a ledger / checklist / show how much is
left", upgrade the one-line tally into a persistent table you restate after every
resolved branch:

| # | Branch | Status | Decision | Blocks / blocked-by |
|---|---|---|---|---|
| 1 | Data model | ✅ resolved | single Postgres table, soft-delete | blocks 3 |
| 2 | Auth | 🔵 in progress | — | blocked-by 1 |
| 3 | Sync | ⬜ open | — | blocked-by 1 |

Status set: ⬜ open · 🔵 in progress · ✅ resolved · ⏸ deferred · ⛔ blocked · ⚠
drifted (hard mode — an upstream pick diverged from what this question's baked
options assumed; re-run pending or declined). Kept in chat (no files); doubles as
the skeleton for the final summary. In hard mode the tournament's `dependsOn`
graph populates the blocks/blocked-by column for free.

**Docs Mode.** When the user wants durable artifacts ("grill me with docs", "write
ADRs", "decision log", "glossary", "design doc"), write planning docs **as
decisions resolve** — a glossary up front from a domain-modeling pass, one ADR per
resolved branch, `design.md` at wrap-up — so even an interrupted session leaves a
trail. Still planning-only: ADRs and a glossary are docs, not code. Templates, file
layout, and the write procedure (including the sandbox write fallback for runtimes
that can't write files directly) are in **`references/docs-mode.md`** — read it
before starting Docs Mode.

---

## Quick reference

| | **Basic** ("grill me") | **Hard** ("grill me hard") |
|---|---|---|
| Shape | one adaptive loop | **3 stages**: assemble → tournament → interview |
| Options | drafted **inline** (~2 passes, distinctness gate) | **pre-computed** by `grill-hard.workflow.js` |
| Workflow | none | `grill-hard.workflow.js` — 5 generate × 3 cross-talk judges, in-script ≥2/3 tally |
| Adaptivity | re-order open branches as deps surface | **flag & re-tournament on drift** (re-run drifted Q + direct dependents) |
| Shared | Iron Laws · discover-first · push back · Shared Understanding | identical |

| Step (basic loop) | Do | Guard |
|------|-----|-------|
| MAP | list branches from plan + codebase | don't invent branches the plan ignores |
| ORDER | sort by impact × blocking-ness | never low-impact-first |
| RESOLVE | one branch, one menu, wait | never batch; never branch-hop mid-resolve |
| SURFACE | name what this decision blocks/forces | re-order when deps shift |
| SUMMARIZE | restate the picked option + confirm | recommend ≠ decided; don't advance unconfirmed |
| ALIGN | structured Shared Understanding | the deliverable, not a chat recap |

**Hard mode adds three stages:**

| Stage | Do | Guard |
|-------|-----|-------|
| ASSEMBLE | pick source (task-derived / from-context); discover-first filter → facts become assumptions, intent → tournament | never tournament a fact you could look up; never re-map when issues are already surfaced |
| TOURNAMENT | run `grill-hard.workflow.js` with `{task, questions, context}` | intent questions only; pass discovered facts in `context` |
| INTERACT | present baked options one-at-a-time; run the DRIFT CHECK after every pick | never present options stale w.r.t. an upstream pick; targeted re-run, never full re-grill |

- **Every question:** progress header + ONE question + ordered menu (A ★ best …) +
  ✎ free-type + `touches:` dep.
- **Codebase-answerable?** Discover, don't ask. (In hard, that's the Stage-1 filter.)
- **Risky / contradictory / `split`?** Push back with the failure mode before recording.
- **No code, ever.** Read-only; stop at the shared understanding.

## Common mistakes

| Mistake | Instead |
|---------|---------|
| Asking 3–5 **questions** in one message (the #1 failure) | One question, then **wait**. Even "and also…" is a violation. |
| Confusing a menu of options with a list of questions | Options answer one question — fine. Separate questions — split. |
| Posting all the hard-mode pre-computed questions at once | Stage 3 is still one question at a time. |
| Running the workflow in basic mode | Basic drafts options inline (~2 passes); the workflow is hard-mode only. |
| Auto-upgrading to hard without the marker | Hard is opt-in; stay basic unless the marker/ask is present. |
| Bare question, no menu | Always a ranked menu: A ★ best + distinct alternatives + ✎. |
| Three near-identical options | Distinctness gate: collapse to the choices that differ. |
| Recording a picked letter as vetted | Recommend ≠ decided; restate + confirm, push back if risky. |
| Asking what the codebase already answers | Discover first; let the fact become option A's evidence. |
| Hard Stage 1: tournamenting a fact | Resolve facts by exploration as assumptions; tournament intent only. |
| Re-mapping when the user pointed at already-surfaced issues | From-context source: lift those issues verbatim; skip fresh mapping. |
| Skipping a hard stage or reordering them | assemble → tournament → interview, in order, none skipped. |
| Ignoring a pick that drifts from a baked `assumes` | Run the DRIFT CHECK; flag the dependents, offer the targeted re-run. |
| Re-grilling the whole list on drift | Targeted one-hop re-run of the drifted set only (drifted Q + direct dependents). |
| Starting with edge cases / cosmetics | Resolve the architecture/data spine first. |
| Branch-hopping before a branch is confirmed | Resolve, restate, then move on. |
| Hidden dependencies between decisions | Name every block/constraint out loud; in hard mode encode them in `dependsOn`. |
| Rubber-stamping a risky choice (incl. a tournament pick / `split`) | Push back; name the failure mode. |
| Writing code, schemas, or signatures "to help" | Planning only; recommend in words, hand off the spec. |
| Ending on a vague "sounds good" | Close with the structured Shared Understanding. |

See `references/worked-example.md` for an annotated transcript — the menu cadence
in basic mode and a hard-mode session with a drift re-tournament, both Iron Laws
holding under pressure — and `references/hard-mode.md` for the hard-mode schemas,
the full drift algorithm, and a worked re-tournament-on-drift.
