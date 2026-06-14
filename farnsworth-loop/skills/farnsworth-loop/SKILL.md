---
name: farnsworth-loop
description: "Run a Farnsworth Loop tournament in one of two modes. First ask the user which model quality to use for the attempts (Anthropic Opus, Sonnet, Haiku; a GLM z.ai model via the glm CLI; a free local on-device MLX model via the omlx server; or Mixed per-attempt). SINGLE PASS: produce N independent solutions in parallel, then a blind Opus reviewer scores them, lists pros and cons, ranks them, and names a winner. TWO PASS: the same first round, but the Opus reviewer also distils what worked and what failed into guidance; the losing attempts are discarded, a second round of N fresh attempts is run with that guidance (positives to emulate, pitfalls to avoid), the saved round one winner is added back, and a final Opus ranker picks the overall winner. Trigger whenever the user's message contains a sigil of the form @@FL:N:M (for example @@FL:5 , @@FL:5:2 , @@fl:7:2 ), where N is the number of attempts per round and M is the number of passes (omitted or 1 = single pass, 2 = two pass); the text before the sigil is the task. ALSO trigger on the prose marker 'farnsworth loop:N' (single pass) or 'farnsworth loop:N:2' (two pass), e.g. 'do abc :farnsworth loop:5' or 'do abc: farnsworth loop:5:2'. All forms are case-insensitive with optional spaces around the colons. Also trigger when the user clearly asks for a farnsworth loop / generate-and-rank tournament even without a marker."
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

The trigger is a task plus a marker in one of two equivalent forms:

- **Sigil (preferred):** `@@FL:N:M` — e.g. `@@FL:5`, `@@FL:5:2`, `@@fl:7:2`. `N` = attempts per round, `M` = passes (omitted or `1` = single, `2` = two pass).
- **Prose marker:** `farnsworth loop:N` or `farnsworth loop:N:P`, optionally with a leading colon (e.g. `... :farnsworth loop:5`, `...: farnsworth loop:5:2`).

Both are case-insensitive with optional spaces around the colons; the text **before** the marker/sigil is the task. Parse three things:

- **Task.** Everything before the marker/sigil. Treat it verbatim, stripping any trailing separator colon (so `do abc:` and `do abc :` both yield the task `do abc`). Every attempt in every round receives the identical task, so the comparison stays fair.
- **N.** The first integer of the marker (`@@FL:`**N**`:M` or `farnsworth loop:`**N**) — independent attempts **per round**.
- **Mode.** Decided by the optional **second** integer (M / P, the pass count):
  - no second segment, or `:1` → **single pass**.
  - `:2` → **two pass**.
  - any other value → invalid; ask the user to clarify (only single and two pass exist).

If the user clearly describes the loop's generate-and-rank tournament but omits any marker, you may still run it: infer single vs two pass from whether they describe a learning round, ask for N and the model if not given, then proceed. Do not nudge the user toward two pass when single pass is what was asked.

**Examples:**
- Input: `do abc @@FL:5` → task = "do abc", N = 5, mode = **single pass** (5 attempts, 1 Opus review).
- Input: `do abc @@FL:5:2` (or `do abc: farnsworth loop:5:2`) → task = "do abc", N = 5, mode = **two pass** (5 + 5 attempts plus 1 carried-over winner = 11 candidates touched).
- Input: `make a hangman game @@fl:7:2` → task = "make a hangman game", N = 7, mode = **two pass**.
- Input: `write a python program for hangman game, farnsworth loop:4` → task = "write a python program for hangman game", N = 4, mode = **single pass**.

Validate N before continuing:
- N must be an integer of 2 or more.
- Single pass is roughly N attempts plus one Opus pass. At N of 8 or more, confirm the user wants that volume.
- Two pass roughly doubles the attempt count, so its cost ceiling is lower: at N of 6 or more, confirm the user wants that volume before proceeding (see the cost note in Phase 2).

## Phase 1: Choose the models (mandatory gate, stop here — both modes)

This is the gate from the operating rule. Ask it as your first response to the trigger and **wait for the answer before doing anything else**. Ask exactly this, as a seven option selection, then stop:

> Which quality of sub-agent do you want for the attempts?
> 1. Opus — Anthropic, highest capability
> 2. Sonnet — Anthropic, balanced
> 3. Haiku — Anthropic, fastest and cheapest
> 4. GLM — z.ai models (I'll then ask which GLM model)
> 5. Local — free on-device MLX models via the omlx server (I'll then list the available ones)
> 6. Codex — OpenAI gpt-5.5 via the `codex exec` CLI (I'll then ask which reasoning effort)
> 7. Mixed — choose a model per attempt (Anthropic, GLM, Local, or Codex)

Handle the answer:

- **Options 1, 2, or 3 (uniform Anthropic):** every attempt uses that single Anthropic model. Record the assignment, e.g. for N = 4 with Sonnet: `[sonnet, sonnet, sonnet, sonnet]`.
- **Option 4 (GLM):** drill down with a second question, then stop again and wait. Every attempt uses the one chosen GLM model:
  > Which GLM model?
  > 1. glm-5.2 — strongest, 1M context
  > 2. glm-5.1
  > 3. glm-4.7
  > 4. glm-4.5-air — fastest, cheapest

  Record the uniform assignment, e.g. for N = 4 with glm-5.2: `[glm-5.2, glm-5.2, glm-5.2, glm-5.2]`.
- **Option 5 (Local):** the local model list is **dynamic**, so fetch it live before drilling down — run `omlx-models` (or `curl -s http://127.0.0.1:8000/v1/models -H "Authorization: Bearer $OMLX_AUTH_TOKEN" | jq -r '.data[].id'`). Present the returned model ids as a numbered menu, then stop and wait. Every attempt uses the one chosen local model id (recorded verbatim, e.g. `[gemma-4-26b-a4b-it-8bit, ...]`). If the server is unreachable (connection refused), tell the user the local server appears down and offer another tier. Local models are free but slower; flag that for larger N.
- **Option 6 (Codex):** Codex is pinned to OpenAI **gpt-5.5** (the model the local ChatGPT-account auth serves; other ids need an `OPENAI_API_KEY`), so the submenu is the **reasoning effort** (codex's quality lever), not a model. First run a one-line liveness probe so a stale CLI / auth block doesn't waste a (possibly paid) round:
  > `printf 'reply OK and stop' | codex exec -s read-only --skip-git-repo-check -c 'mcp_servers={}' -m gpt-5.5 - 2>&1 | tail -5`

  If it returns an HTTP 400 "requires a newer version of Codex" → tell the user to `brew upgrade codex`; if "not supported when using Codex with a ChatGPT account" → tell them to set `OPENAI_API_KEY` (API-key billing) — then offer another tier. On success (it prints OK), ask:
  > Which codex reasoning effort? (model is gpt-5.5)
  > 1. Low — fastest, lightest reasoning
  > 2. Medium — balanced (codex default)
  > 3. High — deeper reasoning
  > 4. Extra high — maximum reasoning depth

  Record the uniform assignment using the `codex-<effort>` displayModel (effort token: low / medium / high / **xhigh** for "Extra high"), e.g. for N = 4 at High: `[codex-high, codex-high, codex-high, codex-high]`. Codex bills your OpenAI/ChatGPT plan, not Anthropic usage; flag that codex (an autonomous agent with no turn cap) is slower than a one-shot, so size N modestly.
- **Option 7 (Mixed):** walk through the attempts one at a time, attempt 1 to attempt N. For each, ask which concrete model to use, offering the three Anthropic models, the four GLM models, the live local model ids, **and** the four codex effort levels (Opus, Sonnet, Haiku, glm-5.2, glm-5.1, glm-4.7, glm-4.5-air, the `omlx-models` ids, plus codex-low/codex-medium/codex-high/codex-xhigh) — not the group names and not "Mixed" again. Record each choice, e.g. `[opus, glm-5.2, codex-high, gemma-4-26b-a4b-it-8bit]`.

In two pass, the model assignment applies to **both rounds**: round two re-uses the same per-attempt list. If the user explicitly wants different models for round two, re-ask the gate for round two; otherwise re-use round one's assignment. Model aliases, the GLM/local dispatch mechanics, and the `--model` mappings are in `references/orchestration.md`. **Anthropic attempts dispatch via the Task tool; GLM attempts via the `glm`→z.ai runner; Local attempts via the `omlx`→on-device runner; Codex attempts via the `codex exec` runner** (the non-Anthropic ones through bundled wrapper agents, per the orchestration reference). The reviewer and the final ranker are **always Anthropic Opus**, regardless of what the attempts use — the judge is held fixed so the comparison is consistent.

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

On confirmation, dispatch the whole tournament. **Two dispatch backends exist — prefer dynamic workflows:**

- **Preferred — dynamic workflows.** Invoke the bundled Workflow script `workflows/tournament.mjs` (at the plugin root, i.e. `../../workflows/tournament.mjs` relative to this skill's base dir) via the `Workflow` tool, passing `args` (see `references/orchestration.md` for the exact shape: task, mode, runDir, the per-attempt list, and the runner paths each kind of attempt needs — plus, if the task has **known input files every worker needs** (e.g. "evaluate/summarise/audit these files"), pass them as `contextFiles: [paths]` so the engine bundles them once and every attempt reads the bundle instead of re-reading each file (this avoids the dominant duplicated-Read cost) — `glmRunner` = `<plugin-root>/bin/glm-run.sh` if any attempt is GLM, `localRunner` = `<plugin-root>/bin/local-run.sh` if any attempt is Local, `codexRunner` = `<plugin-root>/bin/codex-run.sh` if any attempt is Codex, `attemptMaxTurns` = the agentic-iteration cap for **GLM** runners (default 30) and `localMaxTurns` = the cap for **local** runners (default 20) — the iteration backstop against grinding, sized generously because substantial writing deliverables need more turns than a tiny script (the hard-stop brief is the real guard). `attemptTimeoutSecs` = the wall-clock backstop scaled to task complexity — ~180 for a small script, 300 (default) for something heavier, more for big writing tasks. `codexTimeoutSecs` = the Codex-only wall-clock backstop (default 600): codex `exec` has **no** turn cap (no `--max-turns`), so the wall clock is its only per-attempt guard — size it generously). The workflow runs Phases 2–5 deterministically — parallel attempts, the blind Opus review, and (two pass) round two and the final rank — and you can watch it live in `/workflows`. It returns the structured mapping + rankings you report in Phase 6. This is opt-in orchestration: the harness will show a confirm at first dispatch. **Anthropic attempts run native; GLM attempts run through `farnsworth-glm-*` agents executing `bin/glm-run.sh` (z.ai); Local attempts run through the single `farnsworth-local` agent executing `bin/local-run.sh` (on-device omlx server); Codex attempts run through the single `farnsworth-codex` agent executing `bin/codex-run.sh` (OpenAI `codex exec`).** The Task tool cannot target GLM, local, or codex models directly, and the runner-script indirection is what makes those paths reliable (do not inline the raw nested-`claude`/`codex` command; the wrapper will refuse or shortcut it). The indirection matters most for codex, a fully autonomous external agent most prone to solving/refusing the task itself.
- **Fallback — Task tool + `glm` CLI.** If workflows are unavailable (disabled on the plan, or the user declines), fan out manually per `references/orchestration.md`: Anthropic attempts via the Task tool, GLM attempts via backgrounded `glm` calls, then run the Opus review yourself.

Apply a fresh diversity draw for each round (Phase 1b). The essential rules hold on **either** backend:

- **Identical brief plus one modifier.** Every attempt receives the same task text, differing only by its drawn diversity modifier, so any divergence is attributable to it. No attempt is told it is competing, judged, or which attempt it is.
- **Isolation.** Each attempt gets its own workspace (e.g. `<run-id>/round-1/candidate-<i>/`). Isolated workspaces prevent the race conditions and clobbered files that parallel writes to one location cause.
- **No cross-talk.** Attempts must not see each other's output. Independence is the point.
- **Self-summary.** Each attempt leaves its complete work product in its workspace plus a 2 to 4 sentence note on its approach, tradeoffs, and known limitations.
- **Single-pass exploration, hard stop.** Each attempt writes ONE solution file and stops immediately — no running, testing, rewriting, or polishing. It must NOT "iterate until it works." Refinement is the tournament's job (diverse one-shots → review → in two pass, distilled guidance → a fresh guided round), not any single attempt's. A rough or failed attempt is useful signal for the review/distillation; forcing per-attempt perfection collapses diversity, hides that signal, and explodes runtime — weaker local models especially loop on self-critique ("re-align the art…") and fixing their own bugs until they exhaust their turn cap. So the brief is a *hard* stop (write once, don't run/rewrite), with a per-attempt `--max-turns` backstop (GLM 30 / local 20 by default) and a wall-clock timeout. Require a saved file but not a flawless one; convey this as a working style — never tell an attempt it is one of several or being judged. See `references/orchestration.md`.

If many concurrent requests hit provider rate ceilings, run in smaller parallel batches rather than all at once. (Mixed Anthropic+GLM rounds spread load across two providers, which helps.)

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

**Provenance check (GLM, Local, and Codex).** For every GLM attempt, confirm its workspace `_glm_run.log` contains a `FARNSWORTH-GLM-PROVENANCE endpoint=api.z.ai` line; for every Local attempt, confirm `_local_run.log` contains `FARNSWORTH-LOCAL-PROVENANCE endpoint=127.0.0.1:8000`; for every Codex attempt, confirm `_codex_run.log` contains `FARNSWORTH-CODEX-PROVENANCE endpoint=api.openai.com` (and `FARNSWORTH-CODEX-DONE exit=0`, no `-TIMEOUT`/`-ERROR`). This is mechanical proof the attempt actually ran on the intended provider, not a wrapper faking it with an Anthropic model. Treat any such candidate with no provenance marker or no saved deliverable as a failed attempt: exclude it and note the failure. Weaker models (especially `glm-4.5-air` and small local models) sometimes fail to save a deliverable, and codex (an autonomous external agent) can refuse, bail without saving, or run to its wall-clock timeout; those are honest failures, not something to paper over. The engine's validator is line-anchored and provider-specific (`^FARNSWORTH-<PROV>-…`), so an attempt whose own deliverable merely *mentions* a marker token cannot false-fail its validation.

## Quick reference

| Step | Single pass | Two pass |
|------|-------------|----------|
| Trigger | `@@FL:N` / `farnsworth loop:N` | `@@FL:N:2` / `farnsworth loop:N:2` |
| Phase 0 | parse task, N, mode | parse task, N, mode |
| Phase 1 | model gate (mandatory stop) | model gate (mandatory stop) |
| Phase 1b | diversity injection (default on) | diversity injection (default on) |
| Phase 2 | confirm + run N attempts | confirm + run N attempts |
| Phase 3 | blind Opus review → rank → winner = result | blind Opus review → rank + distil guidance; save winner, discard rest |
| Phase 4 | — | N fresh attempts given task + guidance, no prior code |
| Phase 5 | — | final pool = N round-2 + 1 saved winner; blind Opus rank |
| Phase 6 | report | report (+ guidance used, winner's round) |

- Trigger: sigil `@@FL:N:M` (preferred — e.g. `@@FL:5`, `@@FL:7:2`, `@@fl:4:2`) or prose `farnsworth loop:N[:2]`. N = attempts/round, M = passes (omit/1 = single, 2 = two). Case-insensitive, optional spaces; text before the marker is the task.
- Dispatch: prefer the bundled `Workflow` script `workflows/tournament.mjs` (live in `/workflows`); Anthropic attempts native, GLM/Local/Codex attempts via the `farnsworth-glm-*` / `farnsworth-local` / `farnsworth-codex` wrapper agents. Fallback: Task tool + `glm` CLI. See `references/orchestration.md`.
- N is per round, an integer of 2 or more. Confirm volume at N ≥ 8 (single pass) or N ≥ 6 (two pass).
- Phase 1 model question: seven options (Opus, Sonnet, Haiku, GLM→submenu, Local→live submenu, Codex→effort submenu, Mixed); GLM drills down to one of glm-5.2/glm-5.1/glm-4.7/glm-4.5-air; Local lists `omlx-models` live (dynamic); Codex is gpt-5.5 with a reasoning-effort submenu (codex-low/medium/high/xhigh); Mixed loops per attempt over Anthropic + GLM + local + codex ids; in two pass the assignment applies to both rounds. Anthropic attempts dispatch via the Task tool, GLM via the `glm`→z.ai runner, Local via the `omlx`→on-device runner, Codex via the `codex exec` runner. Reviewer/ranker are always Anthropic Opus.
- Diversity injection (default on): each attempt draws a distinct framing so siblings do not converge. Pool A approach nudges by default (blind-safe); Pool B objective lenses opt-in. Without replacement, seeded, logged. See `references/diversity-injection.md`.
- Round attempts: N parallel, isolated, identical brief plus one diversity modifier, no cross-talk.
- Review/rank (Opus, blind): pros and cons per candidate, rank, name winner. In two pass also distil positives-to-consider and challenges-to-avoid, save the winner, discard the other artifacts.
- Dispatch mechanics and the round two brief template: `references/orchestration.md`.
- Scoring and distillation rubric: `references/review-rubric.md`.
