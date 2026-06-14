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
| `glm-4.7`     | `--model sonnet`   |                                |
| `glm-4.5-air` | `--model haiku`    | fastest, cheapest              |

The `--model opus/sonnet/haiku` aliases resolve to GLM models only because the `glm` wrapper sets `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` to the GLM strings; they are GLM models, not Anthropic ones. The wrapper requires `ZAI_API_KEY` to be set in the environment (it is sourced from the user's shell profile).

**Local models (on-device MLX via the `omlx` server)** — dispatched by shelling out to `claude` pointed at the local `omlx` server (`http://127.0.0.1:8000`). Unlike GLM's fixed five, the local catalogue is **dynamic** — fetch it at gate time with `omlx-models` (or `curl -s http://127.0.0.1:8000/v1/models -H "Authorization: Bearer $OMLX_AUTH_TOKEN" | jq -r '.data[].id'`). Local model ids are passed straight through: `--model <exact-id>` (e.g. `--model gemma-4-26b-a4b-it-8bit`, `--model mlx-community--Qwen3.6-35B-A3B-8bit`) — no alias table. Because the list is dynamic, **one generic worker agent (`farnsworth-local`) handles every local model**; the exact id rides in the command. The runner needs `OMLX_AUTH_TOKEN`; if it is not in the environment, `bin/local-run.sh` falls back to the user's `~/.zshrc` export. Local models are **free** (on-device) but slower than the hosted providers.

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
  glmRunner: "<plugin-root>/bin/glm-run.sh",      // REQUIRED if any attempt is GLM
  localRunner: "<plugin-root>/bin/local-run.sh",  // REQUIRED if any attempt is Local
  attemptMaxTurns: 30,                    // optional iteration cap for GLM attempts; default 30
  localMaxTurns: 20,                      // optional iteration cap for LOCAL attempts; default 20
  attemptTimeoutSecs: 300,               // optional wall-clock backstop (GLM/local); default 300
  attempts: [                            // one per attempt, length N
    { label: "candidate-1",
      dispatch: "anthropic",             // native, runs in-process
      model: "haiku",                    // opus | sonnet | haiku
      displayModel: "haiku",             // for the report; NOT shown to judges
      r1nudge: "<Pool A nudge>", r2nudge: "<fresh Pool A nudge>" },
    { label: "candidate-2",
      dispatch: "glm",                              // runs via a wrapper agent + the runner script
      agentType: "farnsworth-loop:farnsworth-glm-5-2",  // namespaced bundled GLM worker agent
      displayModel: "glm-5.2",
      r1nudge: "...", r2nudge: "..." },
    { label: "candidate-3",
      dispatch: "local",                            // runs via the generic local agent + runner
      agentType: "farnsworth-loop:farnsworth-local",    // namespaced single local worker agent
      model: "gemma-4-26b-a4b-it-8bit",  // exact omlx model id -> `--model <id>`
      displayModel: "gemma-4-26b-a4b-it-8bit",
      r1nudge: "...", r2nudge: "..." }
    // ...
  ]
}
```

**Model → agentType map** for GLM attempts. Agent types register under the **plugin namespace**, so use the `farnsworth-loop:` prefix (the workflow also auto-prefixes a bare name, but pass the namespaced form):

| GLM model | agentType |
|-----------|-----------|
| glm-5.2 | `farnsworth-loop:farnsworth-glm-5-2` |
| glm-5.1 | `farnsworth-loop:farnsworth-glm-5-1` |
| glm-4.7 | `farnsworth-loop:farnsworth-glm-4-7` |
| glm-4.5-air | `farnsworth-loop:farnsworth-glm-4-5-air` |

(Local attempts use `farnsworth-loop:farnsworth-local` for every model.)

Anthropic attempts pass `dispatch:"anthropic"` + `model`; the workflow spawns them natively. GLM attempts pass `dispatch:"glm"` + `agentType` (per the map above) + `displayModel`. **Local attempts** pass `dispatch:"local"` + `agentType:"farnsworth-local"` + `model` (the exact omlx id, also used as `displayModel`). The workflow blind-labels candidates, the Opus reviewer/ranker **reads and runs each candidate's files** from its workspace (judges never receive model identities), and the script returns `{ round1.mapping, round1.review, guidance?, final.mapping, final.rank, final.winnerRound }` — everything Phase 6 needs to unblind and report.

**Why GLM dispatch is shaped this way (learned the hard way):** a subagent inherits the session's Anthropic provider, so `model: glm-5.2` fails (verified: the Anthropic endpoint returns "model … may not exist"). GLM therefore needs a separate `claude`→z.ai process. The workflow can only run bash through a sub-agent, and an LLM wrapper handed a **raw** `claude -p … --model glm-5 …` command proved unreliable in smoke testing: it variously (a) solved the task itself with its own Anthropic model, (b) **refused** on safety grounds ("nested autonomous Claude … external provider … unsafe"), or (c) let the weak inner model bail without saving a file. Fix, in three parts:

1. **Runner script (`bin/glm-run.sh`).** The real z.ai call lives in a bundled script. The workflow builds a *benign* command — `mkdir … && printf <brief> > _brief.txt && bash <glmRunner> <flag>` — so the wrapper agent only ever sees "run a project script," nothing to refuse or shortcut. The script sets the z.ai env, runs `claude -p "$(cat _brief.txt)" <flag> --permission-mode acceptEdits --allowedTools …`, and writes a `FARNSWORTH-GLM-PROVENANCE endpoint=api.z.ai` line plus `FARNSWORTH-GLM-DONE exit=N`.
2. **Bash-only command-runner agents.** Each `farnsworth-glm-*` agent (cheap `haiku` driver, `Bash`+`Read` only) is told: run the one command in your message verbatim, never solve the task yourself.
3. **Provenance check.** The `_glm_run.log` must contain the `FARNSWORTH-GLM-PROVENANCE` marker — mechanical proof the attempt actually hit z.ai rather than a wrapper faking it. Phase 6 should verify this per GLM candidate; an attempt whose workspace has no marker / no deliverable is a failure, and the round proceeds over the survivors.

`ZAI_API_KEY` must be set (sourced from the user's shell profile). GLM tokens bill the z.ai plan and don't appear in Anthropic usage, but each attempt still shows as a node in `/workflows`. Note: weaker GLM models (esp. `glm-4.5-air`) are less reliable at actually saving a deliverable; `glm-5`/`glm-5.2` are dependable. The brief explicitly forbids clarifying questions and demands a saved file to mitigate this.

**Local dispatch mirrors GLM**, with three differences: (1) the runner is `bin/local-run.sh` (set z.ai env → set omlx/local env pointing at `http://127.0.0.1:8000`); (2) one generic `farnsworth-local` agent serves every model, with the exact id passed as `--model <id>`; (3) the provenance marker is `FARNSWORTH-LOCAL-PROVENANCE endpoint=127.0.0.1:8000` written to `_local_run.log`. The runner resolves `OMLX_AUTH_TOKEN` from the env or, failing that, from the user's `~/.zshrc` export. Local models are free but slower, and small ones can be unreliable at saving a deliverable — same honest-failure handling as GLM. There is no inline fallback for local; it always uses the runner script.

**Per-attempt guards (two layers).** Both runner scripts bound the nested `claude` call:

1. **`--max-turns` (primary, iteration-based).** Passed from `FL_MAX_TURNS`: **GLM = `attemptMaxTurns` (default 30); local = `localMaxTurns` (default 20).** This caps agentic turns, so an attempt that tries to grind the write→run→fix loop is stopped cleanly. Crucially, **the deliverable written before the cap is preserved** — hitting the cap truncates the grind but keeps the best-so-far file (claude prints `Error: Reached max turns (N)` and exits non-zero; the saved file is still graded). Local gets the tighter cap because weaker local models (observed clearly on Qwen) ignore "single pass" and burn turns **rewriting the art on self-critique** ("that's a cow face… proportions are off… let me realign") and **fixing their own buggy code** (bad raw-string escaping; Linux-only `cat -A` on macOS). The hard-stop brief (below) curbs the behaviour at the source; the tight cap is the backstop. A clean single pass under the hard-stop brief is ~2 turns (Write → stop); the caps are generous runaway backstops, sized up because substantial writing deliverables legitimately need more turns than a tiny script.
2. **Wall-clock timeout (backstop, time-based).** Portable perl `alarm` → TERM/KILL (macOS has no `timeout`/`gtimeout`), from `FL_TIMEOUT_SECS` (workflow `attemptTimeoutSecs`, default 300s). Catches a *single* hung or pathologically slow turn that `--max-turns` can't (one turn never returning). On fire it logs `FARNSWORTH-{GLM,LOCAL}-TIMEOUT secs=N` and exits 124. Scale to task complexity (~180s small, 300s+ heavier).

Either way a bounded-out attempt is just an honest failure and the round proceeds over the survivors. These cover the runner-based (GLM/local) attempts — native Anthropic attempts have no shell hook, but they are fast and bounded by the single-pass brief. The **single-pass brief is the real fix**; these two are the safety net.

If dynamic workflows are unavailable, use the manual Task-tool + `glm`/`omlx`-CLI fallback below.

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

**Each attempt is a SINGLE-PASS exploration, not a grind to perfection.** This is the most important property of the brief, and it is easy to get wrong. The refinement in this system happens at the **tournament** level — many diverse one-shot attempts → blind review → (two pass) distilled guidance → a fresh guided round → final rank — *not* inside any one attempt. So the brief must tell each attempt to produce one solution and stop, explicitly forbidding "iterate until it works":
- An instruction like "actually run it and iterate until it works" is **harmful** here. It (a) collapses diversity — attempts converge on "whatever runs" instead of exploring different approaches; (b) suppresses the failure signal that the review distils into round-two guidance (a rough or broken attempt is *useful data*, not a wasted slot); and (c) on slow or local models, balloons the context (write→run→read→fix loops) into tens of thousands of tokens, turning a one-minute call into many minutes.
- Allow at most a single quick sanity run. Require that a file be saved (an empty workspace is a real failure), but make clear it need not be flawless. Ask for an honest note on known limitations — that note feeds the distillation.
- Keep the no-cross-talk rule: convey "single pass, don't over-polish" as a working style; do **not** tell the attempt it is one of several, that it is being judged, or that failures feed a later round.

**Round 1 brief (identical task plus one diversity modifier) — both modes:**

```
You are solving a self-contained task. Produce ONE complete solution in a single focused pass.

Task:
<the exact task text, verbatim>

<one drawn diversity modifier, per references/diversity-injection.md, e.g.
"Approach this task test-first: sketch the tests before the implementation.">

Rules:
- Fully specified — do NOT ask questions; make reasonable defaults and just produce your solution.
- SINGLE pass, then STOP: write the file ONCE and stop. Do NOT run, test, inspect, rewrite, or polish it — your first version is final, even if imperfect.
- Save your solution file(s) to: farnsworth-loop/<run-id>/round-1/candidate-<i>/  (an empty workspace is a failure;
  the file need NOT be flawless). Work only in that directory.
- End with a 2 to 4 sentence note on your approach, tradeoffs, and any known limitations.
```

**Round 2 brief (two pass only — task plus distilled guidance, no prior code):**

```
You are solving a self-contained task. Produce ONE complete solution in a single focused pass.

Task:
<the exact task text, verbatim>

In producing your answer, please consider these items as possible positives:
- <positive a> ... <positive d>
And treat these items as challenges to avoid:
- <challenge w> ... <challenge z>

<one drawn Pool A nudge, per references/diversity-injection.md, e.g.
"Approach this task starting from the data model or core types.">

Rules:
- Fully specified — do NOT ask questions; make reasonable defaults and just produce your solution.
- SINGLE pass, then STOP: write the file ONCE and stop. Do NOT run, test, inspect, rewrite, or polish it — your first version is final, even if imperfect.
- Save your solution file(s) to: farnsworth-loop/<run-id>/round-2/candidate-<i>/  (an empty workspace is a failure;
  the file need NOT be flawless). Work only in that directory.
- End with a 2 to 4 sentence note on your approach, tradeoffs, and any known limitations.
```

In neither round, and in either mode, tell an agent it is one of several, what N is, that it will be judged, or hand it another agent's output. Each attempt must be an independent solution. The round two guidance steers; it must not include or paraphrase a specific candidate's code, only generic patterns to emulate and pitfalls to avoid.

**Fresh workspaces + the read-before-write guard.** Each attempt gets its own clean workspace (only `_brief.txt` pre-exists), so the deliverable is a *new* file and Claude Code's "file must be read before overwriting" guard does not fire — verified. It can only fire if a workspace is reused (same run-id across runs, or a resume) and a stale deliverable lingers; weaker local models then waste turns (read → retry) on it. Two cheap defenses: use a **unique run-id per run** so paths never collide, and the brief already instructs attempts to overwrite via the shell (`cat > FILE <<'EOF'`) if a file-edit tool demands a read-first — so even a reused workspace stays a clean single pass.

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

**Stage + validate before judging (engine, both passes).** A candidate's live workspace is NOT shown to the judge — it contains `_brief.txt` and `_glm_run.log` / `_local_run.log`, and those provenance logs name the provider/model (`flag=--model opus` = glm-5.2, the exact local id, etc.) while Anthropic workspaces have no such log. Pointing a "blind" judge at the raw workspace therefore leaks identity, and in two pass the round-1-vs-round-2 path also unmasks the carryover. So `tournament.mjs` first stages each candidate's **deliverable-only** files (names not starting with `_`) into a clean `review-1/<blind>/` (and `review-final/<blind>/`) directory and hands the judge those paths — no logs, no briefs, no round in the path. The same step **validates**: a candidate with no deliverable file, or a GLM/local attempt missing its provenance marker, is excluded from the pool *before* the judge runs (and recorded in the mapping as `valid:false` with a reason), rather than ranked as a phantom. The judge's returned winner/ranking are then reconciled against the real blind-label set (normalised, repaired to a full permutation) so an off-spec label never silently carries the wrong artifact.

**Phase 3 reviewer (both modes):** collect each first-round deliverable and self-summary, assign blind labels (Candidate A, B, ...) in a fixed order, keep a private label-to-model mapping, and spawn one Opus agent with the candidates and `references/review-rubric.md`. It returns the per-candidate pros and cons, the ranking, and the winner. In **two pass** it additionally returns the two distilled lists (positives to consider, challenges to avoid); in **single pass** those lists are not needed. Do not pass model identities to it.

**Final ranker (Phase 5, two pass only):** build the pool of N round two attempts plus the one saved round one winner, re-label the whole pool blind in a fixed order, keep a fresh private mapping, and spawn one Opus agent with the pool and the rubric. Do not tell it which candidate is the carried-over winner; it ranks blind on the merits.

## Harness notes

- **Claude Code:** use the Task tool to spawn each Anthropic attempt with the chosen `model`; spawn each GLM attempt by backgrounding a `glm -p` call (see "Dispatching GLM attempts"). With dynamic workflows / ultracode enabled, Claude can fan out and verify automatically. Confirm at the first dispatch. The reviewer/ranker are always Task-tool Anthropic Opus.
- **Claude Agent SDK:** spawn Anthropic sub-agents programmatically with per-agent model selection; for GLM attempts, invoke the `glm` CLI as a subprocess per the dispatch pattern. The same isolation, no-cross-talk, and blind-review rules apply in both modes.
- **Claude.ai (no sub-agents):** true parallel independent agents are not available. **Still run the interactive gates:** ask the Phase 1 model question and get the go-ahead exactly as written; only the parallelism is approximated, not the elicitation. Then produce each round's N attempts one at a time in separate, self-contained passes, holding each chosen model as the capability bar, and do the review yourself against the rubric. Flag to the user that this is a sequential approximation. In two pass, be especially careful not to let round one's code leak into round two beyond the distilled guidance.
