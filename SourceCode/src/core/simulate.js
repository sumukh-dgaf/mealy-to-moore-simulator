/**
 * Run Mealy / Moore machines on input words and compare them under the equivalence convention.
 * Words are arrays of symbols so multi-character symbols work.
 */
(function (root, factory) {
  // Plain script so index.html works from file://; in the browser every core file adds to window.MM.
  if (typeof module === 'object' && module.exports) module.exports = factory({});
  else Object.assign((root.MM = root.MM || {}), factory(root.MM || {}));
})(this, function (M) {
  'use strict';
  /**
   * Split a typed string into input symbols. With a single-character alphabet "0111" is split per
   * character; otherwise symbols are separated by spaces or commas ("a1 b2"). Empty text gives the
   * empty word []. The UI and CLI map the text "ε" to [] before calling this, because ε is never a
   * symbol of the machine.
   * @param {string} text
   * @param {string[]} inputs  Σ
   * @returns {string[]}
   * @throws {Error} if a symbol is not in Σ
   */
  function toSymbols(text, inputs) {
    const t = text.trim();
    const symbols = inputs.every((a) => a.length === 1) ? [...t.replace(/[\s,]/g, '')] : t.split(/[\s,]+/).filter(Boolean);
    const bad = symbols.find((a) => !inputs.includes(a));
    if (bad !== undefined) throw new Error(`Symbol "${bad}" is not in Σ = {${inputs.join(', ')}}`);
    return symbols;
  }

  /**
   * Run a Mealy machine. Assumes every symbol of word is in Σ (check with toSymbols first).
   * @param {import('./model.js').MealyMachine} m
   * @param {string[]} word
   * @returns {{states: string[], outputs: string[]}}  n+1 states visited, n outputs
   */
  function runMealy(m, word) {
    const states = [m.start];
    const outputs = [];
    for (const a of word) {
      const q = states.at(-1);
      outputs.push(m.lambda[q][a]);
      states.push(m.delta[q][a]);
    }
    return { states, outputs };
  }

  /**
   * Run a Moore machine. Assumes every symbol of word is in Σ (check with toSymbols first).
   * On the empty word it returns one output, λ'(q0').
   * @param {import('./model.js').MooreMachine} m
   * @param {string[]} word
   * @returns {{states: string[], outputs: string[]}}  n+1 states visited, n+1 outputs (first = λ'(q0'))
   */
  function runMoore(m, word) {
    const states = [m.start];
    for (const a of word) states.push(m.delta[states.at(-1)][a]);
    return { states, outputs: states.map((q) => m.out[q]) };
  }

  /**
   * Run both machines on one word and compare: Moore output minus its first symbol vs Mealy output.
   * Assumes both machines share Σ and every symbol of word is in it.
   * @param {import('./model.js').MealyMachine} mealy
   * @param {import('./model.js').MooreMachine} moore
   * @param {string[]} word
   * @returns {{word: string[], mealy: {states: string[], outputs: string[]}, moore: {states: string[], outputs: string[]}, mooreDropped: string[], match: boolean}}
   */
  function compareOnWord(mealy, moore, word) {
    const me = runMealy(mealy, word);
    const mo = runMoore(moore, word);
    const mooreDropped = mo.outputs.slice(1);
    return { word, mealy: me, moore: mo, mooreDropped, match: mooreDropped.every((o, i) => o === me.outputs[i]) };
  }

  /**
   * Generate random words for supplementary testing (lengths and symbols uniform).
   * @param {string[]} inputs  Σ
   * @param {number} count
   * @param {number} [maxLen]  lengths are uniform in [0, maxLen]
   * @param {() => number} [rng]  injectable for reproducible tests
   * @returns {string[][]}
   */
  function randomWords(inputs, count, maxLen = 8, rng = Math.random) {
    return Array.from({ length: count }, () =>
      Array.from({ length: Math.floor(rng() * (maxLen + 1)) }, () => inputs[Math.floor(rng() * inputs.length)]),
    );
  }

  return { toSymbols, runMealy, runMoore, compareOnWord, randomWords };
});
