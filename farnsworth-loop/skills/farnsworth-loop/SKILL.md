---
name: farnsworth-loop
description: "Run a Farnsworth Loop tournament in one of two modes. The sigil is @@FL[:N][:M[:Z]] — N (optional) = attempts per round, M = passes (1 single, 2 two), Z = grand loops (Z>=2 = an UNATTENDED chain that, per loop, runs a full tournament, implements the winning proposal into your real repo on a new FL-<loop>-<random7> branch, runs fail-closed verify, and opens one PR — never auto-merged; Z=1 or omitted = today's isolated tournament; Z capped at Z_MAX=5); N may be inferred from a prose model spec like '2 opus, 2 glm 5.2, 1 codex high' (sum of counts = N, the items become the per-attempt Mixed assignment) or the Top Mixed preset ('top mixed' + N spread over opus/glm-5.2/codex-high), and bare @@FL falls back to the interactive model gate. First ask the user which model quality to use for the attempts (Anthropic Opus, Sonnet, Haiku; a GLM z.ai model via the glm CLI; a free local on-device MLX model via the omlx server; or Mixed per-attempt). SINGLE PASS: produce N independent solutions in parallel, then a blind Opus reviewer scores them, lists pros and cons, ranks them, and names a winner. TWO PASS: the same first round, but the Opus reviewer also distils what worked and what failed into guidance; the losing attempts are discarded, a second round of N fresh attempts is run with that guidance (positives to emulate, pitfalls to avoid), the saved round one winner is added back, and a final Opus ranker picks the overall winner. Trigger whenever the user's message contains a sigil of the form @@FL:N:M (for example @@FL:5 , @@FL:5:2 , @@fl:7:2 ), where N is the number of attempts per round and M is the number of passes (omitted or 1 = single pass, 2 = two pass); the text before the sigil is the task. ALSO trigger on the prose marker 'farnsworth loop:N' (single pass) or 'farnsworth loop:N:2' (two pass), e.g. 'do abc :farnsworth loop:5' or 'do abc: farnsworth loop:5:2'. All forms are case-insensitive with optional spaces around the colons. Also trigger when the user clearly asks for a farnsworth loop / generate-and-rank tournament even without a marker."
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

Do not hand-parse the sigil. In Phase 0, run the bundled parser ONCE and act on its JSON:

```
node <plugin-root>/bin/fl-parse.mjs "<the raw user message, verbatim>"
```

It returns `{ task, n, mode, z, assignment, preset?, conflict?, errors?, needsGate? }`. The grammar it implements:

- **Sigil** `@@FL[:N][:M[:Z]]` (case-insensitive, optional spaces around colons). N optional (int ≥ 2). M optional, default 1 (1 = single, 2 = two pass; any other value → error). **Z optional, default 1 (int in [1..5]). `Z=1` (or omitted) = today's isolated tournament, byte-identical. `Z>=2` = grand-loop mode (Phase 0b authorization + Phase 7 driver). `Z>Z_MAX=5` is a hard error (the parser refuses it and echoes the offending Z; tell the user to split into batches).** `@@FL:5` and `@@FL:5:2` parse exactly as before.
- **Positional skips are forbidden:** `@@FL:5::3` is invalid; to set Z with a default M, write `@@FL:5:1:3`.
- **Prose marker** `farnsworth loop:N[:M[:Z]]` — extended identically.
- **Prose model spec** (may replace explicit N): a comma- or `and`-separated list of `<count> <model>` items anywhere in the message. Sum of counts = N; the items expand to the per-attempt assignment. The spec text is stripped from the task. An ordinary `<digit> <noun>` in the task (e.g. "fix 3 bugs") is NOT a spec.
- **Top Mixed preset:** `top mixed` (also `top-mix` / `top mix`) plus an N (from the sigil, or a leading count like `6 top mixed`) → allocate N across `[opus, glm-5.2, codex-high]` as evenly as possible (remainder priority opus > glm-5.2 > codex-high; N=2 → opus+glm-5.2).

**Act on the JSON, in this order:**

1. **`errors` non-empty → STOP and ask.** Print the error(s) and do nothing else. This covers: an unrecognised model token (never silently drop one — a dropped token changes N), an invalid M, an invalid Z (< 1), **`Z > Z_MAX` (5) — refuse and tell the user to split into batches (the error names the offending Z; do NOT silently treat it as Z=1)**, a positional skip, and N < 2. `n` and `assignment` are nulled on any error, so never run a tournament when `errors` is present.
2. **`conflict` present → STOP and ask, surfacing BOTH numbers.** The sigil/marker N and the prose-spec sum disagree. Do **not** guess. Ask, e.g.: *"Your spec lists N=`conflict.specN` (`assignment`) but the marker says N=`conflict.markerN`. Run the spec's count, or N=markerN (and I'll ask the per-attempt models)?"* Proceed only after the user resolves it.
3. **`needsGate: true` → run the Phase 1 gate.** This is bare `@@FL` (no N, no spec), or Top Mixed with no N anywhere. Go to Phase 1.
4. **Otherwise (`n` set):** the invocation is complete. If `assignment` is set (a prose spec or Top Mixed already answered the model question), **skip the Phase 1 menu** and use that assignment directly — it *is* a Mixed assignment. If `assignment` is null but `n` is set (explicit N, no spec), run the Phase 1 gate as today.
5. **`z >= 2` and no error/conflict → grand-loop mode.** After resolving N/assignment/mode as above, do NOT start a normal tournament. Instead: (a) run the **non-implementable-task check** below; (b) go to **Phase 0b** (the one front-loaded autonomy authorization); (c) then run **Phase 7** (the grand-loop driver). For `z == 1` everything proceeds exactly as today (Phases 1–6).

**Task** = the parser's `task` (everything before the marker, with the spec text and Top Mixed keyword stripped and any trailing separator colon removed). Every attempt in every round receives this identical task.

If the user clearly describes the loop's generate-and-rank tournament but omits any marker, you may still run it: infer single vs two pass from whether they describe a learning round, ask for N and the model if not given, then proceed.

Validate before continuing (the parser enforces these; re-check):
- N must be an integer of 2 or more.
- Single pass is roughly N attempts plus one Opus pass. At N of 8 or more, confirm the user wants that volume.
- Two pass roughly doubles the attempt count, so its cost ceiling is lower: at N of 6 or more, confirm the user wants that volume before proceeding (see the cost note in Phase 2).

**Non-implementable-task detection (only when `z >= 2`, before loop 1).** Grand loops implement the winning proposal into the real repo. A task that produces a **standalone artifact unrelated to the repo** (e.g. "write a haiku", "draft an email", "explain X") would make the implementer open empty/meaningless PRs. Before authorizing, judge whether the task implies a change to project files (refactor / add feature / fix / optimise / write tests / document). If it does not, STOP and offer Z=1 instead:
*"This task ('<task>') produces a standalone artifact, not a repo change, so grand loops (Z=<z>) would open empty/meaningless PRs. Run it as a normal tournament (Z=1) instead? [y/N]"*
Proceed to Phase 0b only on a clearly implementable task (or explicit user override).

## Phase 0b: Grand-loop authorization (Z>=2 only)

When `z >= 2`, the mandatory per-dispatch interactive gate (the operating rule) is **front-loaded into ONE authorization covering all Z loops** — the only way an unattended chain is compatible with "stop and ask." This **replaces** the per-dispatch gate for the whole chain (for `z == 1` the normal gate is unchanged). First run the **zero-token preflight** so you never spend on a doomed chain:

```
bash <plugin-root>/bin/fl-git.sh preflight "<base = current branch>" "<runDir>"
```

`preflight` collects ALL failures at once (inside a git work tree? working tree clean — it REFUSES on a dirty tree; gh authenticated? a remote resolves from the base's upstream with an origin fallback? base branch resolves?) and warns (does not fail) if no verify commands are detectable. If it returns nonzero, print its failure list and STOP — run no tournament.

On a clean preflight, show this authorization and **wait** for the user to **re-type Z** (friction proportional to blast radius — a fat-fingered `@@FL:5:2:30` is already refused by the parser at Z_MAX; the re-type guards a valid-but-large Z):

```
Grand-loop mode requested: Z=<z> grand loops.

This is UNATTENDED and WRITES TO A REAL REPOSITORY. For each of <z> loops I will:
  • create a new branch  FL-<loop>-<random7>  off  <base = current branch '<base>'>   (FAN topology)
  • run a full <single|two>-pass tournament (N=<n>, models: <assignment or 'from the gate'>)
  • IMPLEMENT the winning proposal into your repo on that branch (the farnsworth-implementer agent, Opus)
  • run verify (<detected commands, or 'NONE detected → draft needs-human PR'>) — FAIL-CLOSED: a failure HALTS the chain
  • open a PR (draft + needs-human if verify failed or could not run). I will NEVER merge.

Repo:           <repoRoot>
Topology:       FAN (independent, individually-mergeable PRs off <base>); a cross-loop ledger keeps loops from duplicating each other; you merge later
Branch naming:  FL-<loop>-<random7>   (NOTE: this OVERRIDES your global 'rob/' branch-prefix rule for these loop branches only)
Kill switch:    create a file  <runDir>/STOP  at any time to stop the chain before the next loop
Projected cost: ~Z × (N attempts + 1-2 Opus judges + 1 Opus implementer + verify)
                ≈ <z> × (<n> attempts + judges + implementer + verify). (Cost is not the constraint; this is for awareness. Real implementer + verify spend is included.)

To proceed, re-type the number of grand loops: ___
```

Only if the typed number equals `z` do you continue to Phase 7. Any other answer (or a STOP request) aborts with no spend. **STACK topology** is opt-in only (`topology=stack` in the user's message): if chosen, say so in the authorization, note each loop branches off the previous loop's branch, and that STACK **forces halt-on-failure** (no continue-on-failure). FAN is the default.

## Phase 1: Choose the models (mandatory gate, stop here — both modes)

This is the gate from the operating rule (run it when Phase 0 returned `needsGate`, or when an explicit N has no inferred assignment — when Phase 0 already produced an `assignment`, skip the menu). Ask it as your first response and **wait for the answer before doing anything else**. N defaults to **6** (or whatever Phase 0 supplied); passes default to **2** (or 1). Ask exactly this, as a nine option selection, then stop:

> Which models do you want for the attempts? (N defaults to 6, passes to 2)
> 1. Top Mixed — spread N across Opus, glm-5.2, codex-high (even split)
> 2. Specify Mix — choose a model per attempt (custom)
> 3. Opus — Anthropic, highest capability
> 4. Sonnet — Anthropic, balanced
> 5. Haiku — Anthropic, fastest and cheapest
> 6. GLM — z.ai models (I'll then ask which GLM model)
> 7. Local — free on-device MLX models via the omlx server (I'll then list the available ones)
> 8. Codex — OpenAI gpt-5.5 via the `codex exec` CLI (I'll then ask which reasoning effort)
> 9. MiniMax — minimax-m3 via the bundled minimax runner

Handle the answer (if Phase 0 already produced an `assignment` — a prose spec or the Top Mixed keyword — skip this menu and use it directly):

- **Option 1 (Top Mixed):** if N is not yet known, ask for it. Allocate N across `[opus, glm-5.2, codex-high]` as evenly as possible (remainder priority opus > glm-5.2 > codex-high; N=2 → `[opus, glm-5.2]`) — the same computation `fl-parse.mjs` does for the `top mixed` keyword. Record it, e.g. N = 5 → `[opus, opus, glm-5.2, glm-5.2, codex-high]`.
- **Option 2 (Specify Mix):** walk the attempts one at a time, attempt 1 to attempt N. For each, ask which concrete model to use, offering the three Anthropic models, the four GLM models, the live local model ids, the four codex effort levels, **and minimax-m3** — not the group names. Record each choice, e.g. `[opus, glm-5.2, codex-high, minimax-m3]`.
- **Options 3, 4, or 5 (uniform Anthropic):** every attempt uses that single Anthropic model. Record the assignment, e.g. for N = 4 with Sonnet: `[sonnet, sonnet, sonnet, sonnet]`.
- **Option 6 (GLM):** drill down with a second question, then stop again and wait. Every attempt uses the one chosen GLM model:
  > Which GLM model?
  > 1. glm-5.2 — strongest, 1M context
  > 2. glm-5.1
  > 3. glm-4.7
  > 4. glm-4.5-air — fastest, cheapest

  Record the uniform assignment, e.g. for N = 4 with glm-5.2: `[glm-5.2, glm-5.2, glm-5.2, glm-5.2]`.
- **Option 7 (Local):** the local model list is **dynamic**, so fetch it live before drilling down — run `omlx-models` (or `curl -s http://127.0.0.1:8000/v1/models -H "Authorization: Bearer $OMLX_AUTH_TOKEN" | jq -r '.data[].id'`). Present the returned model ids as a numbered menu, then stop and wait. Every attempt uses the one chosen local model id (recorded verbatim, e.g. `[gemma-4-26b-a4b-it-8bit, ...]`). If the server is unreachable (connection refused), tell the user the local server appears down and offer another tier. Local models are free but slower; flag that for larger N.
- **Option 8 (Codex):** Codex is pinned to OpenAI **gpt-5.5** (the model the local ChatGPT-account auth serves; other ids need an `OPENAI_API_KEY`), so the submenu is the **reasoning effort** (codex's quality lever), not a model. First run a one-line liveness probe so a stale CLI / auth block doesn't waste a (possibly paid) round:
  > `printf 'reply OK and stop' | codex exec -s read-only --skip-git-repo-check -c 'mcp_servers={}' -m gpt-5.5 - 2>&1 | tail -5`

  If it returns an HTTP 400 "requires a newer version of Codex" → tell the user to `brew upgrade codex`; if "not supported when using Codex with a ChatGPT account" → tell them to set `OPENAI_API_KEY` (API-key billing) — then offer another tier. On success (it prints OK), ask:
  > Which codex reasoning effort? (model is gpt-5.5)
  > 1. Low — fastest, lightest reasoning
  > 2. Medium — balanced (codex default)
  > 3. High — deeper reasoning
  > 4. Extra high — maximum reasoning depth

  Record the uniform assignment using the `codex-<effort>` displayModel (effort token: low / medium / high / **xhigh** for "Extra high"), e.g. for N = 4 at High: `[codex-high, codex-high, codex-high, codex-high]`. Codex bills your OpenAI/ChatGPT plan, not Anthropic usage; flag that codex (an autonomous agent with no turn cap) is slower than a one-shot, so size N modestly.
- **Option 9 (MiniMax):** every attempt uses `minimax-m3`, dispatched via the bundled `bin/minimax-run.sh` through the `farnsworth-loop:farnsworth-minimax` agent. Record the uniform assignment, e.g. for N = 4: `[minimax-m3, minimax-m3, minimax-m3, minimax-m3]`. Treat it like the other single-model runner providers (its own `_minimax_run.log` provenance marker, same honest-failure handling). MiniMax-M3 handled a heavy multi-file build cleanly in testing (GLM is the slow one on big tasks); if it ever runs long on a large task, raise `attemptTimeoutSecs`.

In two pass, the model assignment applies to **both rounds**: round two re-uses the same per-attempt list. If the user explicitly wants different models for round two, re-ask the gate for round two; otherwise re-use round one's assignment. Model aliases, the GLM/local dispatch mechanics, and the `--model` mappings are in `references/orchestration.md`. **Anthropic attempts dispatch via the Task tool; GLM attempts via the `glm`→z.ai runner; Local attempts via the `omlx`→on-device runner; Codex attempts via the `codex exec` runner; MiniMax attempts via the `bin/minimax-run.sh` runner (agent `farnsworth-loop:farnsworth-minimax`)** (the non-Anthropic ones through bundled wrapper agents, per the orchestration reference). The reviewer and the final ranker are **always Anthropic Opus**, regardless of what the attempts use — the judge is held fixed so the comparison is consistent.

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

## Phase 7: Grand-loop driver (Z>=2 only — FAN topology, fail-closed)

Reached only after a successful Phase 0b authorization. The orchestration home is **this SKILL procedure + `bin/fl-git.sh`** — there is **no nested grand-loop workflow**, and **`tournament.mjs` is unchanged**. You (the main agent) run the loop; you invoke the `Workflow` tool for the tournament and the `Task` tool for the implementer; `bin/fl-git.sh` does every git/gh side effect. Run all git through the helper (`bash <plugin-root>/bin/fl-git.sh <fn> ...`), never improvise git/gh yourself.

The driver calls exactly these `fl-git.sh` functions: `fl_branch`, `preflight`, `detect_verify`, `run_verify`, `commit_and_push`, `open_pr`, `open_pr_needs_human`, `fl_compose_body`, `fl_append_verify_tail`, `stop_file_check`, `done_marker`, `fl_detect_orphan_branch`.

Setup once: `base` = the current branch (from preflight). `ledger = []` (cross-loop memory). Detect verify commands once: `bash <plugin-root>/bin/fl-git.sh detect_verify > <runDir>/_verify_cmds.txt` (empty file ⇒ unverifiable ⇒ every PR will be draft + needs-human).

**For each loop `k` in 1..Z:**

1. **STOP-file kill switch (top of every iteration).** `bash <plugin-root>/bin/fl-git.sh stop_file_check "<runDir>"` — **rc 0 means a STOP file is present**: halt the chain, report, go to the finally step. (rc 1 = keep going.)
2. **Idempotency / DONE marker.** `bash <plugin-root>/bin/fl-git.sh done_marker "<runDir>" <k>` — rc 0 means this loop already completed (its PR exists); **skip it**. Also run `bash <plugin-root>/bin/fl-git.sh fl_detect_orphan_branch <k>`: if it prints an `FL-<k>-*` branch but the DONE marker is absent, a prior run died mid-loop — **STOP and tell the human to inspect/delete that branch** (detect-and-stop; never auto-resume a half-applied implementer step).
3. **Branch off base (FAN).** `BR=$(bash <plugin-root>/bin/fl-git.sh fl_branch <k>)` then `git switch "<base>" && git switch -c "$BR"`. (STACK variant: branch off loop k-1's branch instead.) The `FL-` name OVERRIDES the global `rob/` prefix for loop branches only.
4. **Run the tournament (UNCHANGED engine) via the Workflow tool.** Invoke `workflows/tournament.mjs` exactly as in Phase 2, with `runDir: "<runDir>/loop-<k>"` and the task **augmented with the cross-loop ledger** (see below). It returns the structured mapping/ranking; **pick the winning candidate's deliverable path** (its proposal artifact) from `final.mapping`/`round1.mapping`. The proposal must be a concrete, file-level change description (Phase 2 already briefs attempts to produce that).
5. **Implement the winner via the Task tool.** Spawn `Task` with agent `farnsworth-loop:farnsworth-implementer` (model Opus), cwd = `repoRoot`, passing `{ proposal: <winnerProposalPath>, repoRoot: <base repo root>, branch: "$BR", base: "<base>" }`. It makes the smallest coherent change on `$BR`, leaves changes **UNSTAGED**, and returns a 3-6 line summary (its `FL-NOTES.md` captures any ambiguity). Keep that summary as `WINNER_SUMMARY`.
6. **Verify (fail-closed).** `bash <plugin-root>/bin/fl-git.sh run_verify < <runDir>/_verify_cmds.txt > <runDir>/loop-<k>/_verify.log 2>&1`. rc 0 = pass; rc 1 = a command failed (fail-fast, never masked); rc 2 = no commands (unverifiable). Treat rc 1 **and** rc 2 as "verify did not pass" for PR routing below.
7. **Commit + push.** `bash <plugin-root>/bin/fl-git.sh commit_and_push "$BR" "<base>" "FL loop <k>: <WINNER_SUMMARY first line>"`. It refuses unless HEAD is `$BR` and the diff is non-empty, then pushes `-u` to the resolved remote. Propagate any nonzero rc (stop with the message).
8. **Open the PR.** Compose a body file in a portable temp file, then:
   - **verify passed (rc 0):** `BODY=$(mktemp); bash <plugin-root>/bin/fl-git.sh fl_compose_body "$BODY" <<'EOF' ...PR template (Task, tournament, winner, topology, verify result, ledger siblings, run dir, WINNER_SUMMARY)... EOF`; `bash <plugin-root>/bin/fl-git.sh open_pr "$BR" "<base>" "FL loop <k>: <summary>" "$BODY"`.
   - **verify failed/unverifiable (rc 1 or 2):** compose the same body, then `bash <plugin-root>/bin/fl-git.sh fl_append_verify_tail "$BODY" "<runDir>/loop-<k>/_verify.log"` (caps the output so a huge log can't blow the PR limit), then `bash <plugin-root>/bin/fl-git.sh open_pr_needs_human "$BR" "<base>" "[needs-human] FL loop <k>" "$BODY"` (draft + `needs-human`, with a label-less draft fallback). **Then HALT the whole chain** (fail-closed default; STACK always halts). NEVER auto-merge, ever.
9. **DONE marker (only after the PR is created).** `bash <plugin-root>/bin/fl-git.sh done_marker "<runDir>" <k> write`. A re-run will now skip loop k.
10. **Append to the ledger:** `{ loop: k, winner_summary: <WINNER_SUMMARY>, pr_url: <url> }`.

**Cross-loop ledger (FAN memory).** Because every FAN loop re-attacks the same `base`, augment loop k's task with what prior loops already proposed so loop k explores something different:

```
Prior grand loops on this same repository already proposed and implemented (on separate branches):
- loop 1: <winner_summary 1>
- loop 2: <winner_summary 2>
Propose a DIFFERENT, additive improvement that does not duplicate the above. If the repository is
already in good shape, say so explicitly rather than inventing a marginal change.
```

**Finally (always):** `git switch "<base>"` so the user ends on the branch they started on. **Report** every loop: its FL- branch, PR url (and whether it is a normal or draft/needs-human PR), the winning model, the verify result, and the stop reason if the chain halted early.

## Quick reference

| Step | Single pass | Two pass |
|------|-------------|----------|
| Trigger | `@@FL[:N][:M[:Z]]` / `farnsworth loop:N[:M[:Z]]` — N optional (prose spec / Top Mixed can supply it) | same, `:2` = two pass |
| Phase 0 | parse task, N, mode | parse task, N, mode |
| Phase 1 | model gate (mandatory stop) | model gate (mandatory stop) |
| Phase 1b | diversity injection (default on) | diversity injection (default on) |
| Phase 2 | confirm + run N attempts | confirm + run N attempts |
| Phase 3 | blind Opus review → rank → winner = result | blind Opus review → rank + distil guidance; save winner, discard rest |
| Phase 4 | — | N fresh attempts given task + guidance, no prior code |
| Phase 5 | — | final pool = N round-2 + 1 saved winner; blind Opus rank |
| Phase 6 | report | report (+ guidance used, winner's round) |
| Phase 7 | — (Z=1: not used) | grand-loop driver (Z>=2): preflight → authorize (re-type Z) → per loop: STOP-check → branch off base → tournament → implement → verify → commit/push → PR → ledger; finally switch back to base |

- Trigger: sigil `@@FL[:N][:M[:Z]]` (e.g. `@@FL:5`, `@@FL:7:2`, bare `@@FL`) or prose `farnsworth loop:N[:M[:Z]]`. N optional — inferable from a prose model spec (`2 opus, 2 glm 5.2, 1 codex high` → N=5, `[opus,opus,glm-5.2,glm-5.2,codex-high]`) or the Top Mixed preset (`top mixed` + N → even split over opus/glm-5.2/codex-high). M = passes (omit/1 single, 2 two). Z = grand loops (Z=1/omitted = today's isolated tournament; Z>=2 = unattended chain — per loop: tournament → implement winner on a new FL-<loop>-<random7> branch (Opus implementer) → fail-closed verify → one PR (draft+needs-human on failure, then HALT), never auto-merged; Z capped at Z_MAX=5, Z>5 refused). FL- branch naming OVERRIDES the global rob/ prefix for loop branches only. All git/gh lives in bin/fl-git.sh; tournament.mjs is unchanged; there is no nested workflow. Bare `@@FL` → interactive gate. Case-insensitive, optional spaces; text before the marker is the task. Phase 0 runs `bin/fl-parse.mjs` for all of this.
- Dispatch: prefer the bundled `Workflow` script `workflows/tournament.mjs` (live in `/workflows`); Anthropic attempts native, GLM/Local/Codex/MiniMax attempts via the `farnsworth-glm-*` / `farnsworth-local` / `farnsworth-codex` / `farnsworth-minimax` wrapper agents. Fallback: Task tool + `glm` CLI. See `references/orchestration.md`.
- N is per round, an integer of 2 or more. Confirm volume at N ≥ 8 (single pass) or N ≥ 6 (two pass).
- Phase 1 model question: nine options (Top Mixed, Specify Mix, Opus, Sonnet, Haiku, GLM→submenu, Local→live submenu, Codex→effort submenu, MiniMax); a Phase-0 prose spec or Top Mixed keyword answers it and the menu is skipped; N defaults 6, passes default 2. GLM drills down to one of glm-5.2/glm-5.1/glm-4.7/glm-4.5-air; Local lists `omlx-models` live (dynamic); Codex is gpt-5.5 with a reasoning-effort submenu (codex-low/medium/high/xhigh); Specify Mix loops per attempt over Anthropic + GLM + local + codex + minimax-m3 ids; in two pass the assignment applies to both rounds. Anthropic attempts dispatch via the Task tool, GLM via the `glm`→z.ai runner, Local via the `omlx`→on-device runner, Codex via the `codex exec` runner, MiniMax via the `bin/minimax-run.sh` runner. Reviewer/ranker are always Anthropic Opus.
- Diversity injection (default on): each attempt draws a distinct framing so siblings do not converge. Pool A approach nudges by default (blind-safe); Pool B objective lenses opt-in. Without replacement, seeded, logged. See `references/diversity-injection.md`.
- Round attempts: N parallel, isolated, identical brief plus one diversity modifier, no cross-talk.
- Review/rank (Opus, blind): pros and cons per candidate, rank, name winner. In two pass also distil positives-to-consider and challenges-to-avoid, save the winner, discard the other artifacts.
- Dispatch mechanics and the round two brief template: `references/orchestration.md`.
- Scoring and distillation rubric: `references/review-rubric.md`.
- Grand loops (Z>=2): Phase 0b front-loads ONE autonomy authorization (re-type Z) covering all loops; a `<runDir>/STOP` file is the between-loops kill switch; FAN topology (independent PRs off base) + a cross-loop ledger by default, STACK opt-in (forces halt-on-failure); fail-closed auto-detected verify; per-loop DONE markers for idempotency; non-implementable tasks are offered Z=1 instead. See Phase 7 and `references/orchestration.md`.
- Dogfood backlog (GitHub Issues): problems found while running tournaments are filed as GitHub issues labelled `dogfood` via the bundled `bin/fl-issue.sh` (the only forge-touching part; the engine stays forge-agnostic). File with `bin/fl-issue.sh new --sev sevN --area <area> --title "…" --evidence-file EV.md` — always paste a verbatim verdict/guidance excerpt (still required triage content; PUBLIC repo, so never paste secrets or the `mapping.json` unblinding line — say "blind B", not the model). A `@@FL` "dogfood run" picks the top open item (`bin/fl-issue.sh next`), claims it best-effort (`claim N run-id`; the gh API has no compare-and-swap, so a git-ref push under `refs/dogfood-claims/` is the strict escape hatch), fixes it on a `rob/dogfood-N` branch, and opens one PR with `Closes #N`. No `gh`/offline → the helper degrades to a committed `docs/dogfood/inbox/` draft (never `.runs/`). Historical `D-NNNN` items were imported as closed `dogfood` issues (full evidence in each body); there is no in-repo backlog/archive anymore. Full rules: `references/dogfood.md`.
