#!/usr/bin/env node
// fl-parse.mjs — Farnsworth Loop Phase-0 parser + normaliser (Feature 2).
//
// Single source of truth for the @@FL sigil / prose-marker grammar, the prose
// model spec, the strict normaliser, the Top Mixed preset, and the
// explicit-N-vs-prose conflict rule.
//
// Pure & deterministic: no Date, no random, no I/O except the tiny CLI guard at
// the bottom. NEVER throws on user input — every failure becomes an errors[]
// entry and n/assignment are nulled so a careless caller can't run the wrong
// tournament.
//
// CLI:   node fl-parse.mjs "<raw user message>"
// Prints { task, n, mode, z, assignment, preset?, conflict?, errors?, needsGate? }
//
// Z is parsed as INERT plumbing only (Feature 1 not implemented): validated
// (int >= 1), and if Z > 1 a single 'grand loops not yet implemented' error is
// emitted. Nothing acts on Z here.

// ---------------------------------------------------------------------------
// Normaliser table (the strict gate). alias -> { model, dispatch }.
// Keys are the *canonicalised* token form (lowercased, internal whitespace
// collapsed to single spaces, surrounding whitespace trimmed). We deliberately
// do NOT blanket-replace '.'/'_' so version tokens like 'glm 5.2' survive.
// ---------------------------------------------------------------------------
const NORMALISER = {
  // Anthropic
  'opus':   { model: 'opus',   dispatch: 'anthropic' },
  'sonnet': { model: 'sonnet', dispatch: 'anthropic' },
  'haiku':  { model: 'haiku',  dispatch: 'anthropic' },

  // GLM (z.ai). Bare 'glm' defaults to glm-5.2 (documented strongest).
  'glm':         { model: 'glm-5.2',     dispatch: 'glm' },
  'glm 5.2':     { model: 'glm-5.2',     dispatch: 'glm' },
  'glm-5.2':     { model: 'glm-5.2',     dispatch: 'glm' },
  'glm 5.1':     { model: 'glm-5.1',     dispatch: 'glm' },
  'glm-5.1':     { model: 'glm-5.1',     dispatch: 'glm' },
  'glm 4.7':     { model: 'glm-4.7',     dispatch: 'glm' },
  'glm-4.7':     { model: 'glm-4.7',     dispatch: 'glm' },
  'glm 4.5 air': { model: 'glm-4.5-air', dispatch: 'glm' },
  'glm-4.5-air': { model: 'glm-4.5-air', dispatch: 'glm' },
  'glm 4.5-air': { model: 'glm-4.5-air', dispatch: 'glm' },
  'air':         { model: 'glm-4.5-air', dispatch: 'glm' },

  // Codex (OpenAI, pinned gpt-5.5; the axis is reasoning effort).
  // Bare 'codex' defaults to codex-medium (codex's own default).
  'codex':            { model: 'codex-medium', dispatch: 'codex' },
  'codex low':        { model: 'codex-low',    dispatch: 'codex' },
  'codex medium':     { model: 'codex-medium', dispatch: 'codex' },
  'codex high':       { model: 'codex-high',   dispatch: 'codex' },
  'codex xhigh':      { model: 'codex-xhigh',  dispatch: 'codex' },
  'codex x-high':     { model: 'codex-xhigh',  dispatch: 'codex' },
  'codex extra high': { model: 'codex-xhigh',  dispatch: 'codex' },

  // MiniMax (new provider since the design doc). Like any single-model provider.
  'minimax':    { model: 'minimax-m3', dispatch: 'minimax' },
  'minimax-m3': { model: 'minimax-m3', dispatch: 'minimax' },
  'minimax m3': { model: 'minimax-m3', dispatch: 'minimax' },
  'm3':         { model: 'minimax-m3', dispatch: 'minimax' },
};

// Top Mixed preset pool, in remainder-priority order.
const TOP_MIXED_POOL = ['opus', 'glm-5.2', 'codex-high'];

// Recognised model token alternatives for the SPEC scan. These match the
// HEAD of an item (after the count); the normaliser then validates exactly.
// Order matters: longer / more-specific patterns first so we capture the full
// token (e.g. 'codex high' not just 'codex').
const MODEL_TOKEN_RX =
  '(?:' +
    'codex(?:\\s*-?\\s*(?:low|medium|high|xhigh|x-?high|extra\\s*high))?' +
    '|glm(?:\\s*-?\\s*[0-9](?:\\.[0-9])?)?(?:\\s*-?\\s*air)?' +
    '|opus|sonnet|haiku' +
    '|minimax(?:\\s*-?\\s*m3)?|m3' +
  ')';

// Connectors that license capturing an *arbitrary* (possibly unknown) token as
// a spec item — used by the second-stage scan so unknowns are caught loudly
// without treating ordinary '<digit> <noun>' task text as a spec.
const CONNECTOR_BEFORE = '(?:with|using)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canon(tok) {
  return String(tok).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Normalise one captured model token to { model, dispatch } or null if unknown.
function normaliseModel(rawToken) {
  let t = canon(rawToken);
  if (!t) return null;

  // Direct hit on the table.
  if (NORMALISER[t]) return NORMALISER[t];

  // Tolerate a dash where the table has a space and vice-versa for the
  // multi-word codex/glm forms (e.g. 'codex-high' <-> 'codex high'). We try a
  // small set of equivalent spellings WITHOUT mangling version numbers.
  const dashToSpace = t.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  if (NORMALISER[dashToSpace]) return NORMALISER[dashToSpace];

  const spaceToDash = t.replace(/\s+/g, '-');
  if (NORMALISER[spaceToDash]) return NORMALISER[spaceToDash];

  // 'x high' / 'xhigh' / 'extra high' codex variants already covered; handle
  // 'codex' followed by an unusual-but-equivalent spacing of effort.
  const codexCollapsed = t.replace(/^codex\s*-?\s*/, 'codex ').replace(/\s+/g, ' ').trim();
  if (NORMALISER[codexCollapsed]) return NORMALISER[codexCollapsed];

  // Local ids: a live local id is accepted verbatim by the caller (we can't
  // see the omlx list here). Heuristic: a token that is NOT one of our known
  // provider families but *looks* like a model id (contains a dash and is not
  // a plain English word) could be local. We do NOT guess here — local ids are
  // long/dynamic, the design says accept-verbatim-if-typed but never fuzzy
  // match. Caller handles local via the interactive Mixed menu, so the parser
  // treats an unrecognised token as a hard error (never silently dropped).
  return null;
}

// Parse an integer segment that may be empty. Returns { present, value }.
function intSeg(raw) {
  if (raw === undefined || raw === null || raw === '') return { present: false, value: null };
  const v = parseInt(raw, 10);
  if (Number.isNaN(v)) return { present: true, value: null };
  return { present: true, value: v };
}

// ---------------------------------------------------------------------------
// Sigil / prose-marker detection.
// ---------------------------------------------------------------------------
// We capture each colon segment as \d* (NOT \d+) so an empty segment (a
// positional skip like '@@FL:5::3') is distinguishable from a supplied one.
// The trailing-segment groups are kept optional so '@@FL', '@@FL:5',
// '@@FL:5:2' and '@@FL:5:2:3' all match.
const SIGIL_RX = /@@fl(?:\s*:\s*(\d*))?(?:\s*:\s*(\d*))?(?:\s*:\s*(\d*))?/i;
const PROSE_RX = /farnsworth\s+loop(?:\s*:\s*(\d*))?(?:\s*:\s*(\d*))?(?:\s*:\s*(\d*))?/i;

// ---------------------------------------------------------------------------
// Prose model-spec scan (two-stage).
//   Stage 1: match a chain of '<count> <recognised-model>' items.
//   Stage 2: if a connector ('with'/'using') OR a comma/'and' joins items and
//            one item carries an unrecognised model-ish token, capture it too
//            so the normaliser can reject it loudly (never drop -> never change N).
// ---------------------------------------------------------------------------

// A single recognised item: <count> <model token>.
const ITEM_RX = new RegExp('(\\d+)\\s*(' + MODEL_TOKEN_RX + ')', 'i');

// Find the prose spec region in the message. Returns
// { found, start, end, raw } where [start,end) is the slice to strip, or
// { found:false }.
function locateSpec(msg) {
  // Build a global regex that matches a run of recognised items joined by
  // commas / 'and' / whitespace, optionally introduced by a connector.
  // We iterate item-by-item (NOT one giant variable-length capture) to reliably
  // capture middle items.
  const chainRx = new RegExp(
    '(\\d+\\s*' + MODEL_TOKEN_RX + ')' +                       // first item
    '(?:\\s*(?:,\\s*and|,|and)\\s*\\d+\\s*' + MODEL_TOKEN_RX + ')*', // more
    'ig'
  );

  let best = null;
  let m;
  while ((m = chainRx.exec(msg)) !== null) {
    if (m[0].length === 0) { chainRx.lastIndex++; continue; }
    // Require that this run is "spec-like": either it has >=2 items, or it is
    // near a connector / comma / 'and', or the single item's model token is a
    // recognised model (not an ordinary noun). Because ITEM model tokens here
    // are drawn from MODEL_TOKEN_RX (real model families only), a lone
    // '3 glm' is fine; '3 bugs' never matches because 'bugs' isn't a model
    // token. So any match here is already spec-grade.
    if (!best || m[0].length > best.raw.length) {
      best = { found: true, start: m.index, end: m.index + m[0].length, raw: m[0] };
    }
  }
  return best || { found: false };
}

// Given a located spec slice, expand it into an assignment array, collecting
// unknown tokens as errors. Returns { assignment, count, unknowns[] }.
function expandSpec(specRaw) {
  const assignment = [];
  const unknowns = [];
  // Iterate per item.
  const itemFinder = new RegExp('(\\d+)\\s*(' + MODEL_TOKEN_RX + ')', 'ig');
  let m;
  let any = false;
  while ((m = itemFinder.exec(specRaw)) !== null) {
    any = true;
    const count = parseInt(m[1], 10);
    const norm = normaliseModel(m[2]);
    if (!norm) {
      unknowns.push(m[2].trim());
      continue; // recorded as unknown; do NOT drop silently — surfaced below.
    }
    for (let i = 0; i < count; i++) assignment.push(norm.model);
  }
  return { assignment, count: any ? assignment.length : 0, unknowns, any };
}

// Detect a connector-licensed UNKNOWN token: '<count> <arbitrary>' sitting next
// to 'with'/'using'/','/'and'. This catches typos like '1 gpt4' that the
// recognised-token scan misses, so they error instead of silently shrinking N.
function locateUnknownNearConnector(msg) {
  // <connector> <count> <word(s)>   e.g. 'with 1 gpt4'
  const afterConnector = new RegExp(
    '\\b' + CONNECTOR_BEFORE + '\\s+(\\d+)\\s+([a-z][\\w.+-]*)',
    'ig'
  );
  // ', <count> <word>' or 'and <count> <word>' or 'X, 1 gpt4'
  const afterJoiner = new RegExp(
    '(?:,|\\band\\b)\\s*(\\d+)\\s+([a-z][\\w.+-]*)',
    'ig'
  );
  const hits = [];
  let m;
  while ((m = afterConnector.exec(msg)) !== null) hits.push({ count: m[1], tok: m[2] });
  while ((m = afterJoiner.exec(msg)) !== null) hits.push({ count: m[1], tok: m[2] });
  return hits;
}

// ---------------------------------------------------------------------------
// Top Mixed preset.
//   keyword 'top mixed' / 'top-mix' / 'top mix' + an N -> allocate N across
//   [opus, glm-5.2, codex-high] as evenly as possible, remainder priority
//   opus > glm-5.2 > codex-high. N2 special-cases to opus+glm-5.2 (1/1/0).
// ---------------------------------------------------------------------------
const TOP_MIXED_RX = /\btop[\s-]*mix(?:ed)?\b/i;
// A leading count for top mixed, e.g. '6 top mixed'.
const TOP_MIXED_LEADCOUNT_RX = /(\d+)\s*top[\s-]*mix(?:ed)?\b/i;

function topMixedAssignment(n) {
  if (n === 2) return ['opus', 'glm-5.2']; // 1/1/0 by spec
  const base = Math.floor(n / 3);
  let rem = n % 3;
  const counts = [base, base, base];
  for (let i = 0; i < 3 && rem > 0; i++, rem--) counts[i]++;
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < counts[i]; j++) out.push(TOP_MIXED_POOL[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main parse.
// ---------------------------------------------------------------------------
function parse(rawInput) {
  const result = {
    task: '',
    n: null,
    mode: null,   // 1 = single, 2 = two pass
    z: 1,
    assignment: null,
    needsGate: false,
  };
  const errors = [];

  if (typeof rawInput !== 'string') {
    errors.push('Input must be a string.');
    result.errors = errors;
    return result;
  }
  const msg = rawInput;

  // --- 1. Find the marker (sigil preferred, else prose). ---
  const sigil = SIGIL_RX.exec(msg);
  const prose = PROSE_RX.exec(msg);

  let marker = null;       // { kind, index, length, nSeg, mSeg, zSeg }
  if (sigil) {
    marker = {
      kind: 'sigil',
      index: sigil.index,
      length: sigil[0].length,
      nSeg: intSeg(sigil[1]),
      mSeg: intSeg(sigil[2]),
      zSeg: intSeg(sigil[3]),
      // raw text after '@@FL' (for positional-skip detection)
      rawTail: sigil[0],
    };
  } else if (prose) {
    marker = {
      kind: 'prose',
      index: prose.index,
      length: prose[0].length,
      nSeg: intSeg(prose[1]),
      mSeg: intSeg(prose[2]),
      zSeg: intSeg(prose[3]),
      rawTail: prose[0],
    };
  }

  if (!marker) {
    // No marker at all. Caller decides whether to trigger on plain language;
    // here we just report no usable invocation.
    errors.push('No @@FL sigil or "farnsworth loop:N" marker found.');
    result.errors = errors;
    return result;
  }

  // --- 2. Detect positional skips (empty middle segment). ---
  // A skip looks like '@@FL:5::3' — N present, M EMPTY, Z present. Because we
  // captured \d* per segment, an empty-but-colon-supplied M shows as
  // present:false on mSeg while zSeg is present:true. We must distinguish
  // "M omitted, Z omitted" (fine) from "M skipped, Z given" (forbidden).
  // Count the colon groups actually written in the marker text.
  const colonSegs = countColonSegments(marker.rawTail);
  // colonSegs: how many ':' separators were written. If a later segment has a
  // value but an earlier one is empty -> positional skip.
  if (marker.zSeg.present && !marker.mSeg.present && marker.zSeg.value !== null) {
    errors.push(
      'Positional skip not allowed: "' + marker.rawTail.trim() +
      '". To set Z with default M, write @@FL:N:1:Z (e.g. @@FL:5:1:3).'
    );
  }
  if (marker.mSeg.present && !marker.nSeg.present && marker.nSeg.value === null &&
      marker.kind === 'sigil' && colonSegs >= 2 && isEmptyFirstColonSeg(marker.rawTail)) {
    // '@@FL::2' — empty N is allowed ONLY if a prose spec will supply N; we
    // record nothing here and let the conflict/needsGate logic decide later.
  }

  // --- 3. Extract task = everything before the marker, separator-stripped. ---
  let task = msg.slice(0, marker.index);
  // Also strip the spec region and top-mixed keyword from the task later.

  // --- 4. M / mode. ---
  let mode = 1;
  if (marker.mSeg.present) {
    if (marker.mSeg.value === 1) mode = 1;
    else if (marker.mSeg.value === 2) mode = 2;
    else {
      errors.push(
        'Invalid pass count M=' + (marker.mSeg.value === null ? '(empty)' : marker.mSeg.value) +
        '. Only 1 (single) or 2 (two pass) are valid.'
      );
      mode = null;
    }
  }
  result.mode = mode;

  // --- 5. Z (inert plumbing). ---
  let z = 1;
  if (marker.zSeg.present) {
    if (marker.zSeg.value === null || marker.zSeg.value < 1) {
      errors.push('Invalid Z=' + (marker.zSeg.value === null ? '(empty)' : marker.zSeg.value) +
        '. Z must be an integer >= 1.');
    } else {
      z = marker.zSeg.value;
      if (z > 1) {
        errors.push('grand loops not yet implemented (Z=' + z + '). Z>1 is inert plumbing; re-run with Z=1.');
      }
    }
  }
  result.z = z;

  // --- 6. Sigil/marker N. ---
  let nMarker = null;
  if (marker.nSeg.present) {
    if (marker.nSeg.value === null) {
      // explicit empty N segment (e.g. '@@FL::2') — N must come from prose.
      nMarker = null;
    } else {
      nMarker = marker.nSeg.value;
    }
  }

  // --- 7. Prose model spec scan + Top Mixed. ---
  // Work against the FULL message (spec/keyword can appear anywhere).
  let assignment = null;
  let preset = null;
  let nSpec = null;

  const topMixedPresent = TOP_MIXED_RX.test(msg);
  let topMixedLeadCount = null;
  const tmLead = TOP_MIXED_LEADCOUNT_RX.exec(msg);
  if (tmLead) topMixedLeadCount = parseInt(tmLead[1], 10);

  // Locate a recognised-item spec (not Top Mixed).
  const spec = locateSpec(msg);

  // Connector-licensed unknown tokens (loud rejection of typos).
  const unknownHits = locateUnknownNearConnector(msg);

  if (topMixedPresent) {
    preset = 'top-mixed';
    // N for top mixed: leading count, else sigil/marker N.
    let tmN = topMixedLeadCount != null ? topMixedLeadCount : nMarker;
    if (tmN != null) {
      // If BOTH a leading count and a marker N are present and disagree -> conflict.
      if (topMixedLeadCount != null && nMarker != null && topMixedLeadCount !== nMarker) {
        result.conflict = {
          markerN: nMarker,
          specN: topMixedLeadCount,
          reason: 'Top Mixed leading count (' + topMixedLeadCount + ') disagrees with marker N (' + nMarker + ').',
        };
        result.assignment = null;
        result.n = null;
        result.preset = preset;
        // strip & set task, then return below.
        result.task = stripAll(task, spec, msg, marker).trim();
        if (errors.length) result.errors = errors;
        return result;
      }
      if (tmN < 2) {
        errors.push('Top Mixed needs N >= 2 (got N=' + tmN + ').');
      } else {
        assignment = topMixedAssignment(tmN);
        nSpec = tmN;
      }
    } else {
      // Top Mixed with no N anywhere -> need the gate to supply N.
      result.needsGate = true;
    }
  } else if (spec.found) {
    const exp = expandSpec(spec.raw);
    // Merge in any connector-licensed unknowns that the recognised scan missed.
    const allUnknowns = exp.unknowns.slice();
    for (const h of unknownHits) {
      const norm = normaliseModel(h.tok);
      if (!norm && !allUnknowns.includes(h.tok)) allUnknowns.push(h.tok);
    }
    if (allUnknowns.length) {
      errors.push(
        'Unrecognised model token(s) in spec: ' + allUnknowns.map(u => '"' + u + '"').join(', ') +
        '. Known: opus, sonnet, haiku, glm[-5.2/5.1/4.7/4.5-air], codex[-low/medium/high/xhigh], ' +
        'minimax-m3, or a live local id. Re-state the spec (a dropped token would silently change N).'
      );
      assignment = null;
      nSpec = null;
    } else if (exp.count > 0) {
      assignment = exp.assignment;
      nSpec = exp.count;
    }
  } else {
    // No spec / no top-mixed. But still check for a lone connector-licensed
    // unknown (e.g. 'run with 1 gpt4 @@FL:5') so we reject loudly.
    const realUnknowns = [];
    for (const h of unknownHits) {
      const norm = normaliseModel(h.tok);
      if (!norm) realUnknowns.push(h.tok);
    }
    if (realUnknowns.length) {
      errors.push(
        'Unrecognised model token(s) near a connector: ' +
        realUnknowns.map(u => '"' + u + '"').join(', ') +
        '. If this is a model spec, use a known token; otherwise it was ignored.'
      );
      // Do not set assignment; if no marker N either, gate kicks in below.
    }
  }

  // --- 8. Explicit-N-vs-prose conflict (the one place we must not guess). ---
  if (nMarker != null && nSpec != null && nMarker !== nSpec) {
    result.conflict = {
      markerN: nMarker,
      specN: nSpec,
      reason: 'Marker says N=' + nMarker + ' but the prose spec sums to ' + nSpec + '.',
    };
    result.n = null;
    result.assignment = null;
    if (preset) result.preset = preset;
    result.task = stripAll(task, spec, msg, marker).trim();
    if (errors.length) result.errors = errors;
    return result;
  }

  // --- 9. Resolve N + assignment + gate. ---
  let n = nSpec != null ? nSpec : nMarker;

  if (n == null && !result.needsGate) {
    // Bare @@FL with no spec, no marker N, no top-mixed-needs-N -> interactive gate.
    result.needsGate = true;
  }

  // Validate N range when we do have one.
  if (n != null) {
    if (n < 2) {
      errors.push('N must be an integer >= 2 (got N=' + n + ').');
      n = null;
      assignment = null;
    }
  }

  result.n = n;
  result.assignment = assignment;
  if (preset) result.preset = preset;

  // --- 10. Build the task text (strip marker + spec + top-mixed keyword). ---
  result.task = stripAll(task, spec, msg, marker).trim();

  // --- 11. On any error, null out n/assignment so a careless caller can't run
  //         the wrong tournament. (mode/z/task/errors stay for the message.) ---
  if (errors.length) {
    result.errors = errors;
    result.n = null;
    result.assignment = null;
  }

  return result;
}

// Count how many ':' separators were written in the marker tail.
function countColonSegments(rawTail) {
  const m = rawTail.match(/:/g);
  return m ? m.length : 0;
}

function isEmptyFirstColonSeg(rawTail) {
  // matches '@@fl::' (first segment empty)
  return /@@fl\s*:\s*:/i.test(rawTail);
}

// Build the task text: take everything before the marker, then remove any spec
// slice and top-mixed keyword that fell within it, and strip a trailing
// separator colon. The spec/keyword are searched within the pre-marker text.
function stripAll(preMarkerTask, spec, fullMsg, marker) {
  let t = preMarkerTask;

  // Remove top-mixed phrases (with optional leading count) from the task.
  t = t.replace(/(\d+\s*)?top[\s-]*mix(?:ed)?/ig, ' ');

  // Remove recognised model-spec chains from the task. Re-run the chain regex
  // on the task text only (the spec may have been before the marker).
  const chainRx = new RegExp(
    '(?:\\bwith\\b|\\busing\\b)?\\s*' +
    '(\\d+\\s*' + MODEL_TOKEN_RX + ')' +
    '(?:\\s*(?:,\\s*and|,|and)\\s*\\d+\\s*' + MODEL_TOKEN_RX + ')*',
    'ig'
  );
  t = t.replace(chainRx, ' ');

  // Collapse whitespace, strip dangling commas / connectors / trailing colon.
  t = t.replace(/\s+/g, ' ')
       .replace(/[\s,]+(with|using|and)\s*$/i, '')
       .replace(/\s*[:,]\s*$/, '')
       .replace(/\s+(with|using)\s*$/i, '')
       .trim();
  return t;
}

// ---------------------------------------------------------------------------
// Exports (for the test file).
// ---------------------------------------------------------------------------
export {
  parse,
  normaliseModel,
  topMixedAssignment,
  expandSpec,
  locateSpec,
  NORMALISER,
  TOP_MIXED_POOL,
};

// ---------------------------------------------------------------------------
// CLI guard (self-printing). Only runs when invoked directly.
// ---------------------------------------------------------------------------
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` ||
           (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, '')));
  } catch { return false; }
})();

if (isMain) {
  const raw = process.argv.slice(2).join(' ');
  let out;
  try {
    out = parse(raw);
  } catch (e) {
    out = { task: '', n: null, mode: null, z: 1, assignment: null,
            errors: ['internal parse error: ' + (e && e.message ? e.message : String(e))] };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
