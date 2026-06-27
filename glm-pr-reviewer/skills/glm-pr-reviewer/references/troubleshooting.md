# Troubleshooting

Real failures seen in the field, by symptom. The workflow's diagnostics print
Claude's stdout and stderr on failure — read the "Run Claude review" log group
first; it usually names the cause.

## Job dies in ~9 seconds, review says "could not run"

The `ZAI_API_KEY` secret isn't set (or is empty). `claude` exits immediately
with no credentials. Verify the secret exists: repo Settings → Actions →
Secrets. A fast (<10s) failure ⇒ missing key; a slow (~3 min) failure ⇒ the key
works but GLM is erroring (see below).

## Job runs ~3m20s then fails (and `claude` exits rc=1)

GLM returned **HTTP 529 "service overloaded."** Claude Code retries internally
for ~3 minutes, then gives up. The diagnostics show it verbatim:

```
API Error: 529 [1305][The service may be temporarily overloaded, please try again later] ...
```

This is server-side on Z.AI, not your setup. It's more common for premium models
(`glm-5.2`) on free/coding-plan tiers during peak load. The workflow retries
`ATTEMPTS` times with backoff **on 529 only** (other errors fail fast). Options
if it persists: switch `ANTHROPIC_MODEL` to a lighter, more-available model
(`glm-4.7`, `glm-4.5-air`), raise `ATTEMPTS`, or just re-run when Z.AI recovers.

## The step dies with no error output at all

The run step uses `bash -e -o pipefail`, so any non-zero command (including
`claude` failing) aborts the step before it can report or post. The bundled
workflow fixes this with `set +e` at the top and explicit return-code handling.
If you hand-edited the script and lost that, restore `set +e`.

## Runner installed but app crash-loops / no runner in admin list

See `runner-setup.md` → gotchas: a reused TrueNAS ixVolume with a stale
`.runner`, or the Forgejo declarative token-format error
("token contains invalid characters").

## The check is red but the review reads fine / has no VERDICT line

By design. The check is **fail-closed**: only an explicit last-line
`VERDICT: PASS` is green. If the model omitted the verdict, wrapped it oddly, or
emitted `VERDICT: FAIL`, the status goes red. If GLM keeps dropping the verdict
line, tighten the tail of `REVIEW_PROMPT` (it already demands an exact last
line), or lower the model tier — weaker models follow the format less reliably.

## "Blocked by pre-gate"

The deterministic pre-gate (run before the model) found an unresolved
merge-conflict marker or a high-confidence hardcoded-credential pattern in the
added lines, and forces the check red regardless of the model. Read the
"Deterministic pre-gate" log group; fix the diff, or — if it's a false positive
— tune the patterns in that group (keep them ~zero-false-positive).

## `concurrency` error / runner rejects the workflow

Older Gitea (pre ~1.24) doesn't support the top-level `concurrency:` block.
Delete that block from the YAML — everything else works without it (you just
lose automatic cancel-on-new-push).

## Comment posts but the commit status 403s (Gitea)

Symptom in the log: `comment posted`/`comment updated` then
`WARN: status POST failed`, and curl returns `403`. The Gitea Actions token can
post issue comments but is refused on `POST /repos/.../statuses/{sha}`. The
job's own check still goes red on failure, so merge-gating works via the
workflow check even without the separate `claude-review` status. To get the
dedicated status, the Actions token needs commit-status write — adjust the repo
/ instance Actions token permissions, or gate on the workflow check instead.

## Nothing happens when a PR opens

- Actions not enabled on the repo (repo Settings → Actions), or no runner with
  the `ubuntu-latest` label is online.
- The workflow file isn't on a branch the event sees — for `pull_request` it
  must exist in the repo (base branch). New branches cut from `main` inherit it.
- The workflow YAML is invalid. If you upload it via the API/web editor, make
  sure you didn't corrupt it (a stray non-ASCII byte in a pasted base64 blob
  will yield "illegal base64 data" or "yaml: found character that cannot start
  any token").

## `npm`/`node` not found in the job

The label image lacks Node. Use a `catthehacker/ubuntu:act-*` image (or any with
Node 18+) for the `ubuntu-latest` label, or add a Node setup step.
