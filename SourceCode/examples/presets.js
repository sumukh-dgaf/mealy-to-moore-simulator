/* presets.js — example Mealy machines in the JSON spec format of src/core/parser.js.
   A script (not .json files) so the page can load them from file:// without fetch. */
(function (root) {
  'use strict';
  const PRESETS = [
    {
      id: "ex1",
      name: "Example 1: 11 detector",
      note: "Outputs 1 when the last two inputs are 11. q1 is entered with outputs 0 and 1, so it splits. Expected: 3 Moore states.",
      tests: [
        "0111",
        "1011",
        "11",
        "ε"
      ],
      machine: {
        type: "mealy",
        states: [
          "q0",
          "q1"
        ],
        inputs: [
          "0",
          "1"
        ],
        outputs: [
          "0",
          "1"
        ],
        start: "q0",
        transitions: [
          {
            from: "q0",
            input: "0",
            to: "q0",
            output: "0"
          },
          {
            from: "q0",
            input: "1",
            to: "q1",
            output: "0"
          },
          {
            from: "q1",
            input: "0",
            to: "q0",
            output: "0"
          },
          {
            from: "q1",
            input: "1",
            to: "q1",
            output: "1"
          }
        ]
      }
    },
    {
      id: "ex2",
      name: "Example 2: edge cases",
      note: "p is entered with all of x, y, z; start s has no incoming transitions; d is unreachable. Expected: 7 created, 2 removed, 5 Moore states.",
      tests: [
        "abba",
        "aab",
        "b",
        "ε"
      ],
      machine: {
        type: "mealy",
        states: [
          "s",
          "p",
          "r",
          "d"
        ],
        inputs: [
          "a",
          "b"
        ],
        outputs: [
          "x",
          "y",
          "z"
        ],
        start: "s",
        transitions: [
          {
            from: "s",
            input: "a",
            to: "p",
            output: "x"
          },
          {
            from: "s",
            input: "b",
            to: "p",
            output: "y"
          },
          {
            from: "p",
            input: "a",
            to: "p",
            output: "z"
          },
          {
            from: "p",
            input: "b",
            to: "r",
            output: "x"
          },
          {
            from: "r",
            input: "a",
            to: "p",
            output: "y"
          },
          {
            from: "r",
            input: "b",
            to: "r",
            output: "x"
          },
          {
            from: "d",
            input: "a",
            to: "r",
            output: "z"
          },
          {
            from: "d",
            input: "b",
            to: "d",
            output: "z"
          }
        ]
      }
    }
  ];
  if (typeof module === 'object' && module.exports) module.exports = PRESETS;
  else root.MM_PRESETS = PRESETS;
})(this);
