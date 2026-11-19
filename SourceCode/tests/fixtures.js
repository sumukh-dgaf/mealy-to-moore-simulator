/**
 * Test machines: the two UI examples (examples/presets.js), the hand-worked machines in
 * tests/machines/*.json, and seeded random Mealy machines for property and performance tests.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { parseMachine } = require('../src/core/parser.js');
const PRESETS = require('../examples/presets.js');

const DIR = path.join(__dirname, 'machines');

/** File name of each test machine in TestCases/ (the two presets are exported there as JSON). */
const FILES = { ex1: 'ex1_11detector.json', ex2: 'ex2_edgecases.json' };
for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json')) FILES[f.slice(0, -'.json'.length)] = f;

/**
 * Fresh JSON spec of a named test machine, safe for a test to mutate.
 * @param {string} name  preset id (ex1, ex2) or a file name in tests/machines without ".json"
 * @returns {Object} JSON spec in the parser.js format
 * @throws {Error} if no machine has that name
 */
function spec(name) {
  const preset = PRESETS.find((p) => p.id === name);
  if (preset) return structuredClone(preset.machine);
  if (!FILES[name]) throw new Error(`Unknown test machine "${name}"`);
  return JSON.parse(fs.readFileSync(path.join(DIR, FILES[name]), 'utf8'));
}

/**
 * Validated machine for a named fixture; fails the calling test if the fixture is invalid.
 * @param {string} name  see spec()
 * @returns {import('../src/core/model.js').MealyMachine|import('../src/core/model.js').MooreMachine}
 */
function load(name) {
  const { machine, errors } = parseMachine(spec(name));
  assert.deepEqual(errors, []);
  return machine;
}

/**
 * Deterministic pseudo-random generator (linear congruential), so random tests are reproducible.
 * @param {number} seed
 * @returns {() => number}  values in [0, 1)
 */
const lcg = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

/**
 * Seeded random complete, deterministic Mealy machine spec: states q0…, inputs a0…, outputs o0….
 * @param {number} n  |Q|
 * @param {number} k  |Σ|
 * @param {number} d  |Δ|
 * @param {number} seed
 * @returns {Object} JSON spec
 */
function randomMealy(n, k, d, seed) {
  const rng = lcg(seed);
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const states = Array.from({ length: n }, (_, i) => 'q' + i);
  const inputs = Array.from({ length: k }, (_, i) => 'a' + i);
  const outputs = Array.from({ length: d }, (_, i) => 'o' + i);
  const transitions = states.flatMap((from) => inputs.map((input) => ({ from, input, to: pick(states), output: pick(outputs) })));
  return { type: 'mealy', states, inputs, outputs, start: 'q0', transitions };
}

module.exports = { FILES, spec, load, lcg, randomMealy };
