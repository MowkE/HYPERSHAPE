/**
 * ui.js — control panel, legend, info card. Plain DOM, no framework.
 */

import { SHAPES } from './shapes.js';
import { PALETTES, sample } from './palettes.js';
import { PLANES } from './math4d.js';

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function slider(parent, label, min, max, step, value, onInput, fmt = (v) => v.toFixed(2)) {
  const row = el('div', 'ctl-row');
  const lab = el('label', 'ctl-label', label);
  const val = el('span', 'ctl-value', fmt(value));
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  const top = el('div', 'ctl-row-top');
  top.append(lab, val);
  row.append(top, input);
  parent.append(row);
  return {
    set(v) { input.value = v; val.textContent = fmt(v); },
  };
}

function toggle(parent, label, value, onChange) {
  const row = el('div', 'ctl-check');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.id = 'chk-' + label.replace(/\W+/g, '-');
  const lab = el('label', null, label);
  lab.htmlFor = input.id;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(input, lab);
  parent.append(row);
  return { set(v) { input.checked = v; } };
}

function section(parent, title, open = true) {
  const det = el('details', 'panel-section');
  det.open = open;
  const sum = el('summary');
  sum.append(el('span', 'sec-label', title));
  det.append(sum);
  const body = el('div', 'section-body');
  det.append(body);
  parent.append(det);
  return body;
}

export function buildUI(state, hooks) {
  const panel = $('#panel');

  // ── shape picker ──
  const shapeBody = section(panel, 'Object', true);
  const list = el('div', 'shape-list');
  shapeBody.append(list);
  const launch = el('button', 'lab-launch', 'SHAPE LAB · BUILD YOUR OWN');
  launch.addEventListener('click', () => hooks.openLab());
  list.append(launch);
  let lastGroup = null;
  const items = new Map();
  for (const def of SHAPES) {
    if (def.group !== lastGroup) {
      list.append(el('div', 'shape-group', def.group));
      lastGroup = def.group;
    }
    const item = el('button', 'shape-item', def.name);
    item.addEventListener('click', () => hooks.selectShape(def.id));
    list.append(item);
    items.set(def.id, item);
  }

  // ── shape params (rebuilt per shape) ──
  const paramBody = section(panel, 'Parameters', true);
  const paramHost = el('div');
  paramBody.append(paramHost);

  function renderParams(def) {
    paramHost.replaceChildren();
    const params = def.params || [];
    paramBody.parentElement.style.display = params.length ? '' : 'none';
    for (const p of params) {
      slider(paramHost, p.label, p.min, p.max, p.step, state.params[p.key],
        (v) => hooks.setParam(p.key, v),
        (v) => (p.step >= 1 ? String(Math.round(v)) : v.toFixed(2)));
    }
  }

  // ── rotation: 3D planes in the left column, 4D planes in the right ──
  const rotBody = section(panel, 'Rotation', true);
  const rotGrid = el('div', 'rot-grid');
  rotGrid.append(el('div', 'hint-line', 'Spatial'),
                 el('div', 'hint-line hint-4d', 'Into w'));
  rotBody.append(rotGrid);
  const velSliders = {};
  for (const plane of ['XY', 'XW', 'XZ', 'YW', 'YZ', 'ZW']) {
    velSliders[plane] = slider(rotGrid, plane, -0.8, 0.8, 0.01, state.velocities[plane],
      (v) => { state.velocities[plane] = v; }, (v) => v.toFixed(2));
  }
  const btnRow = el('div', 'btn-row');
  const mkBtn = (label, fn) => {
    const b = el('button', 'mini-btn', label);
    b.addEventListener('click', fn);
    btnRow.append(b);
    return b;
  };
  const pauseBtn = mkBtn('Pause', () => hooks.toggleSpin());
  mkBtn('Isoclinic', () => setVels({ XY: 0, XZ: 0, YZ: 0, XW: 0.35, YW: 0, ZW: 0.35 }));
  mkBtn('Tumble', () => setVels({
    XY: rand(), XZ: rand(), YZ: rand(), XW: rand(), YW: rand(), ZW: rand(),
  }));
  mkBtn('Stop all', () => setVels({ XY: 0, XZ: 0, YZ: 0, XW: 0, YW: 0, ZW: 0 }));
  rotBody.append(btnRow);
  const rand = () => (Math.random() * 0.7 - 0.35);
  function setVels(v) {
    Object.assign(state.velocities, v);
    for (const p of PLANES) velSliders[p].set(state.velocities[p]);
  }

  // ── view ──
  const viewBody = section(panel, 'Display', true);
  const selRow = el('div', 'row2');
  viewBody.append(selRow);

  const mkSelect = (parent, label, entries, value, onChange) => {
    const sel = document.createElement('select');
    for (const [v, n] of entries) {
      const o = document.createElement('option');
      o.value = v; o.textContent = n;
      sel.append(o);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    const row = el('div', 'ctl-row');
    const top = el('div', 'ctl-row-top');
    top.append(el('label', 'ctl-label', label));
    row.append(top, sel);
    parent.append(row);
    return sel;
  };
  mkSelect(selRow, 'Palette', PALETTES.map((p, i) => [String(i), p.name]),
    String(state.palette), (v) => { state.palette = parseInt(v, 10); drawLegend(state); });
  mkSelect(selRow, 'Projection', [['persp', 'Perspective'], ['ortho', 'Orthographic']],
    'persp', (v) => { state.ortho4 = v === 'ortho'; });

  const viewGrid = el('div', 'row2');
  viewBody.append(viewGrid);
  slider(viewGrid, '4D distance', 2.2, 8, 0.05, state.dist4, (v) => { state.dist4 = v; });
  slider(viewGrid, 'Glow', 0, 2.5, 0.05, state.bloom, (v) => { state.bloom = v; });
  slider(viewGrid, 'Brightness', 0.2, 1.6, 0.05, state.edgeBrightness, (v) => { state.edgeBrightness = v; });
  slider(viewGrid, 'Vertex size', 0, 9, 0.5, state.pointSize, (v) => {
    state.pointSize = v;
    state.showPoints = v > 0;
  });

  // ── w-axis tools ──
  const wBody = section(panel, 'W-axis', true);
  const wSlider = slider(wBody, 'W position', -1.6, 1.6, 0.01, state.wTarget, (v) => { state.wTarget = v; });
  const wToggles = el('div', 'row2');
  wBody.append(wToggles);
  toggle(wToggles, 'Focus shell', state.focusOn, (v) => { state.focusOn = v; });
  toggle(wToggles, 'Slice (CT scan)', state.sliceOn, (v) => { state.sliceOn = v; });
  const wGrid = el('div', 'row2');
  wBody.append(wGrid);
  slider(wGrid, 'Focus tightness', 0.5, 8, 0.1, state.decay, (v) => { state.decay = v; });
  slider(wGrid, 'Ghost dim', 0, 1, 0.05, state.ghostDim, (v) => { state.ghostDim = v; });

  return {
    setActiveShape(def) {
      for (const [id, item] of items) item.classList.toggle('active', id === def.id);
      renderParams(def);
    },
    setSpinLabel(spinning) { pauseBtn.textContent = spinning ? 'Pause' : 'Play'; },
    setWTarget(v) { wSlider.set(v); },
  };
}

export function updateInfoCard(shape) {
  const def = shape.def;
  $('#info-name').textContent = def.name;
  const nv = shape.verts.length / 4;
  const ne = shape.edges.length / 2;
  $('#info-stats').textContent = `${nv.toLocaleString()} vertices · ${ne.toLocaleString()} edges · ${def.cells}`;
  $('#info-blurb').textContent = def.blurb;
}

export function drawLegend(state) {
  const canvas = $('#legend-bar');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  for (let x = 0; x < w; x++) {
    const [r, g, b] = sample(state.palette, x / (w - 1));
    ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
    ctx.fillRect(x, 0, 1, h);
  }
}

export function flashToast(msg, ms = 6000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}
