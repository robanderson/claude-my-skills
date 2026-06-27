---
name: glm-pr-reviewer
description: >-
  Set up an automated AI pull-request reviewer on Gitea or Forgejo Actions that
  runs Claude Code (headless `claude -p`) against a GLM model via the Z.AI
  Anthropic-compatible endpoint, posts the review as a PR comment, and sets a
  pass/fail status check that can gate merges. Use this whenever someone wants
  automated PR review / AI code review in CI on a self-hosted git server
  (Gitea, Forgejo, or a Gitea-family Actions runner), wants to wire Claude Code
  or GLM/Z.AI into their Actions pipeline, asks for a "review bot" or
  "Claude reviews my PRs", or is debugging an existing Claude-Code-on-Actions
  reviewer (529 overloads, runner not picking up jobs, comment/status not
  posting, the job dying silently). Prefer this skill over hand-rolling a
  workflow even if the user only says "review my pull requests automatically".
---

# GLM PR Reviewer (Gitea / Forgejo Actions)

This skill installs a CI workflow that reviews every pull request with Claude
Code, using a GLM model (e.g. `glm-5.2`) through Z.AI's Anthropic-compatible
endpoint instead of Anthropic's API. It posts the review as a sticky PR comment
and sets a `claude-review` commit status. It is **fail-closed**: only an explicit
`VERDICT: PASS` is green — a `FAIL`, a missing/ambiguous verdict, a GLM error, or
a deterministic pre-gate hit all go red, so it can gate merges via branch
protection.

## Quickstart

1. Drop `assets/claude-pr-review.yml` into `.forgejo/workflows/` (Forgejo) or
   `.gitea/workflows/` (Gitea).
2. Add an Actions secret `ZAI_API_KEY` = your Z.AI key (repo, or org/global).
3. Confirm a runner with the `ubuntu-latest` label is online.
4. Open a trivial PR — within seconds you get a sticky "Claude Code review"
   comment and a `claude-review` status check.
5. (Optional) Require the `claude-review` check in branch protection to gate
   merges.

Defaults are sane (model `glm-5.2`, fail-closed, prompt-injection-resistant);
the rest of this doc explains how it works and how to tune it.

## How it works (so you can explain it)

- The runner app (gitea-act-runner / forgejo-runner) is a **long-running
  daemon** that polls the server for jobs. It does not run the steps itself.
- When a PR opens/updates, the daemon spawns a **fresh ephemeral container**
  from the job's label image (e.g. `catthehacker/ubuntu:act-latest`) and runs
  the steps inside it. The container is discarded after the job.
- The job: install a **pinned** Claude Code CLI → fetch the PR diff via the
  server API (fail-closed if it can't) → run a cheap **deterministic pre-gate**
  over the diff → run `claude -p` against GLM with the diff fenced as **untrusted
  data** → **update a single sticky** PR comment + set the commit status.
- Claude Code talks to GLM because `ANTHROPIC_BASE_URL` points at
  `https://api.z.ai/api/anthropic` and `ANTHROPIC_AUTH_TOKEN` carries the Z.AI
  key. GLM speaks the Anthropic wire format, so the CLI needs no changes.

## Prerequisites

1. A Gitea (1.20+) or Forgejo (1.20+ / Forgejo 7+) instance with **Actions
   enabled** on the target repo.
2. A **runner online** with the `ubuntu-latest` label. See
   `references/runner-setup.md` for installing one (incl. the TrueNAS app path)
   and the non-obvious gotchas (stale data volume, declarative registration
   token format, Docker socket access).
3. A **Z.AI API key** with a plan that exposes the model you want (e.g. GLM
   coding plan for `glm-5.2`).
4. The job image must have **Node 18+ and npm** (catthehacker images do).

## Setup steps

Do these in order. Ask the user which server (Gitea or Forgejo) and which repo,
and which GLM model they want, before writing anything.

### 1. Add the workflow file

Copy `assets/claude-pr-review.yml` into the repo at:

- **Forgejo:** `.forgejo/workflows/claude-pr-review.yml`
- **Gitea:** `.gitea/workflows/claude-pr-review.yml`

The file content is identical for both — only the directory differs. The
workflow uses `github.*` context variables and `${{ github.server_url }}/api/v1`
for API calls, which the Gitea-family runner populates correctly.

### 2. Add the Z.AI secret

Create an Actions secret named **`ZAI_API_KEY`** = the user's Z.AI key
(repo Settings → Actions → Secrets, or set it org/global-wide so every repo
inherits it). Never hard-code the key in the workflow. Do not handle the key
value yourself — have the user paste it into the secret field.

### 3. Pick the model

Set `ANTHROPIC_MODEL` in the workflow env:

- `glm-5.2` — current SOTA on the coding plan (slower, premium quota).
- `glm-4.7` — 1x "workhorse" tier; faster and more reliably available.
- `glm-4.5-air` — lightest/cheapest.
- `glm-5.2[1m]` — 1M-context variant (needs `CLAUDE_CODE_AUTO_COMPACT_WINDOW`,
  already set in the template).

The template also sets the Claude Code tier aliases
(`ANTHROPIC_DEFAULT_OPUS_MODEL`, `..._SONNET_MODEL`, `..._HAIKU_MODEL`) so the
runtime's opus/sonnet/haiku tiers map onto GLM models.

### 4. Open a PR to test

The workflow triggers on `pull_request` (opened / reopened / synchronize).
Open a trivial PR; the runner should pick it up within seconds and you should
see a "Claude Code review" comment plus a `claude-review` check.

### 5. (Optional) Gate merges

Add a branch-protection rule requiring the `claude-review` status check (or the
workflow's own job check). Because the check is fail-closed, anything other than
an explicit `VERDICT: PASS` — a `FAIL`, a missing/ambiguous verdict, a pre-gate
blocker, or an exhausted GLM retry — turns it red and blocks the merge.

## The workflow's built-in behavior (worth knowing)

These exist because each one fixed a real failure — keep them when editing:

- **`set +e`, never `set -x`.** Actions runs steps with `bash -e -o pipefail`, so
  a non-zero `claude` exit would kill the step before the error could be reported
  or a comment posted. The workflow disables errexit and handles return codes
  explicitly. It never enables `set -x` (that would echo secrets).
- **Secret masking.** It `::add-mask::`es the Z.AI key and repo token up front, so
  they can't surface in logs even via an error echo.
- **Fail-closed verdict, aggregated in shell.** Only an explicit last-line
  `VERDICT: PASS` (tolerant of markdown bold/backticks and case) goes green.
  `FAIL`, a *missing* or ambiguous verdict, a GLM error/timeout, or a pre-gate
  blocker all go red. The outcome is decided in shell, never by the model.
- **Deterministic pre-gate (hybrid gate-then-judge).** Before spending tokens,
  cheap high-confidence rules scan the diff for unresolved merge-conflict markers
  and obvious hardcoded credentials. A hit forces red *and* is fed to the model
  as authoritative ground truth.
- **Prompt-injection resistance.** The diff is fenced as `UNTRUSTED PR DIFF` and
  the prompt forbids following instructions inside it; an injection attempt is
  itself a Blocker.
- **Sticky comment.** It finds its prior comment via a hidden marker and
  *updates* it, so an active PR gets one evolving review comment instead of a new
  comment on every push.
- **Concurrency.** A per-PR concurrency group cancels an in-flight run when a new
  commit lands, so two jobs never race over the comment/status. (Needs a recent
  server — see the note in the YAML; delete the block on older Gitea.)
- **Pinned CLI.** Installs `@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION` for
  reproducibility instead of a floating `latest`.
- **Diagnostics + 529-only retry.** Captures `claude` stdout *and* stderr on
  failure; retries **only** on a Z.AI `529` overload — other errors fail fast
  instead of burning ~3 min per attempt.
- **Diff-fetch fail-closed + truncation.** A non-200 diff fetch reds the check
  rather than reviewing nothing; oversized diffs are truncated with a marker the
  model is told about; a genuinely empty diff passes as "no reviewable changes".

## Customizing

- **Review prompt:** edit the `REVIEW_PROMPT` block in the env. Keep the
  UNTRUSTED-diff security contract and the final `VERDICT:` line — the job
  depends on both.
- **Model:** `ANTHROPIC_MODEL` (the comment footer is derived from it, so the
  label can never drift from the model actually used).
- **Pinned CLI version:** `CLAUDE_CODE_VERSION` — bump deliberately; set to
  `latest` only if you accept unpinned installs.
- **Diff size cap:** `MAX_DIFF_BYTES` (default `300000`).
- **Retry count:** `ATTEMPTS` (applies to Z.AI `529` only).
- **Pre-gate:** the `Deterministic pre-gate` group — add high-confidence rules
  (lint/format/secret patterns). Keep them ~zero-false-positive, since a hit
  forces the check red.

### Repo-aware review (threat model — use with care)

The default reviews the **diff text only**. That is the safe posture against two
attacks from an untrusted PR: prompt **injection** (the diff telling the reviewer
to pass) and data **exfiltration** (the diff telling the reviewer to read a
secret/file and echo it into the public comment). The diff is fenced as untrusted
and the verdict is aggregated in shell, so injection can't flip the gate.

To let Claude read surrounding files, add `--allowedTools "Read,Grep,Glob"` to the
`claude -p` call and check out the repo first — but understand you are handing
attacker-controlled text a file-read tool whose output lands in a public comment.
Only enable this where PR authors are trusted (or add egress/secret controls).
Never grant write/exec tools.

## Troubleshooting

If a run fails or nothing happens, read `references/troubleshooting.md` — it
covers the specific, non-obvious failures seen in the field: the job dies in
~9s (missing secret), dies/hangs ~3m22s (Z.AI 529), runner installed but
crash-loops (stale TrueNAS data volume / wrong Forgejo token format), the
comment posts but the status 403s on Gitea, and Docker-executor jobs that can't
reach the daemon.

## GitHub.com

This bundled workflow targets the **Gitea/Forgejo API** (`/api/v1/...`). On
GitHub.com, use the official `anthropics/claude-code-action@v1` instead —
GitHub's API isn't compatible with these `/api/v1` calls. You can still point
it at GLM with the same env wiring (`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`
+ `claude_args: --model`). See `references/github-actions.md` for a ready GitHub
workflow and caveats, based on https://code.claude.com/docs/en/github-actions
and https://github.com/anthropics/claude-code-action.
