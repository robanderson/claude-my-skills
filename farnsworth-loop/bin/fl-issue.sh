#!/usr/bin/env bash
# =============================================================================
# fl-issue.sh — Farnsworth Loop dogfood backlog, on GitHub Issues.
#
# The CAPABILITY an @@FL run uses to record + work problems found while running
# tournaments. ALL forge (gh) access is confined to THIS file so the tournament
# engine (workflows/tournament.mjs) stays forge-agnostic. Lives at the plugin
# root bin/, beside fl-git.sh / fl-parse.mjs. Convention + flow:
#   skills/farnsworth-loop/references/dogfood.md
#
# Subcommands:
#   bootstrap                 (re-runnable) create the dogfood label scheme
#   new       --sev .. --area .. --title .. --evidence-file F [..]   file an item
#   check-evidence FILE       run ONLY the evidence guards (no network; for tests)
#   next                      print the top open dogfood issue number (sev1->sev3)
#   claim     N RUN-ID        best-effort claim issue N (see references/dogfood.md)
#   release   N               drop your claim on issue N
#   archive   N               snapshot closed issue N -> docs/dogfood/archive/D-N.md
#   drain-inbox               file any committed docs/dogfood/inbox/*.md via `new`
#   import-archive            ONE-OFF migration: legacy DOGFOOD.md rows -> closed issues
#
# Guards return distinct exit codes so callers/tests can branch:
#   3 = evidence empty / placeholder   4 = unblinding (blind->model / mapping.json)
#   5 = possible secret/token
#
# Offline / no-gh / headless: `new` degrades to a COMMITTED inbox file under
# docs/dogfood/inbox/ (NEVER .runs/, which is gitignored) so a finding is never
# lost; drain-inbox files them when connectivity returns.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"              # farnsworth-loop/
DOGFOOD_DIR="$PLUGIN_ROOT/docs/dogfood"
ARCHIVE_DIR="$DOGFOOD_DIR/archive"
INBOX_DIR="$DOGFOOD_DIR/inbox"
ROSTER="$PLUGIN_ROOT/DOGFOOD.md"                         # legacy; read by import-archive only

MARKER="dogfood"                                         # label every FL item carries
TITLE_PREFIX="[dogfood] "

die()  { echo "fl-issue: $*" >&2; exit 1; }
info() { echo "fl-issue: $*" >&2; }
now()  { date -u +%Y-%m-%dT%H:%M:%SZ; }

gh_ok() { command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Guards (pure text; NO network — unit-testable)
# ---------------------------------------------------------------------------
# check_evidence FILE -> 0 ok | 3 empty/placeholder | 4 unblinding | 5 secret
check_evidence() {
  local f="${1:?check_evidence: evidence file required}" ev stripped
  [ -f "$f" ] || { echo "REFUSE: evidence file not found: $f" >&2; return 3; }
  ev="$(cat "$f")"
  stripped="$(printf '%s' "$ev" | tr -d '[:space:]')"
  case "$stripped" in
    ""|TODO*|FIXME*|TBD*|XXX*|"<paste"*|"...") \
      echo "REFUSE: Durable evidence is empty or a placeholder." >&2; return 3 ;;
  esac
  # PUBLIC repo: a blind-letter -> model association, or a mapping.json reference,
  # de-anonymises which candidate was which model. Refer to candidates as "blind B".
  if printf '%s' "$ev" | grep -Eiq \
      'mapping\.json|blind[[:space:]]+[A-Z][[:space:]]*(=|->|:|is|was)[[:space:]]*(the[[:space:]]+)?(opus|sonnet|haiku|glm|codex|minimax|gpt|claude)|"candidate"[[:space:]]*:[[:space:]]*"[A-Z]"'; then
    echo "REFUSE: evidence appears to UNBLIND a candidate (blind-letter->model / mapping.json). Redact to 'blind B'." >&2
    return 4
  fi
  # Obvious secrets/tokens.
  if printf '%s' "$ev" | grep -Eiq \
      'sk-[A-Za-z0-9]{16,}|gh[ps]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{12,}|(api[_-]?key|secret|bearer|access[_-]?token)[[:space:]"'"'"':=]+[A-Za-z0-9._\-]{16,}'; then
    echo "REFUSE: possible secret/token in evidence." >&2
    return 5
  fi
  return 0
}

# scrub_stream: stdin -> stdout, strip unblinding lines / redact blind->model.
# Defensive belt for bodies built from existing material (e.g. migration).
scrub_stream() {
  sed -E \
    -e '/mapping\.json/Id' \
    -e '/"candidate"[[:space:]]*:[[:space:]]*"[A-Z]"/d' \
    -e 's/(blind[[:space:]]+[A-Z][[:space:]]*(=|->|:|is|was)[[:space:]]*(the[[:space:]]+)?)(opus|sonnet|haiku|glm[^[:space:]]*|codex[^[:space:]]*|minimax[^[:space:]]*|gpt[^[:space:]]*|claude[^[:space:]]*)/\1[model redacted]/Ig'
}

# ---------------------------------------------------------------------------
# bootstrap — idempotent label scheme (mirrors the legacy roster columns)
# ---------------------------------------------------------------------------
cmd_bootstrap() {
  gh_ok || die "gh not available/authenticated; cannot bootstrap labels."
  local specs=(
    "dogfood|6f42c1|FL dogfood backlog item (found while running @@FL)"
    "sev1|b60205|wrong winners / corrupts tournament outcome"
    "sev2|d93f0b|degraded but usable"
    "sev3|fbca04|cosmetic / docs"
    "area:review|0e8a16|tournament review/ranking"
    "area:runner|0e8a16|model runner scripts"
    "area:parse|0e8a16|fl-parse invocation parsing"
    "area:git|0e8a16|fl-git / grand-loop git mechanics"
    "area:skill|0e8a16|SKILL.md procedure"
    "area:docs|0e8a16|documentation"
    "area:infra|0e8a16|engine / workflow infrastructure"
    "claimed|c5def5|transient claim marker (see references/dogfood.md)"
    "wontfix|ffffff|will not be fixed (by-design / out of scope)"
  )
  local spec name color desc
  for spec in "${specs[@]}"; do
    IFS='|' read -r name color desc <<<"$spec"
    if gh label create "$name" --color "$color" --description "$desc" >/dev/null 2>&1; then
      echo "  created  $name"
    else
      gh label edit "$name" --color "$color" --description "$desc" >/dev/null 2>&1 \
        && echo "  exists   $name" || echo "  SKIP     $name (label op failed)"
    fi
  done
  info "bootstrap complete."
}

# ---------------------------------------------------------------------------
# new — file a dogfood item (the day-to-day capability)
# ---------------------------------------------------------------------------
SEV="" AREA="" TITLE="" RUNID="" EVIDENCE_FILE="" PROBLEM_FILE="" REPRO_FILE="" FIX_FILE=""
_parse_new_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --sev) SEV="$2"; shift 2;;
      --area) AREA="$2"; shift 2;;
      --title) TITLE="$2"; shift 2;;
      --run-id) RUNID="$2"; shift 2;;
      --evidence-file) EVIDENCE_FILE="$2"; shift 2;;
      --problem-file) PROBLEM_FILE="$2"; shift 2;;
      --repro-file) REPRO_FILE="$2"; shift 2;;
      --fix-file) FIX_FILE="$2"; shift 2;;
      *) die "new: unknown flag '$1'";;
    esac
  done
}
_section() { [ -n "$1" ] && [ -f "$1" ] && cat "$1" || echo "_(none provided)_"; }
render_body() {
  cat <<EOF
## Problem
$(_section "$PROBLEM_FILE")

## Durable evidence (verbatim excerpt)
$(cat "$EVIDENCE_FILE")

## Repro
$(_section "$REPRO_FILE")

## Suspected fix
$(_section "$FIX_FILE")

---
_Provenance (non-durable breadcrumb): run-id \`${RUNID:-unknown}\`. \`.runs/\` may be gc'd — evidence above is the durable record._
EOF
}
find_dup() {  # <full-title-without-prefix> -> prints existing issue number, if any
  # Exact, special-char-safe match: list all dogfood issues as number<TAB>title and
  # compare the full title in-shell. Avoids the `--search in:title` query breaking on
  # backticks/quotes/parens in a title (which silently returns nothing -> a duplicate).
  local want="${TITLE_PREFIX}$1" num title
  while IFS=$'\t' read -r num title; do
    [ "$title" = "$want" ] && { echo "$num"; return 0; }
  done < <(gh issue list --state all --label "$MARKER" --limit 400 \
             --json number,title --jq '.[]|[.number,.title]|@tsv' 2>/dev/null)
  return 0
}
fallback_inbox() {  # <title> <body> -> committed inbox draft (never .runs/)
  mkdir -p "$INBOX_DIR"
  local f="$INBOX_DIR/INBOX-$(date -u +%Y%m%dT%H%M%SZ)-$$.md"
  { printf '<!-- dogfood inbox draft: sev=%s area=%s -->\n# %s%s\n\n' "$SEV" "$AREA" "$TITLE_PREFIX" "$1"; printf '%s\n' "$2"; } > "$f"
  info "gh unavailable — wrote COMMITTED inbox draft: ${f#$PLUGIN_ROOT/}"
  info "commit it now; run 'fl-issue.sh drain-inbox' when gh is reachable."
  echo "$f"
}
cmd_new() {
  _parse_new_flags "$@"
  : "${TITLE:?new: --title required}"
  : "${SEV:?new: --sev required (sev1|sev2|sev3)}"
  : "${AREA:?new: --area required (review|runner|parse|git|skill|docs|infra)}"
  : "${EVIDENCE_FILE:?new: --evidence-file required}"
  case "$SEV" in sev1|sev2|sev3) ;; *) die "new: --sev must be sev1|sev2|sev3";; esac
  local rc; check_evidence "$EVIDENCE_FILE"; rc=$?; [ $rc -ne 0 ] && return $rc
  local body; body="$(render_body)"
  if ! gh_ok; then fallback_inbox "$TITLE" "$body"; return 0; fi
  local dup; dup="$(find_dup "$TITLE")"
  if [ -n "$dup" ]; then info "duplicate of #$dup — not filing (comment there if new info)."; echo "$dup"; return 0; fi
  gh issue create --title "${TITLE_PREFIX}${TITLE}" \
    --label "$MARKER" --label "$SEV" --label "area:$AREA" --body "$body"
}

# ---------------------------------------------------------------------------
# next — top open item: lowest sev, then lowest issue number
# ---------------------------------------------------------------------------
cmd_next() {
  gh_ok || die "gh unavailable."
  local sev n
  for sev in sev1 sev2 sev3; do
    n="$(gh issue list --state open --label "$MARKER" --label "$sev" --json number \
         --jq 'if length>0 then (min_by(.number).number) else empty end' 2>/dev/null)"
    if [ -n "$n" ]; then echo "$n"; return 0; fi
  done
  info "no open dogfood items."
  return 0
}

# ---------------------------------------------------------------------------
# claim — BEST-EFFORT (no gh-API compare-and-swap). See references/dogfood.md.
# Assignee+label are additive/idempotent; this is TOCTOU with a deterministic
# tiebreak so at most one worker proceeds. For STRICT exclusivity at high
# fan-out use the git-ref escape hatch documented in references/dogfood.md.
# ---------------------------------------------------------------------------
cmd_claim() {
  gh_ok || die "gh unavailable."
  local n="${1:?claim: issue number}" runid="${2:?claim: run-id}" me
  me="$(gh api user --jq .login 2>/dev/null)" || die "claim: cannot resolve gh user."
  # 1. read — bail if a fresh claim already holds it (TTL handled by the caller/SKILL).
  local cur; cur="$(gh issue view "$n" --json assignees,labels \
      --jq '{a:[.assignees[].login], claimed:(.labels|map(.name)|index("claimed")!=null)}' 2>/dev/null)" \
      || die "claim: cannot read issue #$n."
  # 2. write — add self + marker + a durable claim comment carrying the run-id.
  gh issue edit "$n" --add-assignee @me --add-label claimed >/dev/null 2>&1
  gh issue comment "$n" --body "claim: @$me run:\`$runid\` $(now)" >/dev/null 2>&1
  # 3. read-after-write — if multiple assignees, deterministic tiebreak:
  #    the LOWEST-numbered claim comment wins; only the loser releases (livelock-free).
  local assignees; assignees="$(gh issue view "$n" --json assignees --jq '.assignees|length' 2>/dev/null)"
  if [ "${assignees:-1}" -gt 1 ]; then
    local winner
    winner="$(gh issue view "$n" --json comments \
      --jq '[.comments[]|select(.body|startswith("claim: "))]|sort_by(.url)|.[0].author.login' 2>/dev/null)"
    if [ "$winner" != "$me" ]; then
      info "lost claim race on #$n to @$winner — releasing."
      gh issue edit "$n" --remove-assignee @me >/dev/null 2>&1
      return 2
    fi
  fi
  info "claimed #$n as @$me (run:$runid). NOTE: best-effort, not a mutex."
  echo "$n"
}
cmd_release() {
  gh_ok || die "gh unavailable."
  local n="${1:?release: issue number}"
  gh issue edit "$n" --remove-assignee @me --remove-label claimed >/dev/null 2>&1
  info "released #$n."
}

# ---------------------------------------------------------------------------
# archive — snapshot a CLOSED issue to the in-repo read-only archive
# ---------------------------------------------------------------------------
cmd_archive() {
  gh_ok || die "gh unavailable."
  local n="${1:?archive: issue number}"
  mkdir -p "$ARCHIVE_DIR"
  local out="$ARCHIVE_DIR/ISSUE-$n.md"
  gh issue view "$n" --json number,title,state,labels,body,closedAt \
    --jq '"# \(.title)\n\n- issue: #\(.number)\n- state: \(.state)\n- closed: \(.closedAt)\n- labels: \([.labels[].name]|join(", "))\n\n---\n\n\(.body)"' \
    | scrub_stream > "$out"
  info "archived #$n -> ${out#$PLUGIN_ROOT/} (scrubbed; review before commit)."
  echo "$out"
}

# ---------------------------------------------------------------------------
# drain-inbox — file committed offline drafts, then remove them
# ---------------------------------------------------------------------------
cmd_drain_inbox() {
  gh_ok || die "gh unavailable — cannot drain inbox."
  [ -d "$INBOX_DIR" ] || { info "no inbox dir."; return 0; }
  local f filed=0
  for f in "$INBOX_DIR"/*.md; do
    [ -e "$f" ] || continue
    info "draining $f — file it manually via 'fl-issue.sh new ...' using its sections, then: git rm $f"
    filed=$((filed+1))
  done
  [ "$filed" -eq 0 ] && info "inbox empty."
  info "drain is intentionally manual (each draft needs --sev/--area to re-validate)."
}

# ---------------------------------------------------------------------------
# import-archive — ONE-OFF migration of the legacy Markdown roster -> Issues.
# Reads DOGFOOD.md rows (id|sev|area|status|title|evidence) dynamically (not
# hard-coded), creates ONE closed issue per item with a scrubbed summary body
# that links to the archived evidence file. Idempotent: skips an item whose
# "[dogfood] D-NNNN:" issue already exists.
# ---------------------------------------------------------------------------
_problem_excerpt() {  # <evidence-file> -> the "## Problem" section, scrubbed, capped
  awk '/^## Problem[[:space:]]*$/{f=1;next} /^## /{f=0} f' "$1" 2>/dev/null \
    | scrub_stream | cat -s | head -c 1200
}
cmd_import_archive() {
  gh_ok || die "gh unavailable; cannot import."
  [ -f "$ROSTER" ] || die "legacy roster not found: $ROSTER"
  local archived_rel="docs/dogfood/archive"
  local line id sev area st title evfile created=0 skipped=0
  # roster rows look like:  | D-0001 | sev1 | review | done | title... | docs/dogfood/D-0001.md |
  while IFS= read -r line; do
    case "$line" in '| D-'*) ;; *) continue;; esac
    id="$(printf '%s' "$line"   | awk -F'|' '{gsub(/ /,"",$2); print $2}')"
    sev="$(printf '%s' "$line"  | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
    area="$(printf '%s' "$line" | awk -F'|' '{gsub(/ /,"",$4); print $4}')"
    st="$(printf '%s' "$line"   | awk -F'|' '{gsub(/ /,"",$5); print $5}')"
    title="$(printf '%s' "$line" | awk -F'|' '{sub(/^ +/,"",$6); sub(/ +$/,"",$6); print $6}')"
    [ -n "$id" ] || continue
    local fulltitle="${id}: ${title}"
    local dup; dup="$(find_dup "$fulltitle")"
    if [ -n "$dup" ]; then echo "  skip   $id (already #$dup)"; skipped=$((skipped+1)); continue; fi
    # evidence file currently at docs/dogfood/<id>.md; after migration it lives in archive/.
    evfile="$DOGFOOD_DIR/$id.md"; [ -f "$evfile" ] || evfile="$ARCHIVE_DIR/$id.md"
    local problem; problem="$( [ -f "$evfile" ] && _problem_excerpt "$evfile" || echo "_(evidence file missing)_")"
    local body
    body="$(cat <<EOF
_Imported from the legacy Markdown dogfood backlog (pre-Issues). Original status: **${st}**._

| field | value |
|---|---|
| id | \`${id}\` |
| severity | ${sev} |
| area | ${area} |
| original status | ${st} |

## Problem (excerpt)
${problem}

---
Full evidence, repro & resolution (verbatim historical record):
\`farnsworth-loop/${archived_rel}/${id}.md\`
EOF
)"
    # labels: marker + sev + area:<area> (+ wontfix when applicable)
    local labelargs=(--label "$MARKER" --label "$sev" --label "area:$area")
    [ "$st" = "wontfix" ] && labelargs+=(--label "wontfix")
    local url; url="$(gh issue create --title "${TITLE_PREFIX}${fulltitle}" "${labelargs[@]}" --body "$body" 2>&1)" \
      || { echo "  FAIL   $id: $url"; continue; }
    local num="${url##*/}"
    if [ "$st" = "wontfix" ]; then
      gh issue close "$num" --reason "not planned" --comment "Imported as wontfix; see archived evidence." >/dev/null 2>&1
    else
      gh issue close "$num" --reason completed --comment "Resolved before the migration to Issues; see archived evidence." >/dev/null 2>&1
    fi
    echo "  created #$num  $id ($sev/$area/$st)"
    created=$((created+1))
  done < "$ROSTER"
  info "import-archive: $created created, $skipped skipped."
}

# ---------------------------------------------------------------------------
main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    bootstrap)       cmd_bootstrap "$@";;
    new)             cmd_new "$@";;
    check-evidence)  check_evidence "$@";;
    next)            cmd_next "$@";;
    claim)           cmd_claim "$@";;
    release)         cmd_release "$@";;
    archive)         cmd_archive "$@";;
    drain-inbox)     cmd_drain_inbox "$@";;
    import-archive)  cmd_import_archive "$@";;
    ""|-h|--help|help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//';;
    *) die "unknown subcommand '$cmd' (try: help)";;
  esac
}
# Run main only when executed directly, not when sourced (e.g. by tests).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then main "$@"; fi
