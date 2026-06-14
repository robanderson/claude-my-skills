---
name: two-pass-best-of-n
description: "Run a two pass Best of N tournament. First ask the user which model quality to use for the attempts (Opus, Sonnet, Haiku, or Mixed). Round one produces N independent solutions in parallel and an Opus reviewer records pros and cons and picks a winner; the losing attempts are discarded, but their lessons are distilled into guidance. Round two runs N fresh attempts given that guidance (positives to emulate, pitfalls to avoid), then the saved round one winner is added back and an Opus ranker selects the final winner from all of them. Use this skill whenever a request ends with a suffix like 'Two Pass Best of N: 4', '2-pass best of n', or 'Best of N: 4 two pass', and also whenever the user wants an iterative best-of-n that feeds round one's lessons into a second round before final judging, even if they do not use the exact phrase."
---

# Two Pass Best of N

Two Pass Best of N is single-pass Best of N with a learning step in the middle. Round one runs N independent attempts and an Opus reviewer judges them, keeps the winner, and distils what worked and what failed into a short guidance brief. Round two runs N brand new attempts that are handed that guidance (but not the prior code), so they explore fresh while steering away from round one's mistakes. The saved round one winner is then added back into the pool, and a final Opus ranker picks the overall winner.

Why discard the losing artifacts but keep the lessons: re-using the winner's code would just make round two copy it and collapse the diversity that makes Best of N work. Re-using the distilled pros and cons keeps the diversity while raising the floor.

This skill is an orchestration procedure. Sub-agent dispatch depends on the harness (in Claude Code, the Task tool and dynamic workflows; the Claude Agent SDK exposes the same primitive). Follow the phases in order.

## Operating rule: this skill is interactive, stop and ask first

The moment you detect the trigger, your **first response must be only the Phase 1 model-selection question**. Do not plan, do not write any attempt, do not pick a model yourself, and do not produce or pre-compose any candidate in the same turn the task arrives. Wait for the user's answer, then proceed.

This gate is mandatory **even when the environment cannot truly run separate-model sub-agents** (for example on Claude.ai with a single instance). Do not skip it on the grounds that the model choice "won't matter". It matters because the user explicitly asked to choose, the chosen model sets the capability bar each attempt is produced at, and the choice is recorded in the report. Silently producing the attempts without asking is the single most common failure of this skill; do not do it.

## Phase 0: Parse the invocation

The trigger is a task followed by a two-pass suffix, for example `Two Pass Best of N: 4`, `2-pass best of n: 4`, or `Best of N: 4 two pass` (case-insensitive; the space after the colon is optional).

- Everything before the suffix is the **task**. Treat it verbatim. Every attempt in both rounds receives the identical task, so the comparison stays fair.
- The integer attached to "Best of N" is **N**, the number of independent attempts **per round**.

**Example:**
Input: `write a python program for hangman game, Two Pass Best of N: 4`
Parsed: task = "write a python program for hangman game", N = 4 (so 4 attempts in round one, 4 in round two, plus 1 carried-over winner = 9 candidates total touched).

Validate N before continuing:
- N must be an integer of 2 or more.
- Two pass roughly doubles the attempt count, so treat the cost ceiling as lower than single pass: at N of 6 or more, confirm the user wants that volume before proceeding (see the cost note in Phase 2).

If the two-pass phrase is absent but the user clearly wants an iterative best-of-n with a learning round, ask for N and the models and proceed the same way.

## Phase 1: Choose the models (mandatory gate, stop here)

This is the gate from the operating rule. Ask it as your first response to the trigger and **wait for the answer before doing anything else**. Ask exactly this, as a four option selection, then stop:

> Which quality of sub-agent do you want for the attempts?
> 1. Opus (highest capability)
> 2. Sonnet (balanced)
> 3. Haiku (fastest, cheapest)
> 4. Mixed (choose a model per attempt)

Handle the answer:

- **Options 1, 2, or 3 (uniform):** every attempt in both rounds uses that single model. Record the assignment, e.g. for N = 4 with Sonnet: `[sonnet, sonnet, sonnet, sonnet]`.
- **Option 4 (Mixed):** walk through the attempts one at a time, attempt 1 to attempt N, asking the same question but offering only the three concrete models (Opus, Sonnet, Haiku), not Mixed again. Record each choice, e.g. `[opus, sonnet, sonnet, haiku]`.

The model assignment applies to **both rounds**: round two re-uses the same per-attempt list. If the user explicitly wants different models for round two, ask the four-option question again for round two; otherwise re-use round one's assignment. Model aliases and full identifiers are in `references/orchestration.md`. The round one reviewer and the final ranker are **always Opus**, regardless of what the attempts use.

## Phase 1b: Diversity injection (default on)

Independent attempts are only valuable if they actually differ. Model heterogeneity and sampling give some of that, but same-model siblings on an identical prompt tend to converge. To prevent that, give each attempt a distinct framing drawn from a modifier pool, following `references/diversity-injection.md`. In short:

- **Pool A (approach nudges), on by default.** These vary how an attempt starts and proceeds, not what counts as a good answer, so the review stays blind. Drawn without replacement within a round so no two attempts share one, biased so same-model siblings get the most different nudges.
- **Pool B (objective lenses like safely, quickly, efficiently), opt-in only.** These bias the tradeoff an attempt makes. Offer them when the user wants to fan attempts across a tradeoff frontier on purpose, and read the Pool B handling notes before using them (they interact with blind review).

Seed and log the draw so the run is reproducible and the report can show what was applied. If the user prefers fully identical briefs, they can turn diversity injection off.

## Phase 2: Confirm, then run Round 1

Before spending tokens, show the plan and get a go-ahead:

- The task, quoted exactly.
- N, the model per attempt, and that this is a two-pass run (round one, then a guided round two, then a final rank).
- A cost note: roughly 2N independent attempts plus two Opus passes (the round one review and the final rank), so token use is about double a single-pass Best of N. Recommend a small N on the first run to gauge usage.

On confirmation, fan out **N sub-agents in parallel** for round one, following `references/orchestration.md`. Apply a fresh diversity draw for this round (Phase 1b). The essential rules:

- **Identical brief plus one modifier.** Every sub-agent receives the same task text, differing only by its drawn diversity modifier, so any divergence is attributable to it. No agent is told it is competing, judged, or which attempt it is.
- **Isolation.** Each sub-agent gets its own workspace (for example `two-pass-best-of-n/<run-id>/round-1/candidate-<i>/`). Isolated workspaces and atomic per-candidate outputs prevent the race conditions and clobbered files that parallel writes to one location cause.
- **No cross-talk.** Sub-agents must not see each other's output. Independence is the point.
- **Self-summary.** Each sub-agent returns its complete work product plus a 2 to 4 sentence note on its approach and tradeoffs.

If many concurrent requests hit provider rate ceilings, run in smaller parallel batches rather than all at once.

## Phase 3: Round 1 review, winner, and distilled guidance

Spin up one **review agent on Opus**. Hand it every round one work product, labelled Candidate A, B, C, and so on, **without revealing which model produced which**. Following `references/review-rubric.md`, it does two jobs:

1. **Judge and pick a winner.** Score each candidate, list concrete pros and cons for each, rank them, and name the round one winner with reasoning.
2. **Distil guidance for round two.** Across all candidates (not just the winner), produce two short lists phrased generically, with no candidate-specific code:
   - **Positives to consider:** patterns and choices that worked well anywhere in round one.
   - **Challenges to avoid:** pitfalls, bugs, and weaknesses seen anywhere in round one.

Then:

- **Save** the round one winner's work product. This is the carried-over champion for the final pool.
- **Discard** the other round one artifacts. Keep only the distilled guidance, not the losing code.

## Phase 4: Run Round 2 with the guidance

Fan out **N fresh sub-agents in parallel** (same isolation and no-cross-talk rules, new workspaces, for example `.../round-2/candidate-<i>/`). Apply a **fresh Pool A draw** for round two (Pool A only, per `references/diversity-injection.md`: the guidance already carries the objective steering, so Pool B lenses would conflict with it). Each gets the identical task **plus** the distilled guidance, framed like this:

> In producing your answer, please consider these items as possible positives: a, b, c, d (the round one positives). And treat these items as challenges to avoid: w, x, y, z (the round one challenges).

Do **not** give round two agents any prior code or the winner's artifact. They get the task and the guidance only, so they produce genuinely new solutions that are merely steered, not seeded. As before, no agent is told it is competing or judged, and each returns its work product plus a short self-summary.

## Phase 5: Final ranking

Build the final pool: the **N fresh round two attempts plus the saved round one winner** (N + 1 candidates). Re-label the whole pool blind (Candidate A, B, C, ...) in a fixed order, keep a private mapping for the report, and spin up one **Opus ranker**. It scores every candidate against the same rubric (`references/review-rubric.md`), lists pros and cons for each, ranks them, and names the overall winner. The carried-over champion competes blind on the merits like everything else: it produced no worse work for not having seen the guidance, and if a guided round two attempt is genuinely better, it should win.

## Phase 6: Report back

Present to the user:

1. **The mapping**, unblinded: which model produced each final candidate, and which one was the round one carried-over winner.
2. **The round two guidance that was used** (the positives-to-consider and challenges-to-avoid lists), so the user can see what steered the second round.
3. **Per-candidate pros and cons** from the final ranker, plus the **ranking and overall winner** with reasoning.
4. **The winning work product itself** (or offer to save it). Offer a merged "best of all" synthesis only if the user asks; the honest comparison is the primary result.

Include brief run metadata: N, the model per attempt, the diversity modifier each attempt drew (and the seed), whether the final winner came from round one or round two, and wall-clock or token figures if the harness surfaced them.

## Quick reference

- Trigger suffix: a two-pass marker plus `Best of N` and a number, N an integer of 2 or more. N is per round.
- Phase 1 model question: four options; Mixed loops per attempt; assignment applies to both rounds.
- Diversity injection (default on): each attempt draws a distinct framing so siblings do not converge. Pool A approach nudges by default (blind-safe); Pool B objective lenses opt-in. Without replacement, seeded, logged. See `references/diversity-injection.md`.
- Round 1: N parallel attempts, isolated, identical brief plus one diversity modifier, no cross-talk.
- Round 1 review (Opus, blind): pros and cons per candidate, pick winner, distil positives-to-consider and challenges-to-avoid. Save the winner, discard the other artifacts.
- Round 2: N fresh parallel attempts given task plus guidance, no prior code.
- Final pool = N round two attempts + 1 saved round one winner = N + 1, ranked blind by Opus.
- Dispatch mechanics and the round two brief template: `references/orchestration.md`.
- Scoring and distillation rubric: `references/review-rubric.md`.
