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
endpoint instead of Anthropic's API. It posts the review as a PR comment and
sets a `claude-review` commit status, and it fails the check on a `FAIL`
verdict or a GLM error so it can gate merges via branch protection.

## How it works (so you can explain it)

- The runner app (gitea-act-runner / forgejo-runner) is a **long-running
  daemon** that polls the server for jobs. It does not run the steps itself.
- When a PR opens/updates, the daemon spawns a **fresh ephemeral container**
  from the job's label image (e.g. `catthehacker/ubuntu:act-latest`) and runs
  the steps inside it. The container is discarded after the job.
- The job: install the Claude Code CLI → fetch the PR diff via the server API →
  run `claude -p` against GLM → post a comment + commit status via the API.
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
workflow's own job check). A `VERDICT: FAIL` or an exhausted GLM retry turns the
check red and blocks the merge.

## The workflow's built-in behavior (worth knowing)

These exist because each one fixed a real failure — keep them when editing:

- **`set +e` at the top.** Actions runs steps with `bash -e -o pipefail`, so a
  non-zero `claude` exit would kill the step before the error could be reported
  or a comment posted. The workflow disables errexit and handles return codes
  explicitly.
- **Diagnostics on failure.** It captures `claude` stdout *and* stderr and
  prints them, so a failure shows the real cause (e.g. a Z.AI `529`) instead of
  a silent red X.
- **Retry on overload.** Z.AI intermittently returns `HTTP 529` ("service
  overloaded"), especially for premium models on free/coding-plan tiers. The
  job retries `ANTHROPIC_MODEL` up to 3 times with backoff before failing.
- **Fail-closed.** A GLM error/timeout (after retries) or a `VERDICT: FAIL`
  exits non-zero so the check goes red. A clean review with `VERDICT: PASS` is
  green.
- **Verdict contract.** The prompt instructs the model to end with exactly
  `VERDICT: PASS` or `VERDICT: FAIL` (FAIL only for blocker-level findings); the
  job greps for that to decide the status.

## Customizing

- **Review prompt:** edit the `REVIEW_PROMPT` block in the env. It's a plain
  multi-line string — adjust what the reviewer looks for or how it scores.
- **Diff size cap:** `head -c 300000 pr.diff` keeps huge PRs within model
  context; raise/lower as needed.
- **Retry count:** the `ATTEMPTS=3` loop variable.
- **Repo-aware review:** the default reviews the diff text only (safest against
  prompt injection from a malicious PR). To let Claude read surrounding files,
  add `--allowedTools "Read,Grep,Glob"` to the `claude -p` call and check out
  the repo first — but understand the injection trade-off.

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
