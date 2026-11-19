/**
 * Algorithm C — exact Mealy/Moore equivalence check by BFS over the product of the two machines.
 *
 * Every input prefix u leads to exactly one pair (δ*(q0,u), δ'*(q0',u)), and there are at most
 * |Q|·|Q'| pairs, so checking every symbol from every reachable pair covers every input word.
 * BFS also makes the reported counterexample a shortest one.
 */
(function (root, factory) {
  // Plain script so index.html works from file://; in the browser every core file adds to window.MM.
  if (typeof module === 'object' && module.exports) module.exports = factory(Object.assign({}, require('./model.js'), require('./simulate.js')));
  else Object.assign((root.MM = root.MM || {}), factory(root.MM || {}));
})(this, function (M) {
  'use strict';
  const { StepLog, compareOnWord } = M;

  /**
   * Decide whether a Mealy and a Moore machine are output-equivalent (Moore output with its first
   * symbol dropped == Mealy output, for every input word).
   * Assumes both machines are deterministic and complete (validated by the parser); outputs are
   * compared as strings. Time O(|Q|·|Q′|·|Σ|), space O(|Q|·|Q′|).
   * @param {import('./model.js').MealyMachine} mealy
   * @param {import('./model.js').MooreMachine} moore
   * @returns {{
   *   equivalent: boolean,
   *   counterexample: (string[]|null),
   *   pairsExplored: number,
   *   pairs: Array<[string, string]>,
   *   steps: import('./model.js').Step[],
   *   witness: (ReturnType<typeof compareOnWord>|null)
   * }}  witness = both runs on the counterexample
   * @throws {Error} if the input alphabets differ
   */
  function checkEquivalence(mealy, moore) {
    const S = mealy.inputs;
    if (S.length !== moore.inputs.length || S.some((a) => !moore.inputs.includes(a))) {
      throw new Error(`Input alphabets differ ({${S.join(', ')}} vs {${moore.inputs.join(', ')}}); equivalence is undefined`);
    }
    const log = new StepLog();
    const key = (q, r) => JSON.stringify([q, r]);
    const parent = new Map([[key(mealy.start, moore.start), null]]); // pair -> {prev, a} for path rebuild
    const pairs = [[mealy.start, moore.start]];
    const pathTo = (k) => {
      const w = [];
      for (let e = parent.get(k); e; e = parent.get(e.prev)) w.unshift(e.a);
      return w;
    };

    // BFS over reachable pairs (Mealy state, Moore state). The pairs array doubles as the queue; parent
    // remembers how each pair was first reached, so the first mismatch yields a shortest input.
    for (let i = 0; i < pairs.length; i++) {
      const [q, r] = pairs[i];
      const k = key(q, r);
      for (const a of S) {
        const expected = mealy.lambda[q][a];
        const p = mealy.delta[q][a];
        const s = moore.delta[r][a];
        const got = moore.out[s];
        // the convention for prefix u·a: λ(δ*(q0,u), a) must equal λ'(δ'*(q0',u·a))
        if (expected !== got) {
          const counterexample = [...pathTo(k), a];
          log.add('C-FAIL', `Pair (${q}, ${r}), input ${a}: λ(${q}, ${a}) = ${expected} but λ'(δ'(${r}, ${a})) = λ'(${s}) = ${got}`, { pair: [q, r], input: a, expected, got, counterexample });
          return { equivalent: false, counterexample, pairsExplored: pairs.length, pairs, steps: log.steps, witness: compareOnWord(mealy, moore, counterexample) };
        }
        log.add('C', `Pair (${q}, ${r}), input ${a}: λ(${q}, ${a}) = ${expected} = λ'(${s}) ✔  → (${p}, ${s})`, { pair: [q, r], input: a, next: [p, s] });
        const nk = key(p, s);
        if (!parent.has(nk)) {
          parent.set(nk, { prev: k, a });
          pairs.push([p, s]);
        }
      }
    }
    log.add('C-OK', `All ${pairs.length} reachable pairs agree on every input symbol → the machines are equivalent`, { pairsExplored: pairs.length });
    return { equivalent: true, counterexample: null, pairsExplored: pairs.length, pairs, steps: log.steps, witness: null };
  }

  return { checkEquivalence };
});
