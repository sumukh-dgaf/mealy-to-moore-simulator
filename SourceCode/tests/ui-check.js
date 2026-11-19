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
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
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
