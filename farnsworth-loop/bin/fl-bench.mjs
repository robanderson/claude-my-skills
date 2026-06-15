#!/usr/bin/env node
// =============================================================================
// fl-bench.mjs — Farnsworth Loop generation-throughput benchmark.
//
// Measures tokens/second for EVERY model the farnsworth-loop system can call,
// on a COLD run (first call) and a HOT run (an immediate second call), and
// reports cold tok/s, hot tok/s, and the delta.
//
// It uses the SAME nested-`claude`/`codex` invocation mechanics, env vars, auth
// conventions, and portable perl-alarm timeout as the bundled runner scripts
// (bin/glm-run.sh / local-run.sh / codex-run.sh / minimax-run.sh), but calls
// them DIRECTLY here (rather than through the runner scripts) so each call's
// wall-time and the provider's REAL output-token count can be captured.
//
//   tok/s = output_tokens / generation_wall_seconds
//
// Token counts are the provider's OWN reported counts (NOT chars/4):
//   - claude-family (anthropic / glm / minimax): `claude -p --output-format
//     json --verbose` emits a JSON ARRAY of stream events; the final
//     type:"result" element carries usage.output_tokens. We parse defensively
//     (walk the whole structure, take the MAX output_tokens seen), never
//     `JSON.parse(stdout).usage`, never slice(indexOf('{')).
//   - local (omlx MLX): we hit the OpenAI-shaped /v1/chat/completions endpoint
//     directly and read usage.completion_tokens.
//   - codex (gpt-5.5): codex's token accounting is not reliably machine-
//     readable from `codex exec`, so codex is the ONE place where a chars/4
//     estimate (of the captured final message) is an explicitly-flagged
//     fallback (estimated:true). We still try the real token_count event first.
//
// HONEST MEASUREMENT NOTES (stated, not implied away):
//   - Every timed window is the WALL-CLOCK of the subprocess: it includes the
//     `claude`/`codex` CLI / agent startup overhead (and curl/HTTP setup for
//     local). So the reported tok/s is end-to-end throughput as the system
//     experiences it, NOT a pure decode rate.
//   - "COLD" means: for local MLX, a genuine model-load-into-memory cold start
//     (if the weights are not resident); for the HOSTED providers (anthropic /
//     glm / minimax / codex) it is connection/cache/route warmup, NOT a true
//     weight load. The HOT run is an immediate second identical call.
//   - The `claude` CLI has NO `--max-tokens` flag; output is bounded by the
//     prompt instruction AND CLAUDE_CODE_MAX_OUTPUT_TOKENS (a SOFT cap for the
//     claude-family providers). For local (raw HTTP) and codex we pass a hard
//     max-tokens where the API supports it.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(__dirname, '..')          // bin/.. = plugin root
const RESULTS_DIR = resolve(PLUGIN_ROOT, '.bench')
const RESULTS_FILE = resolve(RESULTS_DIR, 'results.jsonl')

// ----------------------------------------------------------------------------
// Fixed, IDENTICAL benchmark prompt + bounded generation for EVERY model, so
// tok/s is comparable and the run stays fast/cheap. ~256 output tokens target.
// ----------------------------------------------------------------------------
const MAX_OUTPUT_TOKENS = 256
const PROMPT =
  'Write exactly one paragraph (about 200 words, no lists, no headings, no code) ' +
  'explaining what a hash map is and why its average-case lookup is O(1). ' +
  'Stop after the single paragraph. Do not ask any questions; do not add anything else.'

// Per-call wall-clock backstop (seconds). Generous enough for a slow cold local
// model load, short enough that a hung call does not stall the whole sweep.
const DEFAULT_TIMEOUT_SECS = 240
const LOCAL_TIMEOUT_SECS = 600   // a cold MLX weight-load can be slow

// ----------------------------------------------------------------------------
// CLI args.
//   --models all                 benchmark every callable model (local discovered live)
//   --models <sel>[,<sel>...]    a custom subset (see selection grammar below)
//   --list                       dry-run: print what WOULD be benchmarked, make no calls
//   --timeout <secs>             override the default per-call timeout
//   --help
//
// SELECTION GRAMMAR (comma-separated; whitespace ignored; de-duped):
//   all                          -> every callable model across every provider
//   <provider>                   -> every model of that provider
//                                   providers: anthropic | glm | local | codex | minimax
//   <provider>:<id>              -> one specific model, e.g. glm:glm-5.1, codex:codex-high,
//                                   local:gemma-4-26b-a4b-it-8bit, anthropic:opus
//   <id>                         -> a bare id resolved against the known/discovered catalogue
//                                   (e.g. opus, glm-5.2, minimax-m3, codex-high, a local id)
// Examples:
//   fl-bench.mjs --models all
//   fl-bench.mjs --models anthropic,glm
//   fl-bench.mjs --models glm:glm-5.1,codex:codex-high,opus
//   fl-bench.mjs --models local            # every locally-discovered MLX model
//   fl-bench.mjs --list --models all       # show the plan, call nothing
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { models: 'all', list: false, timeout: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--list' || a === '--dry-run') out.list = true
    else if (a === '--models' || a === '-m') out.models = argv[++i]
    else if (a === '--timeout') out.timeout = Number(argv[++i])
    else if (a.startsWith('--models=')) out.models = a.slice('--models='.length)
    else if (a.startsWith('--timeout=')) out.timeout = Number(a.slice('--timeout='.length))
  }
  return out
}

const USAGE = `fl-bench.mjs — Farnsworth Loop throughput benchmark (cold vs hot tok/s)

Usage:
  fl-bench.mjs [--models <selection>] [--list] [--timeout <secs>]

Options:
  --models <sel>   What to benchmark. Default: all. Comma-separated. See grammar.
  --list           Dry-run: print the resolved plan and make NO model calls.
  --timeout <secs> Per-call wall-clock backstop (default ${DEFAULT_TIMEOUT_SECS}, local ${LOCAL_TIMEOUT_SECS}).
  --help           This help.

Selection grammar (comma-separated, de-duped):
  all                      every callable model (local list discovered live)
  <provider>               anthropic | glm | local | codex | minimax
  <provider>:<id>          e.g. glm:glm-5.1, codex:codex-high, local:<omlx-id>, anthropic:opus
  <id>                     a bare id resolved against the catalogue (opus, glm-5.2, minimax-m3, codex-high, ...)

Results: appended to ${RESULTS_FILE}
         (append-only JSONL; one record per model per run; survives crashes).`

// ============================================================================
// Provider catalogues (static where the system pins them; local is dynamic).
// Each entry is a benchmark TARGET with: { provider, id (display), ...dispatch }.
// ============================================================================

// Anthropic — session's own auth (NO API-key env var). Dispatched via `claude`
// with --model <alias>. The alias resolves on the session's Anthropic provider.
const ANTHROPIC_MODELS = [
  { provider: 'anthropic', id: 'opus', alias: 'opus' },
  { provider: 'anthropic', id: 'sonnet', alias: 'sonnet' },
  { provider: 'anthropic', id: 'haiku', alias: 'haiku' },
]

// GLM (z.ai) — `claude` pointed at the z.ai Anthropic-compatible endpoint.
// Bearer auth via ANTHROPIC_AUTH_TOKEN=$ZAI_API_KEY (NOT x-api-key). The display
// id maps to a `claude --model` flag exactly as the runner/tournament do.
const GLM_MODELS = [
  { provider: 'glm', id: 'glm-5.2', flag: 'opus' },     // --model opus -> glm-5.2 (default-opus env)
  { provider: 'glm', id: 'glm-5.1', flag: 'glm-5.1' },  // passed through directly
  { provider: 'glm', id: 'glm-4.7', flag: 'sonnet' },
  { provider: 'glm', id: 'glm-4.5-air', flag: 'haiku' },
]

// Codex (OpenAI gpt-5.5) — pinned model, REASONING EFFORT is the axis. Auth from
// ~/.codex/auth.json (NO OPENAI_API_KEY env var injected).
const CODEX_MODELS = [
  { provider: 'codex', id: 'codex-low', effort: 'low' },
  { provider: 'codex', id: 'codex-medium', effort: 'medium' },
  { provider: 'codex', id: 'codex-high', effort: 'high' },
  { provider: 'codex', id: 'codex-xhigh', effort: 'xhigh' },
]

// MiniMax — one model, no --model flag (ANTHROPIC_MODEL pins MiniMax-M3). Bearer
// auth via ANTHROPIC_AUTH_TOKEN=$MINIMAX_API_KEY against the MiniMax endpoint.
const MINIMAX_MODELS = [
  { provider: 'minimax', id: 'minimax-m3' },
]

// ----------------------------------------------------------------------------
// Local (omlx MLX) discovery — DYNAMIC, fetched live from the omlx server.
// Degrades gracefully: if OMLX_AUTH_TOKEN is unset or the server is down, we
// return [] with a note rather than crashing.
// ----------------------------------------------------------------------------
function discoverLocalModels() {
  const tok = process.env.OMLX_AUTH_TOKEN
  if (!tok) return { models: [], note: 'OMLX_AUTH_TOKEN unset — local discovery skipped (export in ~/.zshrc and relaunch)' }
  const r = spawnSync('curl', [
    '-s', '--max-time', '15',
    'http://127.0.0.1:8000/v1/models',
    '-H', `Authorization: Bearer ${tok}`,
  ], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) {
    return { models: [], note: `omlx server unreachable at 127.0.0.1:8000 (curl rc=${r.status}) — local discovery skipped` }
  }
  let ids = []
  try {
    const j = JSON.parse(r.stdout)
    ids = (j && Array.isArray(j.data) ? j.data : []).map(m => m && m.id).filter(Boolean)
  } catch {
    return { models: [], note: 'omlx /v1/models returned unparseable JSON — local discovery skipped' }
  }
  return {
    models: ids.map(id => ({ provider: 'local', id })),
    note: ids.length ? '' : 'omlx returned an empty model list',
  }
}

// ============================================================================
// Catalogue assembly + selection resolution.
// ============================================================================
const PROVIDERS = ['anthropic', 'glm', 'local', 'codex', 'minimax']

function buildCatalogue() {
  const local = discoverLocalModels()
  const all = [
    ...ANTHROPIC_MODELS,
    ...GLM_MODELS,
    ...local.models,
    ...CODEX_MODELS,
    ...MINIMAX_MODELS,
  ]
  return { all, localNote: local.note }
}

// Resolve the --models selection string into a de-duped ordered list of targets.
function resolveSelection(sel, catalogue) {
  const tokens = String(sel || 'all').split(',').map(s => s.trim()).filter(Boolean)
  const picked = []
  const seen = new Set()
  const warnings = []
  const add = t => { const k = `${t.provider}:${t.id}`; if (!seen.has(k)) { seen.add(k); picked.push(t) } }

  for (const tk of tokens) {
    const low = tk.toLowerCase()
    if (low === 'all') { catalogue.forEach(add); continue }
    if (PROVIDERS.includes(low)) {
      const hits = catalogue.filter(t => t.provider === low)
      if (!hits.length) warnings.push(`provider "${low}" has no callable models (e.g. local not discovered)`)
      hits.forEach(add)
      continue
    }
    if (tk.includes(':')) {
      const [p, ...rest] = tk.split(':')
      const id = rest.join(':')
      const prov = p.toLowerCase()
      const hit = catalogue.find(t => t.provider === prov && t.id === id)
      if (hit) add(hit)
      else warnings.push(`no match for "${tk}" (provider:${prov}, id:${id})`)
      continue
    }
    // bare id — match against any provider's id
    const hits = catalogue.filter(t => t.id === tk)
    if (hits.length) hits.forEach(add)
    else warnings.push(`no match for bare id "${tk}"`)
  }
  return { picked, warnings }
}

// ============================================================================
// Defensive token extraction for the claude-family `--output-format json`.
// That output is a JSON ARRAY of stream events; the final type:"result" element
// carries usage.output_tokens. We DO NOT do JSON.parse(stdout).usage — that is
// wrong for the real array output. We parse the array (or object), then walk
// the whole structure recursively and take the MAX output_tokens we can find,
// which lands on the cumulative final-result usage regardless of exact shape.
// ============================================================================
function maxOutputTokensDeep(node) {
  let best = 0
  const visit = n => {
    if (n == null) return
    if (Array.isArray(n)) { for (const e of n) visit(e); return }
    if (typeof n === 'object') {
      // usage.output_tokens (Anthropic) anywhere in the tree
      if (n.usage && typeof n.usage === 'object') {
        const ot = Number(n.usage.output_tokens)
        if (Number.isFinite(ot) && ot > best) best = ot
        // some shapes nest a server_tool_use / cache fields; output_tokens is the one we want
      }
      // a bare output_tokens sitting at this level
      const direct = Number(n.output_tokens)
      if (Number.isFinite(direct) && direct > best) best = direct
      for (const k of Object.keys(n)) visit(n[k])
    }
  }
  visit(node)
  return best
}

// Parse claude --output-format json stdout robustly. It is normally a JSON array,
// but be defensive: try whole-string parse first; if that fails, try to parse
// each line as a JSON object (stream-json fallback) and collect.
function parseClaudeJsonTokens(stdout) {
  if (!stdout || !stdout.trim()) return { tokens: 0, parsed: false }
  // 1) whole-string parse (the documented array shape)
  try {
    const j = JSON.parse(stdout)
    const t = maxOutputTokensDeep(j)
    if (t > 0) return { tokens: t, parsed: true }
    // parsed but no tokens found — fall through to line scan as a backstop
  } catch { /* not a single JSON value; try line-by-line */ }
  // 2) line-by-line (in case --verbose interleaved stream-json objects)
  let best = 0, anyParsed = false
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || (s[0] !== '{' && s[0] !== '[')) continue
    try { const o = JSON.parse(s); anyParsed = true; const t = maxOutputTokensDeep(o); if (t > best) best = t } catch { /* skip */ }
  }
  return { tokens: best, parsed: anyParsed }
}

// ============================================================================
// Per-call dispatch. Each returns { ok, secs, tokens, estimated, error }.
// All use the portable perl-alarm TERM->KILL timeout (macOS has no `timeout`),
// close stdin (</dev/null) so the nested CLI never stalls waiting on stdin.
// ============================================================================

// Wrap any command in the same perl alarm fork-exec TERM/KILL pattern the
// runner scripts use. Returns the argv for spawnSync('perl', ...).
function perlAlarmArgv(timeoutSecs, cmdArgv) {
  const PERL = `
    my $t = shift @ARGV;
    my $p = fork; if (!defined $p) { exit 127 }
    if ($p == 0) { exec @ARGV; exit 127 }
    $SIG{ALRM} = sub { kill "TERM", $p; sleep 3; kill "KILL", $p; exit 124 };
    alarm $t; waitpid($p, 0); exit($? >> 8);
  `
  return ['-e', PERL, String(timeoutSecs), ...cmdArgv]
}

// Run a claude-family call (anthropic/glm/minimax) and time JUST this call.
// env: the provider-specific ANTHROPIC_* env (auth, base url, default models).
// flagArgv: extra `claude` args (e.g. ['--model','opus']) — [] for minimax.
function runClaudeFamily({ env, flagArgv, timeoutSecs }) {
  const claudeArgs = [
    '-p', PROMPT,
    ...flagArgv,
    '--output-format', 'json',
    '--verbose',                 // ensure the result/usage event is emitted
    '--permission-mode', 'acceptEdits',
    '--allowedTools', '',        // pure generation: grant no tools
  ]
  const argv = perlAlarmArgv(timeoutSecs, ['claude', ...claudeArgs])
  const fullEnv = {
    ...process.env,
    ...env,
    // SOFT output cap for claude-family (no --max-tokens flag exists).
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
  }
  const t0 = Date.now()
  const r = spawnSync('perl', argv, {
    env: fullEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],      // stdin closed/ignored (no stall)
    maxBuffer: 64 * 1024 * 1024,
  })
  const secs = (Date.now() - t0) / 1000
  if (r.status === 124) return { ok: false, secs, tokens: 0, estimated: false, error: `timeout after ${timeoutSecs}s` }
  if (r.status !== 0) {
    const tail = ((r.stderr || '') + (r.stdout || '')).trim().slice(-300)
    return { ok: false, secs, tokens: 0, estimated: false, error: `claude exit ${r.status}: ${tail || 'no output'}` }
  }
  const { tokens, parsed } = parseClaudeJsonTokens(r.stdout)
  if (!parsed || tokens <= 0) {
    return { ok: false, secs, tokens: 0, estimated: false, error: 'could not extract usage.output_tokens from claude JSON output' }
  }
  return { ok: true, secs, tokens, estimated: false, error: '' }
}

// Anthropic — session's own auth; do NOT inject any ANTHROPIC_AUTH_TOKEN/base url.
function dispatchAnthropic(target, timeoutSecs) {
  return runClaudeFamily({ env: {}, flagArgv: ['--model', target.alias], timeoutSecs })
}

// GLM — z.ai endpoint, Bearer via ZAI_API_KEY, default-model env (mirrors glm-run.sh).
function dispatchGlm(target, timeoutSecs) {
  if (!process.env.ZAI_API_KEY) return { ok: false, secs: 0, tokens: 0, estimated: false, error: 'ZAI_API_KEY unset' }
  const env = {
    ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
    ANTHROPIC_AUTH_TOKEN: process.env.ZAI_API_KEY,           // Bearer (NOT x-api-key)
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2[1m]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air',
  }
  return runClaudeFamily({ env, flagArgv: ['--model', target.flag], timeoutSecs })
}

// MiniMax — MiniMax endpoint, Bearer via MINIMAX_API_KEY, ANTHROPIC_MODEL pins
// MiniMax-M3, no --model flag (mirrors minimax-run.sh).
function dispatchMinimax(_target, timeoutSecs) {
  if (!process.env.MINIMAX_API_KEY) return { ok: false, secs: 0, tokens: 0, estimated: false, error: 'MINIMAX_API_KEY unset' }
  const env = {
    ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
    ANTHROPIC_AUTH_TOKEN: process.env.MINIMAX_API_KEY,        // Bearer
    ANTHROPIC_MODEL: 'MiniMax-M3',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M3',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M3',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M3',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '512000',
    API_TIMEOUT_MS: '3000000',
  }
  return runClaudeFamily({ env, flagArgv: [], timeoutSecs })
}

// Local (omlx MLX) — call the OpenAI-shaped /v1/chat/completions endpoint
// DIRECTLY via curl so we get a clean usage.completion_tokens and a clean
// HTTP-only timing window (no `claude` agent overhead). Bearer via OMLX_AUTH_TOKEN.
function dispatchLocal(target, timeoutSecs) {
  const tok = process.env.OMLX_AUTH_TOKEN
  if (!tok) return { ok: false, secs: 0, tokens: 0, estimated: false, error: 'OMLX_AUTH_TOKEN unset' }
  const body = JSON.stringify({
    model: target.id,
    messages: [{ role: 'user', content: PROMPT }],
    max_tokens: MAX_OUTPUT_TOKENS,           // omlx honours a hard cap
    temperature: 0,
    stream: false,
  })
  const curlArgv = [
    '-s', '--max-time', String(timeoutSecs),
    'http://127.0.0.1:8000/v1/chat/completions',
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${tok}`,
    '-d', body,
  ]
  const t0 = Date.now()
  const r = spawnSync('curl', curlArgv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  const secs = (Date.now() - t0) / 1000
  if (r.status !== 0) return { ok: false, secs, tokens: 0, estimated: false, error: `curl exit ${r.status} (omlx unreachable/timeout)` }
  let j
  try { j = JSON.parse(r.stdout) } catch { return { ok: false, secs, tokens: 0, estimated: false, error: `omlx returned non-JSON: ${(r.stdout || '').trim().slice(0, 200)}` } }
  if (j && j.error) return { ok: false, secs, tokens: 0, estimated: false, error: `omlx error: ${typeof j.error === 'string' ? j.error : JSON.stringify(j.error).slice(0, 200)}` }
  const ct = Number(j && j.usage && j.usage.completion_tokens)
  if (!Number.isFinite(ct) || ct <= 0) {
    return { ok: false, secs, tokens: 0, estimated: false, error: 'omlx response missing usage.completion_tokens' }
  }
  return { ok: true, secs, tokens: ct, estimated: false, error: '' }
}

// Codex (gpt-5.5) — `codex exec`, auth from ~/.codex/auth.json (no env key). We
// request --json so we can read a token_count usage event if present; codex's
// token reporting is unreliable across versions, so if no usage is found we fall
// back to a chars/4 estimate of the captured final message (estimated:true) —
// the ONE legitimate estimation per the constraints.
function dispatchCodex(target, timeoutSecs) {
  // Pull the codex final message to its own file (clean capture), like codex-run.sh.
  const lastFile = resolve(RESULTS_DIR, `_codex_last_${target.id}.txt`)
  const codexArgs = [
    'exec',
    '-s', 'read-only',                       // benchmark only generates text; no writes needed
    '--skip-git-repo-check',
    '-c', 'approval_policy="never"',
    '-c', 'mcp_servers={}',
    '--json',                                // emit structured events (token usage if available)
    '-o', lastFile,
    '-m', 'gpt-5.5',
    '-c', `model_reasoning_effort=${target.effort}`,
    PROMPT,
  ]
  const argv = perlAlarmArgv(timeoutSecs, ['codex', ...codexArgs])
  const t0 = Date.now()
  const r = spawnSync('perl', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  const secs = (Date.now() - t0) / 1000
  if (r.status === 124) return { ok: false, secs, tokens: 0, estimated: false, error: `timeout after ${timeoutSecs}s` }
  const out = (r.stdout || '')
  // terminal model/auth/version failure -> fail closed (mirrors codex-run.sh guard)
  if (/requires a newer version of Codex|is not supported when using Codex with a|invalid_api_key|401 Unauthorized|403 Forbidden/i.test(out + (r.stderr || ''))) {
    return { ok: false, secs, tokens: 0, estimated: false, error: 'codex model/auth/version failure (see codex output)' }
  }
  if (r.status !== 0) {
    const tail = ((r.stderr || '') + out).trim().slice(-300)
    return { ok: false, secs, tokens: 0, estimated: false, error: `codex exit ${r.status}: ${tail || 'no output'}` }
  }
  // 1) try to find a REAL token count in the --json event stream.
  let realTokens = 0
  for (const line of out.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s[0] !== '{') continue
    try {
      const o = JSON.parse(s)
      const cand =
        (o && o.token_count && (o.token_count.output_tokens ?? o.token_count.total_tokens)) ??
        (o && o.usage && (o.usage.output_tokens ?? o.usage.completion_tokens)) ??
        (o && o.info && o.info.token_usage && (o.info.token_usage.output_tokens ?? o.info.token_usage.total_tokens))
      const n = Number(cand)
      if (Number.isFinite(n) && n > realTokens) realTokens = n
    } catch { /* skip */ }
  }
  if (realTokens > 0) return { ok: true, secs, tokens: realTokens, estimated: false, error: '' }
  // 2) FALLBACK (codex only): chars/4 estimate of the captured final message.
  let finalMsg = ''
  try { if (existsSync(lastFile)) finalMsg = require_readFileSync(lastFile) } catch { /* ignore */ }
  if (!finalMsg) {
    // last resort: scrape an "agent_message" / "item.completed" text from the json stream
    for (const line of out.split(/\r?\n/)) {
      const s = line.trim(); if (!s || s[0] !== '{') continue
      try { const o = JSON.parse(s); const txt = o?.msg?.message || o?.item?.text || o?.text; if (typeof txt === 'string' && txt.length > finalMsg.length) finalMsg = txt } catch { /* skip */ }
    }
  }
  if (!finalMsg.trim()) return { ok: false, secs, tokens: 0, estimated: false, error: 'codex produced no extractable final message or token count' }
  const est = Math.max(1, Math.round(finalMsg.length / 4))
  return { ok: true, secs, tokens: est, estimated: true, error: '' }
}

// tiny lazy fs read (kept out of the top imports to avoid an unused symbol if codex never runs)
function require_readFileSync(p) {
  // eslint-disable-next-line global-require
  const fs = require_node_fs()
  return fs.readFileSync(p, 'utf8')
}
let _fs
function require_node_fs() { if (!_fs) _fs = require_dynamic('node:fs'); return _fs }
function require_dynamic(mod) { /* eslint-disable no-undef */ return globalThis.__nodeRequire ? globalThis.__nodeRequire(mod) : importSyncFallback(mod) }
// In ESM there is no require; use createRequire.
import { createRequire as _createRequire } from 'node:module'
const _req = _createRequire(import.meta.url)
function importSyncFallback(mod) { return _req(mod) }

const DISPATCH = {
  anthropic: dispatchAnthropic,
  glm: dispatchGlm,
  local: dispatchLocal,
  codex: dispatchCodex,
  minimax: dispatchMinimax,
}

// ============================================================================
// Benchmark one target: COLD call, then immediate HOT call.
// Each tok/s is derived from THAT call's OWN token count and seconds (cold and
// hot do NOT generate the same number of output tokens, so we store both).
// ============================================================================
function benchOne(target, timeoutSecs) {
  const dispatch = DISPATCH[target.provider]
  const tSecs = target.provider === 'local'
    ? Math.max(timeoutSecs, LOCAL_TIMEOUT_SECS)   // local cold load can be slow
    : timeoutSecs

  const cold = dispatch(target, tSecs)
  // immediate HOT call (no sleep) — warm connection / resident weights
  const hot = cold.ok ? dispatch(target, tSecs) : { ok: false, secs: 0, tokens: 0, estimated: false, error: 'skipped (cold failed)' }

  const tps = c => (c.ok && c.secs > 0 && c.tokens > 0) ? (c.tokens / c.secs) : null
  const coldTps = tps(cold)
  const hotTps = tps(hot)
  const ok = !!(cold.ok && hot.ok)
  const errParts = []
  if (!cold.ok) errParts.push(`cold: ${cold.error}`)
  if (!hot.ok) errParts.push(`hot: ${hot.error}`)

  return {
    provider: target.provider,
    model: target.id,
    ok,
    cold_tok_s: coldTps != null ? round2(coldTps) : null,
    hot_tok_s: hotTps != null ? round2(hotTps) : null,
    delta_tok_s: (coldTps != null && hotTps != null) ? round2(hotTps - coldTps) : null,
    cold_tokens: cold.tokens || 0,
    hot_tokens: hot.tokens || 0,
    cold_secs: round2(cold.secs || 0),
    hot_secs: round2(hot.secs || 0),
    estimated: !!(cold.estimated || hot.estimated),   // true only for codex chars/4 fallback
    timestamp: localIso(),
    error: errParts.join(' | '),
  }
}

function round2(n) { return Math.round(n * 100) / 100 }

// Local-tz ISO-8601 with offset (e.g. 2026-06-15T11:55:28-07:00).
function localIso(d = new Date()) {
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

// ============================================================================
// Persistence — append-only JSONL, one record per model, written IMMEDIATELY
// after each model finishes (crash-survival: a sweep that dies mid-run keeps
// every record produced so far).
// ============================================================================
function appendRecord(rec) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  appendFileSync(RESULTS_FILE, JSON.stringify(rec) + '\n', 'utf8')
}

// ============================================================================
// Readable end-of-run summary table.
// ============================================================================
function printTable(records) {
  const cols = [
    ['PROVIDER', r => r.provider],
    ['MODEL', r => r.model],
    ['COLD t/s', r => r.cold_tok_s == null ? '-' : String(r.cold_tok_s)],
    ['HOT t/s', r => r.hot_tok_s == null ? '-' : String(r.hot_tok_s)],
    ['Δ t/s', r => r.delta_tok_s == null ? '-' : (r.delta_tok_s >= 0 ? '+' : '') + r.delta_tok_s],
    ['cTok', r => String(r.cold_tokens)],
    ['hTok', r => String(r.hot_tokens)],
    ['cSec', r => String(r.cold_secs)],
    ['hSec', r => String(r.hot_secs)],
    ['STATUS', r => r.ok ? (r.estimated ? 'OK*' : 'OK') : 'FAIL'],
  ]
  const widths = cols.map(([h, f]) => Math.max(h.length, ...records.map(r => f(r).length), 1))
  const fmtRow = cells => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  const sep = widths.map(w => '-'.repeat(w)).join('  ')
  console.log('')
  console.log(fmtRow(cols.map(c => c[0])))
  console.log(sep)
  for (const r of records) console.log(fmtRow(cols.map(c => c[1](r))))
  console.log(sep)
  // per-row error detail
  const failed = records.filter(r => !r.ok)
  if (failed.length) {
    console.log('\nFailures:')
    for (const r of failed) console.log(`  ${r.provider}:${r.model} — ${r.error}`)
  }
  if (records.some(r => r.estimated)) {
    console.log('\n* token count for this row is an estimate (codex chars/4 fallback — no machine-readable usage).')
  }
}

// ============================================================================
// Main.
// ============================================================================
function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(USAGE); return }

  const baseTimeout = Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : DEFAULT_TIMEOUT_SECS

  const { all, localNote } = buildCatalogue()
  if (localNote) console.error(`[local discovery] ${localNote}`)

  const { picked, warnings } = resolveSelection(args.models, all)
  for (const w of warnings) console.error(`[selection] ${w}`)

  if (!picked.length) {
    console.error('No models selected. Use --models all or see --help for the selection grammar.')
    process.exit(2)
  }

  if (args.list) {
    console.log(`Would benchmark ${picked.length} model(s) (cold + hot each):\n`)
    for (const t of picked) console.log(`  ${t.provider}:${t.id}`)
    console.log(`\nPer-call timeout: ${baseTimeout}s (local: ${Math.max(baseTimeout, LOCAL_TIMEOUT_SECS)}s)`)
    console.log(`Results would append to: ${RESULTS_FILE}`)
    if (localNote) console.log(`\nNote: ${localNote}`)
    return
  }

  console.error(`fl-bench: benchmarking ${picked.length} model(s); cold+hot each; prompt cap ~${MAX_OUTPUT_TOKENS} tokens.`)
  console.error(`Results -> ${RESULTS_FILE}\n`)

  const records = []
  for (let i = 0; i < picked.length; i++) {
    const t = picked[i]
    process.stderr.write(`[${i + 1}/${picked.length}] ${t.provider}:${t.id} ... `)
    let rec
    try {
      rec = benchOne(t, baseTimeout)
    } catch (e) {
      // honest failure: record + continue
      rec = {
        provider: t.provider, model: t.id, ok: false,
        cold_tok_s: null, hot_tok_s: null, delta_tok_s: null,
        cold_tokens: 0, hot_tokens: 0, cold_secs: 0, hot_secs: 0,
        estimated: false, timestamp: localIso(),
        error: `harness exception: ${String(e && e.message || e).slice(0, 200)}`,
      }
    }
    appendRecord(rec)   // IMMEDIATE append (crash-survival)
    records.push(rec)
    process.stderr.write(
      rec.ok
        ? `OK  cold ${rec.cold_tok_s} t/s, hot ${rec.hot_tok_s} t/s (Δ ${rec.delta_tok_s})${rec.estimated ? ' *est' : ''}\n`
        : `FAIL (${rec.error})\n`
    )
  }

  printTable(records)
  const okCount = records.filter(r => r.ok).length
  console.log(`\n${okCount}/${records.length} models benchmarked successfully. Full history: ${RESULTS_FILE}`)
}

main()
