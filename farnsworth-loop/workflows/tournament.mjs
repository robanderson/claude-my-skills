export const meta = {
  name: 'farnsworth-tournament',
  description: 'Farnsworth Loop tournament: parallel attempts (Anthropic native or GLM via wrapper agents) judged blind by Anthropic Opus; two-pass adds a guided round and a final rank.',
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
const { task, mode, runDir, attempts } = args
const LABELS = 'ABCDEFGHIJKLMNOP'.split('')

function brief(nudge, ws, guidance) {
  let g = ''
  if (guidance) {
    const pos = (guidance.positives || []).map(p => `- ${p}`).join('\n')
    const ch = (guidance.challenges || []).map(c => `- ${c}`).join('\n')
    g = `\nIn producing your answer, please consider these items as possible positives:\n${pos}\nAnd treat these items as challenges to avoid:\n${ch}\n`
  }
  return `You are solving a self-contained task. Produce a complete, working solution.

Task:
${task}
${g}
${nudge}

Rules:
- Save all deliverable files to: ${ws}
- Work only in that directory. Create it if needed.
- If it is code, actually run it to confirm it works; iterate until it does.
- At the end, print a 2 to 4 sentence note on your approach and any tradeoffs you made.`
}

function dispatch(a, ws, guidance, phaseTitle) {
  const b = brief(guidance ? a.r2nudge : a.r1nudge, ws, guidance)
  const opts = { label: `${phaseTitle}:${a.displayModel}`, phase: phaseTitle }
  if (a.dispatch === 'glm') opts.agentType = a.agentType
  else opts.model = a.model
  return agent(b, opts).then(res => ({ label: a.label, displayModel: a.displayModel, ws, res })).catch(() => null)
}

function judgePrompt(kind, blindList, guidanceWanted) {
  const items = blindList.map(c => `- Candidate ${c.blind}: deliverable(s) in directory ${c.ws}`).join('\n')
  const guidanceBlock = guidanceWanted
    ? `\n\nAlso distil GUIDANCE for a second round of fresh attempts. Two short generic lists, NO candidate-specific code:\n- positives: patterns/choices that worked anywhere this round.\n- challenges: pitfalls/weaknesses/constraint-violations seen anywhere this round.`
    : ''
  return `You are a blind ${kind}. You do NOT know which model produced which candidate; do not speculate. Judge only the work in front of you.

Task that every candidate was given:
${task}

Candidates (read the deliverable file(s) in each directory; if it is code, RUN it to see the real output, and judge the real output — not any self-summary):
${items}

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

// ---- Round 1 ----
phase('Round 1')
log(`Round 1: ${attempts.length} attempts (${attempts.map(a => a.displayModel).join(', ')})`)
const r1 = (await parallel(attempts.map(a => () => dispatch(a, `${runDir}/round-1/${a.label}`, null, 'Round 1')))).filter(Boolean)
if (!r1.length) return { error: 'all round-1 attempts failed' }

// blind-label round 1 (rotate by 1 to decorrelate label order from dispatch order)
const rot = r1.map((_, i) => r1[(i + 1) % r1.length])
const blind1 = rot.map((c, i) => ({ blind: LABELS[i], ws: c.ws, displayModel: c.displayModel, label: c.label }))

phase('Review')
const review = await agent(
  judgePrompt('reviewer', blind1, mode === 'two'),
  { model: 'opus', schema: REVIEW_SCHEMA, phase: 'Review', label: 'review' }
)
const r1mapping = blind1.map(c => ({ candidate: c.blind, model: c.displayModel, ws: c.ws }))

if (mode === 'single') {
  return { mode, n: attempts.length, round1: { mapping: r1mapping, review } }
}

// ---- Two pass ----
const winner1 = blind1.find(c => c.blind === review.winner) || blind1[0]
phase('Round 2')
log(`Round 2: ${attempts.length} guided attempts; carrying over round-1 winner (${winner1.displayModel})`)
const r2 = (await parallel(attempts.map(a => () => dispatch(a, `${runDir}/round-2/${a.label}`, review.guidance, 'Round 2')))).filter(Boolean)

// final pool = round-2 attempts + saved round-1 winner
const pool = [
  ...r2.map(c => ({ ws: c.ws, displayModel: c.displayModel, round: 2 })),
  { ws: winner1.ws, displayModel: winner1.displayModel, round: 1 },
]
const rotF = pool.map((_, i) => pool[(i + 2) % pool.length])
const blindF = rotF.map((c, i) => ({ blind: LABELS[i], ws: c.ws, displayModel: c.displayModel, round: c.round }))

phase('Final rank')
const finalRank = await agent(
  judgePrompt('final ranker', blindF, false),
  { model: 'opus', schema: RANK_SCHEMA, phase: 'Final rank', label: 'final-rank' }
)
const finalMapping = blindF.map(c => ({ candidate: c.blind, model: c.displayModel, round: c.round, ws: c.ws }))

return {
  mode, n: attempts.length,
  round1: { mapping: r1mapping, review },
  guidance: review.guidance,
  final: { mapping: finalMapping, rank: finalRank,
           winnerRound: (finalMapping.find(m => m.candidate === finalRank.winner) || {}).round },
}
