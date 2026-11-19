/**
 * Automated test suite (Milestone 2). Run with `node --test` from the project root.
 *
 * Test IDs follow the M1 test plan (docs/milestone1/M1_Design_Document.md §14, TC-01 … TC-21); TC-22 onwards
 * were added in M2 so that every README feature has a test. Categories: Normal, Invalid input,
 * Boundary, Mathematical correctness, Performance.
 *
 * Every check records the machine, the input, the expected (hand-worked) result and the observed
 * result, and prints the observed result into the log. With TEST_RESULTS=<file> set, the records
 * are written to JSON; tests/make-test-table.js turns them into TestCases/test_cases.md.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseMachine, parseTableText, toTableText, toSpec } = require('../src/core/parser.js');
const { mealyToMoore } = require('../src/core/mealyToMoore.js');
const { compareOnWord, randomWords, toSymbols } = require('../src/core/simulate.js');
const { checkEquivalence } = require('../src/core/equivalence.js');
const { showWord } = require('../src/core/model.js');
const { FILES, spec, load, lcg, randomMealy } = require('./fixtures.js');

const results = [];
after(() => {
  if (process.env.TEST_RESULTS) fs.writeFileSync(process.env.TEST_RESULTS, JSON.stringify(results, null, 2));
});

/**
 * Record one expected-vs-observed check for the test table, log the observation, and assert it.
 * @param {import('node:test').TestContext} t
 * @param {{id: string, category: string, feature: string, machine: string, input: string,
 *          expected: string, actual: string, detail?: string, evidence?: string}} rec
 */
function check(t, rec) {
  results.push({ ...rec, status: rec.actual === rec.expected ? 'Pass' : 'Fail', test: t.name });
  t.diagnostic(`${rec.id} observed: ${rec.actual}${rec.detail ? ` (${rec.detail})` : ''}`);
  assert.equal(rec.actual, rec.expected);
}

// ---- formatters: hand-worked expectations are written in the same text form ----
const set = (xs) => `{${xs.join(',')}}`;
const incomingOf = (res) => Object.entries(res.incoming).map(([q, o]) => `O(${q})=${set(o)}`).join(' ');
const statesOf = (m) => m.states.map((s) => `${s}/${m.out[s]}`).join(' ');
const deltaOf = (m) => m.states.map((s) => `${s}:${m.inputs.map((a) => m.delta[s][a]).join(',')}`).join(' ');
const pairs = (n) => `${n} pair${n === 1 ? '' : 's'}`;
function runOn(mealy, moore, w) {
  const r = compareOnWord(mealy, moore, w === 'ε' ? [] : toSymbols(w, mealy.inputs));
  return `${w}: Mealy ${showWord(r.mealy.outputs)}, Moore ${showWord(r.moore.outputs)} → ${showWord(r.mooreDropped)} ${r.match ? '✓' : '✗'}`;
}
function verdict(mealy, moore) {
  const eq = checkEquivalence(mealy, moore);
  return eq.equivalent ? `equivalent (${pairs(eq.pairsExplored)})` : `not equivalent, counterexample ${showWord(eq.counterexample)}`;
}
const errorsOf = (input, opts) => parseMachine(input, opts).errors.join(' | ');
const HAND = 'Hand-worked trace (report §6)';

// ===================== Normal cases =====================

test('TC-01 Example 1: conversion and trace on 0111 match the hand-worked solution', (t) => {
  const mealy = load('ex1');
  const res = mealyToMoore(mealy);
  const m = res.machine;
  check(t, {
    id: 'TC-01', category: 'Normal', feature: 'Mealy → Moore conversion (Algorithm A)', machine: FILES.ex1, input: 'convert; w = 0111',
    expected: 'O(q0)={0} O(q1)={0,1} | [q0,0]/0 [q1,0]/0 [q1,1]/1 | δ′ [q0,0]:[q0,0],[q1,0] [q1,0]:[q0,0],[q1,1] [q1,1]:[q0,0],[q1,1] | start [q0,0] | 0111: Mealy 0011, Moore 00011 → 0011 ✓ | equivalent (3 pairs)',
    actual: [incomingOf(res), statesOf(m), 'δ′ ' + deltaOf(m), 'start ' + m.start, runOn(mealy, m, '0111'), verdict(mealy, m)].join(' | '),
    evidence: `${HAND}; design doc §12.1; Screenshots 01–05`,
  });
});

test('TC-02 three classic Mealy machines: conversions match hand-worked results', (t) => {
  const cases = [
    ['TC-02a', 'complement', '0110', 'O(q)={0,1} | [q,0]/0 [q,1]/1 | start [q,0] | 0110: Mealy 1001, Moore 01001 → 1001 ✓ | equivalent (2 pairs)'],
    ['TC-02b', 'parity', '1101', 'O(E)={0} O(O)={1} | [E,0]/0 [O,1]/1 | start [E,0] | 1101: Mealy 1001, Moore 01001 → 1001 ✓ | equivalent (2 pairs)'],
    ['TC-02c', 'detect101', '10101', 'O(a)={0} O(b)={0,1} O(c)={0} | [a,0]/0 [b,0]/0 [b,1]/1 [c,0]/0 | start [a,0] | 10101: Mealy 00101, Moore 000101 → 00101 ✓ | equivalent (4 pairs)'],
  ];
  for (const [id, name, w, expected] of cases) {
    const mealy = load(name);
    const res = mealyToMoore(mealy);
    check(t, {
      id, category: 'Normal', feature: 'Mealy → Moore conversion (Algorithm A)', machine: FILES[name], input: `convert; w = ${w}`, expected,
      actual: [incomingOf(res), statesOf(res.machine), 'start ' + res.machine.start, runOn(mealy, res.machine, w), verdict(mealy, res.machine)].join(' | '),
      evidence: HAND,
    });
  }
});

// ===================== Boundary cases =====================

test('TC-03 Example 2: a state entered with every output symbol gets |Δ| copies', (t) => {
  const mealy = load('ex2');
  const res = mealyToMoore(mealy);
  const copiesOfP = res.machine.states.filter((s) => res.origin[s].q === 'p');
  check(t, {
    id: 'TC-03a', category: 'Boundary', feature: 'State splitting', machine: FILES.ex2, input: 'convert',
    expected: 'O(p)={x,y,z} → [p,x] [p,y] [p,z]',
    actual: `O(p)=${set(res.incoming.p)} → ${copiesOfP.join(' ')}`, evidence: `${HAND}; design doc §12.2`,
  });
  check(t, {
    id: 'TC-03b', category: 'Normal', feature: 'Mealy → Moore conversion (Algorithm A)', machine: FILES.ex2, input: 'convert; w = abba, aab',
    expected: 'created 7, removed [r,z],[d,z], |Q′| = 5 ≤ 12 | abba: Mealy xxxy, Moore xxxxy → xxxy ✓ | aab: Mealy xzx, Moore xxzx → xzx ✓ | equivalent (5 pairs)',
    actual: `created ${res.createdCount}, removed ${res.removed.join(',')}, |Q′| = ${res.machine.states.length} ≤ ${res.bound} | ` +
      [runOn(mealy, res.machine, 'abba'), runOn(mealy, res.machine, 'aab'), verdict(mealy, res.machine)].join(' | '),
    evidence: `${HAND}; Screenshot 07`,
  });
});

test('TC-04 start state with no incoming transitions gets one copy [q,−] with the default output', (t) => {
  const mealy = load('ex2');
  const res = mealyToMoore(mealy);
  const flagged = res.steps.some((s) => s.rule === 'A3' && s.data.state === '[s,-]' && s.data.defaulted);
  check(t, {
    id: 'TC-04a', category: 'Boundary', feature: 'State with no incoming transitions', machine: FILES.ex2, input: 'convert (default output = first of Δ)',
    expected: 'start [s,-] with λ′ = x, flagged in step A3',
    actual: `start ${res.machine.start} with λ′ = ${res.machine.out[res.machine.start]}${flagged ? ', flagged in step A3' : ''}`,
  });
  const z = mealyToMoore(mealy, { defaultOutput: 'z' }).machine;
  check(t, {
    id: 'TC-04b', category: 'Mathematical correctness', feature: 'Default output only changes the dropped symbol', machine: FILES.ex2, input: 'default output z; w = abba',
    expected: 'abba: Mealy xxxy, Moore zxxxy → xxxy ✓ | equivalent (5 pairs)',
    actual: `${runOn(mealy, z, 'abba')} | ${verdict(mealy, z)}`,
  });
  assert.throws(() => mealyToMoore(mealy, { defaultOutput: 'w' }), /Default output "w" is not in Δ/);
});

test('TC-05 start state entered with several outputs: every start copy is equivalent', (t) => {
  const mealy = load('ex1_start_two_outputs');
  const observed = ['0', '1'].map((o) => {
    const m = mealyToMoore(mealy, { startOutput: o }).machine;
    return `start ${m.start}: ${verdict(mealy, m)}`;
  }).join(' | ');
  check(t, {
    id: 'TC-05a', category: 'Mathematical correctness', feature: 'Start-copy choice', machine: FILES.ex1_start_two_outputs, input: 'start copy o = 0, then o = 1',
    expected: 'start [q0,0]: equivalent (4 pairs) | start [q0,1]: equivalent (4 pairs)', actual: observed,
  });
  let message = 'accepted';
  try { mealyToMoore(load('ex1'), { startOutput: '1' }); } catch (e) { message = e.message; }
  check(t, {
    id: 'TC-05b', category: 'Invalid input', feature: 'Start-copy choice', machine: FILES.ex1, input: 'start copy o = 1 (1 does not enter q0)',
    expected: 'Start output "1" is not in O(q0) = {0}', actual: message,
  });
});

test('TC-06 unreachable states are removed, and keeping them changes nothing', (t) => {
  const mealy = load('ex2');
  const res = mealyToMoore(mealy);
  const step = res.steps.find((s) => s.rule === 'A6');
  check(t, {
    id: 'TC-06a', category: 'Boundary', feature: 'Unreachable-state removal', machine: FILES.ex2, input: 'convert (remove unreachable: on)',
    expected: 'removed [r,z], [d,z]; 5 states kept', actual: `removed ${step.data.removed.join(', ')}; ${res.machine.states.length} states kept`,
    evidence: 'Screenshot 07',
  });
  const kept = mealyToMoore(mealy, { removeUnreachable: false }).machine;
  check(t, {
    id: 'TC-06b', category: 'Mathematical correctness', feature: 'Unreachable-state removal', machine: FILES.ex2, input: 'convert (remove unreachable: off)',
    expected: '7 states; equivalent (5 pairs)', actual: `${kept.states.length} states; ${verdict(mealy, kept)}`,
  });
});

test('TC-07 single state, single input symbol, single output symbol', (t) => {
  const mealy = load('single_state');
  const res = mealyToMoore(mealy);
  check(t, {
    id: 'TC-07', category: 'Boundary', feature: 'Mealy → Moore conversion (Algorithm A)', machine: FILES.single_state, input: 'convert; w = aaa',
    expected: '[q,x]/x | |Q′| = 1, |Q|·|Δ| = 1 | aaa: Mealy xxx, Moore xxxx → xxx ✓ | equivalent (1 pair)',
    actual: `${statesOf(res.machine)} | |Q′| = ${res.machine.states.length}, |Q|·|Δ| = ${res.bound} | ${runOn(mealy, res.machine, 'aaa')} | ${verdict(mealy, res.machine)}`,
    evidence: HAND,
  });
});

test('TC-08 empty input string ε: Mealy outputs ε, Moore outputs only λ′(q0′)', (t) => {
  const ex1 = load('ex1');
  const ex2 = load('ex2');
  check(t, {
    id: 'TC-08a', category: 'Boundary', feature: 'String tester (ε input)', machine: FILES.ex1, input: 'w = ε',
    expected: 'ε: Mealy ε, Moore 0 → ε ✓', actual: runOn(ex1, mealyToMoore(ex1).machine, 'ε'),
  });
  check(t, {
    id: 'TC-08b', category: 'Boundary', feature: 'String tester (ε input)', machine: FILES.ex2, input: 'w = ε',
    expected: 'ε: Mealy ε, Moore x → ε ✓', actual: runOn(ex2, mealyToMoore(ex2).machine, 'ε'),
  });
  assert.deepEqual(toSymbols('', ex1.inputs), []);
});

test('TC-09 multi-character input and output symbols', (t) => {
  const mealy = load('multichar');
  const res = mealyToMoore(mealy);
  check(t, {
    id: 'TC-09', category: 'Boundary', feature: 'Multi-character symbols', machine: FILES.multichar, input: 'convert; w = a1 b2 b2 a1',
    expected: '[s,y0]/y0 [s,y1]/y1 [t,y0]/y0 [t,y1]/y1 | a1 b2 b2 a1: Mealy y0 y1 y0 y1, Moore y0 y0 y1 y0 y1 → y0 y1 y0 y1 ✓',
    actual: `${statesOf(res.machine)} | ${runOn(mealy, res.machine, 'a1 b2 b2 a1')}`, evidence: HAND,
  });
});

test('TC-10 the bound |Q′| ≤ |Q|·|Δ| is reached exactly', (t) => {
  const mealy = load('bound_reached');
  const res = mealyToMoore(mealy);
  check(t, {
    id: 'TC-10', category: 'Boundary', feature: 'Bound |Q′| ≤ |Q|·|Δ|', machine: FILES.bound_reached, input: 'convert; w = 0110',
    expected: '|Q′| = 4 = |Q|·|Δ| = 4 | 0110: Mealy 0101, Moore 00101 → 0101 ✓ | equivalent (4 pairs)',
    actual: `|Q′| = ${res.machine.states.length} = |Q|·|Δ| = ${res.bound} | ${runOn(mealy, res.machine, '0110')} | ${verdict(mealy, res.machine)}`,
    evidence: HAND,
  });
});

// ===================== Mathematical correctness =====================

test('TC-11 a wrong hand-converted Moore machine gets the shortest counterexample', (t) => {
  const mealy = load('ex1');
  const wrong = load('wrong_moore_ex1');
  const eq = checkEquivalence(mealy, wrong);
  check(t, {
    id: 'TC-11', category: 'Mathematical correctness', feature: 'Equivalence check of a hand-converted machine (Algorithm C)',
    machine: `${FILES.ex1} vs ${FILES.wrong_moore_ex1}`, input: 'Verify equivalence',
    expected: 'not equivalent, counterexample 11 | Mealy 01 vs Moore-dropped 00',
    actual: `${verdict(mealy, wrong)} | Mealy ${showWord(eq.witness.mealy.outputs)} vs Moore-dropped ${showWord(eq.witness.mooreDropped)}`,
    evidence: `${HAND}; Screenshot 06`,
  });
  assert.equal(eq.steps.at(-1).rule, 'C-FAIL');
});

test('TC-12 converted machines agree with their input on 500 random strings each', (t) => {
  const names = ['ex1', 'ex2', 'complement', 'parity', 'detect101', 'bound_reached', 'multichar'];
  let agree = 0;
  for (const name of names) {
    const mealy = load(name);
    const moore = mealyToMoore(mealy).machine;
    agree += randomWords(mealy.inputs, 500, 12, lcg(7)).filter((w) => compareOnWord(mealy, moore, w).match).length;
  }
  check(t, {
    id: 'TC-12', category: 'Mathematical correctness', feature: 'Random-string agreement', machine: names.map((n) => FILES[n]).join(', '),
    input: '500 seeded random strings (length 0–12) per machine',
    expected: `${names.length * 500}/${names.length * 500} strings: Moore output minus its first symbol = Mealy output`,
    actual: `${agree}/${names.length * 500} strings: Moore output minus its first symbol = Mealy output`,
  });
});

test('TC-22 on 200 random machines the bound holds and Algorithm C proves equivalence', (t) => {
  const rng = lcg(2026);
  const size = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  let ok = 0;
  for (let i = 0; i < 200; i++) {
    const mealy = parseMachine(randomMealy(size(1, 8), size(1, 3), size(1, 3), i + 1)).machine;
    const res = mealyToMoore(mealy);
    if (res.machine.states.length <= mealy.states.length * mealy.outputs.length && checkEquivalence(mealy, res.machine).equivalent) ok++;
  }
  check(t, {
    id: 'TC-22', category: 'Mathematical correctness', feature: 'Bound |Q′| ≤ |Q|·|Δ| and exact equivalence', machine: 'seeded random machines (fixtures.js randomMealy)',
    input: '200 machines, 1–8 states, 1–3 input and output symbols',
    expected: '200/200 machines: |Q′| ≤ |Q|·|Δ| and equivalent', actual: `${ok}/200 machines: |Q′| ≤ |Q|·|Δ| and equivalent`,
  });
});

test('TC-23 the step log is structured, numbered, and in rule order', (t) => {
  const describe = (name) => {
    const { steps } = mealyToMoore(load(name));
    const numbered = steps.every((s, i) => s.stepNo === i + 1 && typeof s.description === 'string' && typeof s.data === 'object');
    return `${steps.length} steps${numbered ? ' numbered 1…n' : ' NOT numbered'}; rules ${[...new Set(steps.map((s) => s.rule))].join(',')}`;
  };
  check(t, {
    id: 'TC-23', category: 'Normal', feature: 'Step-by-step log (step player data)', machine: `${FILES.ex1}, ${FILES.ex2}`, input: 'convert',
    expected: '14 steps numbered 1…n; rules A1,A2,A4,A5,A6,BOUND | 28 steps numbered 1…n; rules A1,A3,A2,A4,A5,A6,BOUND',
    actual: `${describe('ex1')} | ${describe('ex2')}`, evidence: 'docs/milestone1/evidence/example1_cli.txt, example2_cli.txt',
  });
});

// ===================== Invalid input =====================

test('TC-13 missing transition is rejected (no trap state is added)', (t) => {
  const s = spec('ex1');
  s.transitions.pop();
  check(t, {
    id: 'TC-13a', category: 'Invalid input', feature: 'Input validation', machine: `${FILES.ex1} with δ(q1, 1) removed`, input: 'convert',
    expected: 'Missing transition: δ(q1, 1) is not defined (machine must be complete)', actual: errorsOf(s), evidence: 'Screenshot 08',
  });
  check(t, {
    id: 'TC-13b', category: 'Invalid input', feature: 'Input validation (table text)', machine: 'table text with a "-" cell', input: 'q0 | q0/0 | -',
    expected: 'Missing transition: δ(q0, 1) is not defined (machine must be complete)',
    actual: errorsOf('type: mealy\nstart: q0\noutputs: 0\nstate | 0 | 1\nq0 | q0/0 | -'),
  });
});

test('TC-14 unknown input and output symbols are rejected', (t) => {
  const s1 = spec('ex1');
  s1.transitions[0].input = '2';
  check(t, {
    id: 'TC-14a', category: 'Invalid input', feature: 'Input validation', machine: `${FILES.ex1}, transition #1 input "2"`, input: 'convert',
    expected: 'Transition #1 (q0, 2): unknown input symbol "2" (Σ = {0, 1}) | Missing transition: δ(q0, 0) is not defined (machine must be complete)',
    actual: errorsOf(s1),
  });
  const s2 = spec('ex1');
  s2.transitions[0].output = '7';
  check(t, {
    id: 'TC-14b', category: 'Invalid input', feature: 'Input validation', machine: `${FILES.ex1}, transition #1 output "7"`, input: 'convert',
    expected: 'Transition #1 (q0, 0): unknown output symbol "7" (Δ = {0, 1}) | Missing transition: δ(q0, 0) is not defined (machine must be complete)',
    actual: errorsOf(s2),
  });
});

test('TC-15 duplicate transition (non-determinism) is rejected', (t) => {
  const s = spec('ex1');
  s.transitions.push({ from: 'q0', input: '0', to: 'q1', output: '1' });
  check(t, {
    id: 'TC-15', category: 'Invalid input', feature: 'Input validation', machine: `${FILES.ex1} plus q0 --0/1--> q1`, input: 'convert',
    expected: 'Duplicate transition: δ(q0, 0) is defined more than once (machine must be deterministic)', actual: errorsOf(s),
  });
});

test('TC-16 undefined or unknown start state is rejected', (t) => {
  const s1 = spec('ex1');
  delete s1.start;
  check(t, { id: 'TC-16a', category: 'Invalid input', feature: 'Input validation', machine: `${FILES.ex1} without start`, input: 'convert',
    expected: 'Start state is undefined: set "start"', actual: errorsOf(s1) });
  const s2 = spec('ex1');
  s2.start = 'q9';
  check(t, { id: 'TC-16b', category: 'Invalid input', feature: 'Input validation', machine: `${FILES.ex1}, start = q9`, input: 'convert',
    expected: 'Start state "q9" is not in Q = {q0, q1}', actual: errorsOf(s2) });
});

test('TC-17 empty Q, Σ or Δ is rejected', (t) => {
  for (const [id, field, expected] of [
    ['TC-17a', 'states', 'State set Q is empty: declare at least one element in "states"'],
    ['TC-17b', 'inputs', 'Input alphabet Σ is empty: declare at least one element in "inputs"'],
    ['TC-17c', 'outputs', 'Output alphabet Δ is empty: declare at least one element in "outputs"'],
  ]) {
    const s = spec('ex1');
    s[field] = [];
    const r = parseMachine(s);
    check(t, { id, category: 'Invalid input', feature: 'Input validation', machine: `${FILES.ex1}, ${field} = []`, input: 'convert',
      expected: `first error: ${expected}; refused`, actual: `first error: ${r.errors[0]}; ${r.machine === null ? 'refused' : 'accepted'}` });
  }
});

test('TC-18 hand-converted Moore machine with a state lacking an output is rejected', (t) => {
  const s = spec('wrong_moore_ex1');
  delete s.stateOutputs['[q1,1]'];
  check(t, { id: 'TC-18', category: 'Invalid input', feature: 'Input validation (hand-converted Moore machine)', machine: `${FILES.wrong_moore_ex1} without λ′([q1,1])`,
    input: 'Verify equivalence', expected: "Missing state output: λ'([q1,1]) is not defined", actual: errorsOf(s) });
});

test('TC-19 malformed table text and JSON are rejected with a clear message', (t) => {
  check(t, { id: 'TC-19a', category: 'Invalid input', feature: 'Input validation (table text)', machine: 'table text', input: 'type: mealy / state | 0 / q0 | q0',
    expected: 'Line 3: cell "q0" must be written as next/output', actual: errorsOf('type: mealy\nstate | 0\nq0 | q0') });
  check(t, { id: 'TC-19b', category: 'Invalid input', feature: 'Input validation (table text)', machine: 'table text', input: 'start: q0 (no table)',
    expected: 'No transition table found (the header row "state | ..." is missing)', actual: errorsOf('start: q0') });
  const r = parseMachine('{ "type": "mealy", ');
  check(t, { id: 'TC-19c', category: 'Invalid input', feature: 'Input validation (JSON)', machine: 'JSON text', input: '{ "type": "mealy",',
    expected: 'refused with one JSON syntax error',
    actual: r.machine === null && r.errors.length === 1 && /JSON/.test(r.errors[0]) ? 'refused with one JSON syntax error' : r.errors.join(' | '),
    detail: r.errors[0] });
});

test('TC-20 a Moore machine as the main input is rejected', (t) => {
  check(t, { id: 'TC-20', category: 'Invalid input', feature: 'Input validation', machine: FILES.wrong_moore_ex1, input: 'convert (main input)',
    expected: 'Input must be a Mealy machine (this simulator converts Mealy → Moore only)',
    actual: errorsOf(spec('wrong_moore_ex1'), { mealyOnly: true }), evidence: 'Screenshot 09' });
  assert.equal(parseMachine(spec('wrong_moore_ex1')).machine.type, 'moore'); // still accepted for the hand-conversion check
});

test('TC-24 unknown symbol in a test string, and different alphabets in the checker, are rejected', (t) => {
  let message = 'accepted';
  try { toSymbols('012', ['0', '1']); } catch (e) { message = e.message; }
  check(t, { id: 'TC-24a', category: 'Invalid input', feature: 'String tester', machine: FILES.ex1, input: 'w = 012',
    expected: 'Symbol "2" is not in Σ = {0, 1}', actual: message });
  message = 'accepted';
  try { checkEquivalence(load('ex1'), mealyToMoore(load('ex2')).machine); } catch (e) { message = e.message; }
  check(t, { id: 'TC-24b', category: 'Invalid input', feature: 'Equivalence check of a hand-converted machine (Algorithm C)', machine: `${FILES.ex1} vs Moore of ${FILES.ex2}`,
    input: 'Verify equivalence', expected: 'Input alphabets differ ({0, 1} vs {a, b}); equivalence is undefined', actual: message });
});

// ===================== Import / export formats and console front-end =====================

test('TC-25 table text and JSON import/export round-trip without change', (t) => {
  const mealy = load('ex1');
  const moore = mealyToMoore(load('ex2')).machine;
  const same = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? 'identical' : 'DIFFERENT');
  check(t, { id: 'TC-25a', category: 'Normal', feature: 'Import table text / JSON', machine: FILES.ex1, input: 'JSON → machine → table text → machine',
    expected: 'identical', actual: same(parseMachine(toTableText(mealy)).machine, mealy) });
  check(t, { id: 'TC-25b', category: 'Normal', feature: 'Export Moore machine (JSON / table text)', machine: `Moore of ${FILES.ex2}`,
    input: 'export JSON and table text, re-import both',
    expected: 'JSON identical | table text identical',
    actual: `JSON ${same(parseMachine(JSON.stringify(toSpec(moore))).machine, moore)} | table text ${same(parseMachine(toTableText(moore)).machine, moore)}` });
  assert.deepEqual(parseTableText(toTableText(mealy)).inputs, ['0', '1']);
});

test('TC-26 console front-end reproduces Example 1', (t) => {
  const out = spawnSync(process.execPath, ['src/cli.js', 'ex1', '0111'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).stdout;
  const line = (prefix) => (out.split('\n').find((l) => l.includes(prefix)) || '(missing)').trim();
  check(t, { id: 'TC-26', category: 'Normal', feature: 'Console front-end (src/cli.js)', machine: FILES.ex1, input: 'node src/cli.js ex1 0111',
    expected: 'Moore, first symbol dropped: 0011  ✔ match | ✔ equivalent — 3 reachable pairs: (q0, [q0,0]) (q1, [q1,0]) (q1, [q1,1])',
    actual: `${line('first symbol dropped')} | ${line('reachable pairs')}` });
  const bad = spawnSync(process.execPath, ['src/cli.js', 'ex1', '012'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  check(t, { id: 'TC-26b', category: 'Invalid input', feature: 'Console front-end (src/cli.js)', machine: FILES.ex1, input: 'node src/cli.js ex1 012',
    expected: 'exit 1: w = 012: Symbol "2" is not in Σ = {0, 1}', actual: `exit ${bad.status}: ${bad.stderr.trim()}` });
});

// ===================== Performance =====================

test('TC-21 a 50-state, 5-symbol machine converts and verifies in under 100 ms', (t) => {
  const mealy = parseMachine(randomMealy(50, 5, 3, 21)).machine;
  const times = [];
  let res, eq;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    res = mealyToMoore(mealy);
    eq = checkEquivalence(mealy, res.machine);
    times.push(performance.now() - t0);
  }
  const median = times.sort((a, b) => a - b)[2];
  check(t, { id: 'TC-21', category: 'Performance', feature: 'Conversion + equivalence time', machine: 'randomMealy(50 states, |Σ| = 5, |Δ| = 3, seed 21)',
    input: 'convert + Algorithm C, median of 5 runs', expected: 'under 100 ms and equivalent',
    actual: median < 100 && eq.equivalent ? 'under 100 ms and equivalent' : `${median.toFixed(1)} ms, equivalent: ${eq.equivalent}`,
    detail: `median ${median.toFixed(2)} ms; |Q′| = ${res.machine.states.length}; ${eq.pairsExplored} pairs` });
});
