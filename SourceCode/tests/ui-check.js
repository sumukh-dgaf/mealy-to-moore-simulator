/**
 * Scripted UI checks and screenshots (Milestone 2). Drives the real page with Playwright, which is
 * NOT a project dependency: point PLAYWRIGHT at a node_modules folder that contains it.
 *
 *   python -m http.server 8000            (in the project root, in another terminal)
 *   PLAYWRIGHT=<.../node_modules> node tests/ui-check.js http://localhost:8000/ <out-dir>
 *
 * Writes <out-dir>/NN_name.png screenshots and <out-dir>/ui_results.json (one record per check:
 * id, feature, input, expected, actual, status, evidence), and prints one line per check.
 * Exit code 1 if any check fails.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const url = require('node:url');
const { chromium } = require(path.join(process.env.PLAYWRIGHT || '', 'playwright'));
const { parseMachine, toTableText } = require('../src/core/parser.js');
const { randomMealy } = require('./fixtures.js');

const [base = 'http://localhost:8000/', outDir = 'screenshots'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-ui-'));
const results = [];
const shot = (n) => path.join(outDir, n);

/** Record one UI check and print it. */
function check(rec) {
  rec.status = rec.actual === rec.expected ? 'Pass' : 'Fail';
  results.push(rec);
  console.log(`${rec.status === 'Pass' ? '✔' : '✖'} ${rec.id} ${rec.feature}: ${rec.actual}${rec.status === 'Pass' ? '' : `  (expected: ${rec.expected})`}`);
}

(async () => {
  const browser = await chromium.launch();
  // tall window: element screenshots never need scrolling, so the sticky header never overlaps them
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1750 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // the mocked Gemini errors (429, aborted request) are expected browser network messages, not app errors
  page.on('console', (m) => m.type() === 'error' && !(m.location().url || '').includes('generativelanguage.googleapis.com') && errors.push(m.text()));
  const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const phase = async (name) => page.click(`#timeline button[title="Jump to ${name}"]`);
  // open the import panel (clicking its summary would toggle it closed again)
  const openImport = () => page.evaluate(() => { document.querySelector('details.import').open = true; });
  const preset = async (id) => { await page.selectOption('#preset', id); await page.waitForSelector('#player:not([hidden])'); };

  // UI-01 page load over HTTP with Example 1
  await page.goto(base);
  await page.waitForSelector('#stepCount');
  check({ id: 'UI-01', feature: 'Editor + Example 1 loads (HTTP server)', input: `open ${base}`,
    expected: 'Example 1 converted: 2 → 3 states, ✓ equivalent; no console errors',
    actual: `Example 1 converted: ${(await text('.stat.hero b'))} states, ${(await text('.stat.ok b')) || '?'} equivalent; ${errors.length ? 'errors: ' + errors.join('; ') : 'no console errors'}`,
    evidence: 'Screenshot 01' });
  const first = await page.evaluate(() => ({
    open: document.getElementById('solver').open, focus: document.activeElement && document.activeElement.id,
    chip: !document.getElementById('aiSaved').hidden, field: !document.getElementById('aiKeyEntry').hidden,
    model: document.getElementById('aiModelChoice').selectedOptions[0].textContent, ticked: document.getElementById('aiRemember').checked, hint: document.getElementById('aiKeyHint').hidden ? '' : document.getElementById('aiKeyHint').textContent.trim(),
  }));
  check({ id: 'UI-31', feature: 'Solve from a question: open by default, no key saved yet', input: `first visit to ${base}`,
    expected: 'panel open; cursor in the question box; key field shown, "Remember on this device" ticked; model Auto (recommended); hint: Paste your free key from aistudio.google.com once; it stays on this computer.',
    actual: `panel ${first.open ? 'open' : 'closed'}; cursor in ${first.focus === 'aiQuestion' ? 'the question box' : first.focus || 'nothing'}; ` +
      `key field ${first.field && !first.chip ? 'shown' : 'NOT shown'}, "Remember on this device" ${first.ticked ? 'ticked' : 'not ticked'}; model ${first.model}; hint: ${first.hint}`, evidence: 'test log' });
  // the classic screenshots show the simulator itself; the panel has its own screenshots (16, 17)
  await page.evaluate(() => { document.getElementById('solver').open = false; window.scrollTo(0, 0); });
  await page.screenshot({ animations: 'disabled', path: shot('01_editor_example1.png') });

  // UI-02 step player: Next, Prev, timeline jump, step list
  await page.click('#nextBtn');
  const afterNext = await text('#stepCount');
  await page.click('#prevBtn');
  const afterPrev = await text('#stepCount');
  await phase('Split states');
  const splitFirst = await text('#stepTitle');
  await page.click('#nextBtn');
  check({ id: 'UI-02', feature: 'Step player (Next / Prev / timeline)', input: 'Example 1: Next, Prev, jump to "Split states", Next',
    expected: 'Step 2 of 16 → Step 1 of 16 → Create [q0,0] → Create [q1,0]',
    actual: `${afterNext} → ${afterPrev} → ${splitFirst} → ${await text('#stepTitle')}`, evidence: 'Screenshot 02' });
  await (await page.$('#player')).screenshot({ animations: 'disabled', path: shot('02_step_player_split_step.png') });

  // UI-03 result: diagram + tables
  await phase('Result');
  check({ id: 'UI-03', feature: 'SVG diagram + transition tables (result)', input: 'Example 1: jump to "Result"',
    expected: 'Result: the Moore machine; 3 states drawn; Mealy and Moore tables shown',
    actual: `${await text('#stepTitle')}; ${await page.locator('#graphMain .node').count()} states drawn; ` +
      `${(await page.locator('#work .two-tables table').count()) === 2 ? 'Mealy and Moore tables shown' : 'tables missing'}`, evidence: 'Screenshot 03' });
  await (await page.$('#player')).screenshot({ animations: 'disabled', path: shot('03_example1_result_diagram_tables.png') });

  // UI-04 string tester
  await page.fill('#testInput', '0111');
  await page.click('#testBtn');
  check({ id: 'UI-04', feature: 'String tester (both machines, aligned outputs)', input: 'Example 1: w = 0111',
    expected: '0111 | 0011 | 00011 | 0011 | ✓', actual: (await page.locator('#testLog tbody tr:first-child td').allTextContents()).join(' | '), evidence: 'Screenshot 04' });
  await page.click('#randomBtn');
  check({ id: 'UI-04b', feature: 'String tester (20 random strings)', input: 'Example 1: "20 random"',
    expected: '20 of 20 random strings match (see the log).', actual: await text('#testOut'), evidence: 'test log' });
  await page.fill('#testInput', '0111');
  await page.click('#testBtn');
  await (await page.$('#tester')).screenshot({ animations: 'disabled', path: shot('04_test_strings_table.png') });

  // UI-05 equivalence ✓ (Validate step and the checker with an empty box)
  await phase('Validate');
  const validate = await text('#stepText');
  await page.click('#checkBtn');
  check({ id: 'UI-05', feature: 'Exact equivalence check (Algorithm C)', input: 'Example 1: Validate step; "Verify equivalence" with an empty box',
    expected: 'Validate: ✓ 3 pairs | checker: ✓ Equivalent: no mismatch in 3 reachable state pairs.',
    actual: `Validate: ${validate.includes('✓ Exact check') && validate.includes('over 3 reachable state pairs') ? '✓ 3 pairs' : validate} | checker: ${await text('#checkOut p')}`,
    evidence: 'Screenshot 05' });
  await (await page.$('#player')).screenshot({ animations: 'disabled', path: shot('05_equivalence_validate_step.png') });

  // UI-06 wrong hand conversion → counterexample 11
  await page.click('#copyMooreBtn');
  const box = await page.inputValue('#candidate');
  await page.fill('#candidate', box.replace(/^\[q1,1\] \| 1/m, '[q1,1] | 0'));
  await page.click('#checkBtn');
  check({ id: 'UI-06', feature: 'Check a hand-converted Moore machine', input: 'Example 1: generated Moore machine with λ′([q1,1]) changed to 0',
    expected: '✗ Not equivalent. Shortest counterexample: 11', actual: await text('#checkOut p'), evidence: 'Screenshot 06' });
  await (await page.$('#checker')).screenshot({ animations: 'disabled', path: shot('06_wrong_hand_conversion_counterexample.png') });

  // UI-07 Example 2: unreachable-states step
  await preset('ex2');
  await phase('Unreachable');
  check({ id: 'UI-07', feature: 'Unreachable-state removal (step player)', input: 'Example 2: jump to "Unreachable"',
    expected: 'Remove unreachable Moore states | removed: [r,z] [d,z]',
    actual: `${await text('#stepTitle')} | removed: ${(await page.locator('#work .chip.bad').allTextContents()).join(' ')}`, evidence: 'Screenshot 07' });
  await (await page.$('#player')).screenshot({ animations: 'disabled', path: shot('07_example2_unreachable_step.png') });

  // UI-08 validation error (one cell set to "—")
  await preset('ex1');
  await page.selectOption('select[data-s="q1"][data-a="1"][data-k="delta"]', '');
  await page.click('#runBtn');
  check({ id: 'UI-08', feature: 'Input validation (editor)', input: 'Example 1 with δ(q1, 1) set to “—”, Convert',
    expected: 'Please fix the input:Missing transition: δ(q1, 1) is not defined (machine must be complete)', actual: await text('#inputMsg'),
    evidence: 'Screenshot 08' });
  await (await page.$('#editor')).screenshot({ animations: 'disabled', path: shot('08_validation_error_missing_transition.png') });

  // UI-09 Moore machine imported as the main input
  const mooreText = toTableText(parseMachine(JSON.parse(fs.readFileSync(path.join(__dirname, 'machines', 'wrong_moore_ex1.json'), 'utf8'))).machine);
  await openImport();
  await page.fill('#importText', mooreText);
  await page.click('#importBtn');
  check({ id: 'UI-09', feature: 'Input validation (import)', input: 'Import a Moore table as the main input',
    expected: 'Please fix the input:Input must be a Mealy machine (this simulator converts Mealy → Moore only)', actual: await text('#inputMsg'),
    evidence: 'Screenshot 09' });
  await (await page.$('#editor')).screenshot({ animations: 'disabled', path: shot('09_validation_error_moore_input.png') });

  // UI-10 import table text
  await page.fill('#importText', 'type: mealy\nstart: q0\noutputs: 0 1\nstate | 0 | 1\nq0 | q0/0 | q1/0\nq1 | q0/0 | q1/1');
  await page.click('#importBtn');
  check({ id: 'UI-10', feature: 'Import transition table text', input: 'Example 1 typed as table text, "Load into editor"',
    expected: 'states q0, q1 | 2 → 3', actual: `states ${await page.inputValue('#states')} | ${await text('.stat.hero b')}`, evidence: 'test log' });

  // UI-11 export diagram SVG / PNG (Example 1, Result step)
  await preset('ex1');
  await phase('Result');
  const save = async (btn, dir) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.click(btn)]);
    const p = path.join(dir, d.suggestedFilename());
    await d.saveAs(p);
    return { name: d.suggestedFilename(), path: p };
  };
  const svg = await save('#svgBtn', tmp);
  const svgText = fs.readFileSync(svg.path, 'utf8');
  const png = await save('#pngBtn', tmp);
  const pngHead = fs.readFileSync(png.path).subarray(1, 4).toString();
  fs.copyFileSync(png.path, shot('11_exported_diagram_file.png'));
  check({ id: 'UI-11', feature: 'Export diagram (SVG / PNG)', input: 'Example 1, Result step: "Diagram SVG", "Diagram PNG"',
    expected: 'mealy-moore-step-15.svg: standalone SVG with 3 states | mealy-moore-step-15.png: PNG file',
    actual: `${svg.name}: ${svgText.startsWith('<svg') && svgText.includes('xmlns') ? 'standalone SVG' : 'not SVG'} with ${(svgText.match(/<g class="node( dim)?"/g) || []).length} states | ` +
      `${png.name}: ${pngHead === 'PNG' ? 'PNG file' : 'not PNG'}`, evidence: 'Screenshots 10, 11' });
  const top = await page.locator('#player').boundingBox();
  await page.screenshot({ animations: 'disabled', path: shot('10_export_buttons.png'), clip: { x: top.x, y: top.y, width: top.width, height: 190 } });

  // UI-12 export Moore machine JSON / table text
  const json = await save('#jsonBtn', tmp);
  const txt = await save('#textBtn', tmp);
  const fromJson = parseMachine(fs.readFileSync(json.path, 'utf8'));
  const fromTxt = parseMachine(fs.readFileSync(txt.path, 'utf8'));
  check({ id: 'UI-12', feature: 'Export Moore machine (JSON / table text)', input: 'Example 1: "Moore JSON", "Moore table text", re-import both',
    expected: 'moore-machine.json → [q0,0] [q1,0] [q1,1] | moore-machine.txt → same machine',
    actual: `${json.name} → ${fromJson.errors.length ? fromJson.errors.join(';') : fromJson.machine.states.join(' ')} | ${txt.name} → ` +
      `${!fromTxt.errors.length && JSON.stringify(fromTxt.machine) === JSON.stringify(fromJson.machine) ? 'same machine' : 'DIFFERENT'}`, evidence: 'test log' });

  // UI-13 share link reopens the machine
  await preset('ex2');
  await page.click('#linkBtn');
  const link = page.url();
  const linked = await ctx.newPage();
  await linked.goto(link);
  await linked.waitForSelector('#player:not([hidden])');
  check({ id: 'UI-13', feature: 'Share link', input: 'Example 2: "Share link", open the link in a new tab',
    expected: 'Loaded from a shared link. | 4 → 5', actual: `${(await linked.textContent('#presetNote')).trim()} | ${(await linked.textContent('.stat.hero b')).trim()}`,
    evidence: 'Screenshot 12' });
  await linked.screenshot({ animations: 'disabled', path: shot('12_share_link_reopened.png') });
  await linked.close();

  // UI-14 no sideways overflow at 1200, 1280, 1366 px
  const widths = [];
  for (const w of [1200, 1280, 1366]) {
    await page.setViewportSize({ width: w, height: 900 });
    widths.push(`${w}→${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  }
  check({ id: 'UI-14', feature: 'Layout without sideways overflow', input: 'page width at viewport 1200, 1280, 1366 px',
    expected: '1200→1200 1280→1280 1366→1366', actual: widths.join(' '), evidence: 'Screenshot 13' });
  await page.setViewportSize({ width: 1200, height: 900 });
  await preset('ex1');
  await page.screenshot({ animations: 'disabled', path: shot('13_layout_at_1200px.png') });
  await page.setViewportSize({ width: 1440, height: 1750 });

  // UI-15 larger machine: diagram keeps a readable size and scrolls
  await openImport();
  await page.fill('#importText', JSON.stringify(randomMealy(7, 2, 3, 5)));
  await page.click('#importBtn');
  await phase('Result');
  const large = await page.evaluate(() => {
    const g = document.getElementById('graphMain');
    const s = g.querySelector('svg');
    return { minWidth: s.style.minWidth, scrolls: g.scrollWidth > g.clientWidth, states: g.querySelectorAll('.node').length };
  });
  check({ id: 'UI-15', feature: 'Diagram layout for larger machines', input: 'random 7-state Mealy machine (fixtures.randomMealy(7, 2, 3, 5)), Result step',
    expected: 'minimum width set; stage scrolls', actual: `${large.minWidth ? 'minimum width set' : 'no minimum width'}; ${large.scrolls ? 'stage scrolls' : 'no scroll'}`,
    detail: `${large.states} Moore states drawn, min-width ${large.minWidth}`, evidence: 'Screenshot 14' });
  await (await page.$('#player')).screenshot({ animations: 'disabled', path: shot('14_larger_machine_diagram.png') });

  // ---------- Solve from a question: MOCKED Gemini API (Playwright route interception, no real network) ----------
  const FAKE_KEY = 'test-key-not-real-0000';
  const Q = require(path.join(__dirname, '..', 'src', 'core', 'questionSchema.js'));
  const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ai', `${name}.json`), 'utf8'));
  const geminiOk = (reply) => ({ status: 200, body: { candidates: [{ content: { role: 'model', parts: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] }, finishReason: 'STOP' }] } });
  let mock = null; // what the next request gets: {status, body} | 'abort' | 'hang'
  const calls = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    calls.push({ url: req.url(), key: req.headers()['x-goog-api-key'], body: req.postDataJSON() });
    const m = typeof mock === 'function' ? mock(req) : mock; // a function answers per model (fallback check)
    if (m === 'abort') return route.abort('failed');
    if (m === 'hang') return; // never answered: the page must time out by itself
    return route.fulfill({ status: m.status, contentType: 'application/json', body: JSON.stringify(m.body) });
  });
  const ask = async (timeout = 30000) => { await page.click('#aiAsk'); await page.waitForFunction(() => !document.getElementById('aiAsk').disabled, null, { timeout }); };
  const aiStatus = () => text('#aiStatus');

  await preset('ex1');
  await page.evaluate(() => { document.getElementById('solver').open = true; window.scrollTo(0, 0); });
  await page.fill('#aiKey', '');
  await page.fill('#aiQuestion', 'anything');
  await ask();
  check({ id: 'UI-19', feature: 'Solve from a question: no key', input: 'no API key, "Read the question"',
    expected: 'Enter a Gemini API key first (free from aistudio.google.com/apikey). Only this panel needs a key and internet. | 0 requests sent',
    actual: `${await aiStatus()} | ${calls.length} requests sent`, evidence: 'test log' });

  await page.fill('#aiKey', FAKE_KEY);
  await page.fill('#aiQuestion', '');
  await ask();
  check({ id: 'UI-20', feature: 'Solve from a question: empty question', input: 'key, empty question',
    expected: 'Type or paste the question (or add a photo of it) first.', actual: await aiStatus(), evidence: 'test log' });

  await page.setInputFiles('#aiImage', { name: 'question.png', mimeType: 'image/png', buffer: Buffer.alloc(15 * 1024 * 1024) });
  check({ id: 'UI-21', feature: 'Solve from a question: photo too large', input: '15 MB PNG',
    expected: 'The photo is 15.0 MB; the limit is 14 MB (Gemini accepts at most 20 MB per request, and the photo grows by a third when it is sent).',
    actual: await aiStatus(), evidence: 'test log' });

  // success path: example question 1, mocked reply tests/fixtures/ai/q1_sentences.json
  await page.click('#aiExamples button[data-q="0"]');
  await page.screenshot({ animations: 'disabled', path: shot('16_solver_question_panel.png'), clip: await page.locator('#solver').boundingBox() });
  mock = geminiOk(fixture('q1_sentences'));
  await ask();
  const req = calls.at(-1);
  const checks = await page.locator('#aiPreview tbody td.good').count();
  check({ id: 'UI-22', feature: 'Solve from a question: "Understood as" preview and self-check (mocked API)', input: 'example question 1 + mocked reply q1_sentences.json',
    expected: 'The question was read. Check the machine below before converting. Answered by gemini-3.6-flash. | 2 states in table | self-check 5/5 ✓ | key only in x-goog-api-key header; JSON + schema requested',
    actual: `${await aiStatus()} | ${await page.locator('#aiPreview table.grid').first().locator('tbody tr').count()} states in table | self-check ${checks}/5 ✓ | ` +
      `${req.key === FAKE_KEY && !req.url.includes('key=') ? 'key only in x-goog-api-key header' : 'KEY IN URL OR MISSING'}; ` +
      `${req.body.generationConfig.responseMimeType === 'application/json' && req.body.generationConfig.responseJsonSchema && req.body.systemInstruction ? 'JSON + schema requested' : 'NO SCHEMA'}`,
    evidence: 'Screenshots 16, 17 (mocked API)' });
  await page.screenshot({ animations: 'disabled', path: shot('17_solver_understood_as_selfcheck.png'), clip: await page.locator('#solver').boundingBox() });

  await page.click('#aiConvert');
  await page.waitForSelector('#explain:not([hidden])');
  const SENT = 'The Mealy machine starts at A, which corresponds to [A,0] (output 0) in the Moore machine.';
  const bracketText = await text('#explainBody');
  await page.selectOption('#nameStyle', 'textbook');
  const textbookText = await text('#explainBody');
  check({ id: 'UI-23', feature: 'Convert from the question + Explanation in words', input: '"Convert to Moore", then names A0',
    expected: `2 → 3 | contains "${SENT}" | A0 style: A0, B0, B1`,
    actual: `${await text('.stat.hero b')} | ${bracketText.includes(SENT) ? `contains "${SENT}"` : bracketText.slice(0, 120)} | A0 style: ${['A0', 'B0', 'B1'].filter((n) => textbookText.includes(n)).join(', ')}`,
    evidence: 'Screenshot 18' });
  await (await page.$('#explain')).screenshot({ animations: 'disabled', path: shot('18_explanation_in_words.png') });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await page.click('#copyAnswerBtn');
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check({ id: 'UI-24', feature: 'Copy answer', input: '"Copy answer" (A0 names)',
    expected: 'clipboard: explanation + "Moore transition table" with → A0',
    actual: `clipboard: ${copied.includes('The Mealy machine starts at A') ? 'explanation' : 'NO explanation'} + ${copied.includes('Moore transition table') && copied.includes('→ A0') ? '"Moore transition table" with → A0' : 'NO table'}`,
    evidence: 'test log' });
  await page.selectOption('#nameStyle', 'bracket');

  // wrong reply: one test case does not match the machine
  await page.evaluate(() => { document.getElementById('solver').open = true; });
  mock = geminiOk(fixture('wrong_testcase'));
  await ask();
  check({ id: 'UI-25', feature: 'Solve from a question: self-check warning', input: 'mocked reply wrong_testcase.json (111 expects 000)',
    expected: 'The machine does not match the question on these inputs; edit it before converting.', actual: await text('#aiPreview p.msg.warn'), evidence: 'test log' });

  // missing information: errors shown, Convert disabled, "Use this machine" loads the partial machine into the editor
  mock = geminiOk(fixture('missing'));
  await ask();
  const convertDisabled = await page.isDisabled('#aiConvert');
  await page.click('#aiUse');
  const cell = await page.inputValue('select[data-s="B"][data-a="1"][data-k="delta"]');
  check({ id: 'UI-26', feature: 'Solve from a question: missing information', input: 'mocked reply missing.json, then "Use this machine"',
    expected: 'The question does not say where B goes on input 1. shown | Convert disabled | editor cell δ(B, 1) = —',
    actual: `${(await text('#aiPreview .msg.error')).includes('The question does not say where B goes on input 1.') ? 'The question does not say where B goes on input 1. shown' : 'NOT shown'} | ` +
      `${convertDisabled ? 'Convert disabled' : 'Convert ENABLED'} | editor cell δ(B, 1) = ${cell === '' ? '—' : cell}`, evidence: 'test log' });

  // API errors, with one chosen model (manual mode: no fallback)
  const errorCase = async (m, timeout) => { mock = m; await ask(timeout); return aiStatus(); };
  const modelsCalled = (from) => calls.slice(from).map((c) => c.url.match(/models\/([^:]+):/)[1]);
  const clearMarks = () => page.evaluate(() => localStorage.removeItem('mm.geminiQuota'));
  await page.selectOption('#aiModelChoice', 'gemini-3.6-flash');
  const before = calls.length;
  const r429 = await errorCase({ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } } });
  const rKey = await errorCase({ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } } });
  const rBlock = await errorCase({ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } });
  const nInvalid = calls.length;
  const rJson = await errorCase(geminiOk('Sure! Here is the machine.'));
  const invalidCalls = calls.length - nInvalid;
  const rNet = await errorCase('abort');
  const previewCleared = await page.isHidden('#aiPreview');
  check({ id: 'UI-27', feature: 'Solve from a question: API errors (mocked)', input: '429 | invalid key | safety block | reply not JSON | network failure',
    expected: '429 quota message | key not accepted | blocked | not valid JSON after 2 requests | could not reach the API | old preview cleared',
    actual: [r429.startsWith('gemini-3.6-flash reached its free-tier limit (429') ? '429 quota message' : r429,
      rKey.startsWith('The API key was not accepted') && !rKey.includes(FAKE_KEY) ? 'key not accepted' : rKey,
      rBlock.startsWith('Gemini blocked the question') ? 'blocked' : rBlock,
      rJson.includes('(tried twice)') ? `not valid JSON after ${invalidCalls} requests` : rJson,
      rNet.startsWith('Could not reach the Gemini API') ? 'could not reach the API' : rNet,
      previewCleared ? 'old preview cleared' : 'OLD PREVIEW STILL SHOWN'].join(' | '),
    detail: `${calls.length - before} mocked requests`, evidence: 'test log' });
  const nTimeout = calls.length;
  const rTimeout = await errorCase('hang', 75000); // the page gives up after 60 s
  check({ id: 'UI-28', feature: 'Solve from a question: 60 s timeout with a chosen model (mocked)', input: 'gemini-3.6-flash chosen; the request is never answered',
    expected: 'gemini-3.6-flash did not answer within 60 seconds (timeout). | 1 model call: gemini-3.6-flash',
    actual: `${rTimeout} | ${calls.length - nTimeout} model call: ${modelsCalled(nTimeout).join(', ')}`, evidence: 'test log' });

  // Auto mode: 429 on gemini-3.6-flash → marked for today, gemini-3.8-flash answers
  await page.selectOption('#aiModelChoice', 'auto');
  await clearMarks();
  const quota = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash',
    details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } } };
  const busy = { status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } } };
  const per = (table) => (req) => table[req.url().match(/models\/([^:]+):/)[1]] || geminiOk(fixture('q1_sentences'));
  const label = (m) => page.textContent(`#aiModelChoice option[value="${m}"]`);
  let n0 = calls.length;
  const rAuto1 = await errorCase(per({ 'gemini-3.6-flash': quota }));
  check({ id: 'UI-30', feature: 'Solve from a question: Auto, 429 → next model (mocked)', input: 'Auto; gemini-3.6-flash answers 429 (daily quota); gemini-3.8-flash answers',
    expected: 'calls gemini-3.6-flash → gemini-3.8-flash | The question was read. Check the machine below before converting. Answered by gemini-3.8-flash. | dropdown: gemini-3.6-flash (quota used up today)',
    actual: `calls ${modelsCalled(n0).join(' → ')} | ${rAuto1} | dropdown: ${await label('gemini-3.6-flash')}`, evidence: 'test log' });

  // next request: the marked model is skipped; 503 on gemini-3.8-flash → gemini-3.5-flash-lite answers
  n0 = calls.length;
  const rAuto2 = await errorCase(per({ 'gemini-3.6-flash': quota, 'gemini-3.8-flash': busy }));
  const thinking = calls.slice(n0).map((c) => c.body.generationConfig.thinkingConfig.thinkingLevel).join(', ');
  check({ id: 'UI-32', feature: 'Solve from a question: Auto skips a used-up model; 503 → next model (mocked)', input: 'Auto again; gemini-3.8-flash answers 503 high demand; gemini-3.5-flash-lite answers',
    expected: 'calls gemini-3.8-flash → gemini-3.5-flash-lite (thinking LOW, MINIMAL) | The question was read. Check the machine below before converting. Answered by gemini-3.5-flash-lite.',
    actual: `calls ${modelsCalled(n0).join(' → ')} (thinking ${thinking}) | ${rAuto2}`, evidence: 'test log' });

  // all three answer 429 → one clear message; the next press sends nothing
  await clearMarks();
  n0 = calls.length;
  const rAll = await errorCase(quota);
  const nAll = calls.length - n0;
  n0 = calls.length;
  const rAgain = await errorCase(quota);
  const allMsg = Q.allUsedUpMessage(Q.nextQuotaReset(Date.now()));
  check({ id: 'UI-33', feature: 'Solve from a question: Auto, every model out of quota (mocked)', input: 'Auto; all three models answer 429; then "Read the question" again',
    expected: `3 calls | ${allMsg} | next press: 0 calls, same message | dropdown: 3 models marked`,
    actual: `${nAll} calls | ${rAll} | next press: ${calls.length - n0} calls, ${rAgain === rAll ? 'same message' : rAgain} | ` +
      `dropdown: ${(await page.$$eval('#aiModelChoice option', (os) => os.filter((o) => o.textContent.endsWith('(quota used up today)')).length))} models marked`, evidence: 'test log' });

  // after the reset time the marks no longer count; the model choice survives a reload and "Forget key"
  await page.evaluate(() => localStorage.setItem('mm.geminiQuota', JSON.stringify({ 'gemini-3.6-flash': Date.now() - 1000, 'gemini-3.8-flash': Date.now() - 1000, 'gemini-3.5-flash-lite': Date.now() - 1000 })));
  await page.reload();
  await page.waitForSelector('#player:not([hidden])');
  const marked = await page.$$eval('#aiModelChoice option', (os) => os.filter((o) => o.textContent.includes('quota used up')).length);
  n0 = calls.length;
  mock = geminiOk(fixture('q1_sentences'));
  await page.fill('#aiQuestion', 'Convert the machine of example 1.');
  await ask();
  const afterReset = `${marked} marked, first call ${modelsCalled(n0)[0]}`;
  await page.selectOption('#aiModelChoice', 'gemini-3.8-flash');
  await page.reload();
  await page.waitForSelector('#player:not([hidden])');
  const keptChoice = await page.inputValue('#aiModelChoice');
  const CUSTOM = 'custom-model-test-1';
  await page.selectOption('#aiModelChoice', 'custom');
  await page.fill('#aiModel', CUSTOM);
  await page.click('#aiForget');
  await page.fill('#aiKey', FAKE_KEY);
  await page.reload();
  await page.waitForSelector('#player:not([hidden])');
  const keptCustom = `${await page.inputValue('#aiModelChoice')} ${await page.isVisible('#aiModel') ? await page.inputValue('#aiModel') : '(box hidden)'}`;
  await page.fill('#aiQuestion', 'Convert the machine of example 1.');
  n0 = calls.length;
  await ask();
  const customCalls = modelsCalled(n0);
  await preset('ex1');
  await page.click('#linkBtn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#jsonBtn')]);
  const jsonText = fs.readFileSync(await dl.path(), 'utf8');
  await page.click('#copyAnswerBtn');
  const copiedText = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  const found = [['share link', page.url()], ['JSON export', jsonText], ['copied answer', copiedText]]
    .filter(([, t]) => [FAKE_KEY, CUSTOM, 'mm.gemini'].some((x) => t.includes(x))).map(([n]) => n);
  check({ id: 'UI-34', feature: 'Solve from a question: quota reset, model choice remembered, nothing leaks (mocked)', input: 'marks older than now + reload; choose gemini-3.8-flash + reload; Custom id + Forget key + reload; share link, JSON export, Copy answer',
    expected: 'after the reset: 0 marked, first call gemini-3.6-flash | after reload: gemini-3.8-flash | after Forget key + reload: custom custom-model-test-1 | Custom asks 1 model: custom-model-test-1 | key and model choice not in share link, JSON export or copied answer',
    actual: `after the reset: ${afterReset} | after reload: ${keptChoice} | after Forget key + reload: ${keptCustom} | Custom asks ${customCalls.length} model: ${customCalls.join(', ')} | ` +
      `key and model choice ${found.length ? 'FOUND in ' + found.join(', ') : 'not in share link, JSON export or copied answer'}`, evidence: 'test log' });
  await page.selectOption('#aiModelChoice', 'auto');
  await clearMarks();
  await page.evaluate(() => { document.getElementById('solver').open = true; });
  await page.click('#aiChange'); // the key was restored by the reload: show the field again for UI-29

  // key storage: saved on this device (localStorage, one fixed name) only while the box is ticked; restored on
  // reload; Forget removes it; never in sessionStorage, the share link, the JSON export or the copied answer
  const storage = () => page.evaluate((k) => ({
    slot: localStorage.getItem('mm.geminiKey') === k,
    other: Object.keys(localStorage).some((n) => n !== 'mm.geminiKey' && localStorage.getItem(n).includes(k)),
    session: Object.keys(sessionStorage).some((n) => sessionStorage.getItem(n).includes(k)),
  }), FAKE_KEY);
  const yn = (x) => (x.slot ? 'yes' : 'no');
  const s1 = await storage(); // the key was typed in UI-20 with the box ticked by default
  await page.uncheck('#aiRemember');
  const s2 = await storage();
  await page.check('#aiRemember');
  const s3 = await storage();
  await page.reload();
  await page.waitForSelector('#player:not([hidden])');
  const restored = await page.evaluate(() => ({
    chip: document.getElementById('aiSaved').hidden ? '' : document.getElementById('aiSaved').firstChild.textContent.trim(),
    field: !document.getElementById('aiKeyEntry').hidden, hint: !document.getElementById('aiKeyHint').hidden,
    focus: document.activeElement && document.activeElement.id,
  }));
  mock = geminiOk(fixture('q1_sentences'));
  await page.fill('#aiQuestion', 'Convert the machine of example 1.');
  await ask();
  const sentWith = calls.at(-1).key === FAKE_KEY ? 'request sent with the saved key' : 'REQUEST WITHOUT THE SAVED KEY';
  await page.click('#aiChange');
  const changeShows = await page.isVisible('#aiKey') ? 'Change key shows the field' : 'Change key does NOT show the field';
  await preset('ex1');
  await page.click('#linkBtn');
  const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.click('#jsonBtn')]);
  const exported = fs.readFileSync(await jsonDl.path(), 'utf8');
  await page.click('#copyAnswerBtn');
  const answer = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  const leak = [['share link', page.url()], ['JSON export', exported], ['copied answer', answer]].filter(([, t]) => t.includes(FAKE_KEY)).map(([n]) => n);
  await page.click('#aiForget');
  const s4 = await storage();
  const afterForget = await page.evaluate(() => ({ field: document.getElementById('aiKey').value, chip: !document.getElementById('aiSaved').hidden }));
  await page.reload();
  await page.waitForSelector('#player:not([hidden])');
  const fresh = await page.evaluate(() => ({ field: document.getElementById('aiKey').value, chip: !document.getElementById('aiSaved').hidden, hint: !document.getElementById('aiKeyHint').hidden }));
  check({ id: 'UI-29', feature: 'Solve from a question: API key remembered on this device', input: 'type key; untick; tick; reload; ask; Change key; share link, JSON export, Copy answer; Forget key; reload',
    expected: 'saved under mm.geminiKey: yes (box ticked by default) → no (unticked) → yes (ticked) | after reload: chip "Gemini key saved on this device ✓", field and hint hidden, cursor in the question box, request sent with the saved key | Change key shows the field | key not in share link, JSON export or copied answer | Forget: removed, field empty, chip hidden | after reload: no key, field and hint shown | never in sessionStorage or another storage name',
    actual: `saved under mm.geminiKey: ${yn(s1)} (box ticked by default) → ${yn(s2)} (unticked) → ${yn(s3)} (ticked) | ` +
      `after reload: chip "${restored.chip}", field and hint ${!restored.field && !restored.hint ? 'hidden' : 'SHOWN'}, cursor in ${restored.focus === 'aiQuestion' ? 'the question box' : restored.focus}, ${sentWith} | ` +
      `${changeShows} | key ${leak.length ? 'FOUND in ' + leak.join(', ') : 'not in share link, JSON export or copied answer'} | ` +
      `Forget: ${s4.slot ? 'NOT removed' : 'removed'}, field ${afterForget.field === '' ? 'empty' : 'NOT empty'}, chip ${afterForget.chip ? 'SHOWN' : 'hidden'} | ` +
      `after reload: ${fresh.field === '' && !fresh.chip ? 'no key' : 'KEY STILL THERE'}, field and hint ${fresh.hint ? 'shown' : 'NOT shown'} | ` +
      `${[s1, s2, s3, s4].some((x) => x.session || x.other) ? 'FOUND in sessionStorage or another name' : 'never in sessionStorage or another storage name'}`, evidence: 'test log' });
  await page.fill('#aiKey', '');
  await page.evaluate(() => { document.getElementById('solver').open = false; });
  await preset('ex1');

  // UI-16 design tab
  await page.click('.tab[data-tab="design"]');
  check({ id: 'UI-16', feature: 'Project design tab (M1 design document)', input: 'click "Project design (Milestone 1)"',
    expected: '7 cards; first section 1. Problem Definition & Automata Specification',
    actual: `${await page.locator('#design .card').count()} cards; first section ${(await page.textContent('#design .card:nth-child(2) h2')).trim()}`, evidence: 'Screenshot 15' });
  await page.screenshot({ animations: 'disabled', path: shot('15_project_design_tab.png') });

  // UI-17 works offline from file:// (double-click)
  const offline = await ctx.newPage();
  const offlineErrors = [];
  offline.on('pageerror', (e) => offlineErrors.push(e.message));
  await offline.goto(url.pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await offline.waitForSelector('#player:not([hidden])');
  check({ id: 'UI-17', feature: 'Runs offline from file:// (double-click)', input: 'open index.html as a file:// URL',
    expected: '2 → 3; no page errors', actual: `${(await offline.textContent('.stat.hero b')).trim()}; ${offlineErrors.length ? offlineErrors.join(';') : 'no page errors'}`,
    evidence: 'test log' });

  check({ id: 'UI-18', feature: 'No JavaScript errors during the whole UI run', input: 'all checks above',
    expected: 'no console or page errors', actual: errors.length ? errors.join('; ') : 'no console or page errors', evidence: 'test log' });

  await browser.close();
  fs.writeFileSync(path.join(outDir, 'ui_results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status !== 'Pass').length;
  console.log(`\nUI checks: ${results.length - failed} passed, ${failed} failed (of ${results.length})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
