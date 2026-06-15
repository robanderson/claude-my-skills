---
name: farnsworth-bench
description: Benchmark generation throughput (cold vs hot tok/s) for every model the farnsworth-loop system can call (Anthropic / GLM / local MLX / codex / MiniMax). Thin wrapper over bin/fl-bench.mjs. Use when the user asks to benchmark model speed, measure tokens/second, compare cold vs hot throughput across providers, or run /fl-bench.
---

# fl-bench — model throughput benchmark

Thin wrapper over `bin/fl-bench.mjs`. It measures **tokens/second** for each
selected model on a **cold** call and an immediate **hot** call, prints a table,
and appends every result to `<plugin>/.bench/results.jsonl`.

## What to run

Resolve the plugin root (the dir containing `plugin.json` for `farnsworth-loop`),
then run the benchmark script with `node`. Pass the user's selection through
verbatim; default to `--models all`.

```sh
node "<plugin-root>/bin/fl-bench.mjs" --models <selection>
```

`<selection>` (comma-separated, de-duped):
- `all` — every callable model (local MLX list discovered live). **Default.**
- a provider: `anthropic` | `glm` | `local` | `codex` | `minimax`
- `<provider>:<id>` — e.g. `glm:glm-5.1`, `codex:codex-high`, `anthropic:opus`, `local:<omlx-id>`
- a bare id — `opus`, `glm-5.2`, `minimax-m3`, `codex-high`, a local id

Useful flags: `--list` (dry-run; prints the resolved plan, makes NO model calls —
cheap way to confirm the selection before spending), `--timeout <secs>`, `--help`.

## Guidance

- For a quick, cheap check first, run `--list` with the same `--models` selection
  and show the user the plan before the real (paid) sweep.
- The script handles auth from the environment exactly as the runners do
  (`ZAI_API_KEY`, `MINIMAX_API_KEY`, `OMLX_AUTH_TOKEN`; Anthropic uses the
  session's own auth; codex uses `~/.codex/auth.json`). A provider whose key is
  unset is recorded as a failed row and the sweep continues — surface those rows.
- Results accumulate across runs in the append-only JSONL; point the user at
  `<plugin>/.bench/results.jsonl` for history.
- Report the printed table back to the user, including any failures and the `*`
  estimated-token note (codex fallback).

See `bin/README.fl-bench.md` for the full usage and results-format reference.
