/**
 * slicer.js — CPU cross-sections.
 *
 * Slicing a 4D shape with the hyperplane w = w₀ is the 4D version of a CT
 * scan: the result is a true 3D object. We rotate the vertices on the CPU
 * (same matrix the GPU uses), intersect each triangle with the hyperplane to
 * get line segments, and each edge to get points. Since every intersection
 * lives at exactly w = w₀, the 4D→3D projection collapses to one uniform
 * scale factor.
 */

import { transformVec4 } from './math4d.js';

export function computeSlice(shape, rot4, wTarget, dist4, ortho4) {
  const n = shape.verts.length / 4;
  const rotated = new Float32Array(n * 4);
  const v = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    transformVec4(rot4, shape.verts.subarray(i * 4, i * 4 + 4), v);
    rotated[i * 4] = v[0]; rotated[i * 4 + 1] = v[1];
    rotated[i * 4 + 2] = v[2]; rotated[i * 4 + 3] = v[3];
  }

  const scale = ortho4 ? 1 : dist4 / Math.max(dist4 - wTarget, 0.35);

  // where edge (a, b) crosses w = wTarget, push the 3D point
  const crossing = (a, b, out) => {
    const wa = rotated[a * 4 + 3], wb = rotated[b * 4 + 3];
    if ((wa - wTarget) * (wb - wTarget) > 0 || Math.abs(wa - wb) < 1e-9) return false;
    const t = (wTarget - wa) / (wb - wa);
    for (let k = 0; k < 3; k++) {
      out.push((rotated[a * 4 + k] + t * (rotated[b * 4 + k] - rotated[a * 4 + k])) * scale);
    }
    return true;
  };

  const segs = [];
  if (shape.tris) {
    const tmp = [];
    for (let t = 0; t < shape.tris.length; t += 3) {
      const a = shape.tris[t], b = shape.tris[t + 1], c = shape.tris[t + 2];
      tmp.length = 0;
      crossing(a, b, tmp);
      crossing(b, c, tmp);
      crossing(c, a, tmp);
      if (tmp.length === 6) segs.push(...tmp);
    }
  }

  const points = [];
  for (let e = 0; e < shape.edges.length; e += 2) {
    crossing(shape.edges[e], shape.edges[e + 1], points);
  }

  return { segs: new Float32Array(segs), points: new Float32Array(points) };
}
