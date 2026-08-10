/**
 * lab.js — the Shape Lab: a workspace for inventing your own 4D shapes.
 *
 * Two modes:
 *   🪄 Magic — no code. Pick a base, drag sliders, press 🎲. Every
 *      combination maps into a curated parametric family, so there are
 *      no failure states — a seven-year-old can drive it.
 *   👩‍💻 Code — write a tiny builder function with the same helpers the
 *      built-in library uses, run it, and see it live.
 *
 * Creations can be saved (localStorage) and shared (params/code packed
 * into the URL hash). Shared *code* is never auto-run — the recipient
 * sees it in the editor and must press Run themselves.
 */

import {
  finalize, gridSurface, paramCurve, merge, minDistEdges, triCliques, TAU, PHI,
} from './shapes.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'hypershape-lab';

// ───────────────────────── magic mode ─────────────────────────

const BASES = {
  donut: { emoji: '🍩', label: 'Donut' },
  ball: { emoji: '🔮', label: 'Ball' },
  star: { emoji: '💫', label: 'Star' },
  ribbon: { emoji: '🎀', label: 'Ribbon' },
};

// which sliders each base shows
const MAGIC_SLIDERS = {
  donut: [
    { key: 'waves', label: 'Waves', min: 0, max: 8, step: 1 },
    { key: 'twist', label: 'Twist', min: 0, max: 6, step: 1 },
    { key: 'wob', label: 'Wobble', min: 0, max: 0.6, step: 0.05 },
  ],
  ball: [
    { key: 'waves', label: 'Ripples', min: 0, max: 8, step: 1 },
    { key: 'twist', label: 'Twist', min: 0, max: 6, step: 1 },
    { key: 'wob', label: 'Ripple size', min: 0, max: 0.6, step: 0.05 },
  ],
  star: [
    { key: 'sides', label: 'Points', min: 3, max: 9, step: 1 },
    { key: 'waves', label: 'Waves', min: 0, max: 8, step: 1 },
    { key: 'wob', label: 'Wobble', min: 0, max: 0.6, step: 0.05 },
  ],
  ribbon: [
    { key: 'sides', label: 'Loops one way', min: 1, max: 8, step: 1 },
    { key: 'loops', label: 'Loops other way', min: 1, max: 8, step: 1 },
    { key: 'waves', label: 'Waves', min: 0, max: 9, step: 1 },
    { key: 'wob', label: 'Wobble', min: 0, max: 0.6, step: 0.05 },
  ],
};

function magicBuild(p) {
  const { base, sides, loops, twist, waves, wob } = p;
  if (base === 'donut') {
    return gridSurface((u, v) => {
      const r1 = 0.78 * (1 + wob * Math.cos(waves * u + twist * v));
      const r2 = 0.62 * (1 + wob * Math.sin(waves * v + twist * u));
      return [r1 * Math.cos(u), r1 * Math.sin(u), r2 * Math.cos(v), r2 * Math.sin(v)];
    }, { nu: 56, nv: 56, wrapU: true, wrapV: true });
  }
  if (base === 'ball') {
    return gridSurface((u, v) => {
      const R = 1 + wob * 0.35 * Math.cos(waves * u + twist * v);
      return [
        R * Math.cos(v) * Math.cos(u),
        R * Math.cos(v) * Math.sin(u),
        R * Math.sin(v),
        0.7 * Math.sin(waves * u + twist * v) * Math.cos(v),
      ];
    }, { nu: 48, nv: 24, u0: 0, u1: TAU, v0: -Math.PI / 2, v1: Math.PI / 2, wrapU: true });
  }
  if (base === 'star') {
    return gridSurface((u, v) => {
      const r1 = 0.8 * (1 + 0.35 * Math.cos(sides * u)) * (1 + wob * Math.cos(waves * v));
      const r2 = 0.55 * (1 + wob * Math.sin(waves * v + u));
      return [r1 * Math.cos(u), r1 * Math.sin(u), r2 * Math.cos(v), r2 * Math.sin(v)];
    }, { nu: Math.max(48, sides * 14), nv: 40, wrapU: true, wrapV: true });
  }
  // ribbon: a glowing closed curve
  return paramCurve((t) => {
    const r = 0.75 * (1 + wob * Math.cos(waves * t));
    return [
      r * Math.cos(sides * t), r * Math.sin(sides * t),
      0.75 * Math.cos(loops * t), 0.75 * Math.sin(loops * t),
    ];
  }, { n: 2600, closed: true });
}

const MAGIC_BLURBS = {
  donut: 'A homemade 4D donut, fresh from the Shape Lab.',
  ball: 'A ball wearing ripples of the fourth dimension.',
  star: 'A star spun through 4D space, made in the Shape Lab.',
  ribbon: 'A ribbon of light looping through all four dimensions.',
};

// ───────────────────────── code mode ─────────────────────────

const EXAMPLES = {
  'Two linked rings': `// Two circles in perpendicular planes.
// In 4D they link through each other without ever touching!
const ringA = paramCurve(t => [Math.cos(t), Math.sin(t), 0, 0], { n: 64 });
const ringB = paramCurve(t => [0, 0, Math.cos(t), Math.sin(t)], { n: 64 });
return merge(ringA, ringB);`,

  'Connect the dots': `// Place points, and minDistEdges connects every
// closest pair for you. These 8 points make the 16-cell —
// change them and invent your own polytope!
const verts = [];
for (let axis = 0; axis < 4; axis++) {
  for (const s of [1, -1]) {
    const v = [0, 0, 0, 0];
    v[axis] = s;
    verts.push(v);
  }
}
const edges = minDistEdges(verts);
// triangles let the CT-scan slicer cut it open
return { verts, edges, tris: triCliques(verts.length, edges) };`,

  'Wavy donut': `// gridSurface sweeps u and v over a grid and connects
// neighbors. Return [x, y, z, w] for each point.
const r = Math.SQRT1_2;
return gridSurface((u, v) => [
  (r + 0.15 * Math.cos(3 * v)) * Math.cos(u),
  (r + 0.15 * Math.cos(3 * v)) * Math.sin(u),
  r * Math.cos(v),
  r * Math.sin(v),
], { nu: 48, nv: 48, wrapU: true, wrapV: true });`,

  'Super spiral': `// A curve that spirals through all four dimensions.
return paramCurve(t => [
  Math.cos(t) * (1 - t / 60),
  Math.sin(t) * (1 - t / 60),
  Math.cos(t * 1.618) * (t / 60),
  Math.sin(t * 1.618) * (t / 60),
], { n: 3000, t0: 0, t1: 18 * Math.PI, closed: false });`,

  'Complex function z⁴': `// Every complex function is secretly a 4D surface:
// position = (Re z, Im z, Re f) and COLOR = Im f.
return gridSurface((x, y) => {
  const re = x**4 - 6*x*x*y*y + y**4;   // Re((x+iy)^4)
  const im = 4*x**3*y - 4*x*y**3;       // Im((x+iy)^4)
  return [x, y, re * 0.35, im * 0.35];
}, { nu: 40, nv: 40, u0: -1.2, u1: 1.2, v0: -1.2, v1: 1.2 });`,
};

function runUserCode(code) {
  const helpers = { gridSurface, paramCurve, merge, minDistEdges, triCliques, TAU, PHI };
  const fn = new Function(...Object.keys(helpers), `"use strict";\n${code}`);
  const result = fn(...Object.values(helpers));

  if (!result || !Array.isArray(result.verts) || result.verts.length === 0) {
    throw new Error('Your code must `return { verts, edges }` — verts is a list of [x, y, z, w] points.');
  }
  const verts = result.verts.map((v, i) => {
    if (!Array.isArray(v) || v.length !== 4 || v.some((x) => !Number.isFinite(x))) {
      throw new Error(`Point #${i} isn't 4 finite numbers — every vertex needs [x, y, z, w].`);
    }
    return v;
  });
  // accept flat index arrays or arrays of pairs/triples
  const flatten = (arr, width, what) => {
    if (!arr || arr.length === 0) return [];
    const flat = Array.isArray(arr[0]) ? arr.flat() : Array.from(arr);
    if (flat.length % width !== 0) throw new Error(`${what} must come in groups of ${width}.`);
    for (const i of flat) {
      if (!Number.isInteger(i) || i < 0 || i >= verts.length) {
        throw new Error(`${what} index ${i} doesn't match any vertex (you have ${verts.length}).`);
      }
    }
    return flat;
  };
  const edges = flatten(result.edges, 2, 'edges');
  const tris = flatten(result.tris, 3, 'tris');
  if (verts.length > 30000) throw new Error(`${verts.length} vertices is too many — keep it under 30,000.`);
  if (edges.length / 2 > 100000) throw new Error('Too many edges — keep it under 100,000.');
  if (edges.length === 0) throw new Error('No edges — nothing to draw! Add edges or use gridSurface / paramCurve.');
  return { verts, edges, tris };
}

// ───────────────────────── the drawer ─────────────────────────

export function initLab({ onShape }) {
  const drawer = $('lab');
  const magicParams = { base: 'donut', sides: 5, loops: 3, twist: 1, waves: 3, wob: 0.25 };
  let mode = 'magic';

  const setMode = (m) => {
    mode = m;
    $('lab-magic').hidden = m !== 'magic';
    $('lab-code-pane').hidden = m !== 'code';
    $('lab-tab-magic').classList.toggle('active', m === 'magic');
    $('lab-tab-code').classList.toggle('active', m === 'code');
  };
  $('lab-tab-magic').addEventListener('click', () => setMode('magic'));
  $('lab-tab-code').addEventListener('click', () => setMode('code'));

  const showShape = (raw, name, blurb) => {
    const shape = finalize(raw);
    shape.def = {
      id: 'custom',
      name: name || 'My 4D Shape',
      cells: 'invented in the Shape Lab',
      blurb,
    };
    onShape(shape);
  };

  const error = (msg) => {
    const box = $('lab-error');
    box.textContent = msg || '';
    box.hidden = !msg;
  };

  // ── magic mode wiring ──
  const runMagic = () => {
    error('');
    showShape(magicBuild(magicParams), $('lab-name').value.trim(), MAGIC_BLURBS[magicParams.base]);
  };

  const renderMagicSliders = () => {
    const host = $('lab-magic-sliders');
    host.replaceChildren();
    for (const s of MAGIC_SLIDERS[magicParams.base]) {
      const row = document.createElement('div');
      row.className = 'lab-slider';
      const lab = document.createElement('label');
      lab.textContent = s.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = s.min; input.max = s.max; input.step = s.step;
      input.value = magicParams[s.key];
      input.addEventListener('input', () => {
        magicParams[s.key] = parseFloat(input.value);
        runMagic();
      });
      row.append(lab, input);
      host.append(row);
    }
  };

  for (const [base, { emoji, label }] of Object.entries(BASES)) {
    const btn = document.createElement('button');
    btn.className = 'lab-base' + (base === magicParams.base ? ' active' : '');
    btn.innerHTML = `${emoji}<span>${label}</span>`;
    btn.addEventListener('click', () => {
      magicParams.base = base;
      for (const b of $('lab-bases').children) b.classList.remove('active');
      btn.classList.add('active');
      renderMagicSliders();
      runMagic();
    });
    $('lab-bases').append(btn);
  }
  renderMagicSliders();

  const rnd = (min, max) => min + Math.random() * (max - min);
  $('lab-dice').addEventListener('click', () => {
    magicParams.sides = 3 + Math.floor(rnd(0, 7));
    magicParams.loops = 1 + Math.floor(rnd(0, 8));
    magicParams.twist = Math.floor(rnd(0, 7));
    magicParams.waves = Math.floor(rnd(0, 9));
    magicParams.wob = Math.round(rnd(0.05, 0.55) * 20) / 20;
    renderMagicSliders();
    runMagic();
  });

  // ── code mode wiring ──
  const editor = $('lab-code');
  const exSel = $('lab-examples');
  for (const name of Object.keys(EXAMPLES)) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    exSel.append(o);
  }
  editor.value = EXAMPLES['Two linked rings'];
  exSel.addEventListener('change', () => { editor.value = EXAMPLES[exSel.value]; error(''); });

  const runCode = () => {
    try {
      error('');
      showShape(runUserCode(editor.value), $('lab-name').value.trim(),
        'Written in the Shape Lab, one [x, y, z, w] at a time.');
    } catch (e) {
      error(e.message);
    }
  };
  $('lab-run').addEventListener('click', runCode);
  editor.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runCode(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = editor;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = s + 2;
    }
  });

  // ── save / load / share ──
  const load = () => JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  const store = (list) => localStorage.setItem(STORE_KEY, JSON.stringify(list));

  const renderSaved = () => {
    const host = $('lab-saved');
    host.replaceChildren();
    for (const [i, item] of load().entries()) {
      const row = document.createElement('div');
      row.className = 'lab-saved-row';
      const name = document.createElement('span');
      name.textContent = item.name;
      const play = document.createElement('button');
      play.textContent = '▶';
      play.title = 'Show it';
      play.addEventListener('click', () => applySaved(item));
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Delete';
      del.addEventListener('click', () => { const l = load(); l.splice(i, 1); store(l); renderSaved(); });
      row.append(name, play, del);
      host.append(row);
    }
  };

  const syncBases = () => {
    for (const b of $('lab-bases').children) {
      b.classList.toggle('active', b.textContent.includes(BASES[magicParams.base].label));
    }
  };

  const applySaved = (item) => {
    $('lab-name').value = item.name;
    if (item.mode === 'magic') {
      Object.assign(magicParams, item.data);
      setMode('magic');
      syncBases();
      renderMagicSliders();
      runMagic();
    } else {
      editor.value = item.data;
      setMode('code');
      runCode();
    }
  };

  $('lab-save').addEventListener('click', () => {
    const name = $('lab-name').value.trim() || 'My 4D Shape';
    const item = mode === 'magic'
      ? { name, mode: 'magic', data: { ...magicParams } }
      : { name, mode: 'code', data: editor.value };
    const list = load().filter((s) => s.name !== name);
    list.unshift(item);
    store(list.slice(0, 30));
    renderSaved();
    if (mode === 'magic') runMagic(); else runCode();
  });

  $('lab-share').addEventListener('click', async () => {
    const payload = mode === 'magic'
      ? { m: 1, n: $('lab-name').value.trim(), p: magicParams }
      : { c: editor.value, n: $('lab-name').value.trim() };
    const url = new URL(window.location);
    url.search = '';
    url.hash = 'lab=' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    try {
      await navigator.clipboard.writeText(url.toString());
      $('lab-share').textContent = 'COPIED ✓';
    } catch {
      prompt('Copy this link:', url.toString());
    }
    setTimeout(() => { $('lab-share').textContent = 'COPY LINK'; }, 1600);
  });

  // ── open / close ──
  let hasShown = false;
  const open = () => {
    drawer.classList.add('open');
    // show something the moment the lab opens — instant feedback
    if (!hasShown && mode === 'magic') {
      hasShown = true;
      runMagic();
    }
  };
  const close = () => { drawer.classList.remove('open'); };
  $('lab-close').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  renderSaved();

  // ── shared-link loading ──
  if (window.location.hash.startsWith('#lab=')) {
    try {
      const payload = JSON.parse(decodeURIComponent(escape(atob(window.location.hash.slice(5)))));
      $('lab-name').value = payload.n || '';
      if (payload.m && payload.p) {
        // pure slider data — safe to run immediately
        Object.assign(magicParams, payload.p);
        hasShown = true;
        open();
        syncBases();
        renderMagicSliders();
        runMagic();
      } else if (typeof payload.c === 'string') {
        // shared CODE is shown, never auto-run — the visitor stays in charge
        editor.value = payload.c;
        open();
        setMode('code');
        error('Code loaded from a shared link. Read it, then press RUN.');
      }
    } catch { /* malformed hash — ignore */ }
  }

  return { open, close };
}
