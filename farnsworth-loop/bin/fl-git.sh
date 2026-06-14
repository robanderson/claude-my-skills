#!/usr/bin/env bash
# fl-git.sh — Farnsworth Loop grand-loop git/gh helper (approved internal tool).
#
# ALL real-repo side effects for grand loops (Feature 1) live here, as callable
# functions, so an agent never improvises git/gh. tournament.mjs is UNCHANGED and
# there is NO nested grand-loop workflow: the SKILL.md Phase-7 procedure drives the
# Z-loop and calls these functions for the deterministic, must-not-improvise parts.
#
# Dual interface:
#   - sourceable:   source fl-git.sh ; fl_branch 1
#   - CLI dispatch: bash fl-git.sh <fn> [args...]    (the benign-command pattern,
#                   matching glm-run.sh — the SKILL calls `bash fl-git.sh <fn> ...`)
#
# Portable on macOS: NO GNU coreutils, NO `timeout`/`gtimeout`, /dev/urandom for
# randomness (never Date/Math.random). Every gh/git call is rc-checked and the rc
# is propagated; failures fail closed.
#
# Functions (the SKILL Phase-7 driver calls exactly these signatures):
#   fl_suffix                              -> 7-char [0-9a-z]
#   fl_branch <loop>                       -> "FL-<loop>-<suffix>"
#   preflight <base> <runDir>              -> collects ALL failures; rc!=0 on any
#   detect_verify                          -> prints detected verify commands (one/line); rc 0 if any
#   run_verify                             -> reads commands on stdin or detects; fail-FAST; real rc
#   commit_and_push <branch> <base> <msg>  -> commit (guarded) + push -u; rc propagated
#   open_pr <branch> <base> <title> <bodyFile>            -> normal PR; prints URL
#   open_pr_needs_human <branch> <base> <title> <bodyFile> -> draft + needs-human PR; prints URL
#   stop_file_check <runDir>               -> rc 0 if STOP present (caller halts), rc 1 otherwise
#   done_marker <runDir> <loop> [write]    -> check/write per-loop DONE marker
#
set -uo pipefail

# Cap on verify output appended to a PR body so a huge log can't blow the PR
# body limit. tail -c keeps the most-recent (usually most-relevant) bytes.
FL_VERIFY_TAIL_BYTES="${FL_VERIFY_TAIL_BYTES:-12000}"
FL_NEEDS_HUMAN_LABEL="${FL_NEEDS_HUMAN_LABEL:-needs-human}"

# --------------------------------------------------------------------------
# fl_suffix — 7 chars from [0-9a-z], macOS-portable, /dev/urandom only.
# LC_ALL=C so tr treats bytes as bytes; head -c 7 caps it; trailing newline.
# --------------------------------------------------------------------------
fl_suffix() {
  LC_ALL=C tr -dc '0-9a-z' < /dev/urandom | head -c 7
  echo
}

# fl_branch <loop> -> FL-<loop>-<suffix>. Overrides the global rob/ prefix for
# loop branches only (the SKILL says so explicitly).
fl_branch() {
  local k="${1:?loop number required}"
  echo "FL-${k}-$(fl_suffix)"
}

# --------------------------------------------------------------------------
# detect_verify — scan the repo and print the verify commands we WOULD run,
# one per line (the driver runs them later via run_verify). Records, does not
# run. Prints nothing and returns rc 1 if no verify commands can be detected
# (the SKILL then opens a draft needs-human PR — we could not verify).
#
# Order is fail-fast-friendly: build/typecheck before test before lint.
# --------------------------------------------------------------------------
detect_verify() {
  local found=0

  # Node / JS: package.json scripts. Only emit scripts that actually exist.
  if [ -f package.json ]; then
    local has
    for s in build typecheck test lint; do
      # crude but dependency-free: does a "<s>": key exist in scripts?
      if grep -Eq "\"${s}\"[[:space:]]*:" package.json; then
        echo "npm run ${s} --if-present"
        found=1
      fi
    done
  fi

  # Python: pyproject.toml + pytest / ruff.
  if [ -f pyproject.toml ] || [ -f setup.cfg ] || [ -f tox.ini ]; then
    if command -v ruff >/dev/null 2>&1; then echo "ruff check ."; found=1; fi
    if command -v pytest >/dev/null 2>&1; then echo "pytest -q"; found=1
    elif command -v python3 >/dev/null 2>&1 && python3 -c 'import pytest' >/dev/null 2>&1; then
      echo "python3 -m pytest -q"; found=1
    fi
  fi

  # Makefile: test / check targets.
  if [ -f Makefile ] || [ -f makefile ]; then
    local mf="Makefile"; [ -f Makefile ] || mf="makefile"
    if grep -Eq '^test[[:space:]]*:' "$mf"; then echo "make test"; found=1; fi
    if grep -Eq '^check[[:space:]]*:' "$mf"; then echo "make check"; found=1; fi
  fi

  # Rust: cargo.
  if [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then
    echo "cargo build"
    echo "cargo test"
    found=1
  fi

  # Go.
  if [ -f go.mod ] && command -v go >/dev/null 2>&1; then
    echo "go build ./..."
    echo "go test ./..."
    found=1
  fi

  [ "$found" -eq 1 ] && return 0 || return 1
}

# --------------------------------------------------------------------------
# run_verify — run the detected verify commands FAIL-CLOSED and FAIL-FAST.
# Commands come from stdin (one per line) if given, else from detect_verify.
# CONTRACT (the crown jewel):
#   (a) returns a real NONZERO status on ANY failing command;
#   (b) breaks on the FIRST failure (fail-fast);
#   (c) NEVER lets a later command's success mask an earlier failure.
# We capture each command's rc DIRECTLY with `if cmd; then ... else rc=$?; break`.
# We do NOT pipe through tee/grep to recover rc (tee masks rc; a later exit=0 in a
# combined log would mask an earlier failure). All output goes to stdout/stderr so
# the caller can `> verify.log 2>&1` it.
#
# rc 0  -> all passed
# rc 1  -> a command failed (output shows which)
# rc 2  -> no verify commands available (caller -> draft needs-human PR)
# --------------------------------------------------------------------------
run_verify() {
  local -a cmds=()
  if [ ! -t 0 ]; then
    # read commands from stdin
    while IFS= read -r line; do
      [ -n "$line" ] && cmds+=("$line")
    done
  fi
  if [ "${#cmds[@]}" -eq 0 ]; then
    # No commands piped in: detect them now.
    local detected
    detected="$(detect_verify)" || true
    if [ -n "$detected" ]; then
      while IFS= read -r line; do
        [ -n "$line" ] && cmds+=("$line")
      done <<EOF
$detected
EOF
    fi
  fi

  if [ "${#cmds[@]}" -eq 0 ]; then
    echo "FL-VERIFY: no verify commands detected (cannot verify)" >&2
    return 2
  fi

  local rc=0 c
  for c in "${cmds[@]}"; do
    echo "FL-VERIFY-RUN: $c"
    # Direct rc capture; break on first failure so a later success cannot mask it.
    if eval "$c"; then
      echo "FL-VERIFY-OK: $c"
    else
      rc=$?
      echo "FL-VERIFY-FAIL: $c (exit $rc)" >&2
      break
    fi
  done

  if [ "$rc" -eq 0 ]; then
    echo "FL-VERIFY-ALL-PASS"
  else
    echo "FL-VERIFY-HALT: chain should stop (fail-closed)" >&2
    # Normalise to 1 so the caller's `if run_verify` test is simple, but it is
    # genuinely nonzero (never masked).
    return 1
  fi
  return 0
}

# --------------------------------------------------------------------------
# preflight <base> <runDir>
# Zero-token gate run ONCE before loop 1. Collects ALL failures (does not bail on
# the first) and prints them, then returns rc = number-of-failures capped to 1
# (rc 0 == all good, rc 1 == one or more failures). Resolves the remote from the
# base branch's actual upstream, with an origin fallback.
# --------------------------------------------------------------------------
preflight() {
  local base="${1:?base branch required}"
  local runDir="${2:-.}"
  local -a fails=()

  # inside a git work tree?
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fails+=("not inside a git work tree (run from the repo root)")
  fi

  # working tree clean? (refuse on dirty — never auto-stash unrelated work)
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    fails+=("working tree is dirty — commit/stash your changes first (refusing to risk committing unrelated work)")
  fi

  # gh authenticated?
  if ! command -v gh >/dev/null 2>&1; then
    fails+=("gh CLI not found on PATH")
  elif ! gh auth status >/dev/null 2>&1; then
    fails+=("gh is not authenticated (run: gh auth login)")
  fi

  # a remote exists? prefer the base branch's upstream remote, fall back to origin.
  local remote=""
  remote="$(fl_resolve_remote "$base")"
  if [ -z "$remote" ]; then
    fails+=("no git remote resolvable (base upstream nor 'origin' has a URL)")
  fi

  # base branch resolves?
  if ! git rev-parse --verify --quiet "$base" >/dev/null 2>&1; then
    fails+=("base branch '$base' does not resolve (git rev-parse --verify failed)")
  fi

  # verify commands detected? (record only; missing -> draft needs-human PR later,
  # so this is a WARNING, not a hard fail.)
  if detect_verify >/dev/null 2>&1; then
    : # detected
  else
    echo "FL-PREFLIGHT-WARN: no verify commands auto-detected; PRs will be draft+${FL_NEEDS_HUMAN_LABEL}" >&2
  fi

  if [ "${#fails[@]}" -gt 0 ]; then
    echo "FL-PREFLIGHT-FAIL (${#fails[@]} problem(s)):" >&2
    local f
    for f in "${fails[@]}"; do echo "  - $f" >&2; done
    return 1
  fi
  echo "FL-PREFLIGHT-OK base=$base remote=$remote runDir=$runDir"
  return 0
}

# fl_resolve_remote <base> -> prints the remote name to push to, or empty.
# Prefers the base branch's configured upstream remote; falls back to origin if it
# has a URL.
fl_resolve_remote() {
  local base="${1:-}"
  local up rem=""
  # base@{upstream} -> e.g. "origin/main"; take the part before the first /.
  up="$(git rev-parse --abbrev-ref --symbolic-full-name "${base}@{upstream}" 2>/dev/null || true)"
  if [ -n "$up" ]; then
    rem="${up%%/*}"
  fi
  if [ -n "$rem" ] && git remote get-url "$rem" >/dev/null 2>&1; then
    echo "$rem"; return 0
  fi
  if git remote get-url origin >/dev/null 2>&1; then
    echo "origin"; return 0
  fi
  echo ""
  return 1
}

# --------------------------------------------------------------------------
# commit_and_push <branch> <base> <message>
# Guarded commit: only commits when HEAD is the expected FL- branch AND the diff
# (against the index AND the worktree) is non-empty. The implementer leaves
# changes UNSTAGED, so we `git add -A` here. Then push -u to the resolved remote.
# rc propagated on any git failure.
# --------------------------------------------------------------------------
commit_and_push() {
  local branch="${1:?branch required}"
  local base="${2:?base required}"
  local msg="${3:?commit message required}"

  # Guard: HEAD must be the expected FL- branch (never commit on base/main).
  local cur
  cur="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if [ "$cur" != "$branch" ]; then
    echo "FL-COMMIT-REFUSE: HEAD is '$cur', expected '$branch' (refusing to commit on the wrong branch)" >&2
    return 2
  fi
  case "$branch" in
    FL-*) : ;;
    *) echo "FL-COMMIT-REFUSE: branch '$branch' is not an FL- branch (refusing)" >&2; return 2 ;;
  esac

  # Guard: there must be something to commit.
  git add -A || { echo "FL-COMMIT-FAIL: git add failed" >&2; return 1; }
  if git diff --cached --quiet; then
    echo "FL-COMMIT-REFUSE: empty diff after staging (nothing to commit)" >&2
    return 3
  fi

  if ! git commit -m "$msg"; then
    echo "FL-COMMIT-FAIL: git commit failed" >&2
    return 1
  fi

  local remote
  remote="$(fl_resolve_remote "$base")"
  if [ -z "$remote" ]; then
    echo "FL-PUSH-FAIL: no remote resolvable" >&2
    return 1
  fi
  if ! git push -u "$remote" "$branch"; then
    echo "FL-PUSH-FAIL: git push -u $remote $branch failed" >&2
    return 1
  fi
  echo "FL-COMMIT-PUSH-OK branch=$branch remote=$remote"
  return 0
}

# --------------------------------------------------------------------------
# _ensure_label — idempotently create the needs-human label. If creation fails
# (no permission, etc.) we return nonzero so the caller can fall back to a
# label-less draft PR rather than failing the whole loop.
# --------------------------------------------------------------------------
_ensure_label() {
  local label="${1:-$FL_NEEDS_HUMAN_LABEL}"
  # Already exists?
  if gh label list --limit 200 2>/dev/null | grep -qiE "^${label}([[:space:]]|$)"; then
    return 0
  fi
  # Create (idempotent: --force updates if it raced into existence).
  if gh label create "$label" --color "B60205" --description "Farnsworth Loop: needs human review (verify failed or unverifiable)" --force >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# --------------------------------------------------------------------------
# open_pr <branch> <base> <title> <bodyFile>
# Normal (non-draft) PR. Body is read from a file (portable mktemp composed by
# the caller). Prints the PR URL on success. rc propagated.
# --------------------------------------------------------------------------
open_pr() {
  local branch="${1:?branch required}"
  local base="${2:?base required}"
  local title="${3:?title required}"
  local bodyFile="${4:?body file required}"
  [ -f "$bodyFile" ] || { echo "FL-PR-FAIL: body file '$bodyFile' missing" >&2; return 1; }

  local url
  if url="$(gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$bodyFile" 2>&1)"; then
    echo "$url" | tail -1
    return 0
  fi
  echo "FL-PR-FAIL: gh pr create failed: $url" >&2
  return 1
}

# --------------------------------------------------------------------------
# open_pr_needs_human <branch> <base> <title> <bodyFile>
# DRAFT PR labelled needs-human (verify failed, or could not verify). The body
# file should already contain the (capped) failing verify output — the caller
# composes it; see fl_compose_body / fl_append_verify_tail below. Creates the
# label idempotently; on label failure falls back to a label-LESS draft PR (the
# draft + body still convey "needs human"). Prints URL; rc propagated.
# --------------------------------------------------------------------------
open_pr_needs_human() {
  local branch="${1:?branch required}"
  local base="${2:?base required}"
  local title="${3:?title required}"
  local bodyFile="${4:?body file required}"
  [ -f "$bodyFile" ] || { echo "FL-PR-FAIL: body file '$bodyFile' missing" >&2; return 1; }

  local labelArgs=()
  if _ensure_label "$FL_NEEDS_HUMAN_LABEL"; then
    labelArgs=(--label "$FL_NEEDS_HUMAN_LABEL")
  else
    echo "FL-PR-WARN: could not create/find label '$FL_NEEDS_HUMAN_LABEL'; opening label-less draft" >&2
  fi

  local url
  if url="$(gh pr create --draft "${labelArgs[@]}" --base "$base" --head "$branch" --title "$title" --body-file "$bodyFile" 2>&1)"; then
    echo "$url" | tail -1
    return 0
  fi
  # If the failure was the label, retry once without it (label-less draft fallback).
  if [ "${#labelArgs[@]}" -gt 0 ]; then
    echo "FL-PR-WARN: draft+label create failed, retrying label-less: $url" >&2
    if url="$(gh pr create --draft --base "$base" --head "$branch" --title "$title" --body-file "$bodyFile" 2>&1)"; then
      echo "$url" | tail -1
      return 0
    fi
  fi
  echo "FL-PR-FAIL: gh pr create --draft failed: $url" >&2
  return 1
}

# --------------------------------------------------------------------------
# fl_compose_body <outFile> -- writes the body file from stdin (a here-doc the
# caller pipes in). A convenience so the SKILL can compose in a portable mktemp.
# Usage:  fl_compose_body /tmp/body.md <<'EOF' ... EOF
# --------------------------------------------------------------------------
fl_compose_body() {
  local out="${1:?out file required}"
  cat > "$out"
}

# fl_append_verify_tail <bodyFile> <verifyLogFile>
# Appends a capped tail of the verify log to the PR body inside a fenced block,
# so a huge log cannot blow the PR body limit. Safe if the log is missing.
fl_append_verify_tail() {
  local body="${1:?body file required}"
  local vlog="${2:?verify log required}"
  {
    echo
    echo '### Verify output (tail)'
    echo '```'
    if [ -f "$vlog" ]; then
      tail -c "$FL_VERIFY_TAIL_BYTES" "$vlog"
    else
      echo "(verify log not found: $vlog)"
    fi
    echo '```'
  } >> "$body"
}

# --------------------------------------------------------------------------
# stop_file_check <runDir>
# Between-loops kill switch. rc 0 (success) when a STOP file EXISTS — the caller
# treats rc 0 as "halt now". rc 1 when absent (keep going). This is the inverse
# of the usual convention but matches the caller pattern
#   `if stop_file_check "$runDir"; then halt; fi`.
# --------------------------------------------------------------------------
stop_file_check() {
  local runDir="${1:?runDir required}"
  if [ -e "${runDir}/STOP" ]; then
    echo "FL-STOP: kill-switch file present at ${runDir}/STOP — halting before next loop"
    return 0
  fi
  return 1
}

# --------------------------------------------------------------------------
# done_marker <runDir> <loop> [write]
# Per-loop idempotency. Without 'write': rc 0 if the loop's DONE marker exists
# (caller skips the loop), rc 1 otherwise. With 'write' as 3rd arg: create the
# marker (call ONLY after the PR is created). Marker lives at
# <runDir>/loop-<loop>/DONE.
# --------------------------------------------------------------------------
done_marker() {
  local runDir="${1:?runDir required}"
  local k="${2:?loop number required}"
  local mode="${3:-check}"
  local marker="${runDir}/loop-${k}/DONE"
  if [ "$mode" = "write" ]; then
    mkdir -p "${runDir}/loop-${k}" || return 1
    {
      echo "loop=${k}"
      echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
      [ -n "${2:-}" ] && true
    } > "$marker" || return 1
    echo "FL-DONE-WRITTEN ${marker}"
    return 0
  fi
  if [ -e "$marker" ]; then
    echo "FL-DONE-EXISTS ${marker}"
    return 0
  fi
  return 1
}

# fl_detect_orphan_branch <loop>
# Re-entry safety: detect a half-applied FL-<loop>-* branch with NO DONE marker
# (a mid-loop death). Prints the branch name(s) if any; caller tells the human to
# inspect/delete rather than auto-resuming. (detect-and-stop, never auto-resume.)
fl_detect_orphan_branch() {
  local k="${1:?loop number required}"
  git branch --list "FL-${k}-*" --format '%(refname:short)' 2>/dev/null
}

# --------------------------------------------------------------------------
# CLI dispatcher (the benign-command pattern, like glm-run.sh). Lets the SKILL
# call `bash fl-git.sh <fn> args...` without sourcing.
# --------------------------------------------------------------------------
# Only dispatch when executed directly, not when sourced.
_fl_is_sourced() {
  # bash: ${BASH_SOURCE[0]} != $0 when sourced.
  [ "${BASH_SOURCE[0]:-}" != "${0:-}" ]
}

if ! _fl_is_sourced; then
  cmd="${1:-}"
  shift || true
  case "$cmd" in
    fl_suffix)             fl_suffix ;;
    fl_branch)             fl_branch "$@" ;;
    preflight)             preflight "$@" ;;
    detect_verify)         detect_verify "$@" ;;
    run_verify)            run_verify "$@" ;;
    commit_and_push)       commit_and_push "$@" ;;
    open_pr)               open_pr "$@" ;;
    open_pr_needs_human)   open_pr_needs_human "$@" ;;
    fl_compose_body)       fl_compose_body "$@" ;;
    fl_append_verify_tail) fl_append_verify_tail "$@" ;;
    stop_file_check)       stop_file_check "$@" ;;
    done_marker)           done_marker "$@" ;;
    fl_resolve_remote)     fl_resolve_remote "$@" ;;
    fl_detect_orphan_branch) fl_detect_orphan_branch "$@" ;;
    ""|-h|--help|help)
      cat <<'USAGE'
fl-git.sh — Farnsworth Loop grand-loop git/gh helper.
Usage: bash fl-git.sh <fn> [args...]   (or: source fl-git.sh)
Functions:
  fl_suffix
  fl_branch <loop>
  preflight <base> <runDir>
  detect_verify
  run_verify                      (commands on stdin one/line, else auto-detect)
  commit_and_push <branch> <base> <message>
  open_pr <branch> <base> <title> <bodyFile>
  open_pr_needs_human <branch> <base> <title> <bodyFile>
  fl_compose_body <outFile>       (body text on stdin)
  fl_append_verify_tail <bodyFile> <verifyLogFile>
  stop_file_check <runDir>        (rc 0 == STOP present == halt)
  done_marker <runDir> <loop> [write]
  fl_resolve_remote <base>
  fl_detect_orphan_branch <loop>
USAGE
      ;;
    *)
      echo "fl-git.sh: unknown function '$cmd' (try: bash fl-git.sh help)" >&2
      exit 64
      ;;
  esac
fi
