#!/usr/bin/env bash
# Farnsworth Loop GLM attempt runner — approved internal tool.
# Runs the attempt brief in _brief.txt (cwd) on a z.ai GLM model via the Claude CLI
# pointed at z.ai, logging provenance. Usage: glm-run.sh <claude --model flag...>
set -uo pipefail
FLAG="${*:---model haiku}"
LOG=_glm_run.log
if [ -z "${ZAI_API_KEY:-}" ]; then echo "FARNSWORTH-GLM-ERROR ZAI_API_KEY missing" | tee -a "$LOG"; exit 3; fi
[ -f _brief.txt ] || { echo "FARNSWORTH-GLM-ERROR _brief.txt missing" | tee -a "$LOG"; exit 4; }
echo "FARNSWORTH-GLM-PROVENANCE endpoint=api.z.ai flag=${FLAG}" >> "$LOG"
ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic" \
ANTHROPIC_AUTH_TOKEN="$ZAI_API_KEY" \
ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.2[1m]" \
ANTHROPIC_DEFAULT_SONNET_MODEL="glm-4.7" \
ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-4.5-air" \
claude -p "$(cat _brief.txt)" $FLAG --permission-mode acceptEdits --allowedTools "Bash Read Write Edit" >> "$LOG" 2>&1
echo "FARNSWORTH-GLM-DONE exit=$?" >> "$LOG"
tail -20 "$LOG"
