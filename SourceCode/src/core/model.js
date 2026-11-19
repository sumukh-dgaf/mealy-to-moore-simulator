/**
 * Shared data structures for the algorithm core. Pure JS, no DOM.
 *
 * Machines are plain objects so they serialise to JSON and are easy to inspect in tests.
 */
(function (root, factory) {
  // Plain script so index.html works from file://; in the browser every core file adds to window.MM.
  if (typeof module === 'object' && module.exports) module.exports = factory({});
  else Object.assign((root.MM = root.MM || {}), factory(root.MM || {}));
})(this, function (M) {
  'use strict';
  /**
   * Mealy machine M = (Q, Σ, Δ, δ, λ, q0) — output on transitions.
   * @typedef {Object} MealyMachine
   * @property {'mealy'} type
   * @property {string[]} states   Q, in declaration order
   * @property {string[]} inputs   Σ
   * @property {string[]} outputs  Δ
   * @property {string} start      q0
   * @property {Object<string, Object<string, string>>} delta   delta[q][a] = δ(q, a)
   * @property {Object<string, Object<string, string>>} lambda  lambda[q][a] = λ(q, a)
   */

  /**
   * Moore machine M' = (Q', Σ, Δ, δ', λ', q0') — output on states.
   * @typedef {Object} MooreMachine
   * @property {'moore'} type
   * @property {string[]} states
   * @property {string[]} inputs
   * @property {string[]} outputs
   * @property {string} start
   * @property {Object<string, Object<string, string>>} delta  delta[q][a] = δ'(q, a)
   * @property {Object<string, string>} out                    out[q] = λ'(q)
   */

  /**
   * One entry of an algorithm's step log. Structured so the UI can render it and M2 can animate it.
   * @typedef {Object} Step
   * @property {number} stepNo      1-based, sequential
   * @property {string} rule        rule identifier, e.g. "A2" (see docs/milestone1/M1_Design_Document.md §11)
   * @property {string} description human-readable explanation
   * @property {Object} data        machine-readable details of the step
   */

  /** Collects {@link Step} entries with automatic numbering. */
  class StepLog {
    constructor() {
      /** @type {Step[]} */
      this.steps = [];
    }

    /**
     * Append a step; its stepNo is the next number in sequence.
     * @param {string} rule         rule identifier, e.g. "A4"
     * @param {string} description  human-readable explanation shown in the step player
     * @param {Object} [data]       machine-readable details (state names, symbols) for replay
     * @returns {void}
     */
    add(rule, description, data = {}) {
      this.steps.push({ stepNo: this.steps.length + 1, rule, description, data });
    }
  }

  /**
   * Name of the Moore state that stands for Mealy state q entered with output o.
   * @param {string} q
   * @param {string} o  an output symbol, or "-" when q has no incoming transitions
   * @returns {string}  e.g. "[q1,0]"
   */
  const splitName = (q, o) => `[${q},${o}]`;

  /**
   * Format a symbol sequence for display: no separator when every symbol is a single character.
   * @param {string[]} symbols
   * @returns {string} "ε" for the empty sequence
   */
  const showWord = (symbols) =>
    symbols.length === 0 ? 'ε' : symbols.join(symbols.every((s) => s.length === 1) ? '' : ' ');

  return { StepLog, splitName, showWord };
});
