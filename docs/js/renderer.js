/**
 * renderer.js — zero-dependency WebGL2 renderer.
 *
 * The entire 4D pipeline runs in the vertex shader: vertices are uploaded
 * once as raw 4D positions; per frame we send a single mat4 (the 4D rotation)
 * plus the 4D→3D projection settings. Color is looked up from the rotated
 * w coordinate. Everything draws with additive blending (order-independent,
 * no depth buffer needed) into an offscreen target, which then gets a
 * downsample → gaussian blur → composite bloom pass.
 */

import { buildPaletteImage, PALETTES, PALETTE_SIZE } from './palettes.js';

const SHAPE_VS = `#version 300 es
precision highp float;
in vec4 aPos4;
uniform mat4 uRot4;      // 4D rotation (a plain 4x4 — no homogeneous coord yet)
uniform mat4 uView;
uniform mat4 uProj;
uniform float uDist4;    // 4D camera distance along +w
uniform int uOrtho4;
uniform float uRadius;
uniform float uPointSize;
out float vW;
out vec3 vViewPos;

void main() {
  vec4 p = uRot4 * aPos4;
  vW = p.w / uRadius;                    // normalized w for coloring
  vec3 p3 = p.xyz;
  if (uOrtho4 == 0) {
    // perspective from a "4D eye" at w = uDist4: nearer in w → larger
    float denom = max(uDist4 - p.w, 0.35);
    p3 *= uDist4 / denom;
  }
  vec4 vpos = uView * vec4(p3, 1.0);
  vViewPos = vpos.xyz;
  gl_Position = uProj * vpos;
  gl_PointSize = uPointSize * (10.0 / max(-vpos.z, 0.6));
}`;

const SHAPE_FS = `#version 300 es
precision highp float;
in float vW;
in vec3 vViewPos;
uniform sampler2D uPalette;
uniform float uPaletteRow;
uniform float uWTarget;
uniform float uFocusDecay;   // 0 disables focus mode
uniform float uBrightness;
uniform int uIsPoint;
uniform int uShading;        // 1 = flat-lit faces (normal from derivatives)
uniform float uBands;        // >0 = posterize w into discrete shells
out vec4 fragColor;

void main() {
  if (uIsPoint == 1) {
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
  }
  float t = clamp(vW * 0.5 + 0.5, 0.0, 1.0);
  vec3 col;
  if (uBands > 0.5) {
    // discrete w-shells: quantized color with dark seams between bands
    float tq = (floor(t * uBands) + 0.5) / uBands;
    col = texture(uPalette, vec2(tq, uPaletteRow)).rgb;
    float f = abs(fract(t * uBands) - 0.5);
    col *= smoothstep(0.5, 0.32, f);
  } else {
    col = texture(uPalette, vec2(t, uPaletteRow)).rgb;
  }
  if (uShading == 1) {
    vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
    vec3 L = normalize(vec3(0.4, 0.8, 0.5));
    col *= 0.38 + 0.62 * abs(dot(N, L));
  }
  float a = 1.0;
  if (uFocusDecay > 0.0) {
    a = max(exp(-uFocusDecay * abs(vW - uWTarget)), 0.04);
  }
  fragColor = vec4(col * a * uBrightness, 1.0);
}`;

// slice geometry arrives pre-projected to 3D on the CPU
const SLICE_VS = `#version 300 es
precision highp float;
in vec3 aPos3;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uPointSize;
void main() {
  vec4 vpos = uView * vec4(aPos3, 1.0);
  gl_Position = uProj * vpos;
  gl_PointSize = uPointSize * (10.0 / max(-vpos.z, 0.6));
}`;

const SLICE_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform int uIsPoint;
out vec4 fragColor;
void main() {
  if (uIsPoint == 1) {
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
  }
  fragColor = vec4(uColor, 1.0);
}`;

// fullscreen triangle via gl_VertexID — no vertex buffer at all
const QUAD_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BLIT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 fragColor;
void main() { fragColor = texture(uTex, vUv); }`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;   // (texelX, 0) or (0, texelY)
out vec4 fragColor;
void main() {
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 sum = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    sum += texture(uTex, vUv + uDir * float(i)).rgb * w[i];
    sum += texture(uTex, vUv - uDir * float(i)).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmt;
out vec4 fragColor;
void main() {
  vec3 col = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomAmt;
  col = vec3(1.0) - exp(-col * 1.25);          // soft tonemap for the glow
  float r = length(vUv - 0.5) * 1.35;
  col *= 1.0 - 0.38 * smoothstep(0.45, 1.05, r); // vignette
  fragColor = vec4(col, 1.0);
}`;

function compile(gl, vsSrc, fsSrc) {
  const make = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, make(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

function makeTarget(gl, w, h, withDepth = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (withDepth) {
    const rbo = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbo);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: true, // enables the screenshot button
      alpha: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.canvas = canvas;

    this.shapeProg = compile(gl, SHAPE_VS, SHAPE_FS);
    this.sliceProg = compile(gl, SLICE_VS, SLICE_FS);
    this.blitProg = compile(gl, QUAD_VS, BLIT_FS);
    this.blurProg = compile(gl, QUAD_VS, BLUR_FS);
    this.compositeProg = compile(gl, QUAD_VS, COMPOSITE_FS);

    // palette texture: one row per palette
    this.paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_SIZE, PALETTES.length, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, buildPaletteImage());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // shape geometry buffers: one VBO, two VAOs (edge indices / tri indices)
    this.shapeVbo = gl.createBuffer();
    this.shapeIbo = gl.createBuffer();
    this.shapeTriIbo = gl.createBuffer();
    const locPos4 = gl.getAttribLocation(this.shapeProg, 'aPos4');
    const makeVao = (ibo) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeVbo);
      gl.enableVertexAttribArray(locPos4);
      gl.vertexAttribPointer(locPos4, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bindVertexArray(null);
      return vao;
    };
    this.shapeVao = makeVao(this.shapeIbo);
    this.shapeTriVao = makeVao(this.shapeTriIbo);

    // slice geometry buffers (streamed from the CPU each frame)
    this.sliceVao = gl.createVertexArray();
    this.sliceVbo = gl.createBuffer();
    gl.bindVertexArray(this.sliceVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sliceVbo);
    const locPos3 = gl.getAttribLocation(this.sliceProg, 'aPos3');
    gl.enableVertexAttribArray(locPos3);
    gl.vertexAttribPointer(locPos3, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.nEdgeIndices = 0;
    this.nTriIndices = 0;
    this.nVerts = 0;
    this.targets = null;
    this.resize();
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.targets) return;
    this.canvas.width = w;
    this.canvas.height = h;
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.targets = {
      scene: makeTarget(gl, w, h, true), // depth buffer for solid mode
      blurA: makeTarget(gl, bw, bh),
      blurB: makeTarget(gl, bw, bh),
    };
  }

  setShape(shape) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeVbo);
    gl.bufferData(gl.ARRAY_BUFFER, shape.verts, gl.STATIC_DRAW);
    gl.bindVertexArray(this.shapeVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.shapeIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shape.edges, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    if (shape.tris) {
      gl.bindVertexArray(this.shapeTriVao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.shapeTriIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, shape.tris, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }
    this.nTriIndices = shape.tris ? shape.tris.length : 0;
    this.nEdgeIndices = shape.edges.length;
    this.nVerts = shape.verts.length / 4;
    this.radius = shape.radius;
  }

  /** sliceData: { segs: Float32Array (3D positions), points: Float32Array } | null */
  render(state, sliceData) {
    const gl = this.gl;
    this.resize();
    const { scene, blurA, blurB } = this.targets;

    // ── pass 1: shape into offscreen target ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.clearColor(0.010, 0.010, 0.008, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(this.shapeProg);
    const u = (n) => gl.getUniformLocation(this.shapeProg, n);
    gl.uniformMatrix4fv(u('uRot4'), false, state.rot4);
    gl.uniformMatrix4fv(u('uView'), false, state.view);
    gl.uniformMatrix4fv(u('uProj'), false, state.proj);
    gl.uniform1f(u('uDist4'), state.dist4);
    gl.uniform1i(u('uOrtho4'), state.ortho4 ? 1 : 0);
    gl.uniform1f(u('uRadius'), this.radius || 1.5);
    gl.uniform1f(u('uWTarget'), state.wTarget);
    gl.uniform1f(u('uFocusDecay'), state.focusDecay);
    gl.uniform1f(u('uPaletteRow'), (state.palette + 0.5) / PALETTES.length);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(u('uPalette'), 0);

    const ghost = sliceData ? state.ghostDim : 1;
    const dpr = window.devicePixelRatio || 1;
    // modes that need faces fall back to wireframe when the shape has none
    let mode = state.viewMode || 'wire';
    if (!this.nTriIndices && (mode === 'solid' || mode === 'xray' || mode === 'shell')) mode = 'wire';

    const drawEdges = (brightness, bands = 0) => {
      if (!this.nEdgeIndices) return;
      gl.uniform1i(u('uIsPoint'), 0);
      gl.uniform1i(u('uShading'), 0);
      gl.uniform1f(u('uBands'), bands);
      gl.uniform1f(u('uBrightness'), brightness);
      gl.uniform1f(u('uPointSize'), 1);
      gl.bindVertexArray(this.shapeVao);
      gl.drawElements(gl.LINES, this.nEdgeIndices, gl.UNSIGNED_INT, 0);
    };
    const drawPoints = (brightness, size) => {
      if (!this.nVerts) return;
      gl.uniform1i(u('uIsPoint'), 1);
      gl.uniform1i(u('uShading'), 0);
      gl.uniform1f(u('uBands'), 0);
      gl.uniform1f(u('uBrightness'), brightness);
      gl.uniform1f(u('uPointSize'), size * dpr);
      gl.bindVertexArray(this.shapeVao);
      gl.drawArrays(gl.POINTS, 0, this.nVerts);
    };
    const drawFaces = (brightness, bands = 0) => {
      gl.uniform1i(u('uIsPoint'), 0);
      gl.uniform1i(u('uShading'), 1);
      gl.uniform1f(u('uBands'), bands);
      gl.uniform1f(u('uBrightness'), brightness);
      gl.uniform1f(u('uPointSize'), 1);
      gl.bindVertexArray(this.shapeTriVao);
      gl.drawElements(gl.TRIANGLES, this.nTriIndices, gl.UNSIGNED_INT, 0);
    };

    if (mode === 'solid') {
      // opaque lit surface — the one mode that uses the depth buffer
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      drawFaces(0.95 * ghost);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
    } else if (mode === 'xray') {
      drawFaces(0.16 * state.edgeBrightness * ghost);
      drawEdges(0.45 * state.edgeBrightness * ghost);
      if (state.showPoints) drawPoints(state.edgeBrightness * ghost, state.pointSize);
    } else if (mode === 'shell') {
      drawFaces(0.30 * state.edgeBrightness * ghost, 9);
      drawEdges(0.25 * state.edgeBrightness * ghost, 9);
    } else if (mode === 'cloud') {
      drawPoints(state.edgeBrightness * 1.5 * ghost, state.pointSize * 2.4);
    } else {
      if (state.showEdges) drawEdges(state.edgeBrightness * ghost);
      if (state.showPoints) drawPoints(state.edgeBrightness * 1.4 * ghost, state.pointSize);
    }
    gl.bindVertexArray(null);

    // slice overlay (already projected to 3D on CPU)
    if (sliceData && (sliceData.segs.length || sliceData.points.length)) {
      gl.useProgram(this.sliceProg);
      const su = (n) => gl.getUniformLocation(this.sliceProg, n);
      gl.uniformMatrix4fv(su('uView'), false, state.view);
      gl.uniformMatrix4fv(su('uProj'), false, state.proj);
      gl.uniform3fv(su('uColor'), sliceData.color);
      gl.bindVertexArray(this.sliceVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sliceVbo);
      if (sliceData.segs.length) {
        gl.uniform1i(su('uIsPoint'), 0);
        gl.uniform1f(su('uPointSize'), 1);
        gl.bufferData(gl.ARRAY_BUFFER, sliceData.segs, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, sliceData.segs.length / 3);
      }
      if (sliceData.points.length) {
        gl.uniform1i(su('uIsPoint'), 1);
        gl.uniform1f(su('uPointSize'), 5 * (window.devicePixelRatio || 1));
        gl.bufferData(gl.ARRAY_BUFFER, sliceData.points, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, sliceData.points.length / 3);
      }
      gl.bindVertexArray(null);
    }

    gl.disable(gl.BLEND);

    // ── pass 2: downsample + separable blur ──
    gl.useProgram(this.blitProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fbo);
    gl.viewport(0, 0, blurA.w, blurA.h);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(gl.getUniformLocation(this.blitProg, 'uTex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.blurProg);
    const bu = (n) => gl.getUniformLocation(this.blurProg, n);
    gl.uniform1i(bu('uTex'), 0);
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.fbo);
      gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
      gl.uniform2f(bu('uDir'), 1.4 / blurA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fbo);
      gl.bindTexture(gl.TEXTURE_2D, blurB.tex);
      gl.uniform2f(bu('uDir'), 0, 1.4 / blurA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ── pass 3: composite to screen ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.compositeProg);
    const cu = (n) => gl.getUniformLocation(this.compositeProg, n);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(cu('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
    gl.uniform1i(cu('uBloom'), 1);
    gl.uniform1f(cu('uBloomAmt'), state.bloom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
