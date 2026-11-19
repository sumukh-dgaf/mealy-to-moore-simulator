/**
 * Console front-end for the algorithm core, used to produce reproducible evidence for the design
 * document without a browser.
 *
 *   node src/cli.js <preset-id | mealy.json | mealy-table.txt> [word ...]
 *
 * Preset ids come from examples/presets.js (ex1, ex2). Converts the Mealy machine to Moore,
 * prints the step log, both transition tables, a comparison for each word, and the exact
 * equivalence result. A word "ε" is the empty input string.
 *
 * Exit codes: 0 success; 1 invalid machine (every validation error is printed), unreadable file,
 * or a word containing a symbol outside Σ; 2 usage error (no machine given).
 */
const { readFileSync } = require('node:fs');
const { parseMachine, toTableText } = require('./core/parser.js');
const { mealyToMoore } = require('./core/mealyToMoore.js');
const { compareOnWord, toSymbols } = require('./core/simulate.js');
const { checkEquivalence } = require('./core/equivalence.js');
const { showWord } = require('./core/model.js');
const PRESETS = require('../examples/presets.js');

const [source, ...words] = process.argv.slice(2);
if (!source) {
  console.error('usage: node src/cli.js <preset-id | mealy.json | mealy-table.txt> [word ...]');
  process.exit(2);
}
const preset = PRESETS.find((p) => p.id === source);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
let input;
try {
  input = preset ? preset.machine : readFileSync(source, 'utf8');
} catch (e) {
  fail(`Cannot read "${source}": ${e.message}`);
}
const { machine: mealy, errors } = parseMachine(input, { mealyOnly: true });
if (errors.length) {
  console.error(`Invalid machine:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}

const res = mealyToMoore(mealy);
const moore = res.machine;

console.log(`== Input (mealy) ==\n${toTableText(mealy)}\n`);
console.log('== Step log ==');
for (const s of res.steps) console.log(`${String(s.stepNo).padStart(3)}. [${s.rule}] ${s.description}`);
console.log(`\n== Output (moore) ==\n${toTableText(moore)}\n`);

for (const w of words) {
  let word;
  try {
    word = w === 'ε' ? [] : toSymbols(w, mealy.inputs);
  } catch (e) {
    fail(`w = ${w}: ${e.message}`);
  }
  const r = compareOnWord(mealy, moore, word);
  console.log(`w = ${showWord(r.word)}`);
  console.log(`  Mealy states : ${r.mealy.states.join(' ')}   output ${showWord(r.mealy.outputs)}`);
  console.log(`  Moore states : ${r.moore.states.join(' ')}   output ${showWord(r.moore.outputs)}`);
  console.log(`  Moore, first symbol dropped: ${showWord(r.mooreDropped)}  ${r.match ? '✔ match' : '✘ MISMATCH'}`);
}

const eq = checkEquivalence(mealy, moore);
console.log(`\n== Equivalence (Algorithm C) ==`);
console.log(eq.equivalent
  ? `✔ equivalent — ${eq.pairsExplored} reachable pairs: ${eq.pairs.map(([q, r]) => `(${q}, ${r})`).join(' ')}`
  : `✘ not equivalent — counterexample ${showWord(eq.counterexample)}`);
