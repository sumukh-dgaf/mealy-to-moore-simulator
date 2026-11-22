/**
 * "Explanation in words": textbook sentences describing a finished Mealy → Moore conversion,
 * generated from the conversion result and its step log (no AI), so the text always matches the
 * result. Also the display names for Moore states ("[A,0]" or textbook "A0"); these change only what
 * is shown, never the internal state ids or any algorithm.
 */
(function (root, factory) {
  // Plain script so index.html works from file://; in the browser every core file adds to window.MM.
  if (typeof module === 'object' && module.exports) module.exports = factory({});
  else Object.assign((root.MM = root.MM || {}), factory(root.MM || {}));
})(this, function (M) {
  'use strict';

  /** "a", "a and b", "a, b and c" */
  const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

  /**
   * Display names for every Moore state created by mealyToMoore (kept or removed).
   * "bracket": the internal id, e.g. "[A,0]". "textbook": "A0"; "A_0" when the Mealy state name ends
   * in a digit (q0 → "q0_0"), so names stay unambiguous; a state with no incoming transitions is "A–".
   * If the textbook names would not be unique, or would equal a Mealy state name, the bracket names
   * are used instead (fellBack = true).
   * @param {ReturnType<import('./mealyToMoore.js').mealyToMoore>} conv
   * @param {import('./model.js').MealyMachine} mealy  the converted machine (for its state names)
   * @param {'bracket'|'textbook'} [style]
   * @returns {{names: Object<string, string>, style: 'bracket'|'textbook', fellBack: boolean}}
   */
  function mooreDisplayNames(conv, mealy, style = 'bracket') {
    const ids = Object.keys(conv.origin);
    const bracket = Object.fromEntries(ids.map((id) => [id, id]));
    if (style !== 'textbook') return { names: bracket, style: 'bracket', fellBack: false };
    const names = {};
    for (const id of ids) {
      const { q, o } = conv.origin[id];
      names[id] = q + (/\d$/.test(q) ? '_' : '') + (o === null ? '–' : o);
    }
    const values = Object.values(names);
    const clash = new Set(values).size !== values.length || values.some((n) => mealy.states.includes(n));
    return clash ? { names: bracket, style: 'bracket', fellBack: true } : { names, style: 'textbook', fellBack: false };
  }

  /**
   * Explain a conversion in full sentences, section by section, from the step log.
   * Assumes conv came from mealyToMoore(mealy, …) for this very machine.
   * @param {import('./model.js').MealyMachine} mealy
   * @param {ReturnType<import('./mealyToMoore.js').mealyToMoore>} conv
   * @param {Object<string, string>} [names]  display names from mooreDisplayNames (default: ids)
   * @returns {Array<{heading: string, sentences: string[]}>}
   */
  function explainConversion(mealy, conv, names = {}) {
    const n = (id) => names[id] || id;
    const moore = conv.machine;
    const copies = (q) => Object.keys(conv.origin).filter((id) => conv.origin[id].q === q);
    const sections = [];

    const s0 = moore.start;
    const start = conv.steps.find((s) => s.rule === 'A5');
    const startOut = conv.origin[s0].o === null ? `default output ${moore.out[s0]}` : `output ${moore.out[s0]}`;
    const startSentences = [`The Mealy machine starts at ${mealy.start}, which corresponds to ${n(s0)} (${startOut}) in the Moore machine.`];
    if (start && start.data.candidates.length > 1) {
      startSentences.push(`${mealy.start} could also have started as ${listWords(start.data.candidates.filter((c) => c !== s0).map(n))}; any copy is correct, because the Moore machine's first output is dropped when the outputs are compared.`);
    }
    sections.push({ heading: 'Start state', sentences: startSentences });

    sections.push({
      heading: 'Splitting the states',
      sentences: mealy.states.map((q) => {
        const O = conv.incoming[q];
        const c = copies(q);
        // the copy may already be removed from the machine, so read its output from the A3 step
        if (O.length === 0) return `${q} has no incoming transitions, so it becomes ${n(c[0])} with the default output ${conv.steps.find((s) => s.rule === 'A3' && s.data.from === q).data.output}.`;
        if (O.length === 1) return `State ${q} is entered only with output ${O[0]}, so it becomes ${n(c[0])} (output ${O[0]}).`;
        return `State ${q} is entered with outputs ${listWords(O)}, so it splits into ${listWords(c.map(n))}.`;
      }),
    });

    const trans = [];
    for (const s of moore.states) {
      const q = conv.origin[s].q;
      for (const a of mealy.inputs) {
        trans.push(`From ${n(s)} on input ${a} the Mealy machine goes to ${mealy.delta[q][a]} with output ${mealy.lambda[q][a]}, so the Moore machine goes to ${n(moore.delta[s][a])}.`);
      }
    }
    sections.push({ heading: 'Transitions', sentences: trans });

    const pruned = conv.steps.some((s) => s.rule === 'A6');
    const removal = !pruned
      ? ['Unreachable states were kept, because the option to remove them is off.']
      : conv.removed.length
        ? [`${conv.removed.length > 1 ? 'States' : 'State'} ${listWords(conv.removed.map(n))} can never be reached from the start state, so ${conv.removed.length > 1 ? 'they are' : 'it is'} removed.`]
        : ['Every Moore state can be reached from the start state, so none is removed.'];
    removal.push(`The Moore machine has ${moore.states.length} state${moore.states.length === 1 ? '' : 's'}, within the bound |Q|·|Δ| = ${mealy.states.length}·${mealy.outputs.length} = ${conv.bound}.`);
    sections.push({ heading: 'Unreachable states and size', sentences: removal });

    sections.push({
      heading: 'The Moore machine',
      sentences: moore.states.map((s) => {
        const moves = mealy.inputs.map((a, i) => `on ${a}${i === 0 ? ' it goes' : ''} to ${n(moore.delta[s][a])}`);
        return `${n(s)}${s === s0 ? ' (start state)' : ''} outputs ${moore.out[s]}; ${listWords(moves)}.`;
      }),
    });
    return sections;
  }

  /**
   * Plain-text answer for an answer sheet: the explanation, then the final Moore table.
   * @param {import('./model.js').MealyMachine} mealy
   * @param {ReturnType<import('./mealyToMoore.js').mealyToMoore>} conv
   * @param {Object<string, string>} [names]  display names from mooreDisplayNames (default: ids)
   * @returns {string}
   */
  function answerText(mealy, conv, names = {}) {
    const n = (id) => names[id] || id;
    const moore = conv.machine;
    const lines = [];
    for (const sec of explainConversion(mealy, conv, names)) lines.push(sec.heading, ...sec.sentences.map((s) => `- ${s}`), '');
    const head = ['State', 'Output', ...moore.inputs.map((a) => `on ${a}`)];
    const rows = moore.states.map((s) => [(s === moore.start ? '→ ' : '  ') + n(s), moore.out[s], ...moore.inputs.map((a) => n(moore.delta[s][a]))]);
    const width = head.map((_, j) => Math.max(...[head, ...rows].map((r) => r[j].length)));
    const fmt = (r) => r.map((c, j) => c.padEnd(width[j])).join(' | ').trimEnd();
    lines.push('Moore transition table (→ start state)', fmt(head), width.map((w) => '-'.repeat(w)).join('-+-'), ...rows.map(fmt));
    return lines.join('\n');
  }

  return { mooreDisplayNames, explainConversion, answerText };
});
