/**
 * app.js — controller: Mealy machine editor, step-by-step player, string tester, hand-converted
 * check, exports (diagram SVG/PNG, Moore machine JSON/text) and share links.
 *
 * The theory lives in src/core (window.MM); this file only turns its results and step logs into
 * screens. It exports nothing (it runs once on page load).
 *
 * Error handling: every input goes through MM.parseMachine first; its errors (and the option
 * errors thrown by MM.mealyToMoore) are listed in the editor's message box and nothing is
 * converted. Test strings with unknown symbols, unreadable share links and failed PNG exports
 * are reported next to the control that caused them. All user text is escaped (render.js esc).
 */
(function () {
  'use strict';
  const M = window.MM, G = window.MMGraph, V = window.MMView, PRESETS = window.MM_PRESETS;
  const { esc, set, chips } = V;
  const $ = (id) => document.getElementById(id);
  const b = (s) => '<b>' + esc(s) + '</b>';
  const list = (text) => String(text || '').split(/[\s,]+/).filter(Boolean);

  const editor = { states: [], inputs: [], outputs: [], start: '', delta: {}, lambda: {} };
  let res = null, steps = [], cur = 0, timer = null, samples = null;

  /* ================= Tabs ================= */
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== btn.dataset.tab; });
    });
  });

  /* ================= Mealy machine editor ================= */
  function loadMachine(m) {
    editor.states = [...m.states];
    editor.inputs = [...m.inputs];
    editor.outputs = [...m.outputs];
    editor.start = m.start;
    editor.delta = {};
    editor.lambda = {};
    m.states.forEach((s) => {
      editor.delta[s] = { ...m.delta[s] };
      editor.lambda[s] = { ...m.lambda[s] };
    });
    $('states').value = editor.states.join(', ');
    $('inputs').value = editor.inputs.join(', ');
    $('outputs').value = editor.outputs.join(', ');
    renderEditor();
  }

  function syncFromInputs() {
    editor.states = list($('states').value);
    editor.inputs = list($('inputs').value);
    editor.outputs = list($('outputs').value);
    if (!editor.states.includes(editor.start)) editor.start = editor.states[0] || '';
    renderEditor();
  }

  const options = (values, selected, blank) =>
    (blank !== undefined ? `<option value="">${blank}</option>` : '') +
    values.map((v) => `<option${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');

  function renderEditor() {
    const Q = editor.states, D = editor.outputs;
    $('startSel').innerHTML = options(Q, editor.start);
    const keepDefault = $('defaultSel').value, keepStart = $('startOutSel').value;
    $('defaultSel').innerHTML = options(D, D.includes(keepDefault) ? keepDefault : D[0]);
    $('startOutSel').innerHTML = options(D, keepStart, 'first in O(q₀)');

    const head = '<tr><th>δ / λ</th>' + editor.inputs.map((a) => `<th>${esc(a)}</th>`).join('') + '</tr>';
    const rows = Q.map((s) => `<tr><th>${s === editor.start ? '→' : ''}${esc(s)}</th>` + editor.inputs.map((a) =>
      `<td><div class="cell"><select data-s="${esc(s)}" data-a="${esc(a)}" data-k="delta" aria-label="δ(${esc(s)}, ${esc(a)})">` +
      options(Q, (editor.delta[s] || {})[a], '—') + '</select><span>/</span>' +
      `<select data-s="${esc(s)}" data-a="${esc(a)}" data-k="lambda" aria-label="λ(${esc(s)}, ${esc(a)})">` +
      options(D, (editor.lambda[s] || {})[a], '—') + '</select></div></td>').join('') + '</tr>').join('');
    $('deltaTable').innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
  }

  ['states', 'inputs', 'outputs'].forEach((id) => $(id).addEventListener('change', syncFromInputs));
  $('startSel').addEventListener('change', (e) => { editor.start = e.target.value; renderEditor(); });
  $('deltaTable').addEventListener('change', (e) => {
    const { s, a, k } = e.target.dataset;
    if (!s) return;
    (editor[k][s] = editor[k][s] || {})[a] = e.target.value;
  });

  function currentSpec() {
    const transitions = [];
    editor.states.forEach((s) => editor.inputs.forEach((a) => {
      const to = (editor.delta[s] || {})[a], output = (editor.lambda[s] || {})[a];
      if (to && output) transitions.push({ from: s, input: a, to, output }); // half-filled cells are reported as missing
    }));
    return { type: 'mealy', states: [...editor.states], inputs: [...editor.inputs], outputs: [...editor.outputs], start: editor.start, transitions };
  }

  /* ================= Presets and import ================= */
  $('preset').innerHTML = '<option value="">— choose an example —</option>' +
    PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('preset').addEventListener('change', (e) => {
    const p = PRESETS.find((x) => x.id === e.target.value);
    if (!p) return;
    loadMachine(M.parseMachine(p.machine).machine);
    $('presetNote').textContent = p.note;
    samples = p.tests;
    run();
  });
  $('newBtn').addEventListener('click', () => {
    $('preset').value = '';
    $('presetNote').textContent = 'Enter your own states and alphabets, fill every cell (next state / output), then press Convert.';
    samples = null;
    loadMachine({ states: ['q0', 'q1'], inputs: ['0', '1'], outputs: ['0', '1'], start: 'q0', delta: {}, lambda: {} });
  });
  $('importBtn').addEventListener('click', () => {
    const { machine, errors } = M.parseMachine($('importText').value, { mealyOnly: true });
    if (errors.length) return showInputErrors(errors);
    $('preset').value = '';
    $('presetNote').textContent = '';
    samples = null;
    loadMachine(machine);
    run();
  });

  /* ================= Run the conversion ================= */
  $('runBtn').addEventListener('click', run);

  function showInputErrors(errors) {
    $('inputMsg').className = 'msg error';
    $('inputMsg').innerHTML = '<b>Please fix the input:</b><ul>' + errors.map((e) => `<li>${esc(e)}</li>`).join('') + '</ul>';
    $('player').hidden = $('tester').hidden = $('checker').hidden = true;
    $('emptyState').hidden = false;
  }

  function run() {
    stop();
    syncFromInputs();
    const { machine, errors } = M.parseMachine(currentSpec(), { mealyOnly: true });
    if (errors.length) return showInputErrors(errors);
    let conv;
    try {
      conv = M.mealyToMoore(machine, {
        defaultOutput: $('defaultSel').value,
        startOutput: $('startOutSel').value || undefined,
        removeUnreachable: $('pruneChk').checked,
      });
    } catch (e) {
      return showInputErrors([e.message]);
    }
    const randomRuns = M.randomWords(machine.inputs, 200, 10).map((w) => M.compareOnWord(machine, conv.machine, w));
    res = { mealy: machine, conv, moore: conv.machine, eq: M.checkEquivalence(machine, conv.machine),
            randomPassed: randomRuns.filter((r) => r.match).length, randomTotal: randomRuns.length };
    res.full = mooreFromSteps(res, Infinity);

    $('inputMsg').className = 'msg ok';
    $('inputMsg').textContent = 'Input is a valid, complete, deterministic Mealy machine.';
    steps = buildSteps(res);
    $('emptyState').hidden = true;
    $('player').hidden = $('tester').hidden = $('checker').hidden = false;
    $('testOut').innerHTML = '';
    $('testLog').hidden = true;
    $('testLog').tBodies[0].innerHTML = '';
    $('checkOut').innerHTML = '';
    $('exportMsg').textContent = '';
    renderSummary();
    renderTimeline();
    renderSamples();
    renderStepList();
    show(0);
  }

  /* The Moore machine as built by the first `upto` steps of the log (all created states, nothing pruned). */
  function mooreFromSteps(r, upto) {
    const m = { type: 'moore', states: [], inputs: r.mealy.inputs, outputs: r.mealy.outputs, start: undefined, delta: {}, out: {} };
    r.conv.steps.slice(0, upto).forEach(({ rule, data }) => {
      if (rule === 'A2' || rule === 'A3') {
        m.states.push(data.state);
        m.out[data.state] = data.output;
        m.delta[data.state] = {};
      } else if (rule === 'A4') m.delta[data.from][data.input] = data.to;
      else if (rule === 'A5') m.start = data.start;
    });
    return m;
  }

  /* ================= Result strip + phase timeline ================= */
  function renderSummary() {
    const ok = res.eq.equivalent;
    const stat = (cls, big, small) => `<div class="stat ${cls}"><b>${big}</b><span>${small}</span></div>`;
    $('summary').innerHTML =
      stat('hero', res.mealy.states.length + ' → ' + res.moore.states.length, 'states (Mealy → Moore)') +
      stat('', res.conv.createdCount, 'Moore states created') +
      stat('', res.conv.removed.length, 'unreachable removed') +
      stat('', '≤ ' + res.conv.bound, 'bound |Q|·|Δ|') +
      stat(ok ? 'ok' : '', ok ? '✓' : '✗', ok ? 'equivalent (exact check)' : 'not equivalent');
  }

  let phaseOrder = [];
  function renderTimeline() {
    phaseOrder = [];
    steps.forEach((s, k) => { if (!phaseOrder.some((p) => p.name === s.phase)) phaseOrder.push({ name: s.phase, first: k }); });
    $('timeline').innerHTML = phaseOrder.map((p) =>
      `<li><button type="button" data-k="${p.first}" title="Jump to ${esc(p.name)}"><span class="label">${esc(p.name)}</span></button></li>`).join('');
  }
  function updateTimeline(phase) {
    const idx = phaseOrder.findIndex((p) => p.name === phase);
    $('timeline').querySelectorAll('li').forEach((li, i) => {
      li.className = i < idx ? 'done' : i === idx ? 'current' : '';
      li.firstChild.setAttribute('aria-current', i === idx ? 'step' : 'false');
    });
  }
  $('timeline').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) { stop(); show(+btn.dataset.k); }
  });

  /* ================= Presentation (hide editor) ================= */
  function toggleFocus() {
    const on = document.body.classList.toggle('focus');
    $('focusBtn').setAttribute('aria-pressed', on);
    $('focusBtn').textContent = on ? 'Show editor' : 'Hide editor';
  }
  $('focusBtn').addEventListener('click', toggleFocus);

  /* ================= Build the list of steps from the algorithm's step log ================= */
  function buildSteps(r) {
    const S = [], me = r.mealy, Q = me.states, origin = r.conv.origin;
    const mealyGroups = Q.map((q) => [q]);
    // colour every Moore copy [q,o] like its Mealy state q (empty groups keep the colour indexes aligned)
    const copyGroups = (m) => Q.map((q) => m.states.filter((s) => origin[s].q === q));
    const into = (q) => Q.flatMap((p) => me.inputs.filter((a) => me.delta[p][a] === q).map(() => ({ from: p, to: q })));

    S.push({ phase: 'Input', title: 'Check the input Mealy machine',
      html: `<p>The input is a Mealy machine <i>M</i> = (Q, Σ, Δ, δ, λ, q₀) with Q = ${set(Q)}, Σ = ${set(me.inputs)}, ` +
            `Δ = ${set(me.outputs)}, q₀ = ${b(me.start)}. Output is written on the transitions: an edge labelled <code>a/o</code> reads a and outputs o.</p>` +
            '<p>Goal: build a Moore machine (output written on the states) with the same behaviour. On an input of length n the Moore ' +
            'machine prints n + 1 symbols; its first symbol is dropped before comparing.</p>',
      graph: { m: me, label: 'Input Mealy machine', groups: mealyGroups },
      work: { kind: 'table', m: me, caption: 'Transition table δ / λ' } });

    r.conv.steps.forEach((st, k) => {
      const d = st.data;
      if (st.rule === 'A1') {
        S.push({ phase: 'Incoming outputs', title: `O(${d.state}) = {${d.outputs.join(', ')}}`,
          html: `<p>A Moore state has <b>one</b> output, so first collect the outputs written on the transitions that <b>enter</b> ${b(d.state)}.</p><p>` +
                (d.incoming.length
                  ? `Entering transitions: ${d.incoming.map((t) => `<code>${esc(t)}</code>`).join(', ')}, so O(${esc(d.state)}) = ${set(d.outputs)}.`
                  : `${b(d.state)} has no incoming transitions, so O(${esc(d.state)}) = ∅. It is handled in the next phase.`) + '</p>' +
                (d.outputs.length > 1 ? `<p class="note">${d.outputs.length} different outputs enter ${b(d.state)}, so it must be split into ${d.outputs.length} Moore states.</p>` : ''),
          graph: { m: me, label: 'Input Mealy machine', groups: mealyGroups, active: [d.state], activeEdges: into(d.state) },
          work: { kind: 'incoming', upto: k } });
      } else if (st.rule === 'A2' || st.rule === 'A3') {
        const isStart = d.from === me.start;
        S.push({ phase: 'Split states', title: `Create ${d.state}`,
          html: st.rule === 'A2'
            ? `<p>${b(d.from)} is entered with output ${b(d.output)}, so create the copy ${b(d.state)} with state output λ′ = ${esc(d.output)}. ` +
              `It means “in ${esc(d.from)}, and the last output was ${esc(d.output)}”.</p>`
            : `<p class="note">${b(d.from)} has no incoming transitions, so it gets a single copy ${b(d.state)}. No transition enters it, ` +
              `so its output is set to the <b>default</b> ${b(d.output)} (change it under Options).` +
              (isStart ? ' It is the start state, so this output is the first Moore symbol, which the comparison drops.' : ' It is not the start state, so it is unreachable and removed later.') + '</p>',
          graph: { m: me, label: 'Input Mealy machine', groups: mealyGroups, active: [d.from] },
          work: { kind: 'created', upto: k, current: d.state } });
      } else if (st.rule === 'A4') {
        const q = origin[d.from].q, p = me.delta[q][d.input], o = me.lambda[q][d.input];
        S.push({ phase: 'Transitions', title: `δ′(${d.from}, ${d.input}) = ${d.to}`,
          html: `<p>In the Mealy machine, ${b(q)} on “${esc(d.input)}” goes to ${b(p)} and outputs ${b(o)}. ` +
                `So the Moore machine must enter the copy of ${esc(p)} whose output is ${esc(o)}: ${b(d.to)}.</p>` +
                `<p>The rule never looks at the output part of ${esc(d.from)}, so every copy of ${esc(q)} gets the same row.</p>`,
          graph: { m: me, label: 'Input Mealy machine', groups: mealyGroups, active: [q], activeEdges: [{ from: q, to: p }] },
          work: { kind: 'moore', m: mooreFromSteps(r, k + 1), hot: { q: d.from, a: d.input }, caption: 'Moore transition table (filling in)' } });
      } else if (st.rule === 'A5') {
        S.push({ phase: 'Start state', title: `Start state ${d.start}`,
          html: `<p>${esc(st.description)}</p>`,
          graph: { m: r.full, label: 'Moore machine (all created states)', groups: copyGroups(r.full), active: [d.start] },
          work: { kind: 'chips', rows: [['Candidates', d.candidates, ''], ['Start', [d.start], 'ok']] } });
      } else if (st.rule === 'A6') {
        const kept = r.moore.states;
        S.push({ phase: 'Unreachable', title: d.removed.length ? 'Remove unreachable Moore states' : 'All Moore states are reachable',
          html: `<p>Breadth-first search from the start state ${b(r.moore.start)} over δ′. ` + (d.removed.length
            ? `${set(d.removed)} can never be reached, so ${d.removed.length > 1 ? 'they are' : 'it is'} removed. No input reaches ${d.removed.length > 1 ? 'them' : 'it'}, so no output changes.`
            : 'Every created state is visited, so nothing is removed.') + '</p>',
          graph: { m: r.full, label: 'Moore machine (all created states)', groups: copyGroups(r.full), faded: d.removed, visited: kept },
          work: { kind: 'chips', rows: [['Reachable', kept, 'ok'], ['Removed', d.removed, 'bad']] } });
      } else if (st.rule === 'BOUND') {
        S.push({ phase: 'Result', title: 'Result: the Moore machine',
          html: `<p>|Q′| = ${b(d.final)} (created ${d.created}, removed ${d.created - d.final}) ≤ |Q|·|Δ| = ${Q.length}·${me.outputs.length} = ${b(d.bound)}. ` +
                'Each Mealy state gives at most one copy per output symbol.</p>' +
                '<p>Copies of the same Mealy state share a colour in the diagram.</p>',
          graph: { m: r.moore, label: 'Result Moore machine · coloured by Mealy state', groups: copyGroups(r.moore) },
          work: { kind: 'two' } });
      }
    });

    S.push({ phase: 'Validate', title: 'Result and validation',
      html: '<ul class="facts">' +
        `<li class="${r.eq.equivalent ? 'good' : 'bad'}">` + (r.eq.equivalent
          ? `✓ Exact check (Algorithm C): breadth-first search over ${r.eq.pairsExplored} reachable state pairs (Mealy state, Moore state) found no input on which the outputs differ.`
          : `✗ Outputs differ on “${esc(M.showWord(r.eq.counterexample))}”.`) + '</li>' +
        `<li class="${r.randomPassed === r.randomTotal ? 'good' : 'bad'}">${r.randomPassed === r.randomTotal ? '✓' : '✗'} ` +
          `${r.randomPassed} of ${r.randomTotal} random strings (length 0–10): Moore output minus its first symbol equals the Mealy output.</li>` +
        '<li>Test your own strings below, or paste a hand-converted Moore machine to check it.</li></ul>',
      graph: { m: r.moore, label: 'Result Moore machine · coloured by Mealy state', groups: copyGroups(r.moore) },
      work: { kind: 'pairs' } });
    return S;
  }

  /* ================= Step player ================= */
  function show(i) {
    cur = Math.max(0, Math.min(i, steps.length - 1));
    const st = steps[cur];
    $('stepCount').textContent = 'Step ' + (cur + 1) + ' of ' + steps.length;
    $('stepTitle').textContent = st.title;
    const txt = $('stepText');
    txt.innerHTML = st.html;
    txt.classList.remove('swap'); void txt.offsetWidth; txt.classList.add('swap'); // restart the fade
    updateTimeline(st.phase);
    $('progress').style.width = ((cur + 1) / steps.length * 100) + '%';
    $('prevBtn').disabled = cur === 0;
    $('nextBtn').disabled = cur === steps.length - 1;

    const gr = st.graph;
    $('graphLabel').textContent = gr.label;
    G.draw($('graphMain'), gr.m, {
      groups: gr.groups, active: new Set(gr.active || []), visited: new Set(gr.visited || []),
      faded: new Set(gr.faded || []), activeEdges: gr.activeEdges,
    });
    renderWork(st.work);

    document.querySelectorAll('#stepList li[data-k]').forEach((li) => {
      const on = +li.dataset.k === cur;
      li.classList.toggle('current', on);
      // scroll only the list, never the whole page (autoplay would make the page jump)
      const ul = li.parentElement;
      if (on && (li.offsetTop < ul.scrollTop || li.offsetTop > ul.scrollTop + ul.clientHeight - 30)) ul.scrollTop = li.offsetTop - ul.clientHeight / 2;
    });
  }

  function renderStepList() {
    let last = '';
    $('stepList').innerHTML = steps.map((s, k) => {
      const head = s.phase !== last ? `<li class="phase-head">${esc(s.phase)}</li>` : '';
      last = s.phase;
      return head + `<li data-k="${k}">${esc(s.title)}</li>`;
    }).join('');
  }
  $('stepList').addEventListener('click', (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (k !== undefined) { stop(); show(+k); }
  });
  $('prevBtn').addEventListener('click', () => { stop(); show(cur - 1); });
  $('nextBtn').addEventListener('click', () => { stop(); show(cur + 1); });
  $('firstBtn').addEventListener('click', () => { stop(); show(0); });
  $('lastBtn').addEventListener('click', () => { stop(); show(steps.length - 1); });
  $('playBtn').addEventListener('click', () => (timer ? stop() : play()));

  function play() {
    if (cur === steps.length - 1) show(0);
    $('playBtn').textContent = '❚❚ Pause';
    timer = setInterval(() => {
      if (cur >= steps.length - 1) return stop();
      show(cur + 1);
    }, +$('speed').value);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    $('playBtn').textContent = '▶ Play';
  }
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') { toggleFocus(); return; }
    if ($('player').hidden) return;
    if (e.key === 'ArrowRight') { stop(); show(cur + 1); }
    else if (e.key === 'ArrowLeft') { stop(); show(cur - 1); }
    else if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); timer ? stop() : play(); }
  });

  /* ================= Work-area renderers ================= */
  function renderWork(w) {
    const box = $('work'), title = $('workLabel');
    const A = res.conv.steps;
    if (w.kind === 'table' || w.kind === 'moore') {
      title.textContent = w.caption;
      box.innerHTML = V.tableHtml(w.m, { hot: w.hot });
    } else if (w.kind === 'incoming') {
      title.textContent = 'O(q): outputs entering each state';
      box.innerHTML = '<table class="grid"><thead><tr><th>State</th><th>Entering transitions</th><th>O(q)</th></tr></thead><tbody>' +
        A.slice(0, w.upto + 1).filter((s) => s.rule === 'A1').map((s, i, all) =>
          `<tr${i === all.length - 1 ? ' class="hot"' : ''}><th>${esc(s.data.state)}</th><td>${s.data.incoming.map(esc).join(', ') || '—'}</td><td>${set(s.data.outputs)}</td></tr>`).join('') +
        '</tbody></table>';
    } else if (w.kind === 'created') {
      title.textContent = 'Moore states created so far';
      box.innerHTML = '<table class="grid"><thead><tr><th>Moore state</th><th>Copy of</th><th>λ′</th></tr></thead><tbody>' +
        A.slice(0, w.upto + 1).filter((s) => s.rule === 'A2' || s.rule === 'A3').map((s) =>
          `<tr${s.data.state === w.current ? ' class="hot"' : ''}><th>${esc(s.data.state)}</th><td>${esc(s.data.from)}</td>` +
          `<td>${esc(s.data.output)}${s.rule === 'A3' ? ' <span class="muted">(default)</span>' : ''}</td></tr>`).join('') +
        '</tbody></table>';
    } else if (w.kind === 'chips') {
      title.textContent = 'States';
      box.innerHTML = w.rows.map(([label, items, cls]) => `<div class="kv"><span>${esc(label)}</span><div>${chips(items, cls)}</div></div>`).join('');
    } else if (w.kind === 'two') {
      title.textContent = 'Before and after';
      box.innerHTML = `<div class="two-tables"><div><h4>Mealy (${res.mealy.states.length} states)</h4>${V.tableHtml(res.mealy)}</div>` +
        `<div><h4>Moore (${res.moore.states.length} states)</h4>${V.tableHtml(res.moore)}</div></div>`;
    } else if (w.kind === 'pairs') {
      title.textContent = 'Reachable state pairs (Algorithm C)';
      box.innerHTML = '<table class="grid"><thead><tr><th>#</th><th>Mealy state</th><th>Moore state</th></tr></thead><tbody>' +
        res.eq.pairs.map(([q, s], i) => `<tr><td>${i + 1}</td><td>${esc(q)}</td><td>${esc(s)}</td></tr>`).join('') +
        '</tbody></table><p class="legend">For every pair and every input symbol, λ(q, a) = λ′(δ′(q′, a)) was checked.</p>';
    }
  }

  /* ================= String tester ================= */
  function renderSamples() {
    const sep = res.mealy.inputs.every((a) => a.length === 1) ? '' : ' ';
    const pick = samples || ['ε', ...res.mealy.inputs.slice(0, 3), res.mealy.inputs.join(sep)];
    $('samples').innerHTML = '<span>Try:</span>' +
      pick.map((s) => `<button type="button" class="sample" data-s="${esc(s)}">${esc(s)}</button>`).join('');
  }
  $('samples').addEventListener('click', (e) => {
    const s = e.target.dataset && e.target.dataset.s;
    if (s === undefined) return;
    $('testInput').value = s === 'ε' ? '' : s;
    testString();
  });
  $('testBtn').addEventListener('click', testString);
  $('testInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') testString(); });

  function logRow(r) {
    const body = $('testLog').tBodies[0];
    body.insertAdjacentHTML('afterbegin', `<tr><td>${esc(M.showWord(r.word))}</td><td>${esc(M.showWord(r.mealy.outputs))}</td>` +
      `<td>${esc(M.showWord(r.moore.outputs))}</td><td>${esc(M.showWord(r.mooreDropped))}</td>` +
      `<td class="${r.match ? 'good' : 'bad'}">${r.match ? '✓' : '✗'}</td></tr>`);
    while (body.rows.length > 25) body.deleteRow(-1);
    $('testLog').hidden = false;
  }

  function testString() {
    if (!res) return;
    const text = $('testInput').value.trim();
    let word;
    try {
      word = text === '' || text === 'ε' ? [] : M.toSymbols(text, res.mealy.inputs);
    } catch (e) {
      $('testOut').innerHTML = `<p class="bad">${esc(e.message)}</p>`;
      return;
    }
    const r = M.compareOnWord(res.mealy, res.moore, word);
    logRow(r);
    $('testOut').innerHTML = `<p>Input: <code>${esc(M.showWord(word))}</code></p>` +
      V.runHtml('Mealy', r.mealy.states, word, r.mealy.outputs, false) +
      V.runHtml('Moore', r.moore.states, word, r.moore.outputs, true) + V.alignHtml(r) +
      `<p class="${r.match ? 'good' : 'bad'}">${r.match ? '✓ Moore output with its first symbol dropped equals the Mealy output.' : '✗ The outputs differ!'}</p>`;
  }

  $('randomBtn').addEventListener('click', () => {
    if (!res) return;
    const runs = M.randomWords(res.mealy.inputs, 20).map((w) => M.compareOnWord(res.mealy, res.moore, w));
    runs.forEach(logRow);
    const passed = runs.filter((r) => r.match).length;
    $('testOut').innerHTML = `<p class="${passed === runs.length ? 'good' : 'bad'}">${passed} of ${runs.length} random strings match (see the log).</p>`;
  });

  /* ================= Check a hand-converted Moore machine ================= */
  $('copyMooreBtn').addEventListener('click', () => { if (res) $('candidate').value = M.toTableText(res.moore); });
  $('checkBtn').addEventListener('click', () => {
    if (!res) return;
    const text = $('candidate').value.trim();
    let moore = res.moore;
    if (text) {
      const { machine, errors } = M.parseMachine(text);
      if (errors.length) {
        $('checkOut').innerHTML = '<div class="msg error"><ul>' + errors.map((e) => `<li>${esc(e)}</li>`).join('') + '</ul></div>';
        return;
      }
      if (machine.type !== 'moore') {
        $('checkOut').innerHTML = '<p class="bad">Paste a Moore machine to compare against the Mealy input.</p>';
        return;
      }
      moore = machine;
    }
    try {
      $('checkOut').innerHTML = V.equivalenceHtml(M.checkEquivalence(res.mealy, moore));
    } catch (e) {
      $('checkOut').innerHTML = `<p class="bad">${esc(e.message)}</p>`;
    }
  });

  /* ================= Export (diagram SVG/PNG, Moore machine JSON/text, share link) ================= */
  const exportMsg = (text, ok = true) => { $('exportMsg').className = ok ? 'good' : 'bad'; $('exportMsg').textContent = text; };
  const fileBase = () => `mealy-moore-step-${String(cur + 1).padStart(2, '0')}`;

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    exportMsg('Saved ' + name);
  }

  $('svgBtn').addEventListener('click', () => {
    const { text } = G.toStandaloneSvg($('graphMain').querySelector('svg'));
    download(new Blob([text], { type: 'image/svg+xml' }), fileBase() + '.svg');
  });
  $('pngBtn').addEventListener('click', () => {
    const { text, width, height } = G.toStandaloneSvg($('graphMain').querySelector('svg'));
    const img = new Image();
    img.onload = () => {
      const scale = 2; // 2× so the PNG stays sharp when placed in a report
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        canvas.toBlob((blob) => (blob ? download(blob, fileBase() + '.png') : exportMsg('PNG export failed in this browser; use SVG.', false)), 'image/png');
      } catch (e) {
        exportMsg('PNG export failed in this browser (' + e.message + '); use SVG.', false);
      }
    };
    img.onerror = () => exportMsg('PNG export failed in this browser; use SVG.', false);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  });
  $('jsonBtn').addEventListener('click', () =>
    download(new Blob([JSON.stringify(M.toSpec(res.moore), null, 2) + '\n'], { type: 'application/json' }), 'moore-machine.json'));
  $('textBtn').addEventListener('click', () =>
    download(new Blob([M.toTableText(res.moore) + '\n'], { type: 'text/plain' }), 'moore-machine.txt'));

  // A share link stores the input Mealy machine as transition-table text in the URL hash (#mealy=…),
  // so it also works for a page opened from file://. Options are not stored; they reset to defaults.
  const HASH = '#mealy=';
  $('linkBtn').addEventListener('click', () => {
    const link = location.href.split('#')[0] + HASH + encodeURIComponent(M.toTableText(res.mealy));
    history.replaceState(null, '', link);
    const done = () => exportMsg('Share link is now in the address bar and copied to the clipboard.');
    const manual = () => exportMsg('Share link is now in the address bar; copy it from there.');
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, manual);
    else manual();
  });

  /* ================= Start: a shared link, otherwise Example 1 ================= */
  if (location.hash.startsWith(HASH)) {
    let text = '';
    try { text = decodeURIComponent(location.hash.slice(HASH.length)); } catch { /* malformed escape: reported below */ }
    const { machine, errors } = M.parseMachine(text, { mealyOnly: true });
    if (errors.length) {
      showInputErrors(['The shared link could not be read:', ...errors]);
    } else {
      $('importText').value = text;
      loadMachine(machine);
      $('presetNote').textContent = 'Loaded from a shared link.';
      run();
    }
  } else {
    $('preset').value = PRESETS[0].id;
    $('preset').dispatchEvent(new Event('change'));
  }
})();
