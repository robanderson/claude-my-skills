export const meta = {
  name: 'Farnsworth Loop',
  description: 'A refined, multi-model best-of-N refinement loop: N parallel attempts judged blind by Anthropic Opus; two-pass adds a guided round and a final rank.',
  phases: [
    { title: 'Round 1' },
    { title: 'Review' },
    { title: 'Round 2' },
    { title: 'Final rank' },
  ],
}

// args = {
//   task: string,
//   mode: 'single' | 'two',
//   runDir: string,                       // absolute base dir for workspaces
//   glmRunner / localRunner / codexRunner: string,  // bundled runner-script paths (per provider used)
//   codexTimeoutSecs: number,             // optional wall-clock backstop for codex (default 600)
//   attempts: [ {                         // one per attempt, length N
//      label: 'candidate-1',
//      dispatch: 'anthropic' | 'glm' | 'local' | 'codex',
//      model: 'haiku'|'sonnet'|'opus',    // when dispatch=anthropic (or the exact local/codex model id)
//      agentType: 'farnsworth-glm-5-2',   // when dispatch=glm/local/codex (the worker agent)
//      displayModel: 'glm-5.2',           // for the report (kept private from judges); codex: 'codex-high'
//      r1nudge: string,
//      r2nudge: string,
//   } ]
// }
// args may arrive as a real object or as a JSON-encoded string depending on the caller; normalise.
const A = (typeof args === 'string') ? JSON.parse(args) : (args || {})
const { task, mode, runDir, attempts } = A
if (!Array.isArray(attempts) || attempts.length === 0) {
  return { error: 'no attempts provided', argsType: typeof args, keys: Object.keys(A || {}) }
}
const LABELS = 'ABCDEFGHIJKLMNOP'.split('')

function brief(nudge, ws, guidance, ctx) {
  let g = ''
  if (guidance) {
    const pos = (guidance.positives || []).map(p => `- ${p}`).join('\n')
    const ch = (guidance.challenges || []).map(c => `- ${c}`).join('\n')
    g = `\nIn producing your answer, please consider these items as possible positives:\n${pos}\nAnd treat these items as challenges to avoid:\n${ch}\n`
  }
  const ctxLine = ctx
    ? `\nShared context for this task has ALREADY been gathered for you in one file: ${ctx}\nRead that single file at the start — it contains the source material you need. Do NOT re-read the underlying source files one by one (that work is already done).\n`
    : ''
  return `You are solving a self-contained task. Produce ONE complete solution in a single focused pass.

Task:
${task}
${g}${ctxLine}
${nudge}

Rules:
- This task is fully specified and self-contained. Do NOT ask clarifying questions, present options, or stop for input — make reasonable default choices and just produce your solution.
- Work in a SINGLE pass and then STOP: write your solution file ONCE, then stop immediately. Do NOT run it, do NOT test or inspect it, and do NOT rewrite, re-align, "improve", or polish it. Your first version is final — even if it is imperfect or not to your taste. Perfecting it is explicitly NOT wanted here and only wastes effort.
- Your text reply is discarded; ONLY the file(s) you save are kept. You MUST save your solution to a file (an empty workspace is a total failure) — but it does NOT need to be flawless or fully working.
- Save all deliverable files to: ${ws}
- Work only in that directory. Create it if needed.
- To save a file, just write it. If a file-edit tool refuses because the file "must be read first" (a stale copy exists), do NOT spend turns reading/retrying — overwrite it directly with the shell instead, e.g. \`cat > FILE <<'EOF' ... EOF\`.
- End with a 2 to 4 sentence note on your approach, plus any tradeoffs or known limitations (an honest note about what is rough or unfinished is useful, not a mark against you).`
}

// GLM display model -> the `claude` --model flag that selects it on the z.ai endpoint.
const GLM_FLAG = {
  'glm-5.2': '--model opus',
  'glm-5.1': '--model glm-5.1',
  'glm-4.7': '--model sonnet',
  'glm-4.5-air': '--model haiku',
}
// Codex display model -> the `codex exec` flags selecting it. Codex is pinned to gpt-5.5 (the only
// model the local ChatGPT-account auth serves; other ids need an OPENAI_API_KEY). The selectable axis
// is the REASONING EFFORT — codex's real quality lever — set via the model_reasoning_effort config
// override. Verified-accepted tokens on gpt-5.5: low|medium|high|xhigh ("xhigh" == the UI's "Extra
// high"; "minimal" is rejected). The runner pins -m so it never falls back to config.toml's default.
const CODEX_FLAG = {
  'codex-low': '-m gpt-5.5 -c model_reasoning_effort=low',
  'codex-medium': '-m gpt-5.5 -c model_reasoning_effort=medium',
  'codex-high': '-m gpt-5.5 -c model_reasoning_effort=high',
  'codex-xhigh': '-m gpt-5.5 -c model_reasoning_effort=xhigh',
}
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'" // single-quote shell-escape

// Runner paths for the non-Anthropic providers (passed in via args). Each provider's
// real (nested-Claude) call lives in a bundled script, so the wrapper agent only ever
// sees a benign `bash <runner> <flag>` command — nothing to refuse, shortcut, or
// self-substitute. GLM has an inline fallback; local always uses its runner.
const glmRunner = A.glmRunner
const localRunner = A.localRunner
const codexRunner = A.codexRunner
const minimaxRunner = A.minimaxRunner
// Per-attempt guards for GLM/local runners (enforced inside the runner scripts):
//  - max-turns: PRIMARY guard — caps agentic iterations so single-pass attempts can't
//    grind the write->run->fix loop (which balloons context, esp. on local models).
//  - timeout: wall-clock backstop for a single hung/slow turn.
// GLM gets a roomier cap; local models run a tighter cap because they tend to ignore
// "single pass" and burn turns on a verify-and-polish loop (observed on Qwen).
const glmMaxTurns = Number(A.attemptMaxTurns) > 0 ? Math.floor(Number(A.attemptMaxTurns)) : 30
const localMaxTurns = Number(A.localMaxTurns) > 0 ? Math.floor(Number(A.localMaxTurns)) : 20
// MiniMax exposes one model (MiniMax-M3); its runner reuses the GLM-style guards (default to glmMaxTurns).
const minimaxMaxTurns = Number(A.minimaxMaxTurns) > 0 ? Math.floor(Number(A.minimaxMaxTurns)) : glmMaxTurns
const attemptTimeout = Number(A.attemptTimeoutSecs) > 0 ? Math.floor(Number(A.attemptTimeoutSecs)) : 300
// GLM via z.ai is slow on heavy multi-file builds — give it its OWN wall-clock (usually larger),
// independent of local/minimax, so one long GLM leg doesn't force everyone's timeout up. For code-build
// tournaments pass glmTimeoutSecs ~1800-2400. Defaults to attemptTimeout when unset (backward-compatible).
const glmTimeoutSecs = Number(A.glmTimeoutSecs) > 0 ? Math.floor(Number(A.glmTimeoutSecs)) : attemptTimeout
// Codex exec is agentic with NO turn cap (no --max-turns flag), so the wall-clock timeout is its ONLY
// per-attempt backstop and gets its own, roomier default. Override via args.codexTimeoutSecs.
const codexTimeout = Number(A.codexTimeoutSecs) > 0 ? Math.floor(Number(A.codexTimeoutSecs)) : 600
const cmdHead = (ws, b) => `mkdir -p ${q(ws)} && cd ${q(ws)} && printf '%s' ${q(b)} > _brief.txt`
const runnerCmd = (runner, flag, ws, b, maxTurns, timeout = attemptTimeout) => `${cmdHead(ws, b)} && FL_MAX_TURNS=${maxTurns} FL_TIMEOUT_SECS=${timeout} bash ${q(runner)} ${flag}`
// Codex reuses cmdHead + the runner but overrides the wall-clock with codexTimeout (no FL_MAX_TURNS:
// codex has no turn cap, and codex-run.sh ignores it).
const codexRunnerCmd = (runner, flag, ws, b) => `${cmdHead(ws, b)} && FL_TIMEOUT_SECS=${codexTimeout} bash ${q(runner)} ${flag}`

// Optional shared CONTEXT BUNDLE for known-input tasks (args.contextFiles = [paths/globs]).
// Concatenate those files ONCE into a single file that every worker reads by path — instead of
// each attempt re-reading the same source files (which dominated tool-use/latency in practice).
// The bundle lives OUTSIDE any candidate workspace (in ${runDir}/_context/), and staging only ever
// copies a candidate's own workspace into its review dir, so the bundle is never exposed to the blind
// judge. No bundle is built when contextFiles is empty.
const contextFiles = Array.isArray(A.contextFiles) ? A.contextFiles.filter(Boolean) : []
const contextPath = contextFiles.length ? `${runDir}/_context/_context.md` : null
async function buildContext() {
  if (!contextPath) return
  const cat = contextFiles.map(f => `echo "===== ${f} ====="; cat ${q(f)} 2>/dev/null || echo "(unreadable: ${f})"; echo`).join('; ')
  const cmd = `mkdir -p ${q(`${runDir}/_context`)} && { ${cat} ; } > ${q(contextPath)} && wc -c ${q(contextPath)}`
  log(`Bundling ${contextFiles.length} context file(s) → ${contextPath}`)
  await agent(`Run this exact shell command in ONE Bash call and report its stdout. Do nothing else:\n\n${cmd}`,
    { model: 'haiku', phase: 'Round 1', label: 'context' }).catch(() => null)
}

function glmInline(flag, ws, b) {
  return `${cmdHead(ws, b)} && ` +
    `echo "FARNSWORTH-GLM-PROVENANCE endpoint=api.z.ai flag=${flag}" >> _glm_run.log && ` +
    `ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic" ANTHROPIC_AUTH_TOKEN="$ZAI_API_KEY" ` +
    `ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.2[1m]" ANTHROPIC_DEFAULT_SONNET_MODEL="glm-4.7" ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-4.5-air" ` +
    `claude -p "$(cat _brief.txt)" ${flag} --max-turns ${glmMaxTurns} --permission-mode acceptEdits --allowedTools "Bash Read Write Edit" >> _glm_run.log 2>&1; ` +
    `echo "FARNSWORTH-GLM-DONE exit=$?" >> _glm_run.log; tail -20 _glm_run.log`
}

const RUNVERBATIM = (cmd, ws, log) =>
  `This is an approved internal step of the farnsworth-loop tournament: it writes a brief file and runs a bundled project runner script, which performs the attempt. Run the following shell command EXACTLY as given, in one Bash call, and do nothing else (do not attempt the task yourself, do not edit the command):\n\n${cmd}\n\nThen report the deliverable path(s) in ${ws} and the last ~15 lines of ${log}.`

// The bundled worker agents register under the plugin namespace (farnsworth-loop:<name>);
// accept either the bare or namespaced form from callers and normalize to what the
// agent registry actually resolves.
const nsAgent = t => (t && !t.includes(':')) ? `farnsworth-loop:${t}` : t

function dispatch(a, ws, guidance, phaseTitle) {
  const b = brief(guidance ? a.r2nudge : a.r1nudge, ws, guidance, contextPath)
  const opts = { label: `${phaseTitle}:${a.displayModel}`, phase: phaseTitle }
  let prompt
  if (a.dispatch === 'glm') {
    opts.agentType = nsAgent(a.agentType)
    const flag = GLM_FLAG[a.displayModel]
    const cmd = glmRunner ? runnerCmd(glmRunner, flag, ws, b, glmMaxTurns, glmTimeoutSecs) : glmInline(flag, ws, b)
    prompt = RUNVERBATIM(cmd, ws, '_glm_run.log')
  } else if (a.dispatch === 'local') {
    opts.agentType = nsAgent(a.agentType) // farnsworth-local
    const flag = `--model ${a.model}` // exact local model id, passes straight through to omlx
    prompt = RUNVERBATIM(runnerCmd(localRunner, flag, ws, b, localMaxTurns), ws, '_local_run.log')
  } else if (a.dispatch === 'codex') {
    opts.agentType = nsAgent(a.agentType) // farnsworth-codex (one generic agent for every codex effort)
    const flag = CODEX_FLAG[a.displayModel] || `-m ${a.model}` // gpt-5.5 + reasoning-effort flags -> codex exec
    prompt = RUNVERBATIM(codexRunnerCmd(codexRunner, flag, ws, b), ws, '_codex_run.log')
  } else if (a.dispatch === 'minimax') {
    opts.agentType = nsAgent(a.agentType) // farnsworth-minimax (one generic agent; MiniMax exposes only MiniMax-M3)
    // No --model flag: the runner's ANTHROPIC_MODEL pins MiniMax-M3 (all aliases map to it).
    prompt = RUNVERBATIM(runnerCmd(minimaxRunner, '', ws, b, minimaxMaxTurns), ws, '_minimax_run.log')
  } else {
    // Native Anthropic attempt. NOTE: the workflow agent() primitive exposes no turn/time cap,
    // so (unlike GLM/local) these are bounded only by the single-pass brief. If a future agent()
    // gains a maxTurns option, pass an Anthropic-equivalent cap here for symmetry.
    opts.model = a.model
    prompt = b
  }
  return agent(prompt, opts)
    .then(res => ({ label: a.label, displayModel: a.displayModel, dispatch: a.dispatch || 'anthropic', ws, res }))
    .catch(e => { log(`attempt ${a.label} (${a.displayModel}) errored: ${String(e).slice(0, 100)}`); return null }) // don't swallow silently
}

function judgePrompt(kind, blindList, guidanceWanted, poolPath) {
  const dirs = blindList.map(c => `  Candidate ${c.blind}: ${c.ws}/`).join('\n')
  const guidanceBlock = guidanceWanted
    ? `\n\nAlso distil GUIDANCE for a second round of fresh attempts. Two short generic lists, NO candidate-specific code:\n- positives: patterns/choices that worked anywhere this round.\n- challenges: pitfalls/weaknesses/constraint-violations seen anywhere this round.`
    : ''
  return `You are a blind ${kind}. You do NOT know which model produced which candidate; do not speculate. Judge only the work in front of you.

Task that every candidate was given:
${task}

All candidate deliverables are concatenated, blind-labelled, in ONE file — read it ONCE (each candidate's section is headed "===== Candidate <letter> ====="):
${poolPath}

If (and only if) a candidate is runnable code you want to execute to judge the real output, its individual files are in its own directory (run with a sensible timeout):
${dirs}
Judge the real output / artifact — not any self-summary. Do not read any other files.

Score each candidate against criteria suited to the task (for code: correctness, meets stated constraints, completeness, edge cases, readability; adapt for non-code). Score against the task's STATED runtime, not an environment you cannot see: treat reliance on a capability the task did not establish is available as a risk, and treat an unfamiliar mechanism that honours the stated constraints as correct unless you can name a concrete way it fails — never reward a familiar-looking API over a constraint-honouring one on idiom alone. Give concrete, specific pros and cons per candidate. Rank them all. Name the single winner with reasoning.${guidanceBlock}

Return the structured object: per-candidate pros/cons, the full ranking (best first, by candidate letter), the winner letter${guidanceWanted ? ', and the guidance lists' : ''}.`
}

const CANDS = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', description: 'candidate letter' },
      pros: { type: 'array', items: { type: 'string' } },
      cons: { type: 'array', items: { type: 'string' } },
    },
    required: ['label', 'pros', 'cons'],
  },
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    candidates: CANDS,
    ranking: { type: 'array', items: { type: 'string' } },
    winner: { type: 'string' },
    reasoning: { type: 'string' },
    guidance: {
      type: 'object', additionalProperties: false,
      properties: {
        positives: { type: 'array', items: { type: 'string' } },
        challenges: { type: 'array', items: { type: 'string' } },
      },
      required: ['positives', 'challenges'],
    },
  },
  required: ['candidates', 'ranking', 'winner', 'reasoning', 'guidance'],
}
const RANK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    candidates: CANDS,
    ranking: { type: 'array', items: { type: 'string' } },
    winner: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['candidates', 'ranking', 'winner', 'reasoning'],
}

// ---- helpers ----
const STAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { blind: { type: 'string' }, deliverable: { type: 'boolean' }, provenance: { type: 'boolean' } },
        required: ['blind', 'deliverable', 'provenance'],
      },
    },
  },
  required: ['results'],
}

// D-0004 FIX — PURE, drift-proof provenance-gate builder.
// Emits the shell snippet that sets P (the provenance flag the `D>0 && P==1` pool gate reads).
//   - log:        the engine log filename for this dispatch ('' for native Anthropic) — selects the path.
//   - tok:        the provider provenance token (GLM/LOCAL/CODEX/MINIMAX), '' for native.
//   - lp:         the SHELL-ESCAPED path to the log file (q(`${ws}/${log}`)).
//   - carriedOver: true ONLY for the two-pass round-1 winner re-staged into the final pool.
//
// Decision (the single behavioural delta of this fix):
//   * native (no log)                -> `P=1` (UNCHANGED; native has no provenance contract).
//   * carried-over runner candidate  -> `P=1` (NEW; it ALREADY passed provenance in round 1, but its
//                                       engine log was stripped during round-1 staging, so re-grepping a
//                                       deliberately-stripped dir always yields P=0 — the D-0004 bug).
//   * normal runner candidate (log)  -> the line-anchored success-contract grep (UNCHANGED, byte-for-byte).
// The deliverable (`D>0`) requirement is NOT in here — it is enforced separately at the gate, so a
// carried-over candidate with an EMPTY staged dir is still excluded.
function provCheckShell(log, tok, lp, carriedOver) {
  if (!log) return `P=1`              // native Anthropic: no provenance log, unchanged
  if (carriedOver) return `P=1`       // already validated in round 1; do NOT re-grep the stripped dir
  return `if [ -f ${lp} ]; then if grep -q '^FARNSWORTH-${tok}-PROVENANCE endpoint=' ${lp} && grep -q '^FARNSWORTH-${tok}-DONE exit=0' ${lp} && ! grep -q '^FARNSWORTH-${tok}-\\(TIMEOUT\\|ERROR\\)' ${lp}; then P=1; else P=0; fi; else P=0; fi`
}

// Persist-verification schema: the write-agent reports, per FINAL target path, the byte count
// (`wc -c`) of the file it wrote — NOT free text. We decide success from `bytes > 0` per path, so a
// silently-skipped write (no file → reported as bytes:0/absent) can never read as success (#D-0002).
const PERSIST_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string' }, bytes: { type: 'integer' } },
        required: ['path', 'bytes'],
      },
    },
  },
  required: ['results'],
}

// Stage + validate + pool, all from one cheap haiku agent running a DETERMINISTIC shell script:
//  - stage deliverables into a clean per-blind dir (copy all, then delete the known engine files by
//    exact name — an allowlist, so a legit `_`-prefixed deliverable like `_config.yml` is NOT dropped) (#6);
//  - check a deliverable was saved AND (glm/local) the SUCCESS provenance contract holds — PROVENANCE
//    marker + DONE exit=0 + no TIMEOUT/ERROR (#2);
//  - concatenate the valid deliverables into ONE blind-labelled pool file the judge reads once (read-cost).
// The agent returns per-candidate {deliverable, provenance} via a SCHEMA (not scraped prose) (#4), and we
// FAIL CLOSED (#1): any candidate missing from the return, or not deliverable+provenance, is invalid.
async function stageAndValidate(list, reviewDir, phaseTitle) {
  const pool = `${reviewDir}/_pool.md`
  const script = [`mkdir -p ${q(reviewDir)}; : > ${q(pool)}`].concat(list.map(c => {
    const dest = `${reviewDir}/${c.blind}`
    const log = c.dispatch === 'glm' ? '_glm_run.log'
              : c.dispatch === 'local' ? '_local_run.log'
              : c.dispatch === 'codex' ? '_codex_run.log'
              : c.dispatch === 'minimax' ? '_minimax_run.log'
              : ''
    const lp = log ? q(`${c.ws}/${log}`) : ''
    // Provider-specific, LINE-ANCHORED marker token. Runners write their FARNSWORTH-<PROV>-* markers at
    // column 0, so matching '^FARNSWORTH-<PROV>-' (not the greedy 'FARNSWORTH-.*-') stops an attempt whose
    // OWN deliverable/transcript merely MENTIONS a marker — e.g. a proposal discussing FARNSWORTH-CODEX-ERROR,
    // echoed mid-line into its log — from false-tripping its own validation. That self-referential
    // false-negative was real: it invalidated two genuinely-successful GLM proposals about this very feature.
    // FAIL CLOSED (#2): the PROVENANCE line is written UNCONDITIONALLY at runner startup, so a missing log
    // here means the runner never ran (native-solve spoof / refusal) → P=0. Native attempts (no runner) → P=1.
    const tok = c.dispatch === 'glm' ? 'GLM' : c.dispatch === 'local' ? 'LOCAL' : c.dispatch === 'codex' ? 'CODEX' : c.dispatch === 'minimax' ? 'MINIMAX' : ''
    // D-0004: a carried-over round-1 winner was ALREADY provenance-validated in round 1, but its engine log
    // was stripped during round-1 staging — so re-grepping its stripped staging dir always yields P=0 and the
    // winner is wrongly dropped. provCheckShell skips ONLY the provenance grep for a carryover (P=1); the
    // deliverable requirement below (`D>0`) is still enforced, so an empty carryover is still excluded.
    const provChk = provCheckShell(log, tok, lp, !!c.carriedOver)
    return `mkdir -p ${q(dest)}; cp -R ${q(c.ws)}/. ${q(dest)}/ 2>/dev/null; ` +
           `rm -f ${q(dest)}/_brief.txt ${q(dest)}/_glm_run.log ${q(dest)}/_local_run.log ${q(dest)}/_codex_run.log ${q(dest)}/_codex_last.txt ${q(dest)}/_minimax_run.log; ` +
           `D=$(find ${q(dest)} -type f 2>/dev/null | grep -c .); ${provChk}; ` +
           `if [ "$D" -gt 0 ] && [ "$P" -eq 1 ]; then { echo "===== Candidate ${c.blind} ====="; cat ${q(dest)}/* 2>/dev/null; echo; } >> ${q(pool)}; fi; ` +
           `echo "FLV ${c.blind} d=$([ "$D" -gt 0 ] && echo 1 || echo 0) p=$P"`
  })).join('\n')
  const res = await agent(
    `Run this exact shell script in ONE Bash call. It prints one line per candidate of the form "FLV <letter> d=<0|1> p=<0|1>". Then return the structured results: for EACH printed FLV line, an entry {blind: the letter, deliverable: (d==1), provenance: (p==1)}. Report exactly what the script printed — do not infer or change values.\n\n${script}`,
    { model: 'haiku', schema: STAGE_SCHEMA, phase: phaseTitle, label: 'stage' }
  ).catch(() => null)
  const v = {}
  for (const r of (res && Array.isArray(res.results) ? res.results : [])) v[String(r.blind).trim()] = r
  return list.map(c => {
    const r = v[c.blind]                           // FAIL CLOSED: missing/unparsed → invalid
    const valid = !!(r && r.deliverable && r.provenance)
    const failReason = valid ? '' : (!r ? 'staging result missing (failed closed)' : (!r.deliverable ? 'no deliverable saved' : 'provenance check failed (timeout/error/empty)'))
    return { ...c, ws: `${reviewDir}/${c.blind}`, valid, failReason }
  })
}

// #6 + #7: never silently carry the wrong artifact or trust an off-spec ranking — normalize the
// judge's winner/ranking against the REAL candidate labels and repair to a full permutation.
function reconcile(result, labels) {
  // Null-guard: agent() returns null if the judge dies on a terminal API error (or is skipped). Surface
  // that as a clear, catchable error instead of a cryptic "null is not an object" — judge() retries once
  // then degrades to a clean __failed partial result rather than crashing the (fully-paid) run.
  if (!result || typeof result !== 'object') throw new Error('judge returned no structured result (null)')
  const set = new Set(labels)
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').charAt(0)
  let ranking = [...new Set((result.ranking || []).map(norm).filter(x => set.has(x)))]
  for (const l of labels) if (!ranking.includes(l)) ranking.push(l)
  let winner = norm(result.winner)
  if (!set.has(winner)) { winner = ranking[0]; log(`judge winner "${result.winner}" did not match a candidate; using top of ranking (${winner})`) }
  return { ...result, winner, ranking }
}

// rotate to decorrelate the blind letter from dispatch order
const blindLabel = (list, rot) => list.map((_, i) => list[(i + rot) % list.length]).map((c, i) => ({ ...c, blind: LABELS[i] }))

// #3: an Opus judge runs AFTER the maximum spend, so never let one judge error crash the whole paid
// run — retry once, then return a failure marker the caller turns into a partial, inspectable result.
async function judge(kind, blindList, guidanceWanted, poolPath, schema, phaseTitle, label) {
  const prompt = judgePrompt(kind, blindList, guidanceWanted, poolPath)
  for (let i = 1; i <= 2; i++) {
    try {
      return reconcile(await agent(prompt, { model: 'opus', schema, phase: phaseTitle, label }), blindList.map(c => c.blind))
    } catch (e) {
      log(`${label} judge attempt ${i}/2 failed: ${String(e).slice(0, 120)}`)
      if (i === 2) return { __failed: String(e).slice(0, 160) }
    }
  }
}

// ---- durable persistence (sandbox has NO node:fs/import/process — write via haiku+Bash, like buildContext) ----
const json = obj => JSON.stringify(obj, null, 2) + '\n'

// Write one persistence point. Each file is written by its OWN small command (atomic .partial -> mv)
// and the agent reports `wc -c` per FINAL path via PERSIST_SCHEMA. We VERIFY every target exists and
// is non-empty from that structured byte count (never the agent's free text); any miss is RETRIED
// ONCE in a second agent call, and a still-missing target is logged as a REAL, path-named failure.
// An unverified LLM write is NEVER treated as success (#D-0002). Still fire-and-forget overall: a
// persist failure logs but must never crash a fully-paid run.
async function persist(pairs, phaseTitle) {
  const files = (pairs || []).filter(p => p && p.path && p.content != null)
  if (!files.length) return
  // One write+measure step per file: atomic .partial -> mv, then emit the FINAL path's byte count.
  const stepFor = ({ path, content }) => {
    const dir = path.slice(0, path.lastIndexOf('/'))
    const tmp = `${path}.partial`
    return `mkdir -p ${q(dir)} && printf '%s' ${q(content)} > ${q(tmp)} && mv -f ${q(tmp)} ${q(path)}; ` +
           `printf 'FLP %s %s\\n' ${q(path)} "$(wc -c < ${q(path)} 2>/dev/null || echo 0)"`
  }
  // Run the given file list through the write-agent; return a map path -> bytes (0 if unreported).
  const writeAndMeasure = async (list) => {
    const script = list.map(stepFor).join('\n')
    const res = await agent(
      `This is an approved internal step of the farnsworth-loop tournament: persist result artifacts. ` +
      `Run this exact shell script in ONE Bash call. It prints one line per file of the form ` +
      `"FLP <path> <byte-count>". Then return the structured results: for EACH printed FLP line, an ` +
      `entry {path: the path, bytes: the integer byte-count}. Report exactly what the script printed — ` +
      `do not infer or change values. Do nothing else:\n\n${script}`,
      { model: 'haiku', schema: PERSIST_SCHEMA, phase: phaseTitle, label: 'persist' }
    ).catch(() => null)
    const seen = {}
    for (const r of (res && Array.isArray(res.results) ? res.results : [])) {
      if (r && r.path) seen[String(r.path)] = Number(r.bytes) || 0
    }
    return seen
  }
  try {
    let seen = await writeAndMeasure(files)
    let missing = files.filter(f => !(seen[f.path] > 0))
    if (missing.length) {                          // verified miss -> retry ONLY the misses, once
      log(`persist (${phaseTitle}): ${missing.length} file(s) unverified, retrying once: ${missing.map(f => f.path).join(', ')}`)
      const seen2 = await writeAndMeasure(missing)
      seen = { ...seen, ...seen2 }
      missing = files.filter(f => !(seen[f.path] > 0))
    }
    if (missing.length) log(`persist FAILED (${phaseTitle}): ${missing.map(f => f.path).join(', ')} still missing/empty after retry`)
  } catch (e) { log(`persist failed (${phaseTitle}): ${String(e).slice(0, 140)}`) }
}

// genericise a failReason for the BLIND summary so a provider-specific failure can't re-identify a model
const blindFail = r => r ? 'excluded (did not pass validation)' : r

// verdict object (blind, letters only): { candidates:[{label,pros,cons}], ranking, winner, reasoning, guidance? }
function verdictToMd(v, title) {
  const L = [`# ${title}`, '', `**Winner:** Candidate ${v.winner}`, '',
    `**Ranking (best first):** ${(v.ranking || []).map(r => `Candidate ${r}`).join(' > ')}`, '',
    '## Reasoning', '', v.reasoning || '_(none given)_', '', '## Per-candidate', '']
  for (const c of (v.candidates || [])) {
    L.push(`### Candidate ${c.label}`, '', '**Pros**')
    for (const p of (c.pros || [])) L.push(`- ${p}`)
    if (!(c.pros || []).length) L.push('- _(none)_')
    L.push('', '**Cons**')
    for (const x of (c.cons || [])) L.push(`- ${x}`)
    if (!(c.cons || []).length) L.push('- _(none)_')
    L.push('')
  }
  return L.join('\n') + '\n'
}

function guidanceToMd(g) {
  const pos = (g && g.positives) || []
  const ch = (g && g.challenges) || []
  const L = ['# Round-1 guidance (used to steer round 2)', '', '## Positives to emulate']
  for (const p of pos) L.push(`- ${p}`)
  if (!pos.length) L.push('- _(none)_')
  L.push('', '## Challenges to avoid')
  for (const c of ch) L.push(`- ${c}`)
  if (!ch.length) L.push('- _(none)_')
  return L.join('\n') + '\n'
}

// SUMMARY renderer. unblind=true => show models; false => letters only + genericised failReasons.
// Join on the candidate LETTER, never on model (models repeat in Mixed presets like '2 opus').
function summaryMd({ task, mode, n, unblind, r1mapping, r1review, finalMapping, finalRank, winnerRound }) {
  const L = [`# Farnsworth Loop — run summary${unblind ? '' : ' (BLIND)'}`, '',
    `**Mode:** ${mode === 'two' ? 'two-pass' : 'single-pass'}  •  **N (attempts/round):** ${n}`, '',
    '## Task', '', '> ' + String(task).replace(/\n/g, '\n> '), '',
    '## Round-1 candidates', '',
    unblind ? '| Candidate | Model | Valid | Note |' : '| Candidate | Valid | Note |',
    unblind ? '|---|---|---|---|' : '|---|---|---|']
  for (const m of (r1mapping || [])) {
    const note = m.valid ? '' : (unblind ? (m.failReason || '') : blindFail(m.failReason || 'excluded'))
    L.push(unblind ? `| ${m.candidate} | ${m.model} | ${m.valid ? 'yes' : 'NO'} | ${note} |`
                   : `| ${m.candidate} | ${m.valid ? 'yes' : 'NO'} | ${note} |`)
  }
  L.push('')
  if (r1review && !r1review.__failed) {
    const r1join = letter => {
      const m = (r1mapping || []).find(x => x.candidate === letter)
      return unblind && m ? `Candidate ${letter} (${m.model})` : `Candidate ${letter}`
    }
    L.push(mode === 'two' ? '## Round-1 review verdict' : '## Verdict', '',
      `**${mode === 'two' ? 'Round-1 ' : ''}Winner:** ${r1join(r1review.winner)}`, '',
      `**Ranking:** ${(r1review.ranking || []).map(r1join).join(' > ')}`, '')
  }
  if (mode === 'two' && finalMapping) {
    L.push('## Final candidates', '',
      unblind ? '| Candidate | Model | From round | Valid | Note |' : '| Candidate | From round | Valid | Note |',
      unblind ? '|---|---|---|---|---|' : '|---|---|---|---|')
    for (const m of finalMapping) {
      const note = m.valid ? '' : (unblind ? (m.failReason || '') : blindFail(m.failReason || 'excluded'))
      L.push(unblind ? `| ${m.candidate} | ${m.model} | ${m.round} | ${m.valid ? 'yes' : 'NO'} | ${note} |`
                     : `| ${m.candidate} | ${m.round} | ${m.valid ? 'yes' : 'NO'} | ${note} |`)
    }
    L.push('')
    if (finalRank && !finalRank.__failed) {
      const fjoin = letter => {
        const m = finalMapping.find(x => x.candidate === letter)
        return unblind && m ? `Candidate ${letter} (${m.model})` : `Candidate ${letter}`
      }
      const wm = finalMapping.find(x => x.candidate === finalRank.winner)
      L.push('## Overall winner', '', `**Winner:** ${fjoin(finalRank.winner)}`)
      if (wm) L.push(`**Came from round:** ${wm.round}`)
      else if (winnerRound != null) L.push(`**Came from round:** ${winnerRound}`)
      L.push('', `**Final ranking:** ${(finalRank.ranking || []).map(fjoin).join(' > ')}`, '')
    }
  }
  return L.join('\n') + '\n'
}

// ---- Round 1 ----
phase('Round 1')
await buildContext() // shared context bundle (no-op unless args.contextFiles given) — built once, before the attempts
log(`Round 1: ${attempts.length} attempts (${attempts.map(a => a.displayModel).join(', ')})`)
const r1 = (await parallel(attempts.map(a => () => dispatch(a, `${runDir}/round-1/${a.label}`, null, 'Round 1')))).filter(Boolean)
if (!r1.length) return { error: 'all round-1 attempts failed (dispatch errors)' }

phase('Review')
const staged1 = await stageAndValidate(blindLabel(r1, 1), `${runDir}/review-1`, 'Review')
const blind1 = staged1.filter(c => c.valid)
const r1mapping = staged1.map(c => ({ candidate: c.blind, model: c.displayModel, valid: c.valid, ...(c.valid ? {} : { failReason: c.failReason }) }))
const N = attempts.length
if (!blind1.length) {
  // P0: no valid round-1 pool — still land the key + summaries
  await persist([
    { path: `${runDir}/mapping.json`, content: json({ mode, n: N, round1: r1mapping, winner1: null, ...(mode === 'two' ? { winner: null } : {}) }) },
    { path: `${runDir}/SUMMARY.md`, content: summaryMd({ task, mode, n: N, unblind: true, r1mapping }) },
    { path: `${runDir}/SUMMARY.blind.md`, content: summaryMd({ task, mode, n: N, unblind: false, r1mapping }) },
  ], 'Review')
  return { mode, n: N, error: 'no valid round-1 deliverables', round1: { mapping: r1mapping } }
}

const review = await judge('reviewer', blind1, mode === 'two', `${runDir}/review-1/_pool.md`,
  mode === 'two' ? REVIEW_SCHEMA : RANK_SCHEMA, 'Review', 'review')
if (review.__failed) {
  // P1: review judge failed — land the key + summaries (no verdict exists)
  await persist([
    { path: `${runDir}/mapping.json`, content: json({ mode, n: N, round1: r1mapping, winner1: null, ...(mode === 'two' ? { winner: null } : {}) }) },
    { path: `${runDir}/SUMMARY.md`, content: summaryMd({ task, mode, n: N, unblind: true, r1mapping }) },
    { path: `${runDir}/SUMMARY.blind.md`, content: summaryMd({ task, mode, n: N, unblind: false, r1mapping }) },
  ], 'Review')
  return { mode, n: N, round1: { mapping: r1mapping }, error: `review judge failed: ${review.__failed}` }
}

// P2: round-1 review is valid — incremental write BEFORE any round-2 dispatch (crash-survival linchpin)
await persist([
  { path: `${runDir}/mapping.json`, content: json({ mode, n: N, round1: r1mapping, winner1: review.winner }) },
  { path: `${runDir}/review-1/verdict.json`, content: json(review) },
  { path: `${runDir}/review-1/verdict.md`, content: verdictToMd(review, 'Round-1 review verdict') },
  ...(review.guidance ? [{ path: `${runDir}/review-1/guidance.md`, content: guidanceToMd(review.guidance) }] : []),
], 'Review')

if (mode === 'single') {
  // P3: single-pass — mapping/verdict already written at P2; add the summaries
  await persist([
    { path: `${runDir}/SUMMARY.md`, content: summaryMd({ task, mode, n: N, unblind: true, r1mapping, r1review: review }) },
    { path: `${runDir}/SUMMARY.blind.md`, content: summaryMd({ task, mode, n: N, unblind: false, r1mapping, r1review: review }) },
  ], 'Review')
  return { mode, n: N, round1: { mapping: r1mapping, review } }
}

// ---- Two pass ----
const winner1 = blind1.find(c => c.blind === review.winner)
if (!winner1) log(`round-1 winner "${review.winner}" not among valid candidates; carrying the first valid (${blind1[0].blind})`) // #8
const champ = winner1 || blind1[0]
phase('Round 2')
log(`Round 2: ${attempts.length} guided attempts; carrying over round-1 winner (${champ.displayModel})`)
const r2 = (await parallel(attempts.map(a => () => dispatch(a, `${runDir}/round-2/${a.label}`, review.guidance, 'Round 2')))).filter(Boolean)

// final pool = round-2 attempts + the carried-over round-1 winner. Staging erases the round path,
// so the judge cannot tell which finalist is the carryover.
// D-0004: champ.ws is the round-1 STRIPPED staging dir (review-1/<blind>/) — its provenance log was
// already deleted there. The carryover passed provenance in round 1, so mark it carriedOver:true and
// have stageAndValidate skip ONLY the provenance grep for it (the deliverable is still required). Without
// this flag, a runner-backed (glm/codex/minimax/local) round-1 winner would re-grep the stripped dir,
// get P=0, and be wrongly dropped from the final pool the Opus ranker reads.
const finalPool = [
  ...r2.map(c => ({ ws: c.ws, displayModel: c.displayModel, dispatch: c.dispatch, round: 2 })),
  { ws: champ.ws, displayModel: champ.displayModel, dispatch: champ.dispatch, round: 1, carriedOver: true },
]
phase('Final rank')
const stagedF = await stageAndValidate(blindLabel(finalPool, 2), `${runDir}/review-final`, 'Final rank')
const blindF = stagedF.filter(c => c.valid)
const finalMapping = stagedF.map(c => ({ candidate: c.blind, model: c.displayModel, round: c.round, valid: c.valid, ...(c.valid ? {} : { failReason: c.failReason }) }))
const carriedEntry = finalMapping.find(e => e.round === 1)
const carriedOverWinner = carriedEntry ? carriedEntry.candidate : null
if (!blindF.length) {
  // P4: no valid finalists — full key (round1 + final, winner null) + summaries
  await persist([
    { path: `${runDir}/mapping.json`, content: json({ mode, n: N, round1: r1mapping, winner1: review.winner, final: finalMapping, winner: null, winnerRound: null, carriedOverWinner }) },
    { path: `${runDir}/SUMMARY.md`, content: summaryMd({ task, mode, n: N, unblind: true, r1mapping, r1review: review, finalMapping }) },
    { path: `${runDir}/SUMMARY.blind.md`, content: summaryMd({ task, mode, n: N, unblind: false, r1mapping, r1review: review, finalMapping }) },
  ], 'Final rank')
  return { mode, n: N, round1: { mapping: r1mapping }, guidance: review.guidance, final: { mapping: finalMapping, error: 'no valid finalists' } } // #5
}

const finalRank = await judge('final ranker', blindF, false, `${runDir}/review-final/_pool.md`, RANK_SCHEMA, 'Final rank', 'final-rank')
if (finalRank.__failed) {
  // P5: final-rank judge failed — same payload as P4 (no finalRank to render)
  await persist([
    { path: `${runDir}/mapping.json`, content: json({ mode, n: N, round1: r1mapping, winner1: review.winner, final: finalMapping, winner: null, winnerRound: null, carriedOverWinner }) },
    { path: `${runDir}/SUMMARY.md`, content: summaryMd({ task, mode, n: N, unblind: true, r1mapping, r1review: review, finalMapping }) },
    { path: `${runDir}/SUMMARY.blind.md`, content: summaryMd({ task, mode, n: N, unblind: false, r1mapping, r1review: review, finalMapping }) },
  ], 'Final rank')
  return { mode, n: N, round1: { mapping: r1mapping }, guidance: review.guidance, final: { mapping: finalMapping, error: `final-rank judge failed: ${finalRank.__failed}` } }
}

// #7: resolve winnerRound against the VALID finalist set; omit the field if unresolved (no literal "undefined")
const winnerEntry = blindF.find(c => c.blind === finalRank.winner)
// P6: completed two-pass — full key + final verdict + summaries
await persist([
  { path: `${runDir}/mapping.json`, content: json({ mode, n: N, round1: r1mapping, winner1: review.winner, final: finalMapping, winner: finalRank.winner, winnerRound: winnerEntry ? winnerEntry.round : null, carriedOverWinner }) },
  { path: `${runDir}/review-final/verdict.json`, content: json(finalRank) },
  { path: `${runDir}/review-final/verdict.md`, content: verdictToMd(finalRank, 'Final rank verdict') },
  { path: `${runDir}/SUMMARY.md`, content: summaryMd({ task, mode, n: N, unblind: true, r1mapping, r1review: review, finalMapping, finalRank, winnerRound: winnerEntry ? winnerEntry.round : null }) },
  { path: `${runDir}/SUMMARY.blind.md`, content: summaryMd({ task, mode, n: N, unblind: false, r1mapping, r1review: review, finalMapping, finalRank, winnerRound: winnerEntry ? winnerEntry.round : null }) },
], 'Final rank')
return {
  mode, n: N,
  round1: { mapping: r1mapping, review },
  guidance: review.guidance,
  final: { mapping: finalMapping, rank: finalRank, ...(winnerEntry ? { winnerRound: winnerEntry.round } : {}) },
}
