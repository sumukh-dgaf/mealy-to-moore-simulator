/**
 * Algorithm A — Mealy → Moore by state splitting.
 *
 * A Moore state can carry only one output, but a Mealy state q may be entered by transitions
 * that emit different outputs. So q is split into one copy [q,o] per output o entering it.
 */
(function (root, factory) {
  // Plain script so index.html works from file://; in the browser every core file adds to window.MM.
  if (typeof module === 'object' && module.exports) module.exports = factory(Object.assign({}, require('./model.js')));
  else Object.assign((root.MM = root.MM || {}), factory(root.MM || {}));
})(this, function (M) {
  'use strict';
  const { StepLog, splitName } = M;

  /**
   * Convert a validated Mealy machine into an equivalent Moore machine.
   *
   * Equivalence convention: for every input w, the Moore output with its first symbol dropped
   * equals the Mealy output.
   *
   * Assumptions: the input is deterministic and complete (validated by parser.buildMachine); no
   * trap state is ever added. Every rule applied (A1–A6, BOUND) is recorded in the returned step log,
   * which the UI step player replays. Time: O(|Q|·|Δ|·|Σ|) for the construction itself, plus
   * O(|Q|²·|Σ|) for the A1 step-log text that lists each state's entering transitions.
   *
   * @param {import('./model.js').MealyMachine} mealy  output of parser.buildMachine (valid, complete)
   * @param {Object} [opts]
   * @param {string} [opts.defaultOutput]       λ' for copies [q,-] of states with no incoming transitions (default Δ[0])
   * @param {string} [opts.startOutput]         which copy [q0,o] starts when q0 has incoming transitions (default: first o in O(q0))
   * @param {boolean} [opts.removeUnreachable]  drop Moore states unreachable from the start (default true)
   * @returns {{
   *   machine: import('./model.js').MooreMachine,
   *   steps: import('./model.js').Step[],
   *   incoming: Object<string, string[]>,
   *   removed: string[],
   *   createdCount: number,
   *   bound: number,
   *   origin: Object<string, {q: string, o: (string|null)}>
   * }}
   * @throws {Error} if defaultOutput is not in Δ, if startOutput is not in O(q0), or if two split
   *                 state names collide (state names containing "[", "]" or ",")
   */
  function mealyToMoore(mealy, opts = {}) {
    const { states: Q, inputs: S, outputs: D, delta, lambda, start: q0 } = mealy;
    const def = opts.defaultOutput || D[0];
    if (!D.includes(def)) throw new Error(`Default output "${def}" is not in Δ = {${D.join(', ')}}`);
    const log = new StepLog();

    // A1: O(q) = outputs on transitions entering q, listed in Δ order.
    const entering = Object.fromEntries(Q.map((q) => [q, new Set()]));
    for (const q of Q) for (const a of S) entering[delta[q][a]].add(lambda[q][a]);
    const O = Object.fromEntries(Q.map((q) => [q, D.filter((o) => entering[q].has(o))]));
    for (const q of Q) {
      // step-log text only: scans every transition for each q, O(|Q|²·|Σ|) in total
      const into = Q.flatMap((p) => S.filter((a) => delta[p][a] === q).map((a) => `${p}--${a}/${lambda[p][a]}`));
      log.add('A1', `O(${q}) = {${O[q].join(', ')}}${into.length ? `  from ${into.join(', ')}` : '  (no incoming transitions)'}`, { state: q, outputs: O[q], incoming: into });
    }

    // A2 / A3 state splitting: one Moore state [q,o] per output o entering q, meaning "in q, and the
    // last output was o". A state with no incoming transitions (only q0 or an unreachable state) still
    // needs one copy, [q,-], whose output is never produced by a transition: use the default.
    const out = {};
    const origin = {};
    const created = [];
    for (const q of Q) {
      for (const o of O[q].length ? O[q] : [null]) {
        const s = splitName(q, o ?? '-');
        created.push(s);
        out[s] = o ?? def;
        origin[s] = { q, o };
        if (o === null) log.add('A3', `${q} has no incoming transitions: create ${s} with default output λ'(${s}) = ${def}`, { state: s, from: q, output: def, defaulted: true });
        else log.add('A2', `Create ${s} with λ'(${s}) = ${o}`, { state: s, from: q, output: o });
      }
    }
    if (new Set(created).size !== created.length) throw new Error('Split state names collide; avoid "[", "]" and "," in state names');

    // A4: δ'([q,o], a) = [δ(q,a), λ(q,a)]. The target exists because λ(q,a) ∈ O(δ(q,a)) by A1. The
    // rule ignores o, so every copy of q gets the same row; entering [p,b] emits b = the Mealy output.
    const mooreDelta = {};
    for (const s of created) {
      const { q } = origin[s];
      mooreDelta[s] = {};
      for (const a of S) {
        const p = delta[q][a];
        const b = lambda[q][a];
        const t = splitName(p, b);
        mooreDelta[s][a] = t;
        log.add('A4', `δ'(${s}, ${a}) = ${t}   because δ(${q}, ${a}) = ${p} and λ(${q}, ${a}) = ${b}`, { from: s, input: a, to: t });
      }
    }

    // A5: start state. Any copy [q0,o] is correct: the copies share their outgoing transitions, and
    // the start state's output is printed only for the empty prefix, which the convention drops.
    let start;
    if (O[q0].length === 0) {
      start = splitName(q0, '-');
      log.add('A5', `Start = ${start}: ${q0} has no incoming transitions, so it has a single copy`, { start, candidates: [start] });
    } else {
      const o = opts.startOutput || O[q0][0];
      const candidates = O[q0].map((x) => splitName(q0, x));
      if (!O[q0].includes(o)) throw new Error(`Start output "${o}" is not in O(${q0}) = {${O[q0].join(', ')}}`);
      start = splitName(q0, o);
      log.add(
        'A5',
        `Start = ${start} (candidates ${candidates.join(', ')}). Any candidate is correct: all copies of ${q0} have the same outgoing transitions, and the start state's output is emitted only for the empty prefix, which the equivalence convention drops.`,
        { start, candidates },
      );
    }

    // A6: optionally drop states unreachable from the start (BFS over δ'). No input reaches them, so
    // removing them cannot change any output.
    let states = created;
    let removed = [];
    if (opts.removeUnreachable ?? true) {
      const seen = new Set([start]);
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        for (const a of S) {
          const t = mooreDelta[queue[i]][a];
          if (!seen.has(t)) {
            seen.add(t);
            queue.push(t);
          }
        }
      }
      removed = created.filter((s) => !seen.has(s));
      states = created.filter((s) => seen.has(s));
      for (const s of removed) {
        delete mooreDelta[s];
        delete out[s];
      }
      log.add('A6', removed.length ? `Removed unreachable Moore states: ${removed.join(', ')}` : 'Every Moore state is reachable from the start; nothing removed', { removed });
    }

    // Each q yields max(1, |O(q)|) ≤ |Δ| copies, so |Q'| ≤ |Q|·|Δ| (no extra +1 since no fresh start state is added).
    const bound = Q.length * D.length;
    log.add('BOUND', `|Q'| = ${states.length} (created ${created.length}, removed ${removed.length}) ≤ |Q|·|Δ| = ${Q.length}·${D.length} = ${bound}`, {
      created: created.length,
      final: states.length,
      bound,
    });

    return {
      machine: { type: 'moore', states, inputs: [...S], outputs: [...D], start, delta: mooreDelta, out },
      steps: log.steps,
      incoming: O,
      removed,
      createdCount: created.length,
      bound,
      origin,
    };
  }

  return { mealyToMoore };
});
