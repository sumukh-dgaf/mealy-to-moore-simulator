/**
 * solve.js — the "Solve from a question" panel. Sends the question (and an optional photo) to the
 * Google Gemini generateContent REST API, shows what the model understood ("Understood as"), runs
 * the model's own test cases on that machine (self-check), and hands the machine to the existing
 * editor / conversion (window.MMApp). The model never converts anything.
 *
 * API key handling: the key is kept in memory (apiKey). While "Remember on this device" is ticked
 * (the default) it is also saved in this browser's localStorage under the one name KEY_SLOT, so it
 * is filled in again on the next visit from the same address. It is sent only in the
 * x-goog-api-key request header: never in a URL, a project file, an export, the share link, the
 * copied answer or the console. "Forget key" removes it from memory and from the browser.
 *
 * Errors (no key, invalid key, 429 quota, safety block, network/CORS failure, 60 s timeout, reply
 * without valid JSON (retried once), empty question, photo too large) are shown in the panel; the
 * rest of the simulator, which works offline, is never affected.
 */
(function (root) {
  'use strict';
  const M = root.MM, G = root.MMGraph, V = root.MMView;
  const { esc } = V;
  const $ = (id) => document.getElementById(id);

  const KEY_SLOT = 'mm.geminiKey'; // the only localStorage name, used only with "Remember on this device"
  const TIMEOUT_MS = 60000; // gemini-3.6-flash took 17–30 s in the live runs, so 30 s was too tight
  // Gemini allows 20 MB per request; base64 makes the photo a third larger, so 14 MB stays below it.
  const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  let apiKey = '';
  let image = null; // {mimeType, data (base64), name}
  let result = null; // last normaliseReply result

  /** Hide the key if a message ever contains it. */
  const hideKey = (msg) => (apiKey ? String(msg).split(apiKey).join('•••') : String(msg));
  const status = (text, kind = 'info') => {
    $('aiStatus').className = 'msg ' + (kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : 'warn');
    $('aiStatus').textContent = hideKey(text);
  };
  const model = () => $('aiModel').value.trim() || M.DEFAULT_MODEL;

  /* ---------- key: memory, optional localStorage on this device, forget ---------- */
  const storeKey = () => {
    try {
      if ($('aiRemember').checked && apiKey) localStorage.setItem(KEY_SLOT, apiKey);
      else localStorage.removeItem(KEY_SLOT);
    } catch { /* storage blocked: the key simply stays in memory */ }
  };
  // saved: show the chip instead of the field; the hint asks for a key only when none is saved
  const showSaved = (saved) => {
    $('aiSaved').hidden = !saved;
    $('aiKeyEntry').hidden = saved;
    $('aiKeyHint').hidden = saved;
  };
  try {
    const kept = localStorage.getItem(KEY_SLOT);
    if (kept) { apiKey = kept; $('aiKey').value = kept; showSaved(true); }
  } catch { /* storage blocked */ }
  $('aiKey').addEventListener('input', () => { apiKey = $('aiKey').value.trim(); storeKey(); });
  $('aiRemember').addEventListener('change', storeKey);
  $('aiChange').addEventListener('click', () => { showSaved(false); $('aiKey').select(); });
  $('aiForget').addEventListener('click', () => {
    apiKey = '';
    $('aiKey').value = '';
    $('aiRemember').checked = true; // back to the default for the next key
    try { localStorage.removeItem(KEY_SLOT); } catch { /* storage blocked */ }
    showSaved(false);
    status('The key was forgotten (removed from this page and from this device).', 'ok');
  });
  $('aiModel').value = M.DEFAULT_MODEL;
  // the panel opens expanded: type → Read the question → check → Convert to Moore
  $('aiQuestion').focus();

  /* ---------- examples, photo ---------- */
  $('aiExamples').insertAdjacentHTML('beforeend', M.EXAMPLE_QUESTIONS.map((q, i) =>
    `<button type="button" class="sample" data-q="${i}">${esc(q.label)}</button>`).join(''));
  $('aiExamples').addEventListener('click', (e) => {
    const i = e.target.dataset && e.target.dataset.q;
    if (i !== undefined) $('aiQuestion').value = M.EXAMPLE_QUESTIONS[+i].text;
  });

  const clearImage = () => {
    image = null;
    $('aiImage').value = '';
    $('aiImageName').textContent = '';
    $('aiImageClear').hidden = true;
  };
  $('aiImageClear').addEventListener('click', clearImage);
  $('aiImage').addEventListener('change', () => {
    const f = $('aiImage').files[0];
    if (!f) return clearImage();
    if (!IMAGE_TYPES.includes(f.type)) { clearImage(); return status('Use a PNG, JPEG or WebP photo.', 'error'); }
    if (f.size > MAX_IMAGE_BYTES) {
      clearImage();
      return status(`The photo is ${(f.size / 1048576).toFixed(1)} MB; the limit is 14 MB (Gemini accepts at most 20 MB per request, and the photo grows by a third when it is sent).`, 'error');
    }
    const reader = new FileReader();
    reader.onload = () => {
      image = { mimeType: f.type, data: String(reader.result).split(',')[1], name: f.name };
      $('aiImageName').textContent = `Photo: ${f.name}`;
      $('aiImageClear').hidden = false;
    };
    reader.onerror = () => { clearImage(); status('The photo could not be read.', 'error'); };
    reader.readAsDataURL(f);
  });

  /* ---------- the API call ---------- */
  function httpMessage(code, data, m) {
    const err = data && data.error ? `${data.error.status || ''} ${data.error.message || ''}`.trim() : '';
    let text;
    if ((code === 400 && /api.?key/i.test(err)) || code === 401 || code === 403) text = 'The API key was not accepted. Check that you copied the whole key from aistudio.google.com/apikey.';
    else if (code === 429) text = 'Gemini\'s free-tier limit was reached (429: too many requests, or the daily quota is used up). Wait a minute and try again.';
    else if (code === 404) text = `The model "${m}" was not found. Check the Model id setting.`;
    else if (code === 503) text = `${m} is overloaded right now (503: high demand).`;
    else if (code >= 500) text = `Gemini had a server problem (${code}). Try again in a moment.`;
    else text = `Gemini rejected the request (${code}).`;
    return err ? `${text} Details: ${err}` : text;
  }

  /**
   * One generateContent call to model m. The key goes only in the x-goog-api-key header.
   * @returns {Promise<{reply: Object}|{blocked: string}|{invalid: string}>}
   * @throws {Error} with a user-facing message on timeout, network/CORS failure or an HTTP error;
   *         error.busy is true for 503 (high demand) and for a timeout, the cases that try the other model
   */
  async function callGemini(body, m) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp, data = null;
    try {
      resp = await fetch(M.endpointUrl(m), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      data = await resp.json().catch(() => null);
    } catch (e) {
      const timeout = e && e.name === 'AbortError';
      const err = new Error(timeout
        ? `${m} did not answer within ${TIMEOUT_MS / 1000} seconds (timeout).`
        : 'Could not reach the Gemini API: no internet connection, or the request was blocked (network/CORS). Everything else in the simulator still works offline.');
      err.busy = timeout;
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      const err = new Error(httpMessage(resp.status, data, m));
      err.busy = resp.status === 503 || /high demand/i.test((data && data.error && data.error.message) || '');
      throw err;
    }
    return M.readResponse(data);
  }

  // One model: a second call only if the first reply was not valid JSON.
  async function askModel(m, question) {
    const body = M.buildRequestBody(question, image, m);
    for (let attempt = 1; attempt <= 2; attempt++) {
      status(attempt === 1 ? `Asking ${m}…` : `The reply from ${m} was not valid JSON; asking once more…`);
      const res = await callGemini(body, m);
      if (!res.invalid) return res;
      if (attempt === 2) throw new Error(`${res.invalid} (tried twice). Rephrase the question or try again later.`);
    }
  }

  async function ask() {
    const question = $('aiQuestion').value.trim();
    if (!apiKey) return status('Enter a Gemini API key first (free from aistudio.google.com/apikey). Only this panel needs a key and internet.', 'error');
    if (!question && !image) return status('Type or paste the question (or add a photo of it) first.', 'error');
    let used = model();
    try {
      M.endpointUrl(used);
    } catch (e) {
      return status(e.message, 'error');
    }
    $('aiAsk').disabled = true;
    // clear the last answer, so a failed request never leaves an older machine on screen
    result = null;
    $('aiPreview').hidden = true;
    $('aiPreview').innerHTML = '';
    try {
      let res;
      try {
        res = await askModel(used, question);
      } catch (e) {
        // overloaded (503) or no answer in time: try the other model ONCE (3.6-flash ↔ 3.8-flash)
        const other = M.fallbackModel(used);
        if (!e.busy || !other) throw e;
        status(`${e.message} Trying ${other} once…`);
        used = other;
        try {
          res = await askModel(other, question);
        } catch (e2) {
          throw new Error(`${e.message} Then ${other} was tried once: ${e2.message} Try again later.`);
        }
      }
      if (res.blocked) return status(res.blocked, 'error');
      result = M.normaliseReply(res.reply);
      renderPreview();
      status(`${result.errors.length ? 'The question was read, but the machine is not complete yet: see below.' : 'The question was read. Check the machine below before converting.'} Answered by ${used}.`,
        result.errors.length ? 'error' : 'ok');
    } catch (e) {
      status(e.message, 'error');
    } finally {
      $('aiAsk').disabled = false;
    }
  }
  $('aiAsk').addEventListener('click', ask);

  /* ---------- "Understood as" preview ---------- */
  // A table/diagram for the model's machine even when validation failed (missing cells show "·").
  function partialMachine(spec) {
    const delta = {}, lambda = {};
    spec.states.forEach((q) => { delta[q] = {}; lambda[q] = {}; });
    spec.transitions.forEach((t) => {
      if (delta[t.from] && !(t.input in delta[t.from]) && spec.inputs.includes(t.input)) { delta[t.from][t.input] = t.to; lambda[t.from][t.input] = t.output; }
    });
    return { type: 'mealy', states: spec.states, inputs: spec.inputs, outputs: spec.outputs, start: spec.start, delta, lambda };
  }

  function renderPreview() {
    const { machine, spec, errors, info } = result;
    const shown = machine || partialMachine(spec);
    const list = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    const word = (w) => esc(w === '' ? 'ε' : w);
    const checks = machine ? M.selfCheck(machine, info.testCases) : [];
    const failed = checks.filter((c) => !c.ok);
    let html = `<h3>Understood as: ${info.kind === 'design_problem' ? 'a design problem (the AI designed this Mealy machine)' : 'a Mealy machine given in the question'}</h3>
      <div class="visuals">
        <div class="panel"><div class="panel-label">Mealy state diagram</div><div id="aiGraph" class="graph stage"></div></div>
        <div class="panel"><div class="panel-label">Mealy transition table</div>${V.tableHtml(shown)}
          <p><b>Start state:</b> ${esc(spec.start || '—')}</p>
          ${info.stateMeanings.length ? `<p><b>What each state means:</b></p><ul class="facts">${info.stateMeanings.map((m) => `<li><b>${esc(m.state)}</b>: ${esc(m.meaning)}</li>`).join('')}</ul>` : ''}
        </div>
      </div>`;
    if (info.assumptions.length) html += `<div class="note assume"><b>Assumptions made by the AI (check them):</b>${list(info.assumptions)}</div>`;
    if (errors.length) html += `<div class="msg error"><b>Cannot convert yet. Missing or invalid:</b>${list(errors)}</div>`;
    if (machine) {
      html += `<h3>Self-check: the AI's test cases run on this machine</h3>
        <table class="grid"><thead><tr><th>Input</th><th>Expected (from the question)</th><th>Actual (this machine)</th><th>Match</th><th>Why this case</th></tr></thead><tbody>${
        checks.map((c) => `<tr><td>${word(c.input)}</td><td>${word(c.expected)}</td><td>${esc(c.actual)}</td><td class="${c.ok ? 'good' : 'bad'}">${c.ok ? '✓' : '✗'}</td><td>${esc(c.reason)}${c.note ? ` <span class="bad">(${esc(c.note)})</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
      html += !checks.length ? '<p class="msg warn">The AI gave no test cases, so the machine could not be self-checked.</p>'
        : failed.length ? '<p class="msg warn">The machine does not match the question on these inputs; edit it before converting.</p>'
          : `<p class="good">✓ The machine reproduces all ${checks.length} test cases from the question.</p>`;
    }
    html += `<div class="row solver-actions">
      <button id="aiUse" class="btn" type="button" ${shown.states.length ? '' : 'disabled'}>Use this machine</button>
      <button id="aiConvert" class="btn primary" type="button" ${machine ? '' : 'disabled'}>Convert to Moore</button>
      <button id="aiAgain" class="btn" type="button">Ask again</button></div>`;
    $('aiPreview').innerHTML = html;
    $('aiPreview').hidden = false;
    G.draw($('aiGraph'), shown, { groups: shown.states.map((q) => [q]) });
    const tests = info.testCases.map((t) => t.input || 'ε');
    $('aiUse').addEventListener('click', () => {
      root.MMApp.useMachine(shown, 'Loaded from "Solve from a question". Check every cell, then press Convert to Moore.', tests);
      $('editor').scrollIntoView({ behavior: 'smooth' });
    });
    $('aiConvert').addEventListener('click', () => root.MMApp.convert(machine, 'Loaded from "Solve from a question".', tests));
    $('aiAgain').addEventListener('click', ask);
  }
})(this);
