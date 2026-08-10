/**
 * shapes.js — the 4D shape library.
 *
 * Every builder returns { verts, edges, tris, radius }:
 *   verts  Float32Array, 4 floats per vertex (x, y, z, w)
 *   edges  Uint32Array, 2 indices per edge          → rendered as lines
 *   tris   Uint32Array | null, 3 indices per face   → used by the slicer
 *   radius max |v|, used to normalize the w → color mapping
 *
 * Shapes are normalized to a common radius so switching shapes keeps a
 * consistent scale and color range.
 *
 * Construction techniques:
 *   • Regular polytopes: exact vertex coordinates + "minimum distance" edge
 *     rule (in a regular/uniform polytope every edge is a closest pair).
 *   • Faces of simplex-faced polytopes: 3-cliques of the edge graph.
 *   • Curved manifolds: parametric (u,v) grids and curves.
 */

const PHI = (1 + Math.sqrt(5)) / 2;
const TAU = Math.PI * 2;

// ───────────────────────────── helpers ─────────────────────────────

function key4(v) {
  return v.map((x) => Math.round(x * 1e6) / 1e6).join(',');
}

/** Deduplicate a list of [x,y,z,w] vertices. */
function dedup(verts) {
  const seen = new Map();
  const out = [];
  for (const v of verts) {
    const k = key4(v);
    if (!seen.has(k)) {
      seen.set(k, out.length);
      out.push(v);
    }
  }
  return out;
}

/** Connect every pair of vertices at (approximately) the minimum distance. */
function minDistEdges(verts) {
  let min = Infinity;
  const n = verts.length;
  const d2 = (a, b) => {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2], dw = a[3] - b[3];
    return dx * dx + dy * dy + dz * dz + dw * dw;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = d2(verts[i], verts[j]);
      if (d > 1e-9 && d < min) min = d;
    }
  }
  const edges = [];
  const limit = min * 1.02;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (d2(verts[i], verts[j]) <= limit) edges.push(i, j);
    }
  }
  return edges;
}

/** All triangles (3-cliques) of an edge graph — the faces of simplex-faced polytopes. */
function triCliques(nVerts, edges) {
  const adj = Array.from({ length: nVerts }, () => new Set());
  for (let e = 0; e < edges.length; e += 2) {
    adj[edges[e]].add(edges[e + 1]);
    adj[edges[e + 1]].add(edges[e]);
  }
  const tris = [];
  for (let e = 0; e < edges.length; e += 2) {
    const i = edges[e], j = edges[e + 1];
    for (const k of adj[i]) {
      if (k > j && adj[j].has(k)) tris.push(i, j, k);
    }
  }
  return tris;
}

/** All permutations of `arr`, with parity. */
function permutations(arr) {
  const out = [];
  const recurse = (rest, acc, parity) => {
    if (!rest.length) { out.push({ p: acc, even: parity % 2 === 0 }); return; }
    for (let i = 0; i < rest.length; i++) {
      recurse(rest.slice(0, i).concat(rest.slice(i + 1)), acc.concat(rest[i]), parity + i);
    }
  };
  recurse(arr, [], 0);
  return out;
}

/** Expand a coordinate template over permutations and all sign choices. */
function signedPerms(template, { evenOnly = false } = {}) {
  const verts = [];
  for (const { p, even } of permutations(template)) {
    if (evenOnly && !even) continue;
    for (let mask = 0; mask < 16; mask++) {
      verts.push(p.map((x, i) => (mask & (1 << i) ? -x : x)));
    }
  }
  return dedup(verts);
}

/**
 * Parametric surface → wireframe grid + triangles.
 * f(u, v) → [x, y, z, w];  u ∈ [u0, u1], v ∈ [v0, v1].
 * wrapU/wrapV close the surface in that direction.
 */
function gridSurface(f, { nu, nv, u0 = 0, u1 = TAU, v0 = 0, v1 = TAU, wrapU = false, wrapV = false }) {
  const cols = wrapU ? nu : nu + 1;
  const rows = wrapV ? nv : nv + 1;
  const verts = [];
  for (let iu = 0; iu < cols; iu++) {
    const u = u0 + ((u1 - u0) * iu) / nu;
    for (let iv = 0; iv < rows; iv++) {
      const v = v0 + ((v1 - v0) * iv) / nv;
      verts.push(f(u, v));
    }
  }
  const idx = (iu, iv) => (iu % cols) * rows + (iv % rows);
  const edges = [];
  const tris = [];
  for (let iu = 0; iu < cols; iu++) {
    for (let iv = 0; iv < rows; iv++) {
      const hasU = wrapU || iu < cols - 1;
      const hasV = wrapV || iv < rows - 1;
      if (hasU) edges.push(idx(iu, iv), idx(iu + 1, iv));
      if (hasV) edges.push(idx(iu, iv), idx(iu, iv + 1));
      if (hasU && hasV) {
        const a = idx(iu, iv), b = idx(iu + 1, iv), c = idx(iu + 1, iv + 1), d = idx(iu, iv + 1);
        tris.push(a, b, c, a, c, d);
      }
    }
  }
  return { verts, edges, tris };
}

/** Parametric curve → polyline. */
function paramCurve(f, { n, t0 = 0, t1 = TAU, closed = true }) {
  const count = closed ? n : n + 1;
  const verts = [];
  for (let i = 0; i < count; i++) verts.push(f(t0 + ((t1 - t0) * i) / n));
  const edges = [];
  for (let i = 0; i < count - 1; i++) edges.push(i, i + 1);
  if (closed) edges.push(count - 1, 0);
  return { verts, edges, tris: [] };
}

/** Merge several {verts, edges, tris} parts into one. */
function merge(...parts) {
  const verts = [], edges = [], tris = [];
  for (const p of parts) {
    const off = verts.length;
    verts.push(...p.verts);
    for (const e of p.edges) edges.push(e + off);
    for (const t of p.tris || []) tris.push(t + off);
  }
  return { verts, edges, tris };
}

const TARGET_RADIUS = 1.5;

/** Package + scale a raw shape to the common radius. */
function finalize({ verts, edges, tris }) {
  let maxR = 0;
  for (const v of verts) maxR = Math.max(maxR, Math.hypot(v[0], v[1], v[2], v[3]));
  const s = maxR > 1e-9 ? TARGET_RADIUS / maxR : 1;
  const flat = new Float32Array(verts.length * 4);
  verts.forEach((v, i) => {
    flat[i * 4] = v[0] * s; flat[i * 4 + 1] = v[1] * s;
    flat[i * 4 + 2] = v[2] * s; flat[i * 4 + 3] = v[3] * s;
  });
  return {
    verts: flat,
    edges: new Uint32Array(edges),
    tris: tris && tris.length ? new Uint32Array(tris) : null,
    radius: TARGET_RADIUS,
  };
}

// ─────────────────────── regular polytope builders ───────────────────────

function build5Cell() {
  // Regular 4-simplex: all pairwise distances 2√2.
  const s5 = Math.sqrt(5);
  const verts = [
    [1, 1, 1, -1 / s5],
    [1, -1, -1, -1 / s5],
    [-1, 1, -1, -1 / s5],
    [-1, -1, 1, -1 / s5],
    [0, 0, 0, 4 / s5],
  ];
  const edges = minDistEdges(verts);
  return { verts, edges, tris: triCliques(5, edges) };
}

function buildTesseract() {
  const verts = [];
  for (let m = 0; m < 16; m++) {
    verts.push([m & 1 ? 1 : -1, m & 2 ? 1 : -1, m & 4 ? 1 : -1, m & 8 ? 1 : -1]);
  }
  const edges = minDistEdges(verts); // Hamming-distance-1 pairs
  // square faces: fix two axes, vary the other two
  const tris = [];
  const idxOf = (v) => verts.findIndex((u) => u.every((x, i) => x === v[i]));
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      const rest = [0, 1, 2, 3].filter((c) => c !== a && c !== b);
      for (const s0 of [-1, 1]) for (const s1 of [-1, 1]) {
        const corner = (va, vb) => {
          const v = [0, 0, 0, 0];
          v[rest[0]] = s0; v[rest[1]] = s1; v[a] = va; v[b] = vb;
          return idxOf(v);
        };
        const p = corner(-1, -1), q = corner(1, -1), r = corner(1, 1), t = corner(-1, 1);
        tris.push(p, q, r, p, r, t);
      }
    }
  }
  return { verts, edges, tris };
}

function build16Cell() {
  const verts = [];
  for (let axis = 0; axis < 4; axis++) for (const s of [1, -1]) {
    const v = [0, 0, 0, 0]; v[axis] = s; verts.push(v);
  }
  const edges = minDistEdges(verts);
  return { verts, edges, tris: triCliques(8, edges) };
}

function build24Cell() {
  const verts = signedPerms([1, 1, 0, 0]);
  const edges = minDistEdges(verts);
  return { verts, edges, tris: triCliques(verts.length, edges) };
}

function build600Cell() {
  const verts = dedup([
    ...signedPerms([0.5, 0.5, 0.5, 0.5]),
    ...signedPerms([1, 0, 0, 0]),
    ...signedPerms([PHI / 2, 0.5, 1 / (2 * PHI), 0], { evenOnly: true }),
  ]);
  const edges = minDistEdges(verts);
  return { verts, edges, tris: triCliques(verts.length, edges) };
}

function build120Cell() {
  const s5 = Math.sqrt(5);
  const verts = dedup([
    ...signedPerms([0, 0, 2, 2]),
    ...signedPerms([1, 1, 1, s5]),
    ...signedPerms([1 / (PHI * PHI), PHI, PHI, PHI]),
    ...signedPerms([1 / PHI, 1 / PHI, 1 / PHI, PHI * PHI]),
    ...signedPerms([0, 1 / (PHI * PHI), 1, PHI * PHI], { evenOnly: true }),
    ...signedPerms([0, 1 / PHI, PHI, s5], { evenOnly: true }),
    ...signedPerms([1 / PHI, 1, PHI, 2], { evenOnly: true }),
  ]);
  const edges = minDistEdges(verts);
  return { verts, edges, tris: null }; // pentagonal faces — slicer uses edge points
}

/** Rectification: vertices at the midpoints of another polytope's edges. */
function rectify(builder) {
  const { verts, edges } = builder();
  const mids = [];
  for (let e = 0; e < edges.length; e += 2) {
    const a = verts[edges[e]], b = verts[edges[e + 1]];
    mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2]);
  }
  const v = dedup(mids);
  const newEdges = minDistEdges(v);
  return { verts: v, edges: newEdges, tris: triCliques(v.length, newEdges) };
}

// ───────────────────── prisms, duoprisms, products ─────────────────────

function buildDuoprism(p, q) {
  const verts = [];
  for (let i = 0; i < p; i++) for (let j = 0; j < q; j++) {
    verts.push([Math.cos((TAU * i) / p), Math.sin((TAU * i) / p),
                Math.cos((TAU * j) / q), Math.sin((TAU * j) / q)]);
  }
  const idx = (i, j) => ((i % p + p) % p) * q + ((j % q + q) % q);
  const edges = [], tris = [];
  for (let i = 0; i < p; i++) for (let j = 0; j < q; j++) {
    edges.push(idx(i, j), idx(i + 1, j));
    edges.push(idx(i, j), idx(i, j + 1));
    // square side faces
    tris.push(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1),
              idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
  }
  // polygon faces (fans) — one p-gon per j, one q-gon per i
  for (let j = 0; j < q; j++) for (let i = 1; i < p - 1; i++) {
    tris.push(idx(0, j), idx(i, j), idx(i + 1, j));
  }
  for (let i = 0; i < p; i++) for (let j = 1; j < q - 1; j++) {
    tris.push(idx(i, 0), idx(i, j), idx(i, j + 1));
  }
  return { verts, edges, tris };
}

// 3D seed polyhedra for prisms (verts + optional triangulated faces)
function poly3Tetra() {
  const verts = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((v) => v.map((x) => x * 0.75));
  return { verts, faces: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] };
}
function poly3Octa() {
  const verts = [];
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) { const v = [0, 0, 0]; v[a] = s * 1.1; verts.push(v); }
  const faces = [];
  for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) {
    faces.push([0 + sx, 2 + sy, 4 + sz]);
  }
  return { verts, faces };
}
function cyclicPerms(v) { return [v, [v[1], v[2], v[0]], [v[2], v[0], v[1]]]; }
function poly3Icosa() {
  const raw = [];
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
    for (const c of cyclicPerms([0, s1, s2 * PHI])) raw.push(c);
  }
  const verts = dedup(raw.map((v) => [...v, 0])).map((v) => v.slice(0, 3).map((x) => x * 0.55));
  const flat4 = verts.map((v) => [...v, 0]);
  const edges = minDistEdges(flat4);
  const tris = triCliques(verts.length, edges);
  const faces = [];
  for (let t = 0; t < tris.length; t += 3) faces.push([tris[t], tris[t + 1], tris[t + 2]]);
  return { verts, faces };
}
function poly3Dodeca() {
  const raw = [];
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) raw.push([sx, sy, sz]);
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
    for (const c of cyclicPerms([0, s1 / PHI, s2 * PHI])) raw.push(c);
  }
  const verts = dedup(raw.map((v) => [...v, 0])).map((v) => v.slice(0, 3).map((x) => x * 0.62));
  return { verts, faces: null }; // pentagonal faces left untriangulated
}

/** polyhedron × line segment → 4D prism */
function buildPrism(poly, h = 0.75) {
  const { verts: v3, faces } = poly;
  const flat4 = v3.map((v) => [...v, 0]);
  const e3 = minDistEdges(flat4);
  const n = v3.length;
  const verts = [
    ...v3.map((v) => [...v, -h]),
    ...v3.map((v) => [...v, h]),
  ];
  const edges = [];
  for (let e = 0; e < e3.length; e += 2) {
    edges.push(e3[e], e3[e + 1]);            // bottom copy
    edges.push(e3[e] + n, e3[e + 1] + n);    // top copy
  }
  for (let i = 0; i < n; i++) edges.push(i, i + n); // laterals
  const tris = [];
  if (faces) {
    for (const f of faces) {
      tris.push(f[0], f[1], f[2], f[0] + n, f[1] + n, f[2] + n);
    }
  }
  for (let e = 0; e < e3.length; e += 2) {
    const a = e3[e], b = e3[e + 1];
    tris.push(a, b, b + n, a, b + n, a + n); // side quads
  }
  return { verts, edges, tris };
}

// ─────────────────────── curved manifold builders ───────────────────────

function buildCliffordTorus(balance, res) {
  const rho = (balance * Math.PI) / 2;
  const r1 = Math.cos(rho), r2 = Math.sin(rho);
  return gridSurface(
    (u, v) => [r1 * Math.cos(u), r1 * Math.sin(u), r2 * Math.cos(v), r2 * Math.sin(v)],
    { nu: res, nv: res, wrapU: true, wrapV: true },
  );
}

function buildKleinBottle(res) {
  // The classic *embedding* in R⁴ — unlike in 3D, it never passes through itself.
  const R = 1, r = 0.45;
  // u runs 0..2π inclusive: the seam column lands exactly on the u=0 column
  // (with v reversed), so the surface closes up visually.
  return gridSurface(
    (u, v) => [
      (R + r * Math.cos(v)) * Math.cos(u),
      (R + r * Math.cos(v)) * Math.sin(u),
      r * Math.sin(v) * Math.cos(u / 2),
      r * Math.sin(v) * Math.sin(u / 2),
    ],
    { nu: res, nv: Math.round(res * 0.6), wrapU: false, wrapV: true },
  );
}

/** Fibonacci-distributed points on the 2-sphere. */
function fibonacciSphere(n) {
  const pts = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pts.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return pts;
}

function buildHopf(nFibers, segs = 60) {
  // For each base point on S², its Hopf fiber is a great circle on S³.
  const parts = [];
  for (const [a, b, c] of fibonacciSphere(nFibers)) {
    const alpha = Math.sqrt((1 + c) / 2);
    const beta = Math.sqrt(Math.max(0, (1 - c) / 2));
    const gamma = Math.atan2(b, a);
    parts.push(paramCurve(
      (t) => [
        alpha * Math.cos(t), alpha * Math.sin(t),
        beta * Math.cos(t - gamma), beta * Math.sin(t - gamma),
      ],
      { n: segs, closed: true },
    ));
  }
  return merge(...parts);
}

function buildSphereGrid(nu, nv, scale, w) {
  return gridSurface(
    (u, v) => [
      scale * Math.cos(v) * Math.cos(u),
      scale * Math.sin(v),
      scale * Math.cos(v) * Math.sin(u),
      w,
    ],
    { nu, nv, u0: 0, u1: TAU, v0: -Math.PI / 2, v1: Math.PI / 2, wrapU: true, wrapV: false },
  );
}

function buildSpherinder() {
  const h = 0.6, nu = 20, nv = 10;
  const bottom = buildSphereGrid(nu, nv, 1, -h);
  const top = buildSphereGrid(nu, nv, 1, h);
  const shape = merge(bottom, top);
  // laterals: grids share topology, so vertex k on the bottom ↔ k + offset on top
  const rows = nv + 1, cols = nu;
  const off = bottom.verts.length;
  for (let iu = 0; iu < cols; iu += 5) {
    for (let iv = 0; iv <= nv; iv += 2) {
      const k = iu * rows + iv;
      shape.edges.push(k, k + off);
    }
  }
  return shape;
}

function buildHypercone() {
  const base = buildSphereGrid(20, 10, 1, -0.6);
  const mid1 = buildSphereGrid(14, 7, 0.66, -0.1);
  const mid2 = buildSphereGrid(14, 7, 0.33, 0.4);
  const apex = { verts: [[0, 0, 0, 0.9]], edges: [], tris: [] };
  const shape = merge(base, mid1, mid2, apex);
  const apexIdx = shape.verts.length - 1;
  const rows = 11;
  for (let iu = 0; iu < 20; iu += 2) {
    for (let iv = 0; iv <= 10; iv += 2) {
      shape.edges.push(iu * rows + iv, apexIdx);
    }
  }
  return shape;
}

// ─────────────── complex-function graphs (Riemann surfaces) ───────────────
// The graph of f: ℂ → ℂ is the surface (Re z, Im z, Re f, Im f) ⊂ ℝ⁴.
// Multi-valued functions (√z, log z) self-intersect in any 3D picture but
// embed cleanly here — the w axis (color) separates the sheets.

function complexGraph(f, opts) {
  return gridSurface((u, v) => {
    const [x, y] = opts.polar ? [u * Math.cos(v), u * Math.sin(v)] : [u, v];
    const [re, im] = f(x, y, u, v);
    return [x, y, re, im];
  }, opts);
}

const COMPLEX_SHAPES = {
  zsquared: {
    f: (x, y) => [x * x - y * y, 2 * x * y],
    opts: { nu: 36, nv: 36, u0: -1.3, u1: 1.3, v0: -1.3, v1: 1.3 },
  },
  zcubed: {
    f: (x, y) => [x ** 3 - 3 * x * y * y, 3 * x * x * y - y ** 3],
    opts: { nu: 36, nv: 36, u0: -1.2, u1: 1.2, v0: -1.2, v1: 1.2 },
  },
  sqrtz: {
    // θ runs 0..4π: the two sheets of √z close into one surface
    f: (x, y, r, th) => [Math.sqrt(r) * Math.cos(th / 2), Math.sqrt(r) * Math.sin(th / 2)],
    opts: { nu: 24, nv: 72, u0: 0.02, u1: 1.4, v0: 0, v1: 2 * TAU, wrapV: true, polar: true },
  },
  logz: {
    // θ runs -3π..3π: the infinite spiral staircase of branches (truncated)
    f: (x, y, r, th) => [Math.log(r) * 0.6, th * 0.35],
    opts: { nu: 18, nv: 96, u0: 0.2, u1: 1.4, v0: -3 * Math.PI, v1: 3 * Math.PI, polar: true },
  },
  invz: {
    f: (x, y) => { const d = x * x + y * y; return [x / d, -y / d]; },
    opts: { nu: 20, nv: 48, u0: 0.4, u1: 1.5, v0: 0, v1: TAU, wrapV: true, polar: true },
  },
  expz: {
    f: (x, y) => [Math.exp(x) * Math.cos(y), Math.exp(x) * Math.sin(y)],
    opts: { nu: 30, nv: 40, u0: -1.2, u1: 1.2, v0: -Math.PI, v1: Math.PI, wrapV: true },
  },
  sinz: {
    f: (x, y) => [Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y)],
    opts: { nu: 40, nv: 24, u0: -Math.PI, u1: Math.PI, v0: -1.2, v1: 1.2, wrapU: true },
  },
};

// ───────────────────────────── the registry ─────────────────────────────

const G = {
  REGULAR: 'Regular polytopes',
  MODIFIED: 'Rectified polytopes',
  PRODUCTS: 'Prisms & products',
  CURVED: 'Curved manifolds',
  COMPLEX: 'Riemann surfaces',
  CURVES: '4D curves',
};

export const SHAPES = [
  {
    id: '5cell', name: '5-Cell', group: G.REGULAR,
    cells: '5 tetrahedral cells',
    blurb: 'The 4-simplex — the simplest possible 4D shape, the tetrahedron\'s big sibling. Every vertex touches every other.',
    build: () => build5Cell(),
  },
  {
    id: 'tesseract', name: 'Tesseract (8-Cell)', group: G.REGULAR,
    cells: '8 cubic cells',
    blurb: 'The 4D cube. Watch a face pass "through" the middle during a 4D rotation — that\'s a whole cube moving along w, shown here as a color sweep.',
    build: () => buildTesseract(),
  },
  {
    id: '16cell', name: '16-Cell', group: G.REGULAR,
    cells: '16 tetrahedral cells',
    blurb: 'The 4D octahedron: one vertex out along each semi-axis, including ±w. The two "extra" vertices only differ from the rest by color.',
    build: () => build16Cell(),
  },
  {
    id: '24cell', name: '24-Cell', group: G.REGULAR,
    cells: '24 octahedral cells',
    blurb: 'The one with no 3D analogue at all — self-dual, made of octahedra, and it only exists in exactly four dimensions.',
    build: () => build24Cell(),
  },
  {
    id: '600cell', name: '600-Cell', group: G.REGULAR,
    cells: '600 tetrahedral cells',
    blurb: 'The 4D icosahedron: 120 vertices, 720 edges, 600 tetrahedra. Its vertices form the icosian group — quaternions hiding in plain sight.',
    build: () => build600Cell(),
  },
  {
    id: '120cell', name: '120-Cell', group: G.REGULAR,
    cells: '120 dodecahedral cells',
    blurb: 'The 4D dodecahedron: 600 vertices and 1200 edges of pure golden-ratio geometry. The most intricate regular shape in any dimension.',
    build: () => build120Cell(),
  },
  {
    id: 'rect-tesseract', name: 'Rectified Tesseract', group: G.MODIFIED,
    cells: '8 cuboctahedra + 16 tetrahedra',
    blurb: 'Slice every corner of the tesseract down to the edge midpoints and this is what remains.',
    build: () => rectify(buildTesseract),
  },
  {
    id: 'rect-5cell', name: 'Rectified 5-Cell', group: G.MODIFIED,
    cells: '5 tetrahedra + 5 octahedra',
    blurb: 'Edge midpoints of the 5-cell. Ten vertices, thirty edges, and two kinds of cell.',
    build: () => rectify(build5Cell),
  },
  {
    id: 'rect-600cell', name: 'Rectified 600-Cell', group: G.MODIFIED,
    cells: '600 tetrahedra + 120 icosahedra',
    blurb: '720 vertices and 3600 edges — a glittering shell of icosahedra and octahedra-like cells. Turn the bloom up.',
    build: () => rectify(build600Cell),
  },
  {
    id: 'duoprism', name: 'Duoprism p×q', group: G.PRODUCTS,
    cells: 'p q-gonal prisms + q p-gonal prisms',
    blurb: 'The product of two flat polygons living in perpendicular planes — a shape with no shadow in 3D. Try 3×3, or crank both up.',
    params: [
      { key: 'p', label: 'p (first polygon)', min: 3, max: 16, step: 1, def: 6 },
      { key: 'q', label: 'q (second polygon)', min: 3, max: 16, step: 1, def: 6 },
    ],
    build: ({ p, q }) => buildDuoprism(p, q),
  },
  {
    id: 'tetra-prism', name: 'Tetrahedral Prism', group: G.PRODUCTS,
    cells: '2 tetrahedra + 4 triangular prisms',
    blurb: 'A tetrahedron extruded along w: two identical tetrahedra, one "past" and one "future", joined by prisms.',
    build: () => buildPrism(poly3Tetra()),
  },
  {
    id: 'octa-prism', name: 'Octahedral Prism', group: G.PRODUCTS,
    cells: '2 octahedra + 8 triangular prisms',
    blurb: 'An octahedron extruded along the w axis. The cube prism, by the way, is the tesseract itself.',
    build: () => buildPrism(poly3Octa()),
  },
  {
    id: 'icosa-prism', name: 'Icosahedral Prism', group: G.PRODUCTS,
    cells: '2 icosahedra + 20 triangular prisms',
    blurb: 'Two icosahedra separated only in the 4th dimension — same place in x, y, z, different color.',
    build: () => buildPrism(poly3Icosa()),
  },
  {
    id: 'dodeca-prism', name: 'Dodecahedral Prism', group: G.PRODUCTS,
    cells: '2 dodecahedra + 12 pentagonal prisms',
    blurb: 'A dodecahedron dragged through the 4th dimension.',
    build: () => buildPrism(poly3Dodeca()),
  },
  {
    id: 'hopf', name: 'Hypersphere (Hopf Fibration)', group: G.CURVED,
    cells: 'S³ = a sphere of spheres of circles',
    blurb: 'The 3-sphere, drawn as its Hopf fibers: every circle links every other exactly once, and no two ever touch. Possibly the most beautiful object in mathematics.',
    params: [
      { key: 'fibers', label: 'Fibers', min: 12, max: 240, step: 4, def: 96 },
    ],
    build: ({ fibers }) => buildHopf(fibers),
  },
  {
    id: 'clifford', name: 'Clifford Torus', group: G.CURVED,
    cells: 'flat torus on S³',
    blurb: 'A torus with zero intrinsic curvature — perfectly flat, like a video-game world where walking off one edge re-enters the other. It can only be built in 4D.',
    params: [
      { key: 'balance', label: 'Radius balance', min: 0.15, max: 0.85, step: 0.01, def: 0.5 },
      { key: 'res', label: 'Grid resolution', min: 12, max: 64, step: 2, def: 40 },
    ],
    build: ({ balance, res }) => buildCliffordTorus(balance, res),
  },
  {
    id: 'klein', name: 'Klein Bottle', group: G.CURVED,
    cells: 'non-orientable surface',
    blurb: 'In 3D the Klein bottle must pass through itself. In 4D it doesn\'t — the "neck" dodges the wall by moving in w. Watch the colors where the 3D version would collide.',
    params: [
      { key: 'res', label: 'Resolution', min: 20, max: 72, step: 2, def: 48 },
    ],
    build: ({ res }) => buildKleinBottle(res),
  },
  {
    id: 'spherinder', name: 'Spherinder', group: G.CURVED,
    cells: 'sphere × line segment',
    blurb: 'A solid sphere extruded along w, the way a cylinder is a disk extruded along z. Two boundary spheres, identical except in color.',
    build: () => buildSpherinder(),
  },
  {
    id: 'hypercone', name: 'Hypercone', group: G.CURVED,
    cells: 'cone over a sphere',
    blurb: 'A sphere that shrinks to a point as it travels along the w axis — the 4D analogue of an ice-cream cone.',
    build: () => buildHypercone(),
  },
  {
    id: 'cx-sqrt', name: 'w = √z', group: G.COMPLEX,
    cells: 'Riemann surface, 2 sheets',
    blurb: 'The square root has two answers, so its graph is a two-sheeted surface that self-intersects in 3D. In 4D the sheets pass by cleanly — color keeps them apart.',
    build: () => complexGraph(COMPLEX_SHAPES.sqrtz.f, COMPLEX_SHAPES.sqrtz.opts),
  },
  {
    id: 'cx-log', name: 'w = log z', group: G.COMPLEX,
    cells: 'Riemann surface, ∞ sheets (3 shown)',
    blurb: 'The logarithm\'s infinite spiral staircase of branches. Height is |log z|\'s real part; the branch you\'re on is pure color.',
    build: () => complexGraph(COMPLEX_SHAPES.logz.f, COMPLEX_SHAPES.logz.opts),
  },
  {
    id: 'cx-square', name: 'w = z²', group: G.COMPLEX,
    cells: 'graph of a complex map',
    blurb: 'Every complex function is secretly a 4D surface: (Re z, Im z) in space, (Re f, Im f) shared between depth and color.',
    build: () => complexGraph(COMPLEX_SHAPES.zsquared.f, COMPLEX_SHAPES.zsquared.opts),
  },
  {
    id: 'cx-cube', name: 'w = z³', group: G.COMPLEX,
    cells: 'graph of a complex map',
    blurb: 'The cubing map wraps the plane around itself three times.',
    build: () => complexGraph(COMPLEX_SHAPES.zcubed.f, COMPLEX_SHAPES.zcubed.opts),
  },
  {
    id: 'cx-inv', name: 'w = 1/z', group: G.COMPLEX,
    cells: 'graph with a pole',
    blurb: 'Inversion turns the plane inside-out around the unit circle; the pole at the origin blasts off to infinity.',
    build: () => complexGraph(COMPLEX_SHAPES.invz.f, COMPLEX_SHAPES.invz.opts),
  },
  {
    id: 'cx-exp', name: 'w = eᶻ', group: G.COMPLEX,
    cells: 'graph of a complex map',
    blurb: 'The exponential rolls the whole plane into a cylinder — its imaginary period 2πi closes the surface in v.',
    build: () => complexGraph(COMPLEX_SHAPES.expz.f, COMPLEX_SHAPES.expz.opts),
  },
  {
    id: 'cx-sin', name: 'w = sin z', group: G.COMPLEX,
    cells: 'graph of a complex map',
    blurb: 'Sine, but fed complex numbers: the familiar wave in one direction, exponential growth in the other.',
    build: () => complexGraph(COMPLEX_SHAPES.sinz.f, COMPLEX_SHAPES.sinz.opts),
  },
  {
    id: 'torus-knot', name: '4D Torus Knot (p,q)', group: G.CURVES,
    cells: 'closed curve on the Clifford torus',
    blurb: 'A (p,q) knot wound around the Clifford torus, living directly on the 3-sphere. Coprime p and q give a single unbroken loop.',
    params: [
      { key: 'p', label: 'p (windings)', min: 1, max: 9, step: 1, def: 2 },
      { key: 'q', label: 'q (windings)', min: 1, max: 9, step: 1, def: 3 },
    ],
    build: ({ p, q }) => paramCurve(
      (t) => {
        const s = Math.SQRT1_2;
        return [s * Math.cos(p * t), s * Math.sin(p * t), s * Math.cos(q * t), s * Math.sin(q * t)];
      },
      { n: 1400, closed: true },
    ),
  },
  {
    id: 'lissajous', name: '4D Lissajous Curve', group: G.CURVES,
    cells: 'closed curve in ℝ⁴',
    blurb: 'Four independent oscillations, one per axis. Tune the frequencies to sculpt glowing knots that could not close up in 3D.',
    params: [
      { key: 'a', label: 'x frequency', min: 1, max: 9, step: 1, def: 3 },
      { key: 'b', label: 'y frequency', min: 1, max: 9, step: 1, def: 2 },
      { key: 'c', label: 'z frequency', min: 1, max: 9, step: 1, def: 5 },
      { key: 'd', label: 'w frequency', min: 1, max: 9, step: 1, def: 4 },
    ],
    build: ({ a, b, c, d }) => paramCurve(
      (t) => [Math.cos(a * t), Math.sin(b * t), Math.cos(c * t), Math.sin(d * t)],
      { n: 1600, closed: true },
    ),
  },
];

export function defaultParams(def) {
  const out = {};
  for (const p of def.params || []) out[p.key] = p.def;
  return out;
}

/** Build a shape by id (with optional param overrides) and finalize it. */
export function buildShape(id, params = {}) {
  const def = SHAPES.find((s) => s.id === id) || SHAPES[1];
  const merged = { ...defaultParams(def), ...params };
  const shape = finalize(def.build(merged));
  shape.def = def;
  shape.params = merged;
  return shape;
}
