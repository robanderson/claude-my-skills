# fl-bench — Farnsworth Loop throughput benchmark

`bin/fl-bench.mjs` measures **generation throughput (tokens/second)** for every
model the farnsworth-loop system can call, on a **cold** run (first call) and a
**hot** run (an immediate second call), and reports cold tok/s, hot tok/s, and
the delta.

It reuses the SAME invocation mechanics, env vars, auth conventions, and the
portable perl-alarm timeout as the bundled runners (`glm-run.sh` /
`local-run.sh` / `codex-run.sh` / `minimax-run.sh`), but calls the nested
`claude` / `codex` / omlx endpoint **directly** so it can capture each call's
wall-time and the provider's **real** output-token count.

## Run it

```sh
# every callable model (local MLX list discovered live), cold + hot each:
node ~/.claude/my-skills/farnsworth-loop/bin/fl-bench.mjs --models all

# a custom subset:
node ~/.claude/my-skills/farnsworth-loop/bin/fl-bench.mjs --models anthropic,glm
node ~/.claude/my-skills/farnsworth-loop/bin/fl-bench.mjs --models glm:glm-5.1,codex:codex-high,opus

# dry-run: print the resolved plan, make NO model calls (cheap + testable):
node ~/.claude/my-skills/farnsworth-loop/bin/fl-bench.mjs --list --models all
```

It is invoked like the other `bin/` tools (a plain script run with `node` /
`bash`). Make it executable if you like: `chmod +x bin/fl-bench.mjs`.

## Selection grammar (`--models`, comma-separated, de-duped)

| Token            | Meaning                                                            |
|------------------|-------------------------------------------------------------------|
| `all`            | every callable model across every provider (default)              |
| `<provider>`     | every model of a provider: `anthropic` `glm` `local` `codex` `minimax` |
| `<provider>:<id>`| one model, e.g. `glm:glm-5.1`, `codex:codex-high`, `local:<omlx-id>`, `anthropic:opus` |
| `<id>`           | a bare id matched against the catalogue (`opus`, `glm-5.2`, `minimax-m3`, `codex-high`, a local id) |

Other flags: `--list` (dry-run), `--timeout <secs>` (per-call backstop), `--help`.

## Models covered

- **Anthropic** — `opus` / `sonnet` / `haiku` (session's own auth; no API-key env var).
- **GLM (z.ai)** — `glm-5.2` / `glm-5.1` / `glm-4.7` / `glm-4.5-air`, via `claude`
  pointed at `https://api.z.ai/api/anthropic`, **Bearer** `ANTHROPIC_AUTH_TOKEN=$ZAI_API_KEY`.
- **Local MLX (omlx)** — **discovered live** from `http://127.0.0.1:8000/v1/models`
  (`Authorization: Bearer $OMLX_AUTH_TOKEN`); each benchmarked via the OpenAI
  `/v1/chat/completions` endpoint for `usage.completion_tokens`. Degrades
  gracefully (skips with a note) if the token is unset or the server is down.
- **Codex (OpenAI gpt-5.5)** — reasoning efforts `codex-low|medium|high|xhigh`
  via `codex exec`, auth from `~/.codex/auth.json` (no `OPENAI_API_KEY`).
- **MiniMax** — `minimax-m3` via `claude` pointed at `https://api.minimax.io/anthropic`,
  **Bearer** `ANTHROPIC_AUTH_TOKEN=$MINIMAX_API_KEY`, `ANTHROPIC_MODEL=MiniMax-M3`.

All keys come from the **environment** (never sourcing rc files), exactly as the
runners do. A provider whose key is unset is recorded as a failed entry and the
sweep continues.

## How tok/s is measured

- Fixed, **identical** prompt for every model; bounded output (~256 tokens).
  `tok/s = output_tokens / generation_wall_seconds`.
- **Real** provider token counts:
  - claude-family (`anthropic`/`glm`/`minimax`): `claude -p --output-format json
    --verbose` emits a JSON **array** of stream events; we parse it and walk the
    structure for the maximal `usage.output_tokens` (never `JSON.parse(stdout).usage`,
    never chars/4).
  - local: omlx `usage.completion_tokens`.
  - codex: a real `token_count`/usage event if present; otherwise a **chars/4
    estimate** of the captured final message, flagged `estimated:true` (the only
    place estimation is used — the constraints explicitly allow it for the codex CLI).
- Cold and hot are timed independently and each tok/s is derived from **that
  call's own** token count and seconds (cold ≠ hot tokens; both are stored).

### Honest caveats about the timed window

- Every window is the **subprocess wall-clock**: it includes `claude`/`codex`
  CLI/agent startup (and curl/HTTP setup for local). So tok/s is **end-to-end
  throughput**, not a pure decode rate.
- **"Cold"** is a genuine weight-load only for local MLX (if not resident); for
  the hosted providers it is connection/cache/route warmup, **not** a true model
  load. **"Hot"** is an immediate second identical call.
- The `claude` CLI has **no `--max-tokens`**; output is bounded by the prompt
  plus `CLAUDE_CODE_MAX_OUTPUT_TOKENS` — a **soft** cap for claude-family. Local
  (raw HTTP) and codex take a hard `max_tokens`/effort where supported.

## Results file — format & location

Append-only JSONL at:

```
~/.claude/my-skills/farnsworth-loop/.bench/results.jsonl
```

One JSON object **per model per run**, appended **immediately** after that model
finishes (so a sweep that crashes mid-run keeps everything produced so far).
Each record:

```json
{
  "provider": "glm",
  "model": "glm-5.1",
  "ok": true,
  "cold_tok_s": 41.2,
  "hot_tok_s": 55.7,
  "delta_tok_s": 14.5,
  "cold_tokens": 248,
  "hot_tokens": 251,
  "cold_secs": 6.02,
  "hot_secs": 4.51,
  "estimated": false,
  "timestamp": "2026-06-15T11:55:28-07:00",
  "error": ""
}
```

- `timestamp` — local-tz ISO-8601 with offset, so runs accumulate and stay
  chronologically readable across invocations.
- `ok:false` rows carry the failure text in `error` (e.g. `cold: timeout after
  240s`, `ZAI_API_KEY unset`). The sweep records the failure and **continues**.
- `estimated:true` marks the codex chars/4 token fallback.

A readable table (with cold/hot/Δ tok/s, token counts, seconds, and STATUS) is
printed to stdout at the end of every run; per-row failure reasons are listed
beneath it.
