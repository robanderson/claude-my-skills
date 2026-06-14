# Orchestration reference

How to dispatch both rounds and the two Opus passes. Read this in Phase 2, Phase 4, and Phase 5.

## Model identifiers

The Phase 1 selection maps to these. In Claude Code, a sub-agent's `model` field accepts the short alias; the full API string is given for harnesses that need it. Keep these current with what the running harness offers.

| Choice  | Alias    | API model string     | Role                        |
|---------|----------|----------------------|-----------------------------|
| Opus    | `opus`   | `claude-opus-4-8`    | attempt, review, or rank    |
| Sonnet  | `sonnet` | `claude-sonnet-4-6`  | attempt                     |
| Haiku   | `haiku`  | `claude-haiku-4-5`   | attempt                     |

The round one reviewer (Phase 3) and the final ranker (Phase 5) are always Opus.

## Run layout

One run directory, with separate round folders and isolated per-candidate workspaces. Isolation is not optional: parallel agents writing to a shared path produce race conditions and overwritten files.

```
two-pass-best-of-n/
└── <run-id>/
    ├── round-1/
    │   ├── candidate-1/        # round 1 attempt workspaces
    │   ├── candidate-2/
    │   ├── ...
    │   └── candidate-N/
    ├── review-1/               # round 1 Opus reviewer workspace + report + guidance
    ├── winner/                 # the saved round 1 winner artifact
    ├── round-2/
    │   ├── candidate-1/        # round 2 attempt workspaces
    │   ├── ...
    │   └── candidate-N/
    └── final-rank/             # final Opus ranker workspace + report
```

## Dispatching the attempts (both rounds)

Launch all N of a round in the same turn so they run concurrently, each pointed at its own workspace.

**Round 1 brief (identical task plus one diversity modifier):**

```
You are solving a self-contained task. Produce a complete, working solution.

Task:
<the exact task text, verbatim>

<one drawn diversity modifier, per references/diversity-injection.md, e.g.
"Approach this task test-first: sketch the tests before the implementation.">

Rules:
- Save all output files to: two-pass-best-of-n/<run-id>/round-1/candidate-<i>/
- Work only in that directory.
- At the end, return: (a) the path(s) to your deliverable, and
  (b) a 2 to 4 sentence note on your approach and any tradeoffs you made.
```

**Round 2 brief (task plus distilled guidance, no prior code):**

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
- Save all output files to: two-pass-best-of-n/<run-id>/round-2/candidate-<i>/
- Work only in that directory.
- At the end, return: (a) the path(s) to your deliverable, and
  (b) a 2 to 4 sentence note on your approach and any tradeoffs you made.
```

In neither round tell an agent it is one of several, what N is, that it will be judged, or hand it another agent's output. Each attempt must be an independent solution. The round two guidance steers; it must not include or paraphrase a specific candidate's code, only generic patterns to emulate and pitfalls to avoid.

### Concurrency and rate limits

- Keep each candidate's writes atomic and confined to its own directory.
- Many concurrent model requests can hit provider rate ceilings. If dispatch stalls or errors on rate limits, split N into smaller parallel batches (for example 4 at a time) run in sequence; attempts within a batch still run in parallel.
- If a sub-agent fails or returns nothing, note it and continue. A round proceeds over the attempts that succeeded, and the report states which attempt failed.

## Dispatching the Opus passes

**Round 1 reviewer (Phase 3):** collect each round one deliverable and self-summary, assign blind labels (Candidate A, B, ...) in a fixed order, keep a private label-to-model mapping, and spawn one Opus agent with the candidates and `references/review-rubric.md`. It returns the per-candidate pros and cons, the winner, and the two distilled lists (positives to consider, challenges to avoid). Do not pass model identities to it.

**Final ranker (Phase 5):** build the pool of N round two attempts plus the one saved round one winner, re-label the whole pool blind in a fixed order, keep a fresh private mapping, and spawn one Opus agent with the pool and the rubric. Do not tell it which candidate is the carried-over winner; it ranks blind on the merits.

## Harness notes

- **Claude Code:** use the Task tool to spawn each attempt with the chosen `model`; with dynamic workflows / ultracode enabled, Claude can fan out and verify automatically. Confirm at the first dispatch.
- **Claude Agent SDK:** spawn sub-agents programmatically with per-agent model selection; the same isolation, no-cross-talk, and blind-review rules apply across both rounds.
- **Claude.ai (no sub-agents):** true parallel independent agents are not available. **Still run the interactive gates:** ask the Phase 1 model question and get the go-ahead exactly as written; only the parallelism is approximated, not the elicitation. Then produce each round's N attempts one at a time in separate, self-contained passes, holding each chosen model as the capability bar, and do the reviews yourself against the rubric. Flag to the user that this is a sequential approximation, and be especially careful not to let round one's code leak into round two beyond the distilled guidance.
