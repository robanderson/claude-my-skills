#!/usr/bin/env node
// fl-parse.test.mjs — tests for the Farnsworth Loop Phase-0 parser.
//
// Self-contained (no test framework): a tiny assert harness + a table of
// cases. Run with:  node fl-parse.test.mjs
// Exits 0 if all pass, 1 otherwise (with a per-failure diff).
//
// Covers BOTH Feature 2 (sigil/prose/spec/Top-Mixed/conflict/normaliser) AND
// Feature 1 (grand loops Z): Z=1 unchanged, Z>=2 valid, Z>Z_MAX rejected,
// positional-skip still invalid.

import { parse, normaliseModel, topMixedAssignment, expandSpec, Z_MAX } from './fl-parse.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(a, b) {
  // strict deep-ish equality that distinguishes null from undefined.
  if (a === b) return true;
  if (a === null || b === null) return a === b;       // null !== undefined
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((x, i) => eq(x, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => eq(a[k], b[k]));
  }
  return false;
}

function show(v) {
  if (v === undefined) return 'undefined';
  return JSON.stringify(v);
}

// assertField(name, actual, expected)
function assertField(label, name, actual, expected) {
  if (eq(actual, expected)) { passed++; return; }
  failed++;
  failures.push(`  [${label}] field "${name}": expected ${show(expected)}, got ${show(actual)}`);
}

// Run a parse case. `expect` is a subset of fields to assert (each must match,
// using null where the parser nulls). If `errorIncludes` is set, errors[] must
// be present and contain a matching substring.
function parseCase(label, input, expect = {}, opts = {}) {
  const r = parse(input);
  for (const [k, v] of Object.entries(expect)) {
    assertField(label, k, r[k], v);
  }
  if (opts.errorIncludes !== undefined) {
    const errs = r.errors || [];
    const hit = errs.some(e => e.toLowerCase().includes(opts.errorIncludes.toLowerCase()));
    if (hit) { passed++; }
    else {
      failed++;
      failures.push(`  [${label}] expected an error including "${opts.errorIncludes}", got errors=${show(errs)}`);
    }
  }
  if (opts.noErrors) {
    if (r.errors === undefined) { passed++; }
    else {
      failed++;
      failures.push(`  [${label}] expected NO errors, got ${show(r.errors)}`);
    }
  }
  if (opts.hasConflict) {
    if (r.conflict && r.conflict.markerN === opts.hasConflict.markerN && r.conflict.specN === opts.hasConflict.specN) {
      passed++;
    } else {
      failed++;
      failures.push(`  [${label}] expected conflict ${show(opts.hasConflict)}, got ${show(r.conflict)}`);
    }
  }
}

function unit(label, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(`  [${label}] unit assertion failed`); }
}

// ===========================================================================
// EXISTING Feature-2 behaviour (must all still pass).
// ===========================================================================

// --- basic sigil forms ---
// NOTE on needsGate: the parser sets needsGate ONLY when N is unknown. When an
// explicit N is given with NO inferred assignment, needsGate stays false and the
// SKILL runs the gate off `assignment === null` (the parser-contract distinction
// the brief calls out). So an explicit @@FL:5 has needsGate:false, assignment:null.
parseCase('sigil N', 'do abc @@FL:5',
  { task: 'do abc', n: 5, mode: 1, z: 1, assignment: null, needsGate: false }, { noErrors: true });
parseCase('sigil N:M two', 'do abc @@FL:5:2',
  { task: 'do abc', n: 5, mode: 2, z: 1, assignment: null, needsGate: false }, { noErrors: true });
parseCase('sigil case-insensitive + spaces', 'do abc @@fl : 7 : 2',
  { n: 7, mode: 2, z: 1 }, { noErrors: true });

// --- bare sigil -> needsGate ---
parseCase('bare @@FL', 'do abc @@FL',
  { task: 'do abc', n: null, mode: 1, z: 1, assignment: null, needsGate: true }, { noErrors: true });

// --- prose marker ---
parseCase('prose marker N', 'do abc :farnsworth loop:5',
  { n: 5, mode: 1, z: 1 }, { noErrors: true });
parseCase('prose marker N:2', 'do abc: farnsworth loop:5:2',
  { n: 5, mode: 2, z: 1 }, { noErrors: true });
parseCase('prose marker upper', 'refactor this FARNSWORTH LOOP:5',
  { n: 5, mode: 1, z: 1 }, { noErrors: true });

// --- prose model spec (Feature 2) ---
parseCase('spec headline', 'build a parser with 2 opus, 2 glm 5.2, 1 codex high @@FL',
  { n: 5, mode: 1, z: 1, assignment: ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high'] }, { noErrors: true });
parseCase('spec bare codex -> medium', 'do abc, 1 opus and 1 sonnet and 1 codex farnsworth loop:3',
  { n: 3, mode: 1, z: 1, assignment: ['opus', 'sonnet', 'codex-medium'] }, { noErrors: true });
parseCase('spec bare glm -> 5.2', 'do x with 3 glm @@FL',
  { n: 3, z: 1, assignment: ['glm-5.2', 'glm-5.2', 'glm-5.2'] }, { noErrors: true });
parseCase('spec minimax', 'do y with 2 minimax @@FL',
  { n: 2, z: 1, assignment: ['minimax-m3', 'minimax-m3'] }, { noErrors: true });

// --- Top Mixed preset ---
parseCase('top mixed N=6', 'do abc top mixed @@FL:6',
  { n: 6, z: 1, preset: 'top-mixed', assignment: ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high', 'codex-high'] }, { noErrors: true });
parseCase('top mixed leadcount 5', 'do abc 5 top mixed @@FL',
  { n: 5, z: 1, preset: 'top-mixed', assignment: ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high'] }, { noErrors: true });
parseCase('top mixed N=2', 'do abc with top-mix @@FL:2',
  { n: 2, z: 1, preset: 'top-mixed', assignment: ['opus', 'glm-5.2'] }, { noErrors: true });

// --- conflict (explicit N vs prose) ---
parseCase('conflict 4 vs 5', 'improve X @@FL:4 with 2 opus, 2 glm, 1 codex',
  { n: null, assignment: null, z: 1 }, { hasConflict: { markerN: 4, specN: 5 } });
parseCase('agree marker+spec', 'do x with 2 opus and 1 sonnet @@FL:3',
  { n: 3, z: 1, assignment: ['opus', 'opus', 'sonnet'] }, { noErrors: true });

// --- digit-noun guard ---
// '3 bugs' / '5 tests' are task text, NOT a spec: n stays the explicit sigil N,
// assignment stays null, needsGate stays false (SKILL gates off assignment===null).
parseCase('digit-noun guard 3 bugs', 'fix 3 bugs @@FL:5',
  { n: 5, z: 1, assignment: null, needsGate: false }, { noErrors: true });
parseCase('digit-noun guard 5 tests', 'write 5 tests for the parser @@FL:4',
  { n: 4, z: 1, assignment: null, needsGate: false }, { noErrors: true });
parseCase('digit-noun mixed with spec', 'refactor 2 modules with 2 opus @@FL:2',
  { n: 2, z: 1, assignment: ['opus', 'opus'] }, { noErrors: true });

// --- unknown token rejected loudly ---
parseCase('unknown token gpt4', 'do x with 2 opus and 1 gpt4 @@FL',
  { n: null, assignment: null }, { errorIncludes: 'Unrecognised model token' });

// --- invalid M ---
parseCase('invalid M=3', 'do abc @@FL:5:3',
  { n: null }, { errorIncludes: 'Invalid pass count' });

// --- N < 2 ---
parseCase('N=1 invalid', 'do abc @@FL:1',
  { n: null }, { errorIncludes: 'N must be an integer >= 2' });

// --- no marker ---
parseCase('no marker', 'fix 3 bugs in the parser',
  { n: null }, { errorIncludes: 'No @@FL sigil' });

// ===========================================================================
// FEATURE 1 — grand loops (Z). NEW.
// ===========================================================================

// --- Z=1 explicit is byte-identical to omitting Z ---
{
  const omit = parse('do abc @@FL:5:1');
  const z1 = parse('do abc @@FL:5:1:1');
  unit('Z=1 explicit == omitted (n)', omit.n === z1.n && z1.n === 5);
  unit('Z=1 explicit == omitted (z)', omit.z === 1 && z1.z === 1);
  unit('Z=1 explicit == omitted (mode)', omit.mode === z1.mode);
  unit('Z=1 explicit no errors', z1.errors === undefined);
}

// --- Z>=2 is VALID now (flows on; NO "not yet implemented" error) ---
// Explicit N, no spec -> needsGate stays false (SKILL gates off assignment===null).
parseCase('Z=2 valid', 'do abc @@FL:5:1:2',
  { task: 'do abc', n: 5, mode: 1, z: 2, assignment: null, needsGate: false }, { noErrors: true });
parseCase('Z=3 single valid', 'improve the error handling @@FL:4:1:3',
  { n: 4, mode: 1, z: 3 }, { noErrors: true });
parseCase('Z=3 two-pass valid', 'improve the error handling @@FL:4:2:3',
  { n: 4, mode: 2, z: 3 }, { noErrors: true });
parseCase('Z=5 at the ceiling valid', 'tidy things up @@FL:3:1:5',
  { n: 3, mode: 1, z: 5 }, { noErrors: true });

// --- Z>=2 via prose marker ---
parseCase('Z=3 prose marker', 'optimise this loop, farnsworth loop:4:2:3',
  { n: 4, mode: 2, z: 3 }, { noErrors: true });

// --- Z>=2 with N inferred from a prose spec (empty-N sigil form) ---
parseCase('Z=3 N-from-spec empty N', 'improve X @@FL::1:3 with 2 opus, 2 glm 5.2, 1 codex high',
  { n: 5, mode: 1, z: 3, assignment: ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high'] }, { noErrors: true });
// And with an explicit N that AGREES with the prose sum.
parseCase('Z=3 N explicit agrees with spec', 'improve X @@FL:5:1:3 with 2 opus, 2 glm 5.2, 1 codex high',
  { n: 5, mode: 1, z: 3, assignment: ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high'] }, { noErrors: true });

// --- Z > Z_MAX rejected, echoing the offending Z (NOT reset to 1) ---
parseCase('Z=9 over ceiling', 'tidy things up @@FL:3:1:9',
  { n: null, assignment: null, z: 9 }, { errorIncludes: 'exceeds the grand-loop ceiling' });
parseCase('Z=6 just over ceiling', 'do abc @@FL:4:1:6',
  { n: null, z: 6 }, { errorIncludes: 'Z_MAX=' + Z_MAX });
parseCase('Z=30 fat-fingered', 'do abc @@FL:5:2:30',
  { n: null, z: 30 }, { errorIncludes: 'split into batches' });

// --- positional skip still invalid with Z ---
parseCase('positional skip @@FL:5::3', 'do abc @@FL:5::3',
  { n: null }, { errorIncludes: 'Positional skip' });

// --- invalid Z (zero / empty) ---
parseCase('Z=0 invalid', 'do abc @@FL:5:1:0',
  { n: null }, { errorIncludes: 'Z must be an integer' });

// --- the spec's DANGEROUS worked example must NOT be (mis)treated as Z=3.
//     '@@FL:1:3' is positional N=1, M=3 (NOT N omitted/Z=3). N=1 is < 2 AND
//     M=3 is invalid. The empty-N form '@@FL::1:3' is the correct N-omitted
//     spelling. Assert the grammar, not the stray example. ---
{
  const bad = parse('improve X @@FL:1:3');
  unit('@@FL:1:3 is NOT a valid Z=3 run', bad.n === null && (bad.errors || []).length > 0);
  unit('@@FL:1:3 z is not silently 3', bad.z === 1);
}

// ===========================================================================
// D-0003 — prose 'Nx <model>' multiplier + '<n> grand loop[s]' Z directive.
// ===========================================================================

// --- 'Nx <model>' is equivalent to 'N <model>' (no space before model) ---
parseCase('Nx single spec', 'do x with 2x opus @@FL',
  { n: 2, z: 1, assignment: ['opus', 'opus'], needsGate: false }, { noErrors: true });
parseCase('Nx chained spec', 'build a parser with 2x opus and 1x codex high @@FL',
  { task: 'build a parser', n: 3, z: 1, assignment: ['opus', 'opus', 'codex-high'] }, { noErrors: true });
parseCase('Nx chained four with M=2', 'build x with 2x opus, 2x sonnet, 2x codex, 2x minimax @@FL:8:2',
  { n: 8, mode: 2, z: 1,
    assignment: ['opus', 'opus', 'sonnet', 'sonnet', 'codex-medium', 'codex-medium', 'minimax-m3', 'minimax-m3'] },
  { noErrors: true });
// 'Nx' agrees with an explicit marker N -> no conflict.
parseCase('Nx agrees with marker N', 'do x with 2x opus and 1x sonnet @@FL:3',
  { n: 3, z: 1, assignment: ['opus', 'opus', 'sonnet'] }, { noErrors: true });

// --- '<n> grand loop[s]' is a Z directive: sets z, stripped from task/spec ---
parseCase('grand loops sets Z, with spec', 'build x with 3 opus, 2 grand loops @@FL',
  { n: 3, z: 2, assignment: ['opus', 'opus', 'opus'] }, { noErrors: true });
parseCase('grand loop singular -> z=1', 'do abc with 2 opus, 1 grand loop @@FL',
  { n: 2, z: 1, assignment: ['opus', 'opus'] }, { noErrors: true });
parseCase('grand loops with explicit sigil N (no spec)', 'tidy up @@FL:3 2 grand loops',
  { task: 'tidy up', n: 3, mode: 1, z: 2, assignment: null }, { noErrors: true });
// 'grand' is NOT a model token -> the literal repro no longer errors.
parseCase('grand loop does NOT error on "grand"', '@@FL 2 minimax, 1 grand loop, do X',
  { n: 2, z: 1, assignment: ['minimax-m3', 'minimax-m3'] }, { noErrors: true });
// A prose grand-loop count over the ceiling is rejected like the sigil Z.
parseCase('grand loops over ceiling', 'tidy up @@FL:3 9 grand loops',
  { n: null, z: 9 }, { errorIncludes: 'exceeds the grand-loop ceiling' });
// Sigil :Z and prose 'N grand loops' that DISAGREE -> loud conflict error.
parseCase('grand loop conflicts with sigil Z', 'improve X @@FL:4:1:2 with 3 grand loops',
  {}, { errorIncludes: 'Grand-loop count conflict' });
// Ordinary 'grand' as task noun (no count immediately before, no 'loop[s]' after)
// is NOT treated as a directive and is left in the task text.
parseCase('ordinary grand noun untouched', 'redesign the grand staircase @@FL:5',
  { task: 'redesign the grand staircase', n: 5, z: 1, assignment: null }, { noErrors: true });

// ===========================================================================
// D-0006 — prose 'two pass' / 'single pass' / 'one pass' sets the mode.
// ===========================================================================
parseCase('D-0006 two pass -> mode 2', '@@FL two pass, 2 opus, 2 sonnet do X',
  { task: 'do X', n: 4, mode: 2, z: 1, assignment: ['opus', 'opus', 'sonnet', 'sonnet'] }, { noErrors: true });
parseCase('D-0006 two-pass (hyphen) -> mode 2', '@@FL two-pass, 2 opus, 2 sonnet do X',
  { task: 'do X', n: 4, mode: 2, assignment: ['opus', 'opus', 'sonnet', 'sonnet'] }, { noErrors: true });
parseCase('D-0006 single pass -> mode 1', 'refactor @@FL:4 single pass',
  { task: 'refactor', n: 4, mode: 1, z: 1 }, { noErrors: true });
parseCase('D-0006 one pass -> mode 1', 'do x @@FL:4 one pass',
  { mode: 1 }, { noErrors: true });
parseCase('D-0006 prose marker + two pass', 'do X farnsworth loop:4 two pass',
  { n: 4, mode: 2 }, { noErrors: true });
// sigil :M wins; agreeing prose is fine.
parseCase('D-0006 sigil M=2 agrees with two pass', '@@FL:4:2 two pass, do X',
  { task: 'do X', n: 4, mode: 2 }, { noErrors: true });
// sigil :M vs prose DISAGREE -> loud conflict error, n nulled.
parseCase('D-0006 sigil M vs prose conflict', '@@FL:4:2 single pass, do X',
  { n: null }, { errorIncludes: 'Pass-count conflict' });
// false-positive guard: 'two passes of feedback' is NOT 'two pass' -> mode stays 1.
parseCase('D-0006 "two passes" does NOT flip mode', 'review @@FL:4 give me two passes of feedback',
  { mode: 1, n: 4 }, { noErrors: true });
// --- D-0006 OVER-MATCH regressions (adversarial-review catch): a hyphenated /
// mid-task pass adjective is NOT a directive — it must not flip the mode, raise a
// false conflict, refuse the run, or be eaten from the task. ---
parseCase('D-0006 "two-pass compiler" task is NOT a directive', 'build a two-pass compiler @@FL:4',
  { task: 'build a two-pass compiler', n: 4, mode: 1, z: 1 }, { noErrors: true });
parseCase('D-0006 "two-pass build" does NOT cause a false conflict', 'replace the two-pass build with a faster one @@FL:5:1',
  { n: 5, mode: 1 }, { noErrors: true });
parseCase('D-0006 "single-pass renderer" task kept; sigil mode honoured', 'optimize the single-pass renderer @@FL:5:2',
  { task: 'optimize the single-pass renderer', n: 5, mode: 2 }, { noErrors: true });
parseCase('D-0006 mid-task "two-pass" after spec is kept', '@@FL:4:1 with 2 opus, 2 sonnet, rewrite the two-pass tokenizer',
  { task: 'rewrite the two-pass tokenizer', n: 4, mode: 1, assignment: ['opus', 'opus', 'sonnet', 'sonnet'] }, { noErrors: true });
// a directive immediately followed by the spec (no comma) still works (clause boundary = the digit).
parseCase('D-0006 directive then spec digit', '@@FL two pass 2 opus, 2 sonnet, do the thing',
  { task: 'do the thing', n: 4, mode: 2, assignment: ['opus', 'opus', 'sonnet', 'sonnet'] }, { noErrors: true });

// ===========================================================================
// D-0007 — task text after a leading @@FL marker is captured (not dropped).
// ===========================================================================
parseCase('D-0007 marker-first spec + task', '@@FL 2 opus, fix the parser bug',
  { task: 'fix the parser bug', n: 2, mode: 1, z: 1, assignment: ['opus', 'opus'] }, { noErrors: true });
parseCase('D-0007 sigil N + trailing task', '@@FL:2 do the thing',
  { task: 'do the thing', n: 2 }, { noErrors: true });
parseCase('D-0007 spec + task both after marker', '@@FL:4 with 2 opus and 2 sonnet, refactor the parser',
  { task: 'refactor the parser', n: 4, assignment: ['opus', 'opus', 'sonnet', 'sonnet'] }, { noErrors: true });
parseCase('D-0007 bare marker-first task -> needsGate, task kept', '@@FL fix the parser bug',
  { task: 'fix the parser bug', n: null, needsGate: true }, { noErrors: true });
// regression: pre-marker task still works.
parseCase('D-0007 pre-marker task unchanged', 'fix the bug @@FL:2',
  { task: 'fix the bug', n: 2 }, { noErrors: true });
// D-0006 + D-0007 together: the original failing invocation shape.
parseCase('D-0006+D-0007 combined', '@@FL two pass, 2 opus, 2 sonnet, build a CSV parser',
  { task: 'build a CSV parser', n: 4, mode: 2, assignment: ['opus', 'opus', 'sonnet', 'sonnet'] }, { noErrors: true });
// D-0007 leading-word: a task that legitimately STARTS with 'with'/'and'/'using'
// must NOT have that word eaten (the spec's own connector is absorbed separately).
parseCase('D-0007 leading "with" kept', '@@FL:3 with great care, refactor',
  { task: 'with great care, refactor', n: 3 }, { noErrors: true });
parseCase('D-0007 leading "and" kept', '@@FL:3 and then ship it',
  { task: 'and then ship it', n: 3 }, { noErrors: true });

// ===========================================================================
// unit-level normaliser / helpers.
// ===========================================================================
unit('normalise opus', normaliseModel('opus') && normaliseModel('opus').model === 'opus');
unit('normalise codex high', normaliseModel('codex high') && normaliseModel('codex high').model === 'codex-high');
unit('normalise codex-high dash', normaliseModel('codex-high') && normaliseModel('codex-high').model === 'codex-high');
unit('normalise bare glm', normaliseModel('glm') && normaliseModel('glm').model === 'glm-5.2');
unit('normalise unknown -> null', normaliseModel('gpt4') === null);
unit('topMixed N=2', eq(topMixedAssignment(2), ['opus', 'glm-5.2']));
unit('topMixed N=6', eq(topMixedAssignment(6), ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high', 'codex-high']));
unit('topMixed N=5', eq(topMixedAssignment(5), ['opus', 'opus', 'glm-5.2', 'glm-5.2', 'codex-high']));
unit('expandSpec basic', eq(expandSpec('2 opus, 1 sonnet').assignment, ['opus', 'opus', 'sonnet']));
unit('Z_MAX is 5', Z_MAX === 5);

// ===========================================================================
// report.
// ===========================================================================
console.log(`\nfl-parse tests: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
