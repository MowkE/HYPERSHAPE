/**
 * math4d.js — minimal linear algebra for the 4D pipeline.
 *
 * All matrices are column-major Float32Array(16), ready to hand to
 * gl.uniformMatrix4fv. A 4D rotation is just a 4x4 matrix (no homogeneous
 * coordinate needed until we drop to 3D), so the whole 4D orientation of a
 * shape travels to the GPU as a single mat4 uniform.
 */

// The six rotation planes of 4D space. The first three are the familiar 3D
// rotations; the last three rotate *into* the w axis and have no 3D analogue.
export const PLANES = ['XY', 'XZ', 'YZ', 'XW', 'YW', 'ZW'];

const PLANE_AXES = {
  XY: [0, 1], XZ: [0, 2], YZ: [1, 2],
  XW: [0, 3], YW: [1, 3], ZW: [2, 3],
};

export function mat4Identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** Rotation by `theta` in the given coordinate plane ('XY' … 'ZW'). */
export function mat4PlaneRotation(plane, theta) {
  const [i, j] = PLANE_AXES[plane];
  const m = mat4Identity();
  const c = Math.cos(theta), s = Math.sin(theta);
  // column-major: element (row r, col c) lives at [c*4 + r]
  m[i * 4 + i] = c; m[j * 4 + i] = -s;
  m[i * 4 + j] = s; m[j * 4 + j] = c;
  return m;
}

export function mat4Multiply(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Compose the six per-plane angles into one 4D rotation matrix. */
export function compose4DRotation(angles) {
  let m = mat4Identity();
  for (const plane of PLANES) {
    const a = angles[plane];
    if (Math.abs(a) > 1e-9) m = mat4Multiply(mat4PlaneRotation(plane, a), m);
  }
  return m;
}

export function transformVec4(m, v, out = [0, 0, 0, 0]) {
  const [x, y, z, w] = v;
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
  return out;
}

// ── standard 3D camera matrices (homogeneous 4x4) ──────────────────────────

export function mat4Perspective(fovyDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovyDeg * Math.PI) / 360);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye, target, up) {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const x = [
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0],
  ];
  const xl = Math.hypot(...x) || 1;
  x[0] /= xl; x[1] /= xl; x[2] /= xl;
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const m = mat4Identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  return m;
}

/** Orbit-camera eye position from yaw/pitch/distance around a target. */
export function orbitEye(yaw, pitch, dist, target = [0, 0, 0]) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [
    target[0] + dist * cp * Math.sin(yaw),
    target[1] + dist * sp,
    target[2] + dist * cp * Math.cos(yaw),
  ];
}
