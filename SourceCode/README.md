# Mealy → Moore Conversion Simulator

CSET302 – Automata Theory and Computability · Bennett University, SCSET · Simulator topic 14 (scope: Mealy → Moore conversion) · Milestone II

## Overview: What does the simulator do?

The simulator takes a user-defined Mealy machine M = (Q, Σ, Δ, δ, λ, q0), whose outputs are written on transitions. It converts it into an equivalent Moore machine M′ = (Q′, Σ, Δ, δ′, λ′, q0′), whose outputs are written on states, by **state splitting**. It then shows every step of the conversion, draws both machines, and **proves** that the result is equivalent.

**Equivalence convention.** On an input of length n, the Moore machine prints n + 1 symbols: the first is λ′(q0′), printed before any input is read. The Mealy machine prints n symbols. The machines are equivalent if and only if, for every input, the Moore output with its first symbol dropped equals the Mealy output.

The simulator runs entirely in the browser (plain HTML, CSS and JavaScript, with no libraries and no server). The same algorithm files also run in Node.js for the automated tests and a console version.

## Supported features

Each feature is covered by at least one documented test. The IDs refer to `TestCases/test_cases.md`.

1. **Mealy machine editor** with two built-in examples. Enter Q, Σ and Δ as lists, pick the start state, and fill a table with a next-state and an output drop-down per cell. (UI-01, UI-08)
2. **Import** of transition-table text or JSON. (TC-25a, TC-19a–c, UI-10)
3. **Input validation** with one message per error: empty Q/Σ/Δ, duplicate names, undefined or unknown start state, unknown states or symbols, duplicate transitions (non-determinism), missing transitions (incomplete machine), and a Moore machine given as input. Incomplete machines are rejected; no trap state is added silently. (TC-13 … TC-20, UI-08, UI-09)
4. **Mealy → Moore conversion by state splitting (Algorithm A).** It computes O(q) (the outputs entering each state), creates one copy [q,o] per entering output ([q,−] with a default output if none), applies δ′([q,o], a) = [δ(q,a), λ(q,a)], chooses the start copy, removes unreachable states, and reports |Q′| against the bound |Q|·|Δ|. Options: the default output, the start copy, and whether to remove unreachable states. (TC-01 … TC-10, TC-22)
5. **Step-by-step player** over 8 phases, with Prev/Next/Play, a phase timeline, a list of all steps, keyboard control (← → Space F) and screen-reader announcements. (TC-23, UI-02, UI-07)
6. **SVG state diagrams and transition tables.** States and edges involved in each step are highlighted. Larger machines keep readable labels and scroll. (UI-03, UI-15)
7. **String tester** that runs both machines on a string, an empty string (ε) or 20 random strings, and shows outputs aligned symbol by symbol. (TC-08, TC-12, TC-24a, UI-04)
8. **Exact equivalence check (Algorithm C)**: a breadth-first search over reachable state pairs that returns a shortest counterexample. Paste your own hand-converted Moore machine to check it. (TC-11, TC-24b, UI-05, UI-06)
9. **Export** of the current diagram as SVG or PNG. (UI-11)
10. **Export** of the generated Moore machine as JSON or transition-table text. (TC-25b, UI-12)
11. **Share link**: a URL that reopens the same Mealy machine. (UI-13)
12. **Project design tab** with the Milestone-1 design summary. (UI-16)
13. **Works offline** by double-clicking `index.html`; the layout has no sideways scrolling at 1200–1366 px. (UI-17, UI-14)
14. **Console front-end** (`src/cli.js`) for reproducible text output. (TC-26)

## Technology stack and dependencies

| Item | Version used and tested | Needed for |
|---|---|---|
| HTML5, CSS3, JavaScript (ES2022) | – | the simulator (no framework, no libraries, no build step) |
| Web browser | Google Chrome 157.0.8103.79 (Windows); Playwright's Chromium 153.0.8010.12 for the UI checks | running the simulator. Other current browsers (Edge, Firefox) are expected to work but were **not tested**. |
| Node.js | v24.21.0 (Node.js 20 or newer is required for the built-in test runner) | the automated tests and the console version only. Uses only built-in modules (`node:test`, `node:assert`, `node:fs`, `node:child_process`); **no npm packages**. |
| Python | 3.10.11 (any Python 3) | optional: serving the folder with `python -m http.server` |
| Playwright | 1.63.0 | optional, developer only: `tests/ui-check.js` (scripted UI checks and screenshots). It is **not** a dependency of the project and is not included. |

**Licensing and attribution.** All code was written for this project. It contains no third-party code and loads nothing from the internet. The page layout, the visual style and the layered SVG diagram layout (`src/ui/graph.js`, `src/ui/style.css`) were adapted from another CSET302 project, the *DFA Minimization Simulator* (simulator topic 3), whose team includes Sumukh Gupta and which he supplied as a design reference. Playwright (Apache-2.0 licence) was used only to take screenshots and run UI checks.

## Installation

1. Install a current web browser (tested: Google Chrome 157).
2. Optional, for the tests and the console version: install Node.js 20 or newer from <https://nodejs.org>, then check it:
   ```
   node --version
   ```
3. Optional, to serve the page: check that Python 3 is installed:
   ```
   python --version
   ```
4. Copy or unzip the `SourceCode` folder anywhere and open a terminal in it:
   ```
   cd SourceCode
   ```
5. There is nothing to install with npm: the project has no dependencies.

## How to run

The entry point is **`index.html`**.

- **Option A (no server):** double-click `index.html`, or open it with File → Open in the browser. It works offline from `file://`.
- **Option B (local server):** in the `SourceCode` folder run
  ```
  python -m http.server 8000
  ```
  and open <http://localhost:8000/>.
- **Console version:** in the `SourceCode` folder run
  ```
  node src/cli.js ex1 0111
  ```
  The first argument is a built-in example (`ex1`, `ex2`) or a path to a JSON or table-text file. The other arguments are input strings; `ε` means the empty string.

In the browser, Example 1 loads automatically. Press **Convert to Moore** after any change, then step through with **Next ▶** or **▶ Play**.

## Example

Example 1 is a Mealy “11” sequence detector: it outputs 1 when the last two inputs are 11. As transition-table text (it can be pasted into *Import a transition table or JSON*):

```
type: mealy
start: q0
outputs: 0 1
state | 0    | 1
q0    | q0/0 | q1/0
q1    | q0/0 | q1/1
```

Output of `node src/cli.js ex1 0111`, trimmed to the result:

```
== Output (moore) ==
type: moore
start: [q0,0]
outputs: 0 1
state  | out | 0      | 1
[q0,0] | 0   | [q0,0] | [q1,0]
[q1,0] | 0   | [q0,0] | [q1,1]
[q1,1] | 1   | [q0,0] | [q1,1]

w = 0111
  Mealy states : q0 q0 q1 q1 q1   output 0011
  Moore states : [q0,0] [q0,0] [q1,0] [q1,1] [q1,1]   output 00011
  Moore, first symbol dropped: 0011  ✔ match

== Equivalence (Algorithm C) ==
✔ equivalent — 3 reachable pairs: (q0, [q0,0]) (q1, [q1,0]) (q1, [q1,1])
```

q1 is entered with output 0 (from q0 on 1) and with output 1 (from q1 on 1), so it is split into [q1,0] and [q1,1].

## Project structure

```
SourceCode/
├── index.html                 ENTRY POINT: the page (Simulator tab + Project design tab)
├── src/
│   ├── core/                  all Automata Theory logic; no DOM, also runs in Node.js
│   │   ├── model.js           machine types (JSDoc), StepLog, [q,o] naming, word formatting
│   │   ├── parser.js          parse + validate table text / JSON; export to table text / JSON
│   │   ├── mealyToMoore.js    Algorithm A: state splitting, with a step log (A1–A6, BOUND)
│   │   ├── simulate.js        run both machines, compare outputs, random strings
│   │   └── equivalence.js     Algorithm C: BFS equivalence check, shortest counterexample
│   ├── ui/
│   │   ├── app.js             controller: editor, step player, tester, checker, exports, share link
│   │   ├── render.js          HTML for tables, output alignment, equivalence result
│   │   ├── graph.js           SVG state-diagram renderer and SVG export
│   │   └── style.css          layout and dark theme
│   └── cli.js                 console version
├── examples/presets.js        the two built-in example machines
├── tests/
│   ├── core.test.js           automated test suite (node --test)
│   ├── fixtures.js            loads test machines; seeded random machines
│   ├── machines/*.json        hand-worked test machines
│   ├── ui-check.js            scripted UI checks + screenshots (needs Playwright; optional)
│   ├── make-test-table.js     builds TestCases/test_cases.md from a test run
│   └── benchmark.js           performance measurements
├── docs/
│   ├── evidence/benchmark.txt Milestone-II performance measurements (tests/benchmark.js)
│   └── milestone1/            Milestone-1 design document, slide outline, diagrams, CLI evidence (kept for reference)
├── package.json               only defines "npm test"; no dependencies
└── .vscode/launch.json        VS Code: open the simulator in Chrome
```

## Testing

Run the automated tests in the `SourceCode` folder:

```
node --test
```

(`npm test` does the same.) The suite runs 26 tests (43 checks) and finishes in well under a second.

- **Test data:** the two examples in `examples/presets.js`, the hand-worked machines in `tests/machines/*.json` (also copied to `TestCases/` as JSON), and seeded random machines from `tests/fixtures.js`.
- **Reading the result:** every test prints `✔` (pass) or `✖` (fail) with its ID, followed by a line `ℹ TC-xx observed: …` with the value the program produced. The summary at the end shows `ℹ pass` and `ℹ fail`. The expected value of every check, and where it comes from (a hand-worked trace, the design document, a validation rule), is in `TestCases/test_cases.md`.
- **Rebuilding the test table** (PowerShell; in bash use `TEST_RESULTS=results.json node --test`):
  ```
  $env:TEST_RESULTS = "results.json"; node --test
  node tests/make-test-table.js results.json | Out-File -Encoding utf8 test_cases.md
  ```
- **Scripted UI checks and screenshots** (optional; needs Playwright, which is not part of the project): start `python -m http.server 8000`, then
  ```
  $env:PLAYWRIGHT = "<folder containing node_modules/playwright>"; node tests/ui-check.js http://localhost:8000/ screenshots
  ```
- **Performance measurements:** `node tests/benchmark.js`

## Known limitations and troubleshooting

**Limitations**

- Only Mealy → Moore conversion. A Moore machine is accepted only in the *Check a hand-converted Moore machine* box.
- Only deterministic, complete machines. An incomplete machine is rejected with a "Missing transition" error per missing pair. To model a partial machine, add an explicit trap state yourself.
- ε is never an input symbol. An empty test string (or `ε` typed in the tester or the console version) is the empty word.
- Split states are named `[q,o]`. State names containing `[`, `]` or `,` can collide; this is detected and reported, never silently mis-converted.
- The diagram uses a simple layered layout. Machines with more than about 15 Moore states are drawn at a fixed minimum size and scroll, and edges may still cross.
- The step-log text for step A1 lists every entering transition, which costs O(|Q|²·|Σ|). Conversion stays under 0.2 s up to 1,000 Mealy states (see `docs/evidence/benchmark.txt`).
- A share link stores the Mealy machine only. The options (default output, start copy, pruning) reset to their defaults.

**Troubleshooting**

- *The page is blank or the buttons do nothing:* JavaScript is disabled, or the files of `src/` are missing next to `index.html`. Keep the folder structure as shipped.
- *"Share link" says to copy the link from the address bar:* the browser did not allow clipboard access. The link is already in the address bar.
- *PNG export reports a failure:* use *Diagram SVG*; it always works.
- *`python -m http.server` fails with "address already in use":* use another port, e.g. `python -m http.server 8080`, and open that port.
- *`node` is not recognised:* install Node.js (step 2 of Installation) and open a new terminal.
- *Tests fail to start:* check `node --version`; Node.js 20 or newer is required.

## Team contributions and acknowledgements

| Member | Enrollment No. | Contribution |
|---|---|---|
| Sumukh Gupta | S24CSEU0570 | Algorithm A / state splitting (`src/core/mealyToMoore.js`), data model (`src/core/model.js`), controller (`src/ui/app.js`), integration, demo lead |
| Neya Tripathi | S24CSEU0609 | Parsing and validation rules (`src/core/parser.js`), the test suite (`tests/core.test.js`), `TestCases/` |
| Aaditya Goel | S24CSEU0614 | Simulation and random-string testing (`src/core/simulate.js`), Algorithm C (`src/core/equivalence.js`), performance measurements |
| Kushika Mishra | S24CSEU0652 | User interface (`index.html`, `src/ui/render.js`, `src/ui/style.css`), SVG renderer (`src/ui/graph.js`), step player, M2 exports and layout fix, screenshots |
| Kartik Mahajan | S24CSEU0640 | Technical report, this README and the JSDoc code documentation, existing-tools analysis and theory, console version (`src/cli.js`) |

**Acknowledgements.** CSET302 course team, Bennett University. Theory follows J. E. Hopcroft, R. Motwani and J. D. Ullman, *Introduction to Automata Theory, Languages, and Computation*, 3rd ed., Pearson, 2006. The layout and diagram style were adapted from the DFA Minimization Simulator (CSET302 topic 3), as noted above.
