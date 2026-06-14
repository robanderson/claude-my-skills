#!/usr/bin/env bash
# Farnsworth Loop GLM attempt runner — approved internal tool.
# Runs the attempt brief in _brief.txt (cwd) on a z.ai GLM model via the Claude CLI
# pointed at z.ai, under a hard wall-clock timeout. Usage: glm-run.sh <claude --model flag...>
# Timeout (seconds) comes from FL_TIMEOUT_SECS (default 300).
set -uo pipefail
FLAG="${*:---model glm-5}"
LOG=_glm_run.log
TIMEOUT="${FL_TIMEOUT_SECS:-300}"   # wall-clock backstop (seconds)
MAXTURNS="${FL_MAX_TURNS:-30}"       # primary guard: cap agentic iterations (single-pass)
if [ -z "${ZAI_API_KEY:-}" ]; then echo "FARNSWORTH-GLM-ERROR ZAI_API_KEY missing" | tee -a "$LOG"; exit 3; fi
[ -f _brief.txt ] || { echo "FARNSWORTH-GLM-ERROR _brief.txt missing" | tee -a "$LOG"; exit 4; }

echo "FARNSWORTH-GLM-PROVENANCE endpoint=api.z.ai flag=${FLAG} max-turns=${MAXTURNS} timeout=${TIMEOUT}s" >> "$LOG"
# Portable hard timeout (no coreutils `timeout` on macOS): fork the call, SIGALRM -> TERM/KILL.
ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic" \
ANTHROPIC_AUTH_TOKEN="$ZAI_API_KEY" \
ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.2[1m]" \
ANTHROPIC_DEFAULT_SONNET_MODEL="glm-4.7" \
ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-4.5-air" \
perl -e '
  my $t = shift @ARGV;
  my $p = fork; if (!defined $p) { exit 127 }
  if ($p == 0) { exec @ARGV; exit 127 }
  $SIG{ALRM} = sub { kill "TERM", $p; sleep 3; kill "KILL", $p; exit 124 };
  alarm $t; waitpid($p, 0); exit($? >> 8);
' "$TIMEOUT" claude -p "$(cat _brief.txt)" $FLAG --max-turns "$MAXTURNS" --permission-mode acceptEdits --allowedTools "Bash Read Write Edit" >> "$LOG" 2>&1
RC=$?
[ "$RC" -eq 124 ] && echo "FARNSWORTH-GLM-TIMEOUT secs=${TIMEOUT}" >> "$LOG"
echo "FARNSWORTH-GLM-DONE exit=$RC" >> "$LOG"
tail -20 "$LOG"
