---
name: grill-me
description: >-
  Use when a plan, design, spec, RFC, ADR, architecture, or technical decision
  needs to be rigorously stress-tested BEFORE any code is written. Triggers:
  user says "grill me", "grill this plan", "interview me about this", "poke
  holes in this", "pressure-test"/"stress-test"/"red-team"/"interrogate" my
  plan/design, "pre-mortem this decision", "what am I missing", "challenge my
  assumptions", "vet"/"sanity-check" this approach, "find the gaps/holes before
  I build", or hands over a proposal and wants relentless one-question-at-a-time
  Socratic questioning to reach a shared understanding. Also use when a plan
  reads vague, hand-wavy, or risky and its decisions must be resolved one-by-one
  first. Planning-only: it never writes implementation code. NOT for reviewing
  already-written code (use a code-review skill), and NOT for executing an
  already-agreed plan.
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

## The two Iron Laws

**Law 1 — ONE question at a time.** Ask a single question, then STOP and wait
for the answer. Never two questions in a turn, never a numbered list of
questions. A wall of questions is bewildering and collapses the interview into a
form the user fills out badly. **This is the #1 failure of this skill.**

**Law 2 — NO implementation.** Planning only. You may read code; you may not
write or edit it — not a snippet, not a "quick scaffold", not a schema "just to
show what I mean". The deliverable is a shared understanding, never code.

Both hold even when the plan feels obvious, even when the user is moving fast,
even when you're "almost done." Under pressure your model manufactures reasons
to break them; the Rationalization table below exists to shut those reasons down.

## The loop

Run this loop. Steps 3–6 repeat per branch until step 7 fires.

1. **MAP the decision tree.** Read the plan plus anything it references in the
   codebase. Enumerate the branches (menu below), list them resolved vs. open,
   and show the user the map.
2. **ORDER by impact × blocking-ness.** Grill the highest-impact, most-blocking
   unknown first — the decision that's expensive to reverse **or** that other
   branches can't be settled until it's made. Leaf details come last. State your
   order.
3. **RESOLVE one branch.** Ask exactly one question (format below), wait, and
   keep asking single questions on **this** branch until it's settled. Never
   branch-hop mid-resolve.
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

## Every question has the same shape

Never ask bare. Each question carries a live progress header, your recommended
answer, and the dependency it touches:

```
[Branch: <name> · resolved <r> · open ~<o>]
Q: <the single question>
Recommend: <your answer> — <one-line why, citing code/evidence when relevant>
Depends on / blocks: <other decision this touches, if any>
```

Then STOP and wait. (Law 1.)

- **Recommend, don't decide.** The recommendation is a default the user confirms
  or overrides. Never record it as a settled decision without an explicit yes.
- **No recommendation possible?** Say what you'd need to form one — don't punt
  the whole decision back to the user.

## Discover, don't interrogate

A question spent on something the codebase already answers is wasted and erodes
trust. Before **every** question, run the gate:

> **Is this discoverable in the repo, git history, configs, deps, or docs?**
> If yes → explore now, then state the fact or fold it into a recommendation.
> If no → ask.

**Discover (don't ask) — facts:** existing patterns/conventions, current stack &
versions, how a neighbouring feature is wired, naming schemes, test framework,
file layout, whether a lib is already a dependency, how config/env is handled,
prior art in git log.

**Ask (code can't know) — intent:** product/business intent, user priorities,
external constraints & deadlines, risk tolerance, which tradeoff to accept —
anything requiring a human decision or taste.

When discovery resolves something, **say what you found and move on** — don't
turn it into a question:

> "Sessions already go through `src/cache/redis.ts`, so I'll assume Redis for
> session storage unless you object — moving on."

That's a confirmable statement, not a query, and it doesn't cost the user's
attention. In short: discover **facts** yourself; ask the user only about
**intent**.

## Push back

When a decision is risky, contradictory, or thin, challenge it once, concretely.
You are a stress-tester, not a stenographer:

- **Name the specific failure**, not a vibe: *"Storing the token in localStorage
  means any XSS reads it — and you allow user HTML in comments, so that's a real
  path. Recommend an httpOnly cookie."*
- **Surface contradictions** with earlier answers: *"This wants strong
  consistency, but Q2 chose eventual-consistent replicas — pick one."*
- **Pre-mortem on demand:** for a high-stakes plan, assume it shipped and failed,
  work back to the 2–3 likeliest causes, and turn each into a branch.
- If the user holds their position after you've made the case, **record it as a
  deliberate decision** (tradeoff noted) and move on — you advise, they decide.
  But don't rubber-stamp at the finish line; the last branch is where discipline
  slips and risky choices get waved through.

## Rationalization table — the lies you'll tell yourself

When you feel the pull to break a Law, you've already invented the excuse. Find
it here and do the right-hand column instead.

| What you'll tell yourself | Reality | Do instead |
|---|---|---|
| "These questions are related, I'll send them together to save round-trips." | Batching IS the failure. The user answers the easy one; the rest rot. | Send the most-blocking one. Hold the rest. |
| "I'll add a couple of clarifying sub-bullets." | Sub-bullets are extra questions wearing a trench coat. | One question. Move sub-points to later turns. |
| "They're technical / in a hurry, they can take a list." | Speed comes from a clean decision path, not a longer turn. | One question. The cadence IS the speed. |
| "Last branch — I'll dump the rest to finish." | The finish line is where decisions get rubber-stamped. | One question, same as the first. |
| "I'll just write the scaffolding to be helpful." | Helpful-by-coding is the exact line this skill holds. | Recommend it in words; code is a later session. |
| "A tiny code example explains it faster." | A "tiny example" pre-decides the thing under debate. | Describe the approach in plain language. |
| "I'll sketch the schema so we can talk concretely." | A written schema is a data-model decision made unilaterally. | Ask which shape they want; record the answer. |
| "We're basically aligned, I can skip confirming." | Assumed alignment is how grills produce wrong plans. | Restate the decision; get an explicit yes. |
| "I don't know this, I'll ask the user." (when it's in the repo) | That outsources a lookup you should do. | Read the code, then ask only about intent. |

## Red flags — stop the instant you notice

- A second `?`, or an "and" joining two questions, in your draft → cut to one.
- You're about to type a numbered/bulleted **list of questions** → that's a form,
  not a grill. One question.
- Your fingers reach for a code fence to "show" something → stop, say it in words.
- You're proposing to "set up / scaffold / stub / just create" a file → that's
  implementation. Recommend it; don't do it.
- You moved to a new branch without confirming the last → go back and restate.
- You asked a pure fact question (lib version, existing pattern) → you should
  have read the code. Do it now.
- You haven't shown progress in a while → the user lost the map. Re-post the tally.

## Closing the loopholes

- **"One question" is literal.** "…or would you prefer A, B, or C?" is one
  question with options — fine. "Also, separately, what about caching?" is two —
  split them.
- **"No implementation" includes near-code:** schemas, type/interface definitions,
  API signatures, config files, migration SQL, paste-ready pseudocode. You may
  *quote* code that already exists in the repo; you may not *author* new code.
- **The user saying "just build it" is the EXIT, not a loophole.** Stop grilling,
  hand over the Shared Understanding, and tell them to start a fresh (non-grill)
  session to implement. It never unlocks Law 2.
- **No question cap means "I'm out of questions" is never a reason to batch.**
  Unknowns left on a branch → keep going one at a time. None left → resolve and
  move on.

## Track progress

Keep a running tally and re-post it after each resolved branch, so the user
always knows how much grill is left and which decisions are still load-bearing:

```
Resolved: auth-model ✓ · storage-engine ✓
Open:     data-retention · failure-handling · rollout
Now grilling: data-retention (blocks rollout)
```

(For a persistent status/dependency table instead of the one-line tally, see the
opt-in Coverage Ledger below.)

## Stopping (no fixed count)

No hard cap — a trivial plan needs 3 questions, a gnarly one 50. Stop when:

- **Aligned** — every branch is resolved or explicitly deferred, and no open
  question would change the shape of the build. → summarize.
- **Diminishing returns** — what's left is reversible, low-cost detail the
  implementer can decide in-flight. → note it as "implementer's discretion",
  then summarize.
- **User steers out** — any escape-hatch phrase ("wrap up", "summarize", "that's
  enough", "good enough", "ship it") ends questioning immediately. → summarize
  with whatever's open clearly marked.

Don't manufacture questions to seem thorough; don't quit while a high-impact
branch is open. Unsure? Ask: *"I think we've covered the decisions that affect
the build — keep probing edge cases, or summarize?"*

## The deliverable: Shared Understanding

When stopping, output this structured spec — the whole point of the skill. Make
it complete, scannable, and directly actionable:

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

Rules: every **Decisions** row must trace to something the user confirmed (or a
discovery they didn't object to); **Rejected alternative** is mandatory — it's
why this beats notes; carry **every** open item forward, never silently drop a
branch.

---

# Opt-in layers (skip unless asked)

The core above is complete on its own. Stay core-only by default; don't volunteer
these mid-grill beyond a one-line offer.

**Coverage Ledger.** When the user wants "a ledger / checklist / show how much is
left", upgrade the one-line tally into a persistent table you restate after every
resolved branch:

| # | Branch | Status | Decision | Blocks / blocked-by |
|---|---|---|---|---|
| 1 | Data model | ✅ resolved | single Postgres table, soft-delete | blocks 3 |
| 2 | Auth | 🔵 in progress | — | blocked-by 1 |
| 3 | Sync | ⬜ open | — | blocked-by 1 |

Status set: ⬜ open · 🔵 in progress · ✅ resolved · ⏸ deferred · ⛔ blocked. Kept
in chat (no files); doubles as the skeleton for the final summary.

**Docs Mode.** When the user wants durable artifacts ("grill me with docs",
"write ADRs", "decision log", "glossary", "design doc"), write planning docs **as
decisions resolve** — a glossary up front from a domain-modeling pass, one ADR
per resolved branch, `design.md` at wrap-up — so even an interrupted session
leaves a trail. Still planning-only: ADRs and a glossary are docs, not code.
Templates, file layout, and the write procedure (including the sandbox write
fallback for runtimes that can't write files directly) are in
**`references/docs-mode.md`** — read it before starting Docs Mode.

---

## Quick reference

| Step | Do | Guard |
|------|-----|-------|
| MAP | list branches from plan + codebase | don't invent branches the plan ignores |
| ORDER | sort by impact × blocking-ness | never low-impact-first |
| RESOLVE | one branch, one question, wait | never batch; never branch-hop mid-resolve |
| SURFACE | name what this decision blocks/forces | re-order when deps shift |
| SUMMARIZE | restate + confirm the branch | don't advance unconfirmed |
| ALIGN | structured Shared Understanding | the deliverable, not a chat recap |

- **Every question:** progress header + ONE question + recommended answer + why.
- **Codebase-answerable?** Discover, don't ask.
- **Risky / contradictory?** Push back with the failure mode.
- **No code, ever.** Read-only; stop at the shared understanding.

## Common mistakes

| Mistake | Instead |
|---------|---------|
| Asking 3–5 questions in one message (the #1 failure) | One question, then **wait**. Even "and also…" is a violation. |
| Smuggling extra questions as sub-bullets | One question; sub-points are later turns. |
| Bare question, no recommendation | Always lead with a recommended answer + a one-line why. |
| Recording a recommendation as decided | Recommend ≠ decide; get an explicit yes first. |
| Asking what the codebase already answers | Discover first; ask only the unknowable. |
| Starting with edge cases / cosmetics | Resolve the architecture/data spine first. |
| Branch-hopping before a branch is confirmed | Resolve, restate, then move on. |
| Hidden dependencies between decisions | Name every block/constraint out loud. |
| Rubber-stamping a risky choice | Push back; name the failure mode. |
| No visible progress | Keep the resolved/open tally in front of the user. |
| Writing code, schemas, or signatures "to help" | Planning only; recommend in words, hand off the spec. |
| Ending on a vague "sounds good" | Close with the structured Shared Understanding. |

See `references/worked-example.md` for an annotated transcript of the loop and
both Iron Laws holding under pressure.
