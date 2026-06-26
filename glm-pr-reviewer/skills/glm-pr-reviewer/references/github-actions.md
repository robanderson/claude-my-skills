# GitHub.com variant (official action + GLM)

On **GitHub.com** (not Gitea/Forgejo), don't use the custom `/api/v1` workflow
in `assets/` — GitHub's API isn't compatible with those calls. Use the official
**`anthropics/claude-code-action@v1`** instead. It handles commenting, status,
and GitHub API access for you, and runs Claude Code on your runner.

Docs: https://code.claude.com/docs/en/github-actions
Action: https://github.com/anthropics/claude-code-action
Automatic per-PR review (no `@claude` trigger): https://code.claude.com/docs/en/code-review

## Pointing the official action at GLM (Z.AI)

The action runs Claude Code, which honors `ANTHROPIC_BASE_URL` and
`ANTHROPIC_AUTH_TOKEN` environment variables. Set those on the step and pick the
GLM model via `claude_args: --model`. This is the same env wiring as the
Gitea/Forgejo workflow.

```yaml
name: Claude PR Review (GLM)
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        env:
          ANTHROPIC_BASE_URL: https://api.z.ai/api/anthropic
          ANTHROPIC_AUTH_TOKEN: ${{ secrets.ZAI_API_KEY }}
        with:
          prompt: |
            Review this pull request for bugs, security issues, breaking
            changes, and missing tests. Be concise; cite file:line. Post your
            review as a PR comment.
          claude_args: "--model glm-4.7 --max-turns 15"
```

Notes:

- **Official support** is for the Anthropic API, Amazon Bedrock, Google Vertex
  AI, and Microsoft Foundry. Routing to GLM via an Anthropic-compatible base URL
  is community usage — if a future action version validates `anthropic_api_key`
  or the provider before honoring the env override, you may need to pin a
  version or fall back to the Gitea/Forgejo-style custom job.
- v1 migration cheatsheet (from beta): `direct_prompt` → `prompt`;
  `model`/`max_turns`/`allowed_tools` → `claude_args: --model / --max-turns /
  --allowedTools`; `mode` is removed (auto-detected).
- For interactive use, omit `prompt` and Claude responds to `@claude` mentions;
  for automatic review on every PR, keep the `prompt` + `pull_request` trigger
  as above, or use the `code-review` plugin via `plugin_marketplaces` /
  `plugins`.
- Keep the key in `secrets` (`ANTHROPIC_API_KEY` for the real Anthropic API, or
  `ZAI_API_KEY` for GLM as above). Never hard-code it.

## Why the Gitea/Forgejo path is custom instead

Gitea/Forgejo populate `github.*` contexts and provide a GitHub-Actions-like
runner, but their REST API is the Gitea/Forgejo API (`/api/v1/...`), not
GitHub's. The official action's GitHub client (octokit) expects GitHub's API
shape, so it won't post comments/statuses there. That's why the bundled
workflow talks to `${{ github.server_url }}/api/v1` directly with `curl`.
