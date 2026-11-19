# M1 Review: Slide Outline (12 slides, ~10 minutes)

Mealy → Moore Machine Conversion Simulator · CSET302 · Topic 14
Each slide lists its rubric criterion, its speaker, and its source section in `M1_Design_Document.md`. Rubric: **(a)** Problem Definition & Automata Specification (1) · **(b)** Existing Tools & Feasibility (1) · **(c)** Simulator Design & Methodology (2) · **(d)** Algorithm Selection & Correctness (1).

| # | Title | Content | Rubric | Speaker | Source |
|---|-------|---------|--------|---------|--------|
| 1 | Title & team | Project title, topic #14 (scope: Mealy → Moore conversion), 5 members + enrollment numbers | – | Sumukh Gupta | Title page |
| 2 | Problem & objectives | Why conversion is hard to *see*; objectives O1–O7 with measures | (a) | Sumukh Gupta | §1 |
| 3 | Formal specification | Mealy and Moore 6-tuples; deterministic + complete; one picture of each | (a) | Kartik Mahajan | §2.1 |
| 4 | Equivalence convention | n vs n+1 outputs; "drop Moore's first symbol"; why state splitting is needed (q1 entered with 0 and 1) | (a) | Kartik Mahajan | §2.2–2.4 |
| 5 | Existing tools & gap | Comparison table (JFLAP, automatonsimulator, Noam, Moore-Mealy-Converter, tutorial sites); the 3-part gap | (b) | Kartik Mahajan | §4 |
| 6 | Feasibility | Tech stack (no install, no build, `node --test`), schedule to M2, complexity table O(\|Q\|·\|Δ\|·\|Σ\|), O(\|Q\|·\|Q'\|·\|Σ\|) | (b) | Aaditya Goel | §5 |
| 7 | Architecture | 4-layer diagram; pure core shared by UI, CLI, tests; single trust boundary; structured step log | (c) | Kushika Mishra | §6 |
| 8 | Workflow & UML | Flowchart Mealy input → Validate → Algorithm A → Step log → Visualize → Result → Equivalence; class + sequence diagram | (c) | Kushika Mishra | §7–8 |
| 9 | UI wireframe & modules | Wireframe from the *Project design* tab (editor, step player, diagram + working area, tester, hand-conversion check); module/owner table | (c) | Kushika Mishra / Neya Tripathi | §9–10 |
| 10 | Algorithms A and C | Pseudocode; key line A4 δ'([q,o],a) = [δ(q,a), λ(q,a)]; C = BFS over pairs; correctness in one sentence each | (d) | Sumukh Gupta / Aaditya Goel | §11 |
| 11 | Manually validated example | Example 1 by hand: O(q) table, 3 Moore states, trace 0111 → 0011 vs 00011 → 0011 ✔; hand vs program table; Example 2 edge cases in one line | (d) | Neya Tripathi | §12 |
| 12 | Live prototype + plan to M2 | **Live demo**: load Ex 1 → Convert → test 0111 → Verify ✔ → paste wrong Moore → counterexample 11. Then `node --test` 12/12 and the M2 timeline | (c)(d) | All | §13–15 |

**Demo script (slide 12, ~2 min).** Open `index.html` by double-clicking (no install, no server). (1) Example 1 loads automatically; press *Hide editor* (`F`), then step with `→` through Incoming outputs, Split states, a Transitions step (highlighted edge and δ′ cell) and Start state. (2) Validate step: exact check ✓ with 3 pairs. (3) Tester: 0111 → Mealy 0011, Moore 00011, aligned ✓. (4) *Copy generated Moore machine into the box*, change λ′ of [q1,1] to 0 → *Verify* → ✗ counterexample `11`. (5) Load Example 2 → show [s,-] (default output) and the Unreachable step with [r,z], [d,z] faded. (6) Set one cell to “—” → Convert → validation error.

Text for the "wrong" Moore machine used in the demo:

```
type: moore
start: [q0,0]
outputs: 0 1
state  | out | 0      | 1
[q0,0] | 0   | [q0,0] | [q1,0]
[q1,0] | 0   | [q0,0] | [q1,1]
[q1,1] | 0   | [q0,0] | [q1,1]
```

---

## Likely viva questions (every member should be able to answer all of them)

1. **What is the difference between a Mealy and a Moore machine?**
   Mealy: output λ: Q × Σ → Δ is on transitions, so it depends on the state *and* the current input. Moore: output λ': Q → Δ is on states, so it depends only on the state. On an input of length n, Mealy emits n symbols and Moore emits n+1.

2. **Why does the Moore machine produce one extra symbol, and what do you do with it?**
   The Moore machine is in q0' before reading anything and emits λ'(q0') for the empty prefix. Mealy has no transition yet, so it emits nothing. We compare after dropping Moore's first symbol. That is the equivalence convention.

3. **Why must states be split in Mealy → Moore?**
   A Moore state has one fixed output, but a Mealy state can be entered by transitions with different outputs (q1 in Example 1 is entered with 0 and with 1). Each copy [q,o] remembers "I am in q and the last output was o".

4. **How are transitions of the new Moore machine defined?**
   δ'([q,o], a) = [δ(q,a), λ(q,a)]. The target exists because λ(q,a) is, by definition, an output entering δ(q,a). The rule does not depend on o, so all copies of q behave the same.

5. **Which copy of q0 becomes the start state, and does it matter?**
   If q0 has no incoming transitions, use [q0,−]. Otherwise any [q0,o]; we pick the first in Δ order. It does not matter: the copies have identical outgoing transitions, and the start output is only emitted for ε, which is dropped.

6. **What happens to a state with no incoming transitions?**
   It still gets one copy [q,−] with a default output (user-selectable, default the first symbol of Δ). If it is not the start state it is unreachable and is removed in step A6.

7. **What is the maximum number of states after Mealy → Moore?**
   |Q|·|Δ|: each state gets at most one copy per output symbol. Example 1 gives 3 ≤ 4; Example 2 gives 7 created and 5 kept ≤ 12. Textbooks that add a fresh start state write |Q|·|Δ| + 1.

8. **How do you *prove* the converted machine is equivalent, not just test it?**
   Algorithm C runs BFS over pairs (Mealy state, Moore state) starting from (q0, q0'). For each pair and symbol a it checks λ(q,a) = λ'(δ'(r,a)). Every input prefix leads to one reachable pair, and there are at most |Q|·|Q'| pairs. So if no pair fails, every position of every input agrees. On a failure it rebuilds a shortest counterexample from parent pointers.

9. **Why is random testing not enough?**
    A bug can show up only on a long, specific input that random strings are unlikely to hit. The BFS checks every reachable situation exhaustively in O(|Q|·|Q'|·|Σ|) time. We still run random strings as a supplementary, visual check.

10. **What inputs does your simulator reject, and why?**
    A Moore machine as the main input (the simulator converts Mealy → Moore only), empty Q/Σ/Δ, undefined start state, unknown states or symbols, duplicate transitions (non-determinism) and missing transitions (incompleteness), plus a hand-converted Moore machine with a state lacking an output. The algorithms assume a deterministic, complete machine, so the parser is the single trust boundary.

11. **What are the limitations, and what comes in M2?**
    Mealy → Moore only; deterministic complete machines only; the simple layered diagram layout gets cluttered above ~15 states. M2 adds minimization, diagram export and the full test suite (§14).

**Own-module question (prepare individually).** "Walk us through your module: its input, output, one tricky case, and how it is tested." See the owner column in §9 of the design document.
