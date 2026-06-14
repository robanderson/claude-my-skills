# Orchestration reference

How to dispatch the attempts and the Opus passes. Read this in Phase 2 (both modes), and in Phase 4 and Phase 5 (two pass only).

**Mode note.** Single pass uses only the first round (`round-1/`) and one Opus pass (the Phase 3 reviewer); it has no `round-2/`, no carried-over `winner/`, and no `final-rank/`. Two pass uses everything below. Where this file says "both rounds", single pass simply runs the first round and stops after the Phase 3 review.

## Model identifiers

The Phase 1 selection maps to these. In Claude Code, a sub-agent's `model` field accepts the short alias; the full API string is given for harnesses that need it. Keep these current with what the running harness offers.

| Choice  | Alias    | API model string     | Role                        |
|---------|----------|----------------------|-----------------------------|
| Opus    | `opus`   | `claude-opus-4-8`    | attempt, review, or rank    |
| Sonnet  | `sonnet` | `claude-sonnet-4-6`  | attempt                     |
| Haiku   | `haiku`  | `claude-haiku-4-5`   | attempt                     |

The Phase 3 reviewer (single pass and two pass) and the final ranker (Phase 5, two pass only) are always Opus.

## Run layout

One run directory, with separate round folders and isolated per-candidate workspaces. Isolation is not optional: parallel agents writing to a shared path produce race conditions and overwritten files.

```
best-of-n/
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
- Save all output files to: best-of-n/<run-id>/round-1/candidate-<i>/
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
- Save all output files to: best-of-n/<run-id>/round-2/candidate-<i>/
- Work only in that directory.
- At the end, return: (a) the path(s) to your deliverable, and
  (b) a 2 to 4 sentence note on your approach and any tradeoffs you made.
```

In neither round, and in either mode, tell an agent it is one of several, what N is, that it will be judged, or hand it another agent's output. Each attempt must be an independent solution. The round two guidance steers; it must not include or paraphrase a specific candidate's code, only generic patterns to emulate and pitfalls to avoid.

### Concurrency and rate limits

- Keep each candidate's writes atomic and confined to its own directory.
- Many concurrent model requests can hit provider rate ceilings. If dispatch stalls or errors on rate limits, split N into smaller parallel batches (for example 4 at a time) run in sequence; attempts within a batch still run in parallel.
- If a sub-agent fails or returns nothing, note it and continue. A round proceeds over the attempts that succeeded, and the report states which attempt failed.

## Dispatching the Opus passes

**Phase 3 reviewer (both modes):** collect each first-round deliverable and self-summary, assign blind labels (Candidate A, B, ...) in a fixed order, keep a private label-to-model mapping, and spawn one Opus agent with the candidates and `references/review-rubric.md`. It returns the per-candidate pros and cons, the ranking, and the winner. In **two pass** it additionally returns the two distilled lists (positives to consider, challenges to avoid); in **single pass** those lists are not needed. Do not pass model identities to it.

**Final ranker (Phase 5, two pass only):** build the pool of N round two attempts plus the one saved round one winner, re-label the whole pool blind in a fixed order, keep a fresh private mapping, and spawn one Opus agent with the pool and the rubric. Do not tell it which candidate is the carried-over winner; it ranks blind on the merits.

## Harness notes

- **Claude Code:** use the Task tool to spawn each attempt with the chosen `model`; with dynamic workflows / ultracode enabled, Claude can fan out and verify automatically. Confirm at the first dispatch.
- **Claude Agent SDK:** spawn sub-agents programmatically with per-agent model selection; the same isolation, no-cross-talk, and blind-review rules apply in both modes.
- **Claude.ai (no sub-agents):** true parallel independent agents are not available. **Still run the interactive gates:** ask the Phase 1 model question and get the go-ahead exactly as written; only the parallelism is approximated, not the elicitation. Then produce each round's N attempts one at a time in separate, self-contained passes, holding each chosen model as the capability bar, and do the review yourself against the rubric. Flag to the user that this is a sequential approximation. In two pass, be especially careful not to let round one's code leak into round two beyond the distilled guidance.
