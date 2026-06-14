#!/usr/bin/env node
// fl-parse.test.mjs — runnable test suite for fl-parse.mjs.
//   node fl-parse.test.mjs
// Asserts and prints pass/fail counts; exits non-zero on any failure.

import {
  parse,
  normaliseModel,
  topMixedAssignment,
  expandSpec,
} from './fl-parse.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(name + (detail ? '  -- ' + detail : ''));
  }
}

function checkEq(name, actual, expected) {
  const ok = eq(actual, expected);
  check(name, ok, ok ? '' : 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}

// --------------------------------------------------------------------------
// Backwards-compat: existing @@FL:N / @@FL:N:M behaviour must be byte-identical.
// --------------------------------------------------------------------------
{
  const r = parse('do abc @@FL:5');
  checkEq('@@FL:5 -> n=5', r.n, 5);
  checkEq('@@FL:5 -> mode=1', r.mode, 1);
  checkEq('@@FL:5 -> z=1', r.z, 1);
  checkEq('@@FL:5 -> task', r.task, 'do abc');
  check('@@FL:5 -> no errors', !r.errors, JSON.stringify(r.errors));
  // Explicit N, no prose spec: assignment stays null and the Phase-1 gate runs
  // as today (needsGate is only set for a MISSING N). This matches SKILL Phase 0.
  check('@@FL:5 -> no inferred assignment', r.assignment === null, JSON.stringify(r));
  check('@@FL:5 -> needsGate false (N is explicit)', r.needsGate === false, JSON.stringify(r));
}
{
  const r = parse('do abc @@FL:5:2');
  checkEq('@@FL:5:2 -> n=5', r.n, 5);
  checkEq('@@FL:5:2 -> mode=2', r.mode, 2);
  checkEq('@@FL:5:2 -> z=1', r.z, 1);
  checkEq('@@FL:5:2 -> task', r.task, 'do abc');
  check('@@FL:5:2 -> no errors', !r.errors, JSON.stringify(r.errors));
}
{
  const r = parse('write a haiku @@FL : 4 : 2');
  checkEq('spaced sigil n=4', r.n, 4);
  checkEq('spaced sigil mode=2', r.mode, 2);
  checkEq('spaced sigil task', r.task, 'write a haiku');
}
{
  const r = parse('do abc :farnsworth loop:5');
  checkEq('prose loop:5 n=5', r.n, 5);
  checkEq('prose loop:5 mode=1', r.mode, 1);
  checkEq('prose loop:5 task', r.task, 'do abc');
}
{
  const r = parse('do abc: farnsworth loop:5:2');
  checkEq('prose loop:5:2 n=5', r.n, 5);
  checkEq('prose loop:5:2 mode=2', r.mode, 2);
}

// --------------------------------------------------------------------------
// Bare @@FL -> needsGate.
// --------------------------------------------------------------------------
{
  const r = parse('do abc @@FL');
  checkEq('bare @@FL n=null', r.n, null);
  checkEq('bare @@FL mode=1', r.mode, 1);
  check('bare @@FL needsGate', r.needsGate === true, JSON.stringify(r));
  checkEq('bare @@FL task', r.task, 'do abc');
  check('bare @@FL no errors', !r.errors, JSON.stringify(r.errors));
}
{
  const r = parse('@@fl do the thing');
  // marker leading; task is text after? Spec says text BEFORE marker is task.
  // With marker at start, task before is empty.
  checkEq('leading bare @@FL needsGate', r.needsGate, true);
}

// --------------------------------------------------------------------------
// Prose model spec -> N + assignment (the headline example, end to end).
// --------------------------------------------------------------------------
{
  const r = parse('build a parser with 2 opus, 2 glm 5.2, 1 codex high @@FL');
  checkEq('headline n=5', r.n, 5);
  checkEq('headline assignment',
    r.assignment, ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high']);
  check('headline no errors', !r.errors, JSON.stringify(r.errors));
  check('headline no gate', !r.needsGate, JSON.stringify(r));
  check('headline task strips spec', !/opus|glm|codex/i.test(r.task), 'task=' + r.task);
}
{
  // Dashed spelling must give the same result as spaced.
  const r = parse('build a parser with 2 opus, 2 glm-5.2, 1 codex-high @@FL');
  checkEq('dashed glm-5.2 assignment',
    r.assignment, ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high']);
}
{
  const r = parse('do x, 1 opus and 1 sonnet and 1 codex @@FL');
  checkEq('and-chain n=3', r.n, 3);
  checkEq('and-chain assignment (bare codex=medium)',
    r.assignment, ['opus', 'sonnet', 'codex-medium']);
}
{
  const r = parse('do x with 3 glm @@FL');
  checkEq('bare glm default n=3', r.n, 3);
  checkEq('bare glm -> glm-5.2',
    r.assignment, ['glm-5.2', 'glm-5.2', 'glm-5.2']);
}
{
  // Spec appears in the MIDDLE then the marker after; vary position.
  const r = parse('please, with 1 opus and 1 haiku, do the job @@FL:2');
  checkEq('middle spec n=2', r.n, 2);
  checkEq('middle spec assignment', r.assignment, ['opus', 'haiku']);
}
{
  // MiniMax token.
  const r = parse('do y with 2 minimax @@FL');
  checkEq('minimax n=2', r.n, 2);
  checkEq('minimax-m3 assignment', r.assignment, ['minimax-m3', 'minimax-m3']);
  const r2 = parse('do y with 1 minimax-m3 and 1 m3 @@FL');
  checkEq('minimax variants', r2.assignment, ['minimax-m3', 'minimax-m3']);
}

// --------------------------------------------------------------------------
// Top Mixed preset, N=2..6.
// --------------------------------------------------------------------------
checkEq('topMixed N=6', topMixedAssignment(6), ['opus','opus','glm-5.2','glm-5.2','codex-high','codex-high']);
checkEq('topMixed N=5', topMixedAssignment(5), ['opus','opus','glm-5.2','glm-5.2','codex-high']);
checkEq('topMixed N=4', topMixedAssignment(4), ['opus','opus','glm-5.2','codex-high']);
checkEq('topMixed N=3', topMixedAssignment(3), ['opus','glm-5.2','codex-high']);
checkEq('topMixed N=2', topMixedAssignment(2), ['opus','glm-5.2']);
{
  const r = parse('do abc top mixed @@FL:6');
  checkEq('top mixed via sigil N=6 n', r.n, 6);
  checkEq('top mixed via sigil N=6 assignment',
    r.assignment, ['opus','opus','glm-5.2','glm-5.2','codex-high','codex-high']);
  checkEq('top mixed preset flag', r.preset, 'top-mixed');
  check('top mixed task strips keyword', !/top\s*mix/i.test(r.task), 'task=' + r.task);
}
{
  const r = parse('do abc 5 top mixed @@FL');
  checkEq('leading-count top mixed n=5', r.n, 5);
  checkEq('leading-count top mixed assignment',
    r.assignment, ['opus','opus','glm-5.2','glm-5.2','codex-high']);
}
{
  const r = parse('do abc with top-mix @@FL:2');
  checkEq('top-mix alias N=2', r.assignment, ['opus','glm-5.2']);
}

// --------------------------------------------------------------------------
// Unknown-token rejection (LOUD, never drop, never change N).
// --------------------------------------------------------------------------
{
  const r = parse('do x with 2 opus and 1 gpt4 @@FL');
  check('unknown token errors', !!r.errors && r.errors.length > 0, JSON.stringify(r));
  checkEq('unknown token nulls n', r.n, null);
  checkEq('unknown token nulls assignment', r.assignment, null);
  check('unknown token names gpt4', r.errors.join(' ').includes('gpt4'), JSON.stringify(r.errors));
}
{
  // Trailing unknown must error, not silently shorten the assignment.
  const r = parse('do x with 1 opus, 1 gpt4 @@FL');
  check('trailing unknown errors', !!r.errors && r.errors.length > 0, JSON.stringify(r));
  checkEq('trailing unknown nulls n', r.n, null);
}
checkEq('normaliseModel unknown -> null', normaliseModel('frobnicate'), null);
checkEq('normaliseModel opus', normaliseModel('OPUS'), { model: 'opus', dispatch: 'anthropic' });
checkEq('normaliseModel glm 5.2 spaced', normaliseModel('glm 5.2'), { model: 'glm-5.2', dispatch: 'glm' });
checkEq('normaliseModel glm-5.2 dashed', normaliseModel('glm-5.2'), { model: 'glm-5.2', dispatch: 'glm' });
checkEq('normaliseModel codex bare', normaliseModel('codex'), { model: 'codex-medium', dispatch: 'codex' });
checkEq('normaliseModel codex high', normaliseModel('codex high'), { model: 'codex-high', dispatch: 'codex' });
checkEq('normaliseModel m3', normaliseModel('m3'), { model: 'minimax-m3', dispatch: 'minimax' });

// --------------------------------------------------------------------------
// Explicit-N-vs-prose conflict.
// --------------------------------------------------------------------------
{
  const r = parse('improve X @@FL:4 with 2 opus, 2 glm, 1 codex');
  check('conflict surfaced', !!r.conflict, JSON.stringify(r));
  checkEq('conflict markerN', r.conflict.markerN, 4);
  checkEq('conflict specN', r.conflict.specN, 5);
  checkEq('conflict nulls n', r.n, null);
  checkEq('conflict nulls assignment', r.assignment, null);
}
{
  // Agreement -> proceed silently.
  const r = parse('do x with 2 opus and 1 sonnet @@FL:3');
  check('agree no conflict', !r.conflict, JSON.stringify(r));
  checkEq('agree n=3', r.n, 3);
  checkEq('agree assignment', r.assignment, ['opus','opus','sonnet']);
}

// --------------------------------------------------------------------------
// Positional-skip rejection.
// --------------------------------------------------------------------------
{
  const r = parse('do abc @@FL:5::3');
  check('positional skip errors', !!r.errors && r.errors.some(e => /positional skip/i.test(e)),
    JSON.stringify(r.errors));
  checkEq('positional skip nulls n', r.n, null);
}
{
  // Explicit Z with default M is the correct spelling.
  const r = parse('do abc @@FL:5:1:3');
  // Z>1 is inert -> emits the grand-loops error.
  check('explicit Z>1 inert error', !!r.errors && r.errors.some(e => /grand loops not yet/i.test(e)),
    JSON.stringify(r.errors));
  checkEq('explicit Z value', r.z, 3);
}

// --------------------------------------------------------------------------
// Z>1 inert.
// --------------------------------------------------------------------------
{
  const r = parse('do abc @@FL:5:2:2');
  checkEq('Z=2 value parsed', r.z, 2);
  check('Z=2 emits not-implemented', !!r.errors && r.errors.some(e => /grand loops not yet/i.test(e)),
    JSON.stringify(r.errors));
}
{
  const r = parse('do abc @@FL:5:1:1');
  checkEq('Z=1 explicit ok z', r.z, 1);
  check('Z=1 explicit no grand-loop error',
    !r.errors || !r.errors.some(e => /grand loops/i.test(e)), JSON.stringify(r.errors));
  checkEq('Z=1 explicit n=5', r.n, 5);
}

// --------------------------------------------------------------------------
// Digit-noun task guard: 'fix 3 bugs' must NOT be a model spec.
// --------------------------------------------------------------------------
{
  const r = parse('fix 3 bugs @@FL:5');
  checkEq('digit-noun keeps n=5', r.n, 5);
  checkEq('digit-noun assignment stays null (gate)', r.assignment, null);
  // N is explicit (5) so needsGate stays false; the Phase-1 menu still runs
  // because assignment is null. The key guard is that n is NOT shifted by '3 bugs'.
  check('digit-noun needsGate false (N explicit)', r.needsGate === false, JSON.stringify(r));
  checkEq('digit-noun task intact', r.task, 'fix 3 bugs');
  check('digit-noun no errors', !r.errors, JSON.stringify(r.errors));
}
{
  const r = parse('write 5 tests for the parser @@FL:4');
  checkEq('write 5 tests keeps n=4', r.n, 4);
  check('write 5 tests no spec', r.assignment === null, JSON.stringify(r));
  check('write 5 tests task has digits', /5 tests/.test(r.task), 'task=' + r.task);
}
{
  // A digit-noun next to a real model token in the SAME phrase still only
  // treats the model item as a spec.
  const r = parse('refactor 2 modules with 2 opus @@FL:2');
  checkEq('mixed digit-noun + spec n=2', r.n, 2);
  checkEq('mixed digit-noun + spec assignment', r.assignment, ['opus','opus']);
  check('mixed task keeps 2 modules', /2 modules/.test(r.task), 'task=' + r.task);
}

// --------------------------------------------------------------------------
// Marker position variation: leading / middle / trailing.
// --------------------------------------------------------------------------
{
  const r = parse('@@FL:3 do the thing');
  checkEq('leading marker n=3', r.n, 3);
  // Text before marker is empty; task should be empty (or whitespace-trimmed).
  checkEq('leading marker task empty', r.task, '');
}
{
  const r = parse('start of task @@FL:3 trailing words');
  checkEq('middle marker n=3', r.n, 3);
  checkEq('middle marker task = before', r.task, 'start of task');
}

// --------------------------------------------------------------------------
// Malformed / edge inputs must not throw.
// --------------------------------------------------------------------------
{
  let threw = false; let r;
  try { r = parse(null); } catch { threw = true; }
  check('null input no throw', !threw, 'threw');
  check('null input errors', r && !!r.errors, JSON.stringify(r));
}
{
  let threw = false; let r;
  try { r = parse(''); } catch { threw = true; }
  check('empty input no throw', !threw, 'threw');
  check('empty input errors (no marker)', r && !!r.errors, JSON.stringify(r));
}
{
  let threw = false; let r;
  try { r = parse(12345); } catch { threw = true; }
  check('number input no throw', !threw, 'threw');
}
{
  const r = parse('do something with no marker at all');
  check('no-marker errors', !!r.errors, JSON.stringify(r));
}
{
  // Invalid M.
  const r = parse('do abc @@FL:5:3');
  check('invalid M=3 errors', !!r.errors && r.errors.some(e => /pass count/i.test(e)),
    JSON.stringify(r.errors));
}
{
  // N=1 invalid.
  const r = parse('do abc @@FL:1');
  check('N=1 invalid errors', !!r.errors, JSON.stringify(r.errors));
  checkEq('N=1 nulls n', r.n, null);
}

// --------------------------------------------------------------------------
// expandSpec direct unit (full assignment, not just length).
// --------------------------------------------------------------------------
{
  const e = expandSpec('2 opus, 2 glm 5.2, 1 codex high');
  checkEq('expandSpec count', e.count, 5);
  checkEq('expandSpec assignment',
    e.assignment, ['opus','opus','glm-5.2','glm-5.2','codex-high']);
  checkEq('expandSpec no unknowns', e.unknowns, []);
}

// --------------------------------------------------------------------------
// Report.
// --------------------------------------------------------------------------
console.log('');
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  x ' + f);
  console.log('');
}
console.log(`fl-parse tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed === 0 ? 0 : 1);
