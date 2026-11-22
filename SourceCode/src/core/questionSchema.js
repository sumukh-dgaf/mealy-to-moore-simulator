/**
 * "Solve from a question": everything about the AI step that does not need a browser.
 *
 * The model (Google Gemini, generateContent REST API) only READS the question and returns a Mealy
 * machine in the JSON shape of RESPONSE_SCHEMA. This module builds the request body, reads the API
 * response, normalises the model's JSON into the parser.js spec format and runs it through the
 * EXISTING validation (buildMachine). It never converts anything: conversion, validation and the
 * equivalence check stay in mealyToMoore.js, parser.js and equivalence.js.
 *
 * The API key is never passed to this module: it travels only in the x-goog-api-key header, which
 * src/ui/solve.js adds.
 */
(function (root, factory) {
  // Plain script so index.html works from file://; in the browser every core file adds to window.MM.
  if (typeof module === 'object' && module.exports) module.exports = factory(Object.assign({}, require('./model.js'), require('./parser.js'), require('./simulate.js')));
  else Object.assign((root.MM = root.MM || {}), factory(root.MM || {}));
})(this, function (M) {
  'use strict';
  const { buildMachine, toSymbols, runMealy, showWord } = M;

  /**
   * Default model id: gemini-3.6-flash, a stable free-tier Flash model (aistudio.google.com/docs/models).
   * Measured on 22 Nov 2026 it was the only free model whose answers to all 5 benchmark questions passed
   * the self-check; gemini-3.8-flash answered 503 (high demand). First model of the Auto list (AUTO_MODELS).
   */
  const DEFAULT_MODEL = 'gemini-3.6-flash';

  const str = { type: 'string' };
  const objectOf = (properties) => ({ type: 'object', properties, required: Object.keys(properties) });

  /**
   * JSON Schema (the subset Gemini's structured output supports) for the model's reply. Sent as
   * generationConfig.responseJsonSchema together with responseMimeType "application/json".
   */
  const RESPONSE_SCHEMA = objectOf({
    kind: { type: 'string', enum: ['given_machine', 'design_problem'], description: 'given_machine: the question states the machine; design_problem: the machine must be designed' },
    states: { type: 'array', items: str, description: 'state names, start state first' },
    inputs: { type: 'array', items: str, description: 'input alphabet Σ' },
    outputs: { type: 'array', items: str, description: 'output alphabet Δ' },
    start: { type: 'string', description: 'start state' },
    transitions: { type: 'array', description: 'one per (state, input) pair that the question gives or the design needs',
      items: objectOf({ from: str, input: str, to: str, output: str }) },
    state_meanings: { type: 'array', description: 'what each state remembers', items: objectOf({ state: str, meaning: str }) },
    assumptions: { type: 'array', items: str, description: 'anything that had to be assumed' },
    missing: { type: 'array', items: str, description: 'information the question does not give, in plain English; never invent it' },
    test_cases: { type: 'array', description: '4 to 6 checks taken from the problem statement',
      items: objectOf({ input: str, expected_output: str, reason: str }) },
  });

  /** System instruction sent with every request. */
  const SYSTEM_INSTRUCTION = [
    'You read automata-theory exam questions and return the Mealy machine M = (Q, Σ, Δ, δ, λ, q0) they describe or ask you to design, as JSON matching the response schema.',
    'You do NOT convert the machine to Moore form; another program does that.',
    'Rules:',
    '1. Use the question\'s own state names (A, B, q0, ...) and symbols when it gives them. All names and symbols are strings.',
    '2. kind = "given_machine" if the question states the transitions; "design_problem" if you must design the machine (e.g. "detect 101", "divisible by 3", "2\'s complement").',
    '3. Never invent transitions the question does not give. For each one that is missing, add a plain-English sentence to "missing", e.g. "The question does not say where B goes on input 1."',
    '4. For design problems, build a minimal, correct, deterministic and complete Mealy machine and give a meaning for every state in "state_meanings".',
    '5. Give exactly one transition per (state, input) pair you know. Put anything you had to assume in "assumptions".',
    '6. Give 4 to 6 test_cases taken from the problem statement itself. "input" and "expected_output" are strings of symbols: no separators when every symbol is one character (e.g. "0111"), otherwise separated by single spaces. Use "" for the empty input. The Mealy output has exactly as many symbols as the input.',
    '7. Almost every question asks you to convert the Mealy machine into a Moore machine. That request is expected and is NOT missing information: never mention it in "missing" or "assumptions". "missing" is ONLY for facts needed to build the Mealy machine (a state, a transition, an output, the start state) that the question does not give.',
    '8. Only if the question gives a Moore machine (outputs written on states) or asks for Moore → Mealy conversion, add to "missing": "The question gives a Moore machine or asks for Moore → Mealy; this simulator only converts Mealy → Moore."',
  ].join('\n');

  /**
   * Lowest thinking level the docs allow for each known model (aistudio.google.com/docs/thinking:
   * gemini-3.8-flash does not support MINIMAL). Sent as generationConfig.thinkingConfig.thinkingLevel;
   * other model ids get no thinkingConfig, because setting it on a model without thinking is an error.
   */
  const LOWEST_THINKING = { 'gemini-3.8-flash': 'LOW', 'gemini-3.6-flash': 'MINIMAL', 'gemini-3.5-flash-lite': 'MINIMAL', 'gemini-3.1-flash-lite': 'MINIMAL' };

  /**
   * "Auto" mode: tried in this order; the next one is used after a 429 (quota), a 503 (high demand)
   * or a timeout. All three are stable free-tier models (aistudio.google.com/docs/models, /docs/pricing).
   */
  const AUTO_MODELS = [DEFAULT_MODEL, 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];

  // Wall-clock time of instant t in time zone tz, read as if it were UTC (ms).
  function wallClock(t, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(t).forEach((x) => { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }

  /**
   * When free-tier daily quotas next reset: midnight Pacific time (aistudio.google.com/docs/rate-limits).
   * @param {number} now  ms since the epoch
   * @returns {number} ms since the epoch of the next midnight in America/Los_Angeles
   */
  function nextQuotaReset(now) {
    const wall = wallClock(now, 'America/Los_Angeles');
    const d = new Date(wall);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const t = midnight - (wall - now); // with today's UTC offset
    return t + (midnight - wallClock(t, 'America/Los_Angeles')); // corrected once if daylight saving changes before midnight
  }

  /** Auto-mode models whose quota is not marked as used up at time now. @param {Object<string, number>} usedUp  model → reset time */
  const availableModels = (usedUp, now) => AUTO_MODELS.filter((m) => !(usedUp[m] > now));

  /** True unless a 429 reply says it is only the per-minute limit (then the model is not marked for the day). */
  const isDailyQuota = (data) => !/PerMinute|per minute/i.test(JSON.stringify(data || ''));

  /** The one message shown when every Auto model has used its daily quota. @param {number} resetAt  ms since the epoch */
  function allUsedUpMessage(resetAt) {
    const ist = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(resetAt).toLowerCase();
    return `All free Gemini models have used today's quota. It resets at about ${ist} IST. Choose a model manually or try later.`;
  }

  /** Four example questions for the panel's example buttons (and live demos). */
  const EXAMPLE_QUESTIONS = [
    { label: 'Machine in sentences', text: 'A Mealy machine has states A and B, input alphabet {0, 1} and output alphabet {0, 1}. A is the start state. From A, input 0 keeps the machine in A with output 0, and input 1 moves it to B with output 0. From B, input 0 moves it back to A with output 0, and input 1 keeps it in B with output 1. Convert this Mealy machine into an equivalent Moore machine.' },
    { label: 'Table in words', text: 'Convert the following Mealy machine to a Moore machine. Present state q1 (initial state): on input a the next state is q1 with output 0, on input b the next state is q2 with output 0. Present state q2: on input a the next state is q3 with output 1, on input b the next state is q2 with output 0. Present state q3: on input a the next state is q1 with output 1, on input b the next state is q2 with output 1.' },
    { label: 'Sequence detector (101)', text: 'Design a Mealy machine over the input alphabet {0, 1} that outputs 1 whenever the input read so far ends in 101 (overlapping sequences allowed) and 0 otherwise. Then convert it into an equivalent Moore machine.' },
    { label: 'Divisible by 3', text: 'Design a Mealy machine that reads a binary number one bit at a time, most significant bit first, and after each bit outputs 1 if the number read so far is divisible by 3 and 0 otherwise. Convert it into a Moore machine.' },
  ];

  /**
   * generateContent endpoint for a model. The API key is NOT part of the URL (it goes in the
   * x-goog-api-key header).
   * @param {string} model  model id, e.g. "gemini-3.8-flash"
   * @returns {string} URL
   * @throws {Error} if the model id contains characters other than letters, digits, ".", "_" or "-"
   */
  function endpointUrl(model) {
    if (!/^[\w.-]+$/.test(String(model || ''))) throw new Error(`"${model}" is not a valid model id (letters, digits, ".", "_" and "-" only).`);
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }

  /**
   * Request body for generateContent: system instruction, the question (and optional inline image),
   * structured output (application/json + responseJsonSchema) and, for known models, the lowest
   * thinking level (faster replies). Contains no API key.
   * @param {string} question  the question text (may be empty when an image is given)
   * @param {{mimeType: string, data: string}|null} [image]  base64-encoded png/jpeg/webp
   * @param {string} [model]  model id; selects the thinking level (see LOWEST_THINKING)
   * @returns {Object} JSON body
   */
  function buildRequestBody(question, image, model) {
    const parts = [];
    if (question) parts.push({ text: question });
    if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    const generationConfig = { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_SCHEMA };
    if (LOWEST_THINKING[model]) generationConfig.thinkingConfig = { thinkingLevel: LOWEST_THINKING[model] };
    return {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
    };
  }

  const BLOCKED = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'];

  /**
   * Read a successful generateContent response. Never throws.
   * @param {Object} data  parsed HTTP response body
   * @returns {{reply: Object}|{blocked: string}|{invalid: string}}  reply: the model's JSON object;
   *          blocked: refused for safety reasons (do not retry); invalid: no usable JSON (retry once)
   */
  function readResponse(data) {
    const block = data && data.promptFeedback && data.promptFeedback.blockReason;
    if (block) return { blocked: `Gemini blocked the question (${block}). Rephrase it and try again.` };
    const cand = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (!cand) return { invalid: 'The reply contained no answer.' };
    if (BLOCKED.includes(cand.finishReason)) return { blocked: `Gemini stopped the answer for safety reasons (${cand.finishReason}).` };
    const parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
    const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
    if (!text.trim()) return { invalid: 'The reply contained no JSON.' };
    try {
      const reply = JSON.parse(text);
      if (reply && typeof reply === 'object' && !Array.isArray(reply)) return { reply };
    } catch { /* reported below */ }
    return { invalid: 'The reply was not valid JSON.' };
  }

  const clean = (x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '');
  const strings = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);
  const objects = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);

  /**
   * Normalise the model's JSON into the parser.js spec and validate it with the existing rules.
   * Every "missing" item is an error, so a question with gaps is never converted. Never throws.
   * @param {Object} reply  the model's JSON (RESPONSE_SCHEMA shape; fields are checked, not trusted)
   * @returns {{
   *   machine: (import('./model.js').MealyMachine|null),
   *   spec: Object,
   *   errors: string[],
   *   info: {kind: string, stateMeanings: Array<{state: string, meaning: string}>, assumptions: string[],
   *          missing: string[], testCases: Array<{input: string, expected: string, reason: string}>}
   * }}  machine is null whenever errors is non-empty
   */
  function normaliseReply(reply) {
    const r = reply && typeof reply === 'object' && !Array.isArray(reply) ? reply : {};
    const info = {
      kind: r.kind === 'design_problem' ? 'design_problem' : 'given_machine',
      stateMeanings: objects(r.state_meanings).map((m) => ({ state: clean(m.state), meaning: clean(m.meaning) })).filter((m) => m.state && m.meaning),
      assumptions: strings(r.assumptions),
      missing: strings(r.missing),
      testCases: objects(r.test_cases).map((t) => ({ input: clean(t.input), expected: clean(t.expected_output), reason: clean(t.reason) })),
    };
    const spec = {
      type: 'mealy',
      states: strings(r.states),
      inputs: strings(r.inputs),
      outputs: strings(r.outputs),
      start: clean(r.start),
      transitions: objects(r.transitions).map((t) => ({ from: clean(t.from), input: clean(t.input), to: clean(t.to), output: clean(t.output) })),
    };
    const errors = [];
    if (r !== reply) errors.push('The reply is not a JSON object.');
    else if (r.kind !== 'given_machine' && r.kind !== 'design_problem') errors.push(`The reply has no valid "kind" (got ${JSON.stringify(r.kind)}).`);
    errors.push(...info.missing);
    errors.push(...buildMachine(spec).errors);
    return { machine: errors.length ? null : buildMachine(spec).machine, spec, errors, info };
  }

  /**
   * Run the model's own test cases on the machine it built (simulate.js), as a self-check that the
   * machine matches the question. Inputs/outputs "" or "ε" mean the empty word. Never throws.
   * @param {import('./model.js').MealyMachine} machine  a validated Mealy machine
   * @param {Array<{input: string, expected: string, reason: string}>} testCases  from normaliseReply
   * @returns {Array<{input: string, expected: string, reason: string, actual: string, ok: boolean, note: string}>}
   *          actual is the Mealy output; note explains a symbol that is not in Σ or Δ
   */
  function selfCheck(machine, testCases) {
    const word = (text, alphabet) => (text === '' || text === 'ε' ? [] : toSymbols(text, alphabet));
    return testCases.map((tc) => {
      let input;
      try {
        input = word(tc.input, machine.inputs);
      } catch (e) {
        return { ...tc, actual: '—', ok: false, note: e.message };
      }
      const actual = runMealy(machine, input).outputs;
      let expected;
      try {
        expected = word(tc.expected, machine.outputs);
      } catch (e) {
        return { ...tc, actual: showWord(actual), ok: false, note: `expected output: ${e.message}` };
      }
      const ok = expected.length === actual.length && expected.every((o, i) => o === actual[i]);
      return { ...tc, actual: showWord(actual), ok, note: '' };
    });
  }

  return { DEFAULT_MODEL, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, EXAMPLE_QUESTIONS, LOWEST_THINKING, AUTO_MODELS, nextQuotaReset, availableModels, isDailyQuota, allUsedUpMessage, endpointUrl, buildRequestBody, readResponse, normaliseReply, selfCheck };
});
