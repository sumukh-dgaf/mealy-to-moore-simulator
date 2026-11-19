/* graph.js — draws a Mealy or Moore machine as an SVG state diagram (no external libraries).
   Mealy edges are labelled "a/o"; Moore states show their output λ' under the name. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  // dark-theme palette: deep fills keep the light state labels readable, bright strokes mark the group
  const FILLS = ['#1e3a5f', '#14532d', '#4a3410', '#5b1f3f', '#3b2a63', '#134e5a', '#5a1f1f', '#2e3270', '#334d14', '#3a3633'];
  const STROKES = ['#60a5fa', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#f87171', '#818cf8', '#a3e635', '#a8a29e'];
  const EDGE = '#93a1bb', HOT = '#f59e0b', VISITED = '#4ade80', NODE_FILL = '#1b2232';
  const COL_W = 170, ROW_H = 120;
  let uid = 0;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  const radius = (m, name) => Math.max(26, 10 + name.length * 4.3) + (m.type === 'moore' ? 4 : 0);

  /* Layered layout: column = BFS distance from the start state; states not reached go in a last column. */
  function layout(m) {
    const depth = {};
    const queue = m.start !== undefined ? [m.start] : [];
    if (queue.length) depth[m.start] = 0;
    while (queue.length) {
      const s = queue.shift();
      m.inputs.forEach((a) => {
        const t = m.delta[s] && m.delta[s][a];
        if (t !== undefined && depth[t] === undefined && m.states.includes(t)) {
          depth[t] = depth[s] + 1;
          queue.push(t);
        }
      });
    }
    let maxD = 0;
    m.states.forEach((s) => { if (depth[s] !== undefined) maxD = Math.max(maxD, depth[s]); });
    let cols = [];
    m.states.forEach((s) => {
      const d = depth[s] === undefined ? maxD + 1 : depth[s];
      (cols[d] = cols[d] || []).push(s);
    });
    cols = cols.filter(Boolean);
    const maxRows = Math.max(...cols.map((c) => c.length));

    // Crossing reduction (barycenter heuristic) for larger machines: order each column by the
    // mean row of its neighbours in the previous column (forward sweep), then in the next one
    // (backward sweep). States with no neighbour there keep their row; ties keep their order.
    const adj = {};
    m.states.forEach((s) => { adj[s] = new Set(); });
    m.states.forEach((s) => m.inputs.forEach((a) => {
      const t = m.delta[s] && m.delta[s][a];
      if (t !== undefined && adj[t] && t !== s) { adj[s].add(t); adj[t].add(s); }
    }));
    const rowOf = (col) => {
      const r = new Map();
      col.forEach((s, i) => r.set(s, i + (maxRows - col.length) / 2));
      return r;
    };
    const reorder = (col, ref) => {
      const refRow = rowOf(ref), ownRow = rowOf(col);
      return col.map((s, i) => {
        const ns = [...adj[s]].filter((n) => refRow.has(n));
        return { s, i, k: ns.length ? ns.reduce((sum, n) => sum + refRow.get(n), 0) / ns.length : ownRow.get(s) };
      }).sort((x, y) => x.k - y.k || x.i - y.i).map((e) => e.s);
    };
    for (let sweep = 0; sweep < 2; sweep++) {
      for (let i = 1; i < cols.length; i++) cols[i] = reorder(cols[i], cols[i - 1]);
      for (let i = cols.length - 2; i >= 0; i--) cols[i] = reorder(cols[i], cols[i + 1]);
    }

    const pos = {};
    cols.forEach((col, ci) => {
      col.forEach((s, ri) => {
        pos[s] = { x: 90 + ci * COL_W, y: 90 + (ri + (maxRows - col.length) / 2) * ROW_H, r: radius(m, s) };
      });
    });
    return pos;
  }

  /* Put a self-loop on the side (up/down/right/left) farthest from this node's other edges. */
  function loopAngle(s, edges, pos, isStart) {
    const p = pos[s], used = [];
    for (const k in edges) {
      const e = edges[k];
      if (e.from === e.to) continue;
      const other = e.from === s ? e.to : e.to === s ? e.from : null;
      if (other) used.push(Math.atan2(pos[other].y - p.y, pos[other].x - p.x));
    }
    if (isStart) used.push(Math.PI); // start arrow comes from the left
    let best = -Math.PI / 2, bestGap = -1;
    [-Math.PI / 2, Math.PI / 2, 0, Math.PI].forEach((c) => {
      const gap = Math.min(...used.map((u) => {
        const d = Math.abs(c - u) % (2 * Math.PI);
        return d > Math.PI ? 2 * Math.PI - d : d;
      }), Math.PI);
      if (gap > bestGap + 0.3) { best = c; bestGap = gap; }
    });
    return best;
  }

  /**
   * Draw machine m as an SVG state diagram into container (replacing its content). Layered layout:
   * column = BFS distance from the start; parallel edges are merged into one labelled arrow. Works on
   * partial machines too (missing transitions are simply not drawn). Never throws.
   * @param {HTMLElement} container
   * @param {import('../core/model.js').MealyMachine|import('../core/model.js').MooreMachine} m
   * @param {Object} [opts]
   * @param {string[][]} [opts.groups]   states to colour alike (e.g. the copies of one Mealy state)
   * @param {Set<string>} [opts.active]  states outlined in amber (what the current step is about)
   * @param {Set<string>} [opts.visited] states outlined in green (reached by a BFS)
   * @param {Set<string>} [opts.faded]   states drawn dashed and dimmed (removed)
   * @param {Array<{from: string, to: string}>} [opts.activeEdges]  edges drawn in amber
   * @returns {void}
   */
  function draw(container, m, opts = {}) {
    container.innerHTML = '';
    if (!m || !m.states.length) return;
    const id = 'g' + uid++;
    const moore = m.type === 'moore';
    const pos = layout(m);
    const colorOf = {};
    (opts.groups || []).forEach((g, gi) => g.forEach((s) => { colorOf[s] = gi % FILLS.length; }));
    const active = opts.active || new Set(), visited = opts.visited || new Set(), faded = opts.faded || new Set();
    const hotEdge = {};
    (opts.activeEdges || []).forEach((e) => { hotEdge[e.from + '\u0000' + e.to] = true; });

    const svg = el('svg', { class: 'dfa-svg', role: 'img', 'aria-label': (moore ? 'Moore' : 'Mealy') + ' machine state diagram' });
    const defs = el('defs', {}, svg);
    [['n', EDGE], ['h', HOT]].forEach(([k, color]) => {
      const mk = el('marker', { id: id + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }, mk);
    });

    // Merge parallel edges: one arrow per (from, to) labelled "0/1, 1/0" (Mealy) or "0, 1" (Moore).
    const edges = {}, order = [];
    m.states.forEach((s) => {
      m.inputs.forEach((a) => {
        const t = m.delta[s] && m.delta[s][a];
        if (t === undefined || !pos[t]) return;
        const k = s + '\u0000' + t;
        if (!edges[k]) { edges[k] = { from: s, to: t, labels: [] }; order.push(k); }
        edges[k].labels.push(moore ? a : a + '/' + m.lambda[s][a]);
      });
    });

    const gEdges = el('g', {}, svg), gNodes = el('g', {}, svg);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };

    order.forEach((k) => {
      const e = edges[k], p = pos[e.from], q = pos[e.to];
      const hot = hotEdge[k], dim = faded.has(e.from) || faded.has(e.to);
      const cls = 'edge' + (hot ? ' hot' : '') + (dim ? ' dim' : '');
      let d, lx, ly;
      if (e.from === e.to) {
        const th = loopAngle(e.from, edges, pos, e.from === m.start);
        const pt = (ang, dist) => [p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist];
        const s0 = pt(th - 0.4, p.r), e0 = pt(th + 0.4, p.r + 2), c1 = pt(th - 0.6, p.r + 58), c2 = pt(th + 0.6, p.r + 58);
        d = 'M' + s0 + ' C' + c1 + ' ' + c2 + ' ' + e0;
        [lx, ly] = pt(th, p.r + 56);
      } else {
        const dx = q.x - p.x, dy = q.y - p.y, dist = Math.sqrt(dx * dx + dy * dy);
        const nx = -dy / dist, ny = dx / dist;
        let bend = edges[e.to + '\u0000' + e.from] ? 28 : 0;
        if (dist > COL_W * 1.3 || dx < 0) bend = Math.max(bend, 0.2 * dist);
        const cx = (p.x + q.x) / 2 + nx * bend, cy = (p.y + q.y) / 2 + ny * bend;
        const a1 = Math.atan2(cy - p.y, cx - p.x), a2 = Math.atan2(cy - q.y, cx - q.x);
        const sx = p.x + Math.cos(a1) * p.r, sy = p.y + Math.sin(a1) * p.r;
        const ex = q.x + Math.cos(a2) * (q.r + 2), ey = q.y + Math.sin(a2) * (q.r + 2);
        d = 'M' + sx + ',' + sy + ' Q' + cx + ',' + cy + ' ' + ex + ',' + ey;
        // label at t = 0.4 (not the midpoint) so two edges that cross in the middle don't stack labels
        lx = 0.36 * sx + 0.48 * cx + 0.16 * ex + nx * 9;
        ly = 0.36 * sy + 0.48 * cy + 0.16 * ey + ny * 9;
      }
      el('path', { d, class: cls, 'marker-end': 'url(#' + id + (hot ? 'h' : 'n') + ')' }, gEdges);
      const text = e.labels.join(', ');
      const t = el('text', { x: lx, y: ly + 4, class: 'edge-label' + (hot ? ' hot' : '') + (dim ? ' dim' : '') }, gEdges);
      t.textContent = text;
      const half = 6 + text.length * 4.6;
      grow(lx - half, ly - 12);
      grow(lx + half, ly + 12);
    });

    m.states.forEach((s) => {
      const p = pos[s], ci = colorOf[s];
      const g = el('g', { class: 'node' + (faded.has(s) ? ' dim' : '') }, gNodes);
      const fill = ci !== undefined ? FILLS[ci] : NODE_FILL;
      const stroke = active.has(s) ? HOT : visited.has(s) ? VISITED : ci !== undefined ? STROKES[ci] : EDGE;
      const sw = active.has(s) ? 4 : visited.has(s) ? 3 : 2;
      el('circle', { cx: p.x, cy: p.y, r: p.r, fill, stroke, 'stroke-width': sw, 'stroke-dasharray': faded.has(s) ? '5 4' : 'none' }, g);
      const label = el('text', { x: p.x, y: p.y + (moore ? -1 : 6), class: 'node-label' }, g);
      label.textContent = s;
      if (moore) {
        const out = el('text', { x: p.x, y: p.y + 17, class: 'node-out' }, g);
        out.textContent = 'λ′ = ' + m.out[s];
      }
      if (s === m.start) {
        el('line', { x1: p.x - p.r - 40, y1: p.y, x2: p.x - p.r - 3, y2: p.y, class: 'edge start', 'marker-end': 'url(#' + id + 'n)' }, g);
        const st = el('text', { x: p.x - p.r - 44, y: p.y - 8, class: 'start-label' }, g);
        st.textContent = 'start';
      }
      grow(p.x - p.r - 60, p.y - p.r - 72);
      grow(p.x + p.r + 72, p.y + p.r + 72);
    });

    const pad = 10;
    const width = maxX - minX + 2 * pad;
    svg.setAttribute('viewBox', (minX - pad) + ' ' + (minY - pad) + ' ' + width + ' ' + (maxY - minY + 2 * pad));
    // Large machines: never scale below 70 % (labels stay ≥ ~12 px); the stage scrolls instead.
    if (width > 800) {
      svg.style.minWidth = Math.round(width * 0.7) + 'px';
      svg.style.maxHeight = 'none';
    }
    container.appendChild(svg);
  }

  /**
   * Make a self-contained copy of a diagram for download. The page styles the diagram with CSS
   * classes and variables, which a standalone file would not have, so every element's computed
   * paint and font properties are copied onto it as attributes, and the stage colour is added as
   * a background rectangle.
   * @param {SVGSVGElement} svg  a diagram produced by draw() and currently in the document
   * @returns {{text: string, width: number, height: number}}  SVG source and its viewBox size
   * @throws {Error} if svg has no viewBox (i.e. was not produced by draw())
   */
  function toStandaloneSvg(svg) {
    const box = (svg.getAttribute('viewBox') || '').split(' ').map(Number);
    if (box.length !== 4) throw new Error('Not a diagram drawn by graph.js');
    const [x, y, width, height] = box;
    const copy = svg.cloneNode(true);
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size',
      'font-style', 'font-weight', 'text-anchor', 'paint-order'];
    const from = svg.querySelectorAll('*'), to = copy.querySelectorAll('*');
    from.forEach((el, i) => {
      const cs = getComputedStyle(el);
      props.forEach((p) => to[i].setAttribute(p, cs.getPropertyValue(p)));
    });
    const bg = document.createElementNS(NS, 'rect');
    [['x', x], ['y', y], ['width', width], ['height', height]].forEach(([k, v]) => bg.setAttribute(k, v));
    bg.setAttribute('fill', getComputedStyle(svg.parentElement).backgroundColor);
    copy.insertBefore(bg, copy.firstChild);
    copy.removeAttribute('style');
    copy.setAttribute('xmlns', NS);
    copy.setAttribute('width', width);
    copy.setAttribute('height', height);
    return { text: new XMLSerializer().serializeToString(copy), width, height };
  }

  root.MMGraph = { draw, toStandaloneSvg, FILLS, STROKES };
})(this);
