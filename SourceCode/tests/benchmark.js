/**
 * Performance measurements for the report: time of Algorithm A (conversion) and Algorithm C
 * (equivalence check) on seeded random Mealy machines of growing size. Not part of `node --test`.
 *
 *   node tests/benchmark.js
 *
 * Each size is measured 7 times; the median is reported (milliseconds, performance.now()).
 */
const os = require('node:os');
const { parseMachine } = require('../src/core/parser.js');
const { mealyToMoore } = require('../src/core/mealyToMoore.js');
const { checkEquivalence } = require('../src/core/equivalence.js');
const { randomMealy } = require('./fixtures.js');

const RUNS = 7;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`Node.js ${process.version} on ${os.cpus()[0].model.trim()} (${os.platform()} ${os.arch()})`);
console.log(`|Σ| = 5, |Δ| = 3, seed = size; median of ${RUNS} runs\n`);
console.log('| |Q| | |Q′| created | |Q′| kept | bound |Q|·|Δ| | Algorithm A (ms) | Algorithm C (ms) | pairs explored |');
console.log('|----:|----:|----:|----:|----:|----:|----:|');
for (const n of [10, 50, 100, 200, 500, 1000]) {
  const mealy = parseMachine(randomMealy(n, 5, 3, n)).machine;
  const conv = [], eqv = [];
  let res, eq;
  for (let i = 0; i < RUNS; i++) {
    let t0 = performance.now();
    res = mealyToMoore(mealy);
    conv.push(performance.now() - t0);
    t0 = performance.now();
    eq = checkEquivalence(mealy, res.machine);
    eqv.push(performance.now() - t0);
  }
  if (!eq.equivalent) throw new Error(`size ${n}: not equivalent`);
  console.log(`| ${n} | ${res.createdCount} | ${res.machine.states.length} | ${res.bound} | ${median(conv).toFixed(2)} | ${median(eqv).toFixed(2)} | ${eq.pairsExplored} |`);
}
