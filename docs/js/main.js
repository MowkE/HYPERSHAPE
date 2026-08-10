/**
 * main.js — boot, input, and the render loop.
 */

import { Renderer } from './renderer.js';
import { SHAPES, buildShape } from './shapes.js';
import { initLab } from './lab.js';
import { computeSlice } from './slicer.js';
import { buildUI, updateInfoCard, drawLegend, flashToast } from './ui.js';
import {
  PLANES, compose4DRotation, mat4Perspective, mat4LookAt, orbitEye,
} from './math4d.js';
import { sample } from './palettes.js';

const canvas = document.getElementById('view');

const state = {
  shapeId: 'tesseract',
  params: {},
  angles: Object.fromEntries(PLANES.map((p) => [p, 0])),
  velocities: { XY: 0, XZ: 0, YZ: 0, XW: 0.28, YW: 0.09, ZW: 0.16 },
  spinning: true,
  cam: { yaw: 0.55, pitch: 0.32, dist: 4.7 },
  dist4: 3.4,
  ortho4: false,
  palette: 0,
  bloom: 1.25,
  edgeBrightness: 0.95,
  viewMode: 'wire',
  showEdges: true,
  showPoints: true,
  pointSize: 3.5,
  wTarget: 0,
  focusOn: false,
  decay: 2.5,
  sliceOn: false,
  ghostDim: 0.22,
};

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  document.getElementById('gl-error').style.display = 'flex';
  throw err;
}

let shape = null;

function loadShape(id, keepParams = false) {
  const def = SHAPES.find((s) => s.id === id) || SHAPES[1];
  state.shapeId = def.id;
  if (!keepParams) state.params = {};
  shape = buildShape(def.id, state.params);
  state.params = shape.params;
  renderer.setShape(shape);
  updateInfoCard(shape);
  ui.setActiveShape(def);
  const url = new URL(window.location);
  url.searchParams.set('shape', def.id);
  history.replaceState(null, '', url);
}

let lab = null;

const ui = buildUI(state, {
  selectShape: (id) => { lab?.close(); loadShape(id); },
  setParam: (key, value) => {
    state.params[key] = value;
    shape = buildShape(state.shapeId, state.params);
    renderer.setShape(shape);
    updateInfoCard(shape);
  },
  toggleSpin: () => {
    state.spinning = !state.spinning;
    ui.setSpinLabel(state.spinning);
  },
  openLab: () => lab?.open(),
});

// ── input: left-drag = 3D orbit · right-drag = 4D rotation ──
const pointers = new Map();
let pinchDist = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) state.cam.dist = clamp(state.cam.dist * (pinchDist / d), 2, 18);
    pinchDist = d;
    return;
  }
  if (p.button === 2 || e.ctrlKey || e.metaKey) {
    // rotate *into the 4th dimension* — no 3D analogue for this movement
    state.angles.XW += dx * 0.006;
    state.angles.YW -= dy * 0.006;
  } else {
    state.cam.yaw -= dx * 0.008;
    state.cam.pitch = clamp(state.cam.pitch + dy * 0.008, -1.45, 1.45);
  }
});
const releasePointer = (e) => { pointers.delete(e.pointerId); pinchDist = 0; };
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey) {
    state.wTarget = clamp(state.wTarget + (e.deltaY > 0 ? -0.05 : 0.05), -1.6, 1.6);
    ui.setWTarget(state.wTarget);
  } else {
    state.cam.dist = clamp(state.cam.dist * (e.deltaY > 0 ? 1.07 : 0.935), 2, 18);
  }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const idx = SHAPES.findIndex((s) => s.id === state.shapeId);
  switch (e.key) {
    case ' ':
      e.preventDefault();
      state.spinning = !state.spinning;
      ui.setSpinLabel(state.spinning);
      break;
    case 'r': case 'R': resetView(); break;
    case 'h': case 'H': case '?': toggleHelp(); break;
    case 's': case 'S': screenshot(); break;
    case 'ArrowRight': loadShape(SHAPES[(idx + 1) % SHAPES.length].id); break;
    case 'ArrowLeft': loadShape(SHAPES[(idx - 1 + SHAPES.length) % SHAPES.length].id); break;
    default:
      if (/^[0-9]$/.test(e.key)) {
        const n = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        if (SHAPES[n]) loadShape(SHAPES[n].id);
      }
  }
});

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function resetView() {
  for (const p of PLANES) state.angles[p] = 0;
  Object.assign(state.cam, { yaw: 0.55, pitch: 0.32, dist: 4.7 });
  state.wTarget = 0;
  ui.setWTarget(0);
}

function screenshot() {
  const a = document.createElement('a');
  a.download = `hypershape-${state.shapeId}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  flashToast('Saved screenshot ✓', 2000);
}

function toggleHelp() {
  document.getElementById('help').classList.toggle('open');
}

document.getElementById('btn-help').addEventListener('click', toggleHelp);
document.getElementById('help-close').addEventListener('click', toggleHelp);
document.getElementById('btn-shot').addEventListener('click', screenshot);
document.getElementById('btn-panel').addEventListener('click', () => {
  document.getElementById('panel').classList.toggle('open');
});
if (window.innerWidth < 760) document.getElementById('panel').classList.remove('open');

// ── boot ──
const urlShape = new URL(window.location).searchParams.get('shape');
loadShape(urlShape || 'tesseract');
// the lab initializes after the default shape so a shared #lab= link wins
lab = initLab({
  onShape: (custom) => {
    shape = custom;
    state.shapeId = 'custom';
    renderer.setShape(shape);
    updateInfoCard(shape);
    ui.setActiveShape({ id: 'custom' });
  },
});
drawLegend(state);
flashToast('drag — rotate in 3D · right-drag — rotate in 4D · scroll — zoom · shift+scroll — move along w');

// ── telemetry strip ──
const tele = Object.fromEntries(
  ['obj', 'v', 'e', 'rot', 'w', 'fps'].map((k) => [k, document.getElementById('tele-' + k)]),
);
let fpsEma = 60;
let teleTick = 0;

function updateTelemetry() {
  const mod = (a) => (((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(2);
  tele.obj.textContent = shape.def.name;
  tele.v.textContent = (shape.verts.length / 4).toLocaleString();
  tele.e.textContent = (shape.edges.length / 2).toLocaleString();
  tele.rot.textContent =
    `XW ${mod(state.angles.XW)} · YW ${mod(state.angles.YW)} · ZW ${mod(state.angles.ZW)}`;
  tele.w.textContent = (state.wTarget >= 0 ? '+' : '') + state.wTarget.toFixed(2);
  tele.fps.textContent = Math.round(fpsEma);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  fpsEma += (1 / Math.max(dt, 1e-4) - fpsEma) * 0.08;
  if ((teleTick++ & 7) === 0) updateTelemetry();

  if (state.spinning) {
    for (const p of PLANES) state.angles[p] += state.velocities[p] * dt;
  }

  const rot4 = compose4DRotation(state.angles);
  const eye = orbitEye(state.cam.yaw, state.cam.pitch, state.cam.dist);
  const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0]);
  const proj = mat4Perspective(50, canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.1, 100);

  let sliceData = null;
  if (state.sliceOn) {
    sliceData = computeSlice(shape, rot4, state.wTarget, state.dist4, state.ortho4);
    const [r, g, b] = sample(state.palette, state.wTarget / 3.2 + 0.5);
    // push the slice color toward white so it reads as "solid"
    sliceData.color = [r * 0.45 + 0.55, g * 0.45 + 0.55, b * 0.45 + 0.55];
  }

  renderer.render({
    rot4, view, proj,
    viewMode: state.viewMode,
    dist4: state.dist4,
    ortho4: state.ortho4,
    wTarget: state.wTarget,
    focusDecay: state.focusOn ? state.decay : 0,
    palette: state.palette,
    bloom: state.bloom,
    edgeBrightness: state.edgeBrightness,
    showEdges: state.showEdges,
    // point sprites clutter dense meshes — auto-hide above ~800 vertices
    showPoints: state.showPoints && shape.verts.length / 4 <= 800,
    pointSize: state.pointSize,
    ghostDim: state.ghostDim,
  }, sliceData);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
