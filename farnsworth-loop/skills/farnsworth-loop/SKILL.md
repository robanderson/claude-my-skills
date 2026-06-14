---
name: farnsworth-loop
description: "Run a Farnsworth Loop tournament in one of two modes. First ask the user which model quality to use for the attempts (Anthropic Opus, Sonnet, Haiku; a GLM z.ai model via the glm CLI; or Mixed per-attempt). SINGLE PASS: produce N independent solutions in parallel, then a blind Opus reviewer scores them, lists pros and cons, ranks them, and names a winner. TWO PASS: the same first round, but the Opus reviewer also distils what worked and what failed into guidance; the losing attempts are discarded, a second round of N fresh attempts is run with that guidance (positives to emulate, pitfalls to avoid), the saved round one winner is added back, and a final Opus ranker picks the overall winner. Trigger on the explicit marker 'farnsworth loop:N' (single pass, N attempts) or 'farnsworth loop:N:2' (two pass, N attempts per round), case-insensitive, with or without a leading colon and surrounding spaces, e.g. 'do abc :farnsworth loop:5' or 'do abc: farnsworth loop:5:2'. The optional third segment is the number of passes: omitted or 1 means single pass, 2 means two pass."
---

# Farnsworth Loop

Farnsworth Loop runs several independent attempts at one task and has a blind Opus reviewer pick the best. It has two modes:

- **Single pass** is the base pattern: N independent attempts in parallel, then one blind Opus review that scores them, ranks them, and names the winner. Done.
- **Two pass** is single pass with a learning step in the middle. Round one runs and is reviewed exactly as in single pass, but the reviewer also distils what worked and what failed into a short guidance brief. The winner is kept, the other artifacts are discarded, and round two runs N brand new attempts that are handed that guidance (but not the prior code), so they explore fresh while steering away from round one's mistakes. The saved round one winner is then added back into the pool, and a final Opus ranker picks the overall winner.

Two pass is therefore the same spine as single pass plus an extra round. Every shared step below (model choice, diversity injection, attempt dispatch, the review rubric, the report) applies to both modes identically; the only difference is that two pass continues past the first review into a guided round and a final rank.

Why two pass discards the losing artifacts but keeps the lessons: re-using the winner's code would just make round two copy it and collapse the diversity that makes the loop work. Re-using the distilled pros and cons keeps the diversity while raising the floor.

This skill is an orchestration procedure. Sub-agent dispatch depends on the harness (in Claude Code, the Task tool and dynamic workflows; the Claude Agent SDK exposes the same primitive). Follow the phases in order.

## Operating rule: this skill is interactive, stop and ask first

The moment you detect the trigger, your **first response must be only the Phase 1 model-selection question** (after silently parsing the invocation in Phase 0). Do not plan, do not write any attempt, do not pick a model yourself, and do not produce or pre-compose any candidate in the same turn the task arrives. Wait for the user's answer, then proceed. This applies to **both modes**.

This gate is mandatory **even when the environment cannot truly run separate-model sub-agents** (for example on Claude.ai with a single instance). Do not skip it on the grounds that the model choice "won't matter". It matters because the user explicitly asked to choose, the chosen model sets the capability bar each attempt is produced at, and the choice is recorded in the report. Silently producing the attempts without asking is the single most common failure of this skill; do not do it.

## Phase 0: Parse the invocation and detect the mode

The trigger is a task followed by a `farnsworth loop` marker of the form `farnsworth loop:N` or `farnsworth loop:N:P`. The marker may carry a leading colon and arbitrary surrounding spaces (e.g. `... :farnsworth loop:5`, `...: farnsworth loop:5:2`). Match it case-insensitively. Parse three things:

- **Task.** Everything before the marker. Treat it verbatim, stripping any trailing separator colon (so `do abc:` and `do abc :` both yield the task `do abc`). Every attempt in every round receives the identical task, so the comparison stays fair.
- **N.** The first integer after `farnsworth loop:` — the number of independent attempts **per round**.
- **Mode.** Decided by the optional **second** integer P (the pass count):
  - `farnsworth loop:N` with no second segment, or `farnsworth loop:N:1` → **single pass**.
  - `farnsworth loop:N:2` → **two pass**.
  - P values other than 1 or 2 are invalid — ask the user to clarify (only single and two pass exist).

If the user clearly describes the loop's generate-and-rank tournament but omits the exact marker, you may still run it: infer single vs two pass from whether they describe a learning round, ask for N and the model if not given, then proceed. Do not nudge the user toward two pass when single pass is what was asked.

**Examples:**
- Input: `do abc :farnsworth loop:5` → task = "do abc", N = 5, mode = **single pass** (5 attempts, 1 Opus review).
- Input: `do abc: farnsworth loop:5:2` → task = "do abc", N = 5, mode = **two pass** (5 attempts in round one, 5 in round two, plus 1 carried-over winner = 11 candidates touched).
- Input: `write a python program for hangman game, farnsworth loop:4` → task = "write a python program for hangman game", N = 4, mode = **single pass**.

Validate N before continuing:
- N must be an integer of 2 or more.
- Single pass is roughly N attempts plus one Opus pass. At N of 8 or more, confirm the user wants that volume.
- Two pass roughly doubles the attempt count, so its cost ceiling is lower: at N of 6 or more, confirm the user wants that volume before proceeding (see the cost note in Phase 2).

## Phase 1: Choose the models (mandatory gate, stop here — both modes)

This is the gate from the operating rule. Ask it as your first response to the trigger and **wait for the answer before doing anything else**. Ask exactly this, as a five option selection, then stop:

> Which quality of sub-agent do you want for the attempts?
> 1. Opus — Anthropic, highest capability
> 2. Sonnet — Anthropic, balanced
> 3. Haiku — Anthropic, fastest and cheapest
> 4. GLM — z.ai models (I'll then ask which GLM model)
> 5. Mixed — choose a model per attempt (Anthropic or GLM)

Handle the answer:

- **Options 1, 2, or 3 (uniform Anthropic):** every attempt uses that single Anthropic model. Record the assignment, e.g. for N = 4 with Sonnet: `[sonnet, sonnet, sonnet, sonnet]`.
- **Option 4 (GLM):** drill down with a second question, then stop again and wait. Every attempt uses the one chosen GLM model:
  > Which GLM model?
  > 1. glm-5.2 — strongest, 1M context
  > 2. glm-5.1
  > 3. glm-5
  > 4. glm-4.7
  > 5. glm-4.5-air — fastest, cheapest

  Record the uniform assignment, e.g. for N = 4 with glm-5.2: `[glm-5.2, glm-5.2, glm-5.2, glm-5.2]`.
- **Option 5 (Mixed):** walk through the attempts one at a time, attempt 1 to attempt N. For each, ask which concrete model to use, offering the three Anthropic models **and** the five GLM models (Opus, Sonnet, Haiku, glm-5.2, glm-5.1, glm-5, glm-4.7, glm-4.5-air) — not "GLM" as a group and not "Mixed" again. Record each choice, e.g. `[opus, glm-5.2, sonnet, glm-4.5-air]`.

In two pass, the model assignment applies to **both rounds**: round two re-uses the same per-attempt list. If the user explicitly wants different models for round two, re-ask the gate for round two; otherwise re-use round one's assignment. Model aliases, the GLM `--model` flag mapping, and dispatch mechanics are in `references/orchestration.md`. **Anthropic attempts dispatch via the Task tool; GLM attempts dispatch by shelling out to the `glm` CLI (agentic, with tools), per the orchestration reference.** The reviewer and the final ranker are **always Anthropic Opus**, regardless of what the attempts use — the judge is held fixed so the comparison is consistent.

## Phase 1b: Diversity injection (default on — both modes)

Independent attempts are only valuable if they actually differ. Model heterogeneity and sampling give some of that, but same-model siblings on an identical prompt tend to converge. To prevent that, give each attempt a distinct framing drawn from a modifier pool, following `references/diversity-injection.md`. In short:

- **Pool A (approach nudges), on by default.** These vary how an attempt starts and proceeds, not what counts as a good answer, so the review stays blind. Drawn without replacement within a round so no two attempts share one, biased so same-model siblings get the most different nudges.
- **Pool B (objective lenses like safely, quickly, efficiently), opt-in only.** These bias the tradeoff an attempt makes. Offer them when the user wants to fan attempts across a tradeoff frontier on purpose, and read the Pool B handling notes before using them (they interact with blind review).

Seed and log the draw so the run is reproducible and the report can show what was applied. If the user prefers fully identical briefs, they can turn diversity injection off.

## Phase 2: Confirm, then run the first round (both modes)

Before spending tokens, show the plan and get a go-ahead:

- The task, quoted exactly.
- N, the model per attempt, and **which mode** this is (single pass: one round then a final review; two pass: round one, then a guided round two, then a final rank).
- A cost note scaled to the mode:
  - **Single pass:** roughly N independent attempts plus one Opus review.
  - **Two pass:** roughly 2N independent attempts plus two Opus passes (the round one review and the final rank), so token use is about double single pass. Recommend a small N on the first run to gauge usage.

On confirmation, fan out **N sub-agents in parallel** for the first round, following `references/orchestration.md`. Apply a fresh diversity draw for this round (Phase 1b). The essential rules:

- **Identical brief plus one modifier.** Every sub-agent receives the same task text, differing only by its drawn diversity modifier, so any divergence is attributable to it. No agent is told it is competing, judged, or which attempt it is.
- **Isolation.** Each sub-agent gets its own workspace (for example `farnsworth-loop/<run-id>/round-1/candidate-<i>/`). Isolated workspaces and atomic per-candidate outputs prevent the race conditions and clobbered files that parallel writes to one location cause.
- **No cross-talk.** Sub-agents must not see each other's output. Independence is the point.
- **Self-summary.** Each sub-agent returns its complete work product plus a 2 to 4 sentence note on its approach and tradeoffs.

If many concurrent requests hit provider rate ceilings, run in smaller parallel batches rather than all at once.

## Phase 3: Blind Opus review

Spin up one **review agent on Opus**. Hand it every first-round work product, labelled Candidate A, B, C, and so on, **without revealing which model produced which**. Following `references/review-rubric.md`, it scores each candidate, lists concrete pros and cons, ranks them, and names the winner with reasoning.

**Then the modes diverge:**

- **Single pass:** Phase 3's named winner **is the result**. Skip Phases 4 and 5 and go straight to Phase 6 to report. (You do not need the round-two guidance lists; the reviewer can omit them in single-pass mode.)
- **Two pass:** the reviewer does the **second job** as well — distil guidance for round two. Across all candidates (not just the winner), produce two short lists phrased generically, with no candidate-specific code:
  - **Positives to consider:** patterns and choices that worked well anywhere in round one.
  - **Challenges to avoid:** pitfalls, bugs, and weaknesses seen anywhere in round one.

  Then **save** the round one winner's work product (the carried-over champion for the final pool) and **discard** the other round one artifacts, keeping only the distilled guidance — not the losing code. Continue to Phase 4.

## Phase 4 (two pass only): Run round 2 with the guidance

Fan out **N fresh sub-agents in parallel** (same isolation and no-cross-talk rules, new workspaces, for example `.../round-2/candidate-<i>/`). Apply a **fresh Pool A draw** for round two (Pool A only, per `references/diversity-injection.md`: the guidance already carries the objective steering, so Pool B lenses would conflict with it). Each gets the identical task **plus** the distilled guidance, framed like this:

> In producing your answer, please consider these items as possible positives: a, b, c, d (the round one positives). And treat these items as challenges to avoid: w, x, y, z (the round one challenges).

Do **not** give round two agents any prior code or the winner's artifact. They get the task and the guidance only, so they produce genuinely new solutions that are merely steered, not seeded. As before, no agent is told it is competing or judged, and each returns its work product plus a short self-summary.

## Phase 5 (two pass only): Final ranking

Build the final pool: the **N fresh round two attempts plus the saved round one winner** (N + 1 candidates). Re-label the whole pool blind (Candidate A, B, C, ...) in a fixed order, keep a private mapping for the report, and spin up one **Opus ranker**. It scores every candidate against the same rubric (`references/review-rubric.md`), lists pros and cons for each, ranks them, and names the overall winner. The carried-over champion competes blind on the merits like everything else: it produced no worse work for not having seen the guidance, and if a guided round two attempt is genuinely better, it should win.

## Phase 6: Report back (both modes)

Present to the user:

1. **The mapping**, unblinded: which model produced each final candidate. In two pass, also mark which one was the round one carried-over winner.
2. **(Two pass only) the round two guidance that was used** (the positives-to-consider and challenges-to-avoid lists), so the user can see what steered the second round.
3. **Per-candidate pros and cons** from the reviewer (single pass) or final ranker (two pass), plus the **ranking and overall winner** with reasoning.
4. **The winning work product itself** (or offer to save it). Offer a merged "best of all" synthesis only if the user asks; the honest comparison is the primary result.

Include brief run metadata: the mode, N, the model per attempt, the diversity modifier each attempt drew (and the seed), and — in two pass — whether the final winner came from round one or round two, plus wall-clock or token figures if the harness surfaced them.

## Quick reference

| Step | Single pass | Two pass |
|------|-------------|----------|
| Trigger | `farnsworth loop:N` (or `:N:1`) | `farnsworth loop:N:2` |
| Phase 0 | parse task, N, mode | parse task, N, mode |
| Phase 1 | model gate (mandatory stop) | model gate (mandatory stop) |
| Phase 1b | diversity injection (default on) | diversity injection (default on) |
| Phase 2 | confirm + run N attempts | confirm + run N attempts |
| Phase 3 | blind Opus review → rank → winner = result | blind Opus review → rank + distil guidance; save winner, discard rest |
| Phase 4 | — | N fresh attempts given task + guidance, no prior code |
| Phase 5 | — | final pool = N round-2 + 1 saved winner; blind Opus rank |
| Phase 6 | report | report (+ guidance used, winner's round) |

- Marker: `farnsworth loop:N` (single) / `farnsworth loop:N:2` (two pass), case-insensitive, optional leading colon and spaces. Third segment is the pass count (1 or 2).
- N is per round, an integer of 2 or more. Confirm volume at N ≥ 8 (single pass) or N ≥ 6 (two pass).
- Phase 1 model question: five options (Opus, Sonnet, Haiku, GLM→submenu, Mixed); GLM drills down to one of glm-5.2/glm-5.1/glm-5/glm-4.7/glm-4.5-air; Mixed loops per attempt over all eight concrete models; in two pass the assignment applies to both rounds. Anthropic attempts dispatch via the Task tool, GLM attempts via the `glm` CLI (agentic). Reviewer/ranker are always Anthropic Opus.
- Diversity injection (default on): each attempt draws a distinct framing so siblings do not converge. Pool A approach nudges by default (blind-safe); Pool B objective lenses opt-in. Without replacement, seeded, logged. See `references/diversity-injection.md`.
- Round attempts: N parallel, isolated, identical brief plus one diversity modifier, no cross-talk.
- Review/rank (Opus, blind): pros and cons per candidate, rank, name winner. In two pass also distil positives-to-consider and challenges-to-avoid, save the winner, discard the other artifacts.
- Dispatch mechanics and the round two brief template: `references/orchestration.md`.
- Scoring and distillation rubric: `references/review-rubric.md`.
