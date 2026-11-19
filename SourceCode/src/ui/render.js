/* render.js — view helpers: turn core results into HTML. No algorithm logic lives here.
   Every user-supplied string goes through esc() before reaching innerHTML. */
(function (root) {
  'use strict';
  const { showWord } = root.MM;

  /** Escape text for safe insertion into innerHTML. @param {*} s @returns {string} */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  /** Format a list as an escaped set "{a, b}". @param {string[]} list @returns {string} HTML */
  const set = (list) => '{' + list.map(esc).join(', ') + '}';
  /** One chip per item (or "none"). @param {string[]} list @param {string} [cls] chip class, e.g. "ok" @returns {string} HTML */
  const chips = (list, cls = '') =>
    list.length ? list.map((s) => `<span class="chip ${cls}">${esc(s)}</span>`).join('') : '<span class="muted">none</span>';

  /**
   * Transition table of a (possibly partial) machine: start marked →, missing cells "·".
   * @param {import('../core/model.js').MealyMachine|import('../core/model.js').MooreMachine} m
   * @param {{hot?: {q: string, a: string}}} [opts]  hot outlines one cell (the cell being filled)
   * @returns {string} HTML table plus legend
   */
  function tableHtml(m, opts = {}) {
    const moore = m.type === 'moore';
    const hot = opts.hot;
    const head = `<tr><th>${moore ? 'δ′' : 'δ / λ'}</th>${moore ? '<th>λ′</th>' : ''}${m.inputs.map((a) => `<th>${esc(a)}</th>`).join('')}</tr>`;
    const rows = m.states.map((q) => {
      const cells = m.inputs.map((a) => {
        const t = m.delta[q] && m.delta[q][a];
        const text = t === undefined ? '·' : moore ? esc(t) : `${esc(t)} / ${esc(m.lambda[q][a])}`;
        return `<td${hot && hot.q === q && hot.a === a ? ' class="hot"' : ''}>${text}</td>`;
      }).join('');
      return `<tr><th>${q === m.start ? '→' : ''}${esc(q)}</th>${moore ? `<td>${esc(m.out[q])}</td>` : ''}${cells}</tr>`;
    });
    const legend = moore ? '→ start · λ′ = state output · cells: δ′(q, a)' : '→ start · cells: δ(q, a) / λ(q, a)';
    return `<table class="grid"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table><p class="legend">${legend}</p>`;
  }

  /**
   * Per-symbol alignment of one comparison: Moore's first output sits under no input symbol and is
   * shown struck through; mismatching symbols are marked.
   * @param {ReturnType<import('../core/simulate.js').compareOnWord>} r
   * @returns {string} HTML
   */
  function alignHtml(r) {
    const cell = (s, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${esc(s)}</td>`;
    const diff = (i) => (r.mooreDropped[i] !== r.mealy.outputs[i] ? 'diff' : '');
    return `<table class="align">
      <tr><td class="lbl">input</td>${cell('')}${r.word.map((a) => cell(a)).join('')}</tr>
      <tr><td class="lbl">Moore</td>${cell(r.moore.outputs[0], 'dropped')}${r.mooreDropped.map((o, i) => cell(o, diff(i))).join('')}</tr>
      <tr><td class="lbl">Mealy</td>${cell('')}${r.mealy.outputs.map((o, i) => cell(o, diff(i))).join('')}</tr>
    </table><p class="legend">The grey Moore symbol is λ′(q₀′), printed before any input is read; it is dropped before comparing.</p>`;
  }

  /**
   * One machine's run: state path with the symbol read (and, for Mealy, the output) on each arrow.
   * @param {string} name        row label ("Mealy" / "Moore")
   * @param {string[]} states    visited states (n + 1)
   * @param {string[]} word      input symbols (n)
   * @param {string[]} outputs   n (Mealy) or n + 1 (Moore) outputs
   * @param {boolean} moore      true: outputs belong to states; false: to transitions
   * @returns {string} HTML
   */
  function runHtml(name, states, word, outputs, moore) {
    const path = states.map((s, k) =>
      (k ? `<span class="arrow">—${esc(word[k - 1])}${moore ? '' : '/' + esc(outputs[k - 1])}→</span>` : '') +
      esc(s) + (moore ? `<sub>${esc(outputs[k])}</sub>` : '')).join(' ');
    return `<div class="run"><span class="run-name">${name}</span><span class="path">${path}</span><code class="out">${esc(showWord(outputs))}</code></div>`;
  }

  /**
   * Result of Algorithm C: verdict, pairs explored, and for a failure the shortest counterexample.
   * @param {ReturnType<import('../core/equivalence.js').checkEquivalence>} res
   * @returns {string} HTML
   */
  function equivalenceHtml(res) {
    const pairs = res.pairs.map(([q, r]) => `(${esc(q)}, ${esc(r)})`).join(', ');
    if (res.equivalent) {
      return `<p class="good"><b>✓ Equivalent:</b> no mismatch in ${res.pairsExplored} reachable state pairs.</p>
        <p class="legend">Pairs explored: ${pairs}</p>`;
    }
    const w = res.witness;
    return `<p class="bad"><b>✗ Not equivalent.</b> Shortest counterexample: <code>${esc(showWord(res.counterexample))}</code></p>
      <p>${esc(res.steps.at(-1).description)}</p>
      <p>Mealy output <code>${esc(showWord(w.mealy.outputs))}</code> vs Moore output with first symbol dropped <code>${esc(showWord(w.mooreDropped))}</code></p>
      ${alignHtml(w)}
      <p class="legend">Pairs discovered before the mismatch: ${pairs}</p>`;
  }

  root.MMView = { esc, set, chips, tableHtml, alignHtml, runHtml, equivalenceHtml };
})(this);
