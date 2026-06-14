#!/usr/bin/env bash
# Farnsworth Loop LOCAL (omlx / MLX) attempt runner — approved internal tool.
# Runs the attempt brief in _brief.txt (cwd) on a local MLX model via the Claude CLI
# pointed at the local omlx server (http://127.0.0.1:8000), under a hard wall-clock timeout.
# Usage: local-run.sh <claude --model flag...>   Timeout (seconds) from FL_TIMEOUT_SECS (default 300).
set -uo pipefail
FLAG="${*:---model gemma-4-26b-a4b-it-8bit}"
LOG=_local_run.log
TIMEOUT="${FL_TIMEOUT_SECS:-300}"   # wall-clock backstop (seconds)
MAXTURNS="${FL_MAX_TURNS:-8}"       # primary guard: cap agentic iterations (single-pass)

# Resolve the local server token: prefer the env var; fall back to the user's ~/.zshrc
# export (the token is the user's own, for their own on-device server — it stays local).
TOKEN="${OMLX_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.zshrc" ]; then
  TOKEN=$(grep -E '^[[:space:]]*export[[:space:]]+OMLX_AUTH_TOKEN=' "$HOME/.zshrc" | tail -1 | sed -E 's/^[^=]*=//; s/^["'"'"']//; s/["'"'"']$//')
fi
if [ -z "$TOKEN" ]; then echo "FARNSWORTH-LOCAL-ERROR OMLX_AUTH_TOKEN missing (set it or export in ~/.zshrc)" | tee -a "$LOG"; exit 3; fi
[ -f _brief.txt ] || { echo "FARNSWORTH-LOCAL-ERROR _brief.txt missing" | tee -a "$LOG"; exit 4; }

echo "FARNSWORTH-LOCAL-PROVENANCE endpoint=127.0.0.1:8000 flag=${FLAG} max-turns=${MAXTURNS} timeout=${TIMEOUT}s" >> "$LOG"
# Portable hard timeout (no coreutils `timeout` on macOS): fork the call, SIGALRM -> TERM/KILL.
ANTHROPIC_BASE_URL="http://127.0.0.1:8000" \
ANTHROPIC_AUTH_TOKEN="$TOKEN" \
ANTHROPIC_DEFAULT_OPUS_MODEL="Qwen3.5-122B-A10B-LM-MLX-6.5bit" \
ANTHROPIC_DEFAULT_SONNET_MODEL="mlx-community--Qwen3.6-35B-A3B-8bit" \
ANTHROPIC_DEFAULT_HAIKU_MODEL="gemma-4-26b-a4b-it-8bit" \
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1" API_TIMEOUT_MS="3000000" \
perl -e '
  my $t = shift @ARGV;
  my $p = fork; if (!defined $p) { exit 127 }
  if ($p == 0) { exec @ARGV; exit 127 }
  $SIG{ALRM} = sub { kill "TERM", $p; sleep 3; kill "KILL", $p; exit 124 };
  alarm $t; waitpid($p, 0); exit($? >> 8);
' "$TIMEOUT" claude -p "$(cat _brief.txt)" $FLAG --max-turns "$MAXTURNS" --permission-mode acceptEdits --allowedTools "Bash Read Write Edit" >> "$LOG" 2>&1
RC=$?
[ "$RC" -eq 124 ] && echo "FARNSWORTH-LOCAL-TIMEOUT secs=${TIMEOUT}" >> "$LOG"
echo "FARNSWORTH-LOCAL-DONE exit=$RC" >> "$LOG"
tail -20 "$LOG"
