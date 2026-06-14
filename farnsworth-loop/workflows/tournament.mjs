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
//   attempts: [ {                         // one per attempt, length N
//      label: 'candidate-1',
//      dispatch: 'anthropic' | 'glm',
//      model: 'haiku'|'sonnet'|'opus',    // when dispatch=anthropic
//      agentType: 'farnsworth-glm-5-2',   // when dispatch=glm
//      displayModel: 'glm-5.2',           // for the report (kept private from judges)
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
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'" // single-quote shell-escape

// Runner paths for the non-Anthropic providers (passed in via args). Each provider's
// real (nested-Claude) call lives in a bundled script, so the wrapper agent only ever
// sees a benign `bash <runner> <flag>` command — nothing to refuse, shortcut, or
// self-substitute. GLM has an inline fallback; local always uses its runner.
const glmRunner = A.glmRunner
const localRunner = A.localRunner
// Per-attempt guards for GLM/local runners (enforced inside the runner scripts):
//  - max-turns: PRIMARY guard — caps agentic iterations so single-pass attempts can't
//    grind the write->run->fix loop (which balloons context, esp. on local models).
//  - timeout: wall-clock backstop for a single hung/slow turn.
// GLM gets a roomier cap; local models run a tighter cap because they tend to ignore
// "single pass" and burn turns on a verify-and-polish loop (observed on Qwen).
const glmMaxTurns = Number(A.attemptMaxTurns) > 0 ? Math.floor(Number(A.attemptMaxTurns)) : 30
const localMaxTurns = Number(A.localMaxTurns) > 0 ? Math.floor(Number(A.localMaxTurns)) : 20
const attemptTimeout = Number(A.attemptTimeoutSecs) > 0 ? Math.floor(Number(A.attemptTimeoutSecs)) : 300
const cmdHead = (ws, b) => `mkdir -p ${q(ws)} && cd ${q(ws)} && printf '%s' ${q(b)} > _brief.txt`
const runnerCmd = (runner, flag, ws, b, maxTurns) => `${cmdHead(ws, b)} && FL_MAX_TURNS=${maxTurns} FL_TIMEOUT_SECS=${attemptTimeout} bash ${q(runner)} ${flag}`

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
    const cmd = glmRunner ? runnerCmd(glmRunner, flag, ws, b, glmMaxTurns) : glmInline(flag, ws, b)
    prompt = RUNVERBATIM(cmd, ws, '_glm_run.log')
  } else if (a.dispatch === 'local') {
    opts.agentType = nsAgent(a.agentType) // farnsworth-local
    const flag = `--model ${a.model}` // exact local model id, passes straight through to omlx
    prompt = RUNVERBATIM(runnerCmd(localRunner, flag, ws, b, localMaxTurns), ws, '_local_run.log')
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

Score each candidate against criteria suited to the task (for code: correctness, meets stated constraints, completeness, edge cases, readability; adapt for non-code). Give concrete, specific pros and cons per candidate. Rank them all. Name the single winner with reasoning.${guidanceBlock}

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
    const log = c.dispatch === 'glm' ? '_glm_run.log' : c.dispatch === 'local' ? '_local_run.log' : ''
    const lp = log ? q(`${c.ws}/${log}`) : ''
    // FAIL CLOSED (#2): the runner writes its log (with the PROVENANCE line) UNCONDITIONALLY at
    // startup, so a missing log at this exact path means the runner never ran — a native-solve spoof
    // or refusal — which must be rejected (P=0), not waved through. Native attempts (no runner) → P=1.
    const provChk = log
      ? `if [ -f ${lp} ]; then if grep -q 'FARNSWORTH-.*-PROVENANCE endpoint=' ${lp} && grep -q 'FARNSWORTH-.*-DONE exit=0' ${lp} && ! grep -q 'FARNSWORTH-.*-\\(TIMEOUT\\|ERROR\\)' ${lp}; then P=1; else P=0; fi; else P=0; fi`
      : `P=1`
    return `mkdir -p ${q(dest)}; cp -R ${q(c.ws)}/. ${q(dest)}/ 2>/dev/null; ` +
           `rm -f ${q(dest)}/_brief.txt ${q(dest)}/_glm_run.log ${q(dest)}/_local_run.log; ` +
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
if (!blind1.length) return { mode, n: attempts.length, error: 'no valid round-1 deliverables', round1: { mapping: r1mapping } }

const review = await judge('reviewer', blind1, mode === 'two', `${runDir}/review-1/_pool.md`,
  mode === 'two' ? REVIEW_SCHEMA : RANK_SCHEMA, 'Review', 'review')
if (review.__failed) return { mode, n: attempts.length, round1: { mapping: r1mapping }, error: `review judge failed: ${review.__failed}` }

if (mode === 'single') {
  return { mode, n: attempts.length, round1: { mapping: r1mapping, review } }
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
const finalPool = [
  ...r2.map(c => ({ ws: c.ws, displayModel: c.displayModel, dispatch: c.dispatch, round: 2 })),
  { ws: champ.ws, displayModel: champ.displayModel, dispatch: champ.dispatch, round: 1 },
]
phase('Final rank')
const stagedF = await stageAndValidate(blindLabel(finalPool, 2), `${runDir}/review-final`, 'Final rank')
const blindF = stagedF.filter(c => c.valid)
const finalMapping = stagedF.map(c => ({ candidate: c.blind, model: c.displayModel, round: c.round, valid: c.valid, ...(c.valid ? {} : { failReason: c.failReason }) }))
if (!blindF.length) return { mode, n: attempts.length, round1: { mapping: r1mapping }, guidance: review.guidance, final: { mapping: finalMapping, error: 'no valid finalists' } } // #5

const finalRank = await judge('final ranker', blindF, false, `${runDir}/review-final/_pool.md`, RANK_SCHEMA, 'Final rank', 'final-rank')
if (finalRank.__failed) return { mode, n: attempts.length, round1: { mapping: r1mapping }, guidance: review.guidance, final: { mapping: finalMapping, error: `final-rank judge failed: ${finalRank.__failed}` } }

// #7: resolve winnerRound against the VALID finalist set; omit the field if unresolved (no literal "undefined")
const winnerEntry = blindF.find(c => c.blind === finalRank.winner)
return {
  mode, n: attempts.length,
  round1: { mapping: r1mapping, review },
  guidance: review.guidance,
  final: { mapping: finalMapping, rank: finalRank, ...(winnerEntry ? { winnerRound: winnerEntry.round } : {}) },
}
