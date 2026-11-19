/**
 * Parse and validate user input. This is the trust boundary: every algorithm module assumes
 * the machine it receives came out of {@link buildMachine} without errors.
 *
 * Two input formats are accepted:
 *  1. JSON spec (see examples/presets.js):
 *     { type, states, inputs, outputs, start, transitions: [{from, input, to, output?}],
 *       stateOutputs? (Moore only: {state: output}) }
 *  2. Transition-table text (see {@link parseTableText}).
 *
 * The simulator's main input is always a Mealy machine (mealyOnly). Moore machines are parsed
 * only for the optional hand-converted machine checked by the equivalence panel.
 *
 * Documented input rules (see buildMachine):
 *  - Incomplete machines are REJECTED with one "Missing transition: δ(q, a)" error per missing
 *    pair. No trap/dead state is ever added silently: the user must add one explicitly.
 *  - Non-deterministic machines (the same (q, a) defined twice) are rejected as duplicates.
 *  - Q, Σ and Δ must be non-empty lists without duplicates; every state and symbol used in a
 *    transition must be declared. Symbols are compared as strings, exactly (no trimming of
 *    JSON values, no case folding).
 *  - ε is never an input symbol of the machine. The empty input string is a word of length 0
 *    and is handled by the simulator (simulate.js), not by the parser.
 */
(function (root, factory) {
  // Plain script so index.html works from file://; in the browser every core file adds to window.MM.
  if (typeof module === 'object' && module.exports) module.exports = factory({});
  else Object.assign((root.MM = root.MM || {}), factory(root.MM || {}));
})(this, function (M) {
  'use strict';
  const MEALY_ONLY_ERROR = 'Input must be a Mealy machine (this simulator converts Mealy → Moore only)';

  /**
   * Parse JSON text, a JSON object, or transition-table text, then validate it.
   * Text that starts with "{" is read as JSON; any other text as a transition table.
   * Never throws: syntax errors and validation errors are both returned in `errors`.
   * @param {string|Object} input  JSON text, transition-table text, or an already-parsed JSON spec
   * @param {Object} [opts]
   * @param {boolean} [opts.mealyOnly]  reject Moore machines (with one error) before validating them
   * @returns {{machine: (import('./model.js').MealyMachine|import('./model.js').MooreMachine|null), errors: string[]}}
   *          machine is null whenever errors is non-empty
   */
  function parseMachine(input, { mealyOnly = false } = {}) {
    let spec;
    try {
      if (typeof input !== 'string') spec = input;
      else if (input.trim().startsWith('{')) spec = JSON.parse(input);
      else spec = parseTableText(input);
    } catch (e) {
      return { machine: null, errors: [e.message] };
    }
    if (mealyOnly && spec?.type === 'moore') return { machine: null, errors: [MEALY_ONLY_ERROR] };
    return buildMachine(spec);
  }

  /**
   * Convert transition-table text into a JSON spec. Structural checks only; {@link buildMachine}
   * does the semantic validation.
   *
   *     type: mealy                    type: moore
   *     start: q0                      start: A
   *     outputs: 0 1                   outputs: 0 1
   *     state | 0    | 1               state | out | 0 | 1
   *     q0    | q0/0 | q1/0            A     | 0   | A | B
   *
   * Mealy cells are "next/output", Moore cells are "next". An empty cell or "-" is a missing
   * transition (reported by the completeness check). "#" starts a comment.
   * Assumes "type:" appears before the header row; Σ is taken from the header, Q from the rows.
   * @param {string} text  the whole transition-table text
   * @returns {Object} JSON spec (unvalidated)
   * @throws {Error} with the line number when the header is missing or misplaced, a row has the
   *                 wrong number of cells, or a Mealy cell is not "next/output"
   */
  function parseTableText(text) {
    const spec = { transitions: [] };
    let header = null;
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim();
      const at = `Line ${i + 1}`;
      if (!line) return;

      const kv = line.match(/^(type|start|outputs)\s*:\s*(.*)$/i);
      if (kv) {
        const key = kv[1].toLowerCase();
        const val = kv[2].trim();
        if (key === 'type') spec.type = val.toLowerCase();
        else if (key === 'start') spec.start = val;
        else spec.outputs = val.split(/[\s,]+/).filter(Boolean);
        return;
      }

      const cells = line.split('|').map((c) => c.trim());
      const moore = spec.type === 'moore';
      if (!header) {
        if (cells[0].toLowerCase() !== 'state') throw new Error(`${at}: expected the header row "state | ..."`);
        if (spec.type !== 'mealy' && spec.type !== 'moore') throw new Error(`${at}: "type: mealy" or "type: moore" must appear before the table`);
        if (moore && (cells[1] ?? '').toLowerCase() !== 'out') throw new Error(`${at}: Moore header must be "state | out | <inputs...>"`);
        header = cells;
        spec.inputs = cells.slice(moore ? 2 : 1);
        spec.states = [];
        if (moore) spec.stateOutputs = {};
        return;
      }

      if (cells.length !== header.length) throw new Error(`${at}: expected ${header.length} cells, found ${cells.length}`);
      const [q, ...rest] = cells;
      spec.states.push(q);
      if (moore) {
        const o = rest.shift();
        if (o !== '' && o !== '-') spec.stateOutputs[q] = o;
      }
      rest.forEach((cell, j) => {
        if (cell === '' || cell === '-') return;
        const input = spec.inputs[j];
        if (moore) {
          spec.transitions.push({ from: q, input, to: cell });
          return;
        }
        const k = cell.lastIndexOf('/');
        if (k < 1) throw new Error(`${at}: cell "${cell}" must be written as next/output`);
        spec.transitions.push({ from: q, input, to: cell.slice(0, k).trim(), output: cell.slice(k + 1).trim() });
      });
    });
    if (!header) throw new Error('No transition table found (the header row "state | ..." is missing)');
    return spec;
  }

  /**
   * Validate a JSON spec and build a deterministic, complete machine from it.
   * Reports every problem found, not only the first: empty alphabets / state set, duplicates,
   * undefined start state, unknown states or symbols, duplicate transitions, missing transitions,
   * and (Moore) missing or unknown state outputs. Incomplete machines are rejected; no trap state
   * is added. Never throws.
   * @param {Object} spec  JSON spec: {type, states, inputs, outputs, start, transitions, stateOutputs?}
   * @returns {{machine: (import('./model.js').MealyMachine|import('./model.js').MooreMachine|null), errors: string[]}}
   *          a deterministic, complete machine, or null with every error found
   */
  function buildMachine(spec) {
    if (!spec || typeof spec !== 'object') return { machine: null, errors: ['Input must be a JSON object or a transition table'] };
    const errors = [];
    const err = (m) => errors.push(m);

    const { type } = spec;
    if (type !== 'mealy' && type !== 'moore') err(`"type" must be "mealy" or "moore" (got ${JSON.stringify(type)})`);
    const mealy = type === 'mealy';

    const list = (field, label) => {
      const v = spec[field];
      if (!Array.isArray(v) || v.length === 0) {
        err(`${label} is empty: declare at least one element in "${field}"`);
        return [];
      }
      const arr = v.map(String);
      const dups = [...new Set(arr.filter((x, i) => arr.indexOf(x) !== i))];
      if (dups.length) err(`${label} has duplicate entries: ${dups.join(', ')}`);
      return arr;
    };
    const states = list('states', 'State set Q');
    const inputs = list('inputs', 'Input alphabet Σ');
    const outputs = list('outputs', 'Output alphabet Δ');
    const Q = new Set(states);
    const S = new Set(inputs);
    const D = new Set(outputs);

    const start = spec.start === undefined || spec.start === null ? '' : String(spec.start);
    if (start === '') err('Start state is undefined: set "start"');
    else if (!Q.has(start)) err(`Start state "${start}" is not in Q = {${states.join(', ')}}`);

    const delta = {};
    const lambda = {};
    for (const q of states) {
      delta[q] = {};
      lambda[q] = {};
    }

    if (!Array.isArray(spec.transitions)) err('"transitions" must be a list');
    for (const [n, t] of (Array.isArray(spec.transitions) ? spec.transitions : []).entries()) {
      const from = String(t?.from);
      const input = String(t?.input);
      const to = String(t?.to);
      const where = `Transition #${n + 1} (${from}, ${input})`;
      let ok = true;
      const bad = (m) => {
        err(`${where}: ${m}`);
        ok = false;
      };
      if (!Q.has(from)) bad(`source state "${from}" is not in Q`);
      if (!S.has(input)) bad(`unknown input symbol "${input}" (Σ = {${inputs.join(', ')}})`);
      if (!Q.has(to)) bad(`target state "${to}" is not in Q`);
      if (mealy && !D.has(String(t?.output))) bad(`unknown output symbol "${t?.output}" (Δ = {${outputs.join(', ')}})`);
      if (!ok) continue;
      if (Object.hasOwn(delta[from], input)) {
        err(`Duplicate transition: δ(${from}, ${input}) is defined more than once (machine must be deterministic)`);
        continue;
      }
      delta[from][input] = to;
      if (mealy) lambda[from][input] = String(t.output);
    }

    const out = {};
    if (type === 'moore') {
      const so = spec.stateOutputs && typeof spec.stateOutputs === 'object' ? spec.stateOutputs : {};
      for (const q of states) {
        if (!Object.hasOwn(so, q)) err(`Missing state output: λ'(${q}) is not defined`);
        else if (!D.has(String(so[q]))) err(`State output λ'(${q}) = "${so[q]}" is not in Δ = {${outputs.join(', ')}}`);
        else out[q] = String(so[q]);
      }
      for (const q of Object.keys(so)) if (!Q.has(q)) err(`"stateOutputs" mentions unknown state "${q}"`);
    }

    for (const q of states) {
      for (const a of inputs) {
        if (!Object.hasOwn(delta[q], a)) err(`Missing transition: δ(${q}, ${a}) is not defined (machine must be complete)`);
      }
    }

    if (errors.length) return { machine: null, errors };
    const machine = { type, states, inputs, outputs, start, delta };
    if (mealy) machine.lambda = lambda;
    else machine.out = out;
    return { machine, errors };
  }

  /**
   * Serialise a machine back to transition-table text (inverse of {@link parseTableText}).
   * Assumes a valid, complete machine (output of buildMachine or mealyToMoore).
   * @param {import('./model.js').MealyMachine|import('./model.js').MooreMachine} m
   * @returns {string} text that parseMachine reads back to an identical machine
   */
  function toTableText(m) {
    const moore = m.type === 'moore';
    const head = ['state', ...(moore ? ['out'] : []), ...m.inputs];
    const rows = m.states.map((q) => [
      q,
      ...(moore ? [m.out[q]] : []),
      ...m.inputs.map((a) => (moore ? m.delta[q][a] : `${m.delta[q][a]}/${m.lambda[q][a]}`)),
    ]);
    const width = head.map((_, j) => Math.max(...[head, ...rows].map((r) => r[j].length)));
    const fmt = (r) => r.map((c, j) => c.padEnd(width[j])).join(' | ').trimEnd();
    return [`type: ${m.type}`, `start: ${m.start}`, `outputs: ${m.outputs.join(' ')}`, fmt(head), ...rows.map(fmt)].join('\n');
  }

  /**
   * Serialise a machine to the JSON spec format (inverse of {@link buildMachine}); used to export
   * the generated Moore machine. One transition per (state, input) pair, in declaration order.
   * Assumes a valid, complete machine.
   * @param {import('./model.js').MealyMachine|import('./model.js').MooreMachine} m
   * @returns {Object} JSON spec that buildMachine turns back into an identical machine
   */
  function toSpec(m) {
    const spec = { type: m.type, states: [...m.states], inputs: [...m.inputs], outputs: [...m.outputs], start: m.start };
    if (m.type === 'moore') spec.stateOutputs = { ...m.out };
    spec.transitions = m.states.flatMap((q) => m.inputs.map((a) =>
      m.type === 'mealy' ? { from: q, input: a, to: m.delta[q][a], output: m.lambda[q][a] } : { from: q, input: a, to: m.delta[q][a] }));
    return spec;
  }

  return { parseMachine, parseTableText, buildMachine, toTableText, toSpec };
});
