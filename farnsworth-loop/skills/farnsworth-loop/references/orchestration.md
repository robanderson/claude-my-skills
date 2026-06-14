# Orchestration reference

How to dispatch the attempts and the Opus passes. Read this in Phase 2 (both modes), and in Phase 4 and Phase 5 (two pass only).

**Mode note.** Single pass uses only the first round (`round-1/`) and one Opus pass (the Phase 3 reviewer); it has no `round-2/`, no carried-over `winner/`, and no `final-rank/`. Two pass uses everything below. Where this file says "both rounds", single pass simply runs the first round and stops after the Phase 3 review.

## Model identifiers

The Phase 1 selection maps to these. There are two families with two different dispatch paths.

**Anthropic models** — dispatched via the Task tool. The sub-agent's `model` field accepts the short alias; the full API string is given for harnesses that need it.

| Choice  | Alias    | API model string     | Role                        |
|---------|----------|----------------------|-----------------------------|
| Opus    | `opus`   | `claude-opus-4-8`    | attempt, review, or rank    |
| Sonnet  | `sonnet` | `claude-sonnet-4-6`  | attempt                     |
| Haiku   | `haiku`  | `claude-haiku-4-5`   | attempt                     |

**GLM models (z.ai)** — dispatched by shelling out to the `glm` CLI (see "Dispatching GLM attempts" below). `glm` is the `claude` CLI pointed at z.ai's Anthropic-compatible endpoint; it is selected through `glm`'s `--model` flag, which is **not** the same as a GLM model name. Use this exact mapping:

| GLM model     | `glm` flag         | Notes                          |
|---------------|--------------------|--------------------------------|
| `glm-5.2`     | `--model opus`     | strongest, 1M context          |
| `glm-5.1`     | `--model glm-5.1`  | passed through directly        |
| `glm-5`       | `--model glm-5`    | passed through directly        |
| `glm-4.7`     | `--model sonnet`   |                                |
| `glm-4.5-air` | `--model haiku`    | fastest, cheapest              |

The `--model opus/sonnet/haiku` aliases resolve to GLM models only because the `glm` wrapper sets `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` to the GLM strings; they are GLM models, not Anthropic ones. The wrapper requires `ZAI_API_KEY` to be set in the environment (it is sourced from the user's shell profile).

The Phase 3 reviewer (single pass and two pass) and the final ranker (Phase 5, two pass only) are **always Anthropic Opus**, dispatched via the Task tool — never GLM. Holding the judge fixed keeps scoring consistent across attempts and across rounds.

## Dynamic-workflow dispatch (preferred backend)

The bundled workflow `workflows/tournament.mjs` (plugin root) runs the whole tournament — parallel attempts, blind Opus review, and (two pass) the guided round and final rank — as one resumable, `/workflows`-monitored run. Invoke it from the skill's Phase 2 once the interactive gates are done:

```
Workflow({ scriptPath: "<plugin-root>/workflows/tournament.mjs", args: <ARGS> })
```

**ARGS shape** (the skill builds this from the model gate + diversity draw):

```
{
  task: "<exact task text>",
  mode: "single" | "two",
  runDir: "<absolute run dir>",          // e.g. <plugin>/.runs/<run-id>
  attempts: [                            // one per attempt, length N
    { label: "candidate-1",
      dispatch: "anthropic",             // native, runs in-process
      model: "haiku",                    // opus | sonnet | haiku
      displayModel: "haiku",             // for the report; NOT shown to judges
      r1nudge: "<Pool A nudge>", r2nudge: "<fresh Pool A nudge>" },
    { label: "candidate-2",
      dispatch: "glm",                   // runs via a wrapper agent
      agentType: "farnsworth-glm-5-2",   // one of the bundled GLM worker agents
      displayModel: "glm-5.2",
      r1nudge: "...", r2nudge: "..." }
    // ...
  ]
}
```

**Model → agentType map** for GLM attempts (the wrapper bakes the `glm` flag, see the table above):

| GLM model | agentType |
|-----------|-----------|
| glm-5.2 | `farnsworth-glm-5-2` |
| glm-5.1 | `farnsworth-glm-5-1` |
| glm-5 | `farnsworth-glm-5` |
| glm-4.7 | `farnsworth-glm-4-7` |
| glm-4.5-air | `farnsworth-glm-4-5-air` |

Anthropic attempts pass `dispatch:"anthropic"` + `model`; the workflow spawns them natively. The workflow blind-labels candidates, the Opus reviewer/ranker **reads and runs each candidate's files** from its workspace (judges never receive model identities), and the script returns `{ round1.mapping, round1.review, guidance?, final.mapping, final.rank, final.winnerRound }` — everything Phase 6 needs to unblind and report.

**Why the GLM wrapper agents exist:** a subagent inherits the session's Anthropic provider, so `model: glm-5.2` fails (verified: the Anthropic endpoint returns "model … may not exist"). Each `farnsworth-glm-*` agent is a cheap Anthropic (`haiku`) driver that shells out to `claude` pointed at z.ai — it must faithfully relay the GLM agent's output and never solve the task itself. GLM tokens bill the z.ai plan and do not appear in Anthropic usage, but each attempt still shows as a node in `/workflows`.

If dynamic workflows are unavailable, use the manual Task-tool + `glm`-CLI fallback below.

## Run layout

One run directory, with separate round folders and isolated per-candidate workspaces. Isolation is not optional: parallel agents writing to a shared path produce race conditions and overwritten files.

```
farnsworth-loop/
└── <run-id>/
    ├── round-1/
    │   ├── candidate-1/        # round 1 attempt workspaces
    │   ├── candidate-2/
    │   ├── ...
    │   └── candidate-N/
    ├── review-1/               # Phase 3 Opus reviewer workspace + report (+ guidance in two pass)
    ├── winner/                 # (two pass) the saved round 1 winner artifact
    ├── round-2/                # (two pass) round 2 attempt workspaces
    │   ├── candidate-1/
    │   ├── ...
    │   └── candidate-N/
    └── final-rank/             # (two pass) final Opus ranker workspace + report
```

Single pass stops after `review-1/`: the Phase 3 reviewer names the winner and that is the result.

## Dispatching the attempts

Launch all N of a round in the same turn so they run concurrently, each pointed at its own workspace. Single pass dispatches the Round 1 brief only. Two pass dispatches the Round 1 brief, then later the Round 2 brief.

**Round 1 brief (identical task plus one diversity modifier) — both modes:**

```
You are solving a self-contained task. Produce a complete, working solution.

Task:
<the exact task text, verbatim>

<one drawn diversity modifier, per references/diversity-injection.md, e.g.
"Approach this task test-first: sketch the tests before the implementation.">

Rules:
- Save all output files to: farnsworth-loop/<run-id>/round-1/candidate-<i>/
- Work only in that directory.
- At the end, return: (a) the path(s) to your deliverable, and
  (b) a 2 to 4 sentence note on your approach and any tradeoffs you made.
```

**Round 2 brief (two pass only — task plus distilled guidance, no prior code):**

```
You are solving a self-contained task. Produce a complete, working solution.

Task:
<the exact task text, verbatim>

In producing your answer, please consider these items as possible positives:
- <positive a>
- <positive b>
- <positive c>
- <positive d>
And treat these items as challenges to avoid:
- <challenge w>
- <challenge x>
- <challenge y>
- <challenge z>

<one drawn Pool A nudge, per references/diversity-injection.md, e.g.
"Approach this task starting from the data model or core types.">

Rules:
- Save all output files to: farnsworth-loop/<run-id>/round-2/candidate-<i>/
- Work only in that directory.
- At the end, return: (a) the path(s) to your deliverable, and
  (b) a 2 to 4 sentence note on your approach and any tradeoffs you made.
```

In neither round, and in either mode, tell an agent it is one of several, what N is, that it will be judged, or hand it another agent's output. Each attempt must be an independent solution. The round two guidance steers; it must not include or paraphrase a specific candidate's code, only generic patterns to emulate and pitfalls to avoid.

### Two dispatch paths (Anthropic vs GLM)

Each attempt's assigned model decides how it is launched. The **brief is identical either way** — same task text, same one diversity modifier, same isolation and self-summary rules — only the launch mechanism differs.

- **Anthropic attempt (`opus`/`sonnet`/`haiku`):** spawn a sub-agent via the Task tool with that `model`, as usual.
- **GLM attempt (`glm-5.2`/`glm-5.1`/`glm-5`/`glm-4.7`/`glm-4.5-air`):** the Task tool cannot target a GLM model, so launch it by shelling out to the `glm` CLI (see next subsection). It runs agentic with tools in its own workspace, exactly like a Task sub-agent, but on the GLM backend.

A single round can mix both paths (e.g. Mixed mode): launch the Task sub-agents and the `glm` background commands in the same turn so the whole round runs concurrently, then collect all deliverables together.

### Dispatching GLM attempts

For each GLM attempt with workspace `WS` and chosen GLM model mapped to its `glm` flag `F` (per the mapping table above), run the attempt brief through the `glm` CLI, agentic, with its cwd set to the isolated workspace:

```
( cd "WS" && glm -p "<the exact attempt brief, same text a Task sub-agent would get>" \
    --model F --allowedTools "Bash Read Write Edit" ) > "WS/_glm_run.log" 2>&1 &
```

- **cwd = the workspace** so the brief's "save to / work only in this directory" rules resolve to `WS` (the `glm` agent treats cwd as its working dir).
- `--allowedTools "Bash Read Write Edit"` pre-grants the tools so the non-interactive `-p` run never blocks on a permission prompt. (`ZAI_API_KEY` must be set; it comes from the user's shell profile.)
- Background each call with `&` (redirecting to a per-candidate log) so all of the round's GLM attempts run in parallel, then `wait` for them.
- **The deliverable** is whatever files the agent wrote in `WS`; **the self-summary** is the tail of `_glm_run.log` (the agent's final printed message). Collect both, exactly as you would a Task sub-agent's return.
- Do not put competition/judging/N context in the brief, same as any other attempt.

A quick liveness check before a big round is cheap: `glm -p "reply OK" --model haiku` should print `OK`.

### Concurrency and rate limits

- Keep each candidate's writes atomic and confined to its own directory.
- Many concurrent model requests can hit provider rate ceilings. If dispatch stalls or errors on rate limits, split N into smaller parallel batches (for example 4 at a time) run in sequence; attempts within a batch still run in parallel.
- If a sub-agent fails or returns nothing, note it and continue. A round proceeds over the attempts that succeeded, and the report states which attempt failed.

## Dispatching the Opus passes

**Phase 3 reviewer (both modes):** collect each first-round deliverable and self-summary, assign blind labels (Candidate A, B, ...) in a fixed order, keep a private label-to-model mapping, and spawn one Opus agent with the candidates and `references/review-rubric.md`. It returns the per-candidate pros and cons, the ranking, and the winner. In **two pass** it additionally returns the two distilled lists (positives to consider, challenges to avoid); in **single pass** those lists are not needed. Do not pass model identities to it.

**Final ranker (Phase 5, two pass only):** build the pool of N round two attempts plus the one saved round one winner, re-label the whole pool blind in a fixed order, keep a fresh private mapping, and spawn one Opus agent with the pool and the rubric. Do not tell it which candidate is the carried-over winner; it ranks blind on the merits.

## Harness notes

- **Claude Code:** use the Task tool to spawn each Anthropic attempt with the chosen `model`; spawn each GLM attempt by backgrounding a `glm -p` call (see "Dispatching GLM attempts"). With dynamic workflows / ultracode enabled, Claude can fan out and verify automatically. Confirm at the first dispatch. The reviewer/ranker are always Task-tool Anthropic Opus.
- **Claude Agent SDK:** spawn Anthropic sub-agents programmatically with per-agent model selection; for GLM attempts, invoke the `glm` CLI as a subprocess per the dispatch pattern. The same isolation, no-cross-talk, and blind-review rules apply in both modes.
- **Claude.ai (no sub-agents):** true parallel independent agents are not available. **Still run the interactive gates:** ask the Phase 1 model question and get the go-ahead exactly as written; only the parallelism is approximated, not the elicitation. Then produce each round's N attempts one at a time in separate, self-contained passes, holding each chosen model as the capability bar, and do the review yourself against the rubric. Flag to the user that this is a sequential approximation. In two pass, be especially careful not to let round one's code leak into round two beyond the distilled guidance.
