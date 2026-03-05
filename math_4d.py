"""
math_4d.py — Mathematical foundations for 4D visualization.

Provides 5x5 homogeneous transformation matrices, 4D rotation functions
for all 6 planes, shape generators (Tesseract, 5-Cell), and cross-section
computation.
"""

import numpy as np


# ---------------------------------------------------------------------------
# 5x5 Transformation Matrices (Homogeneous 4D)
# ---------------------------------------------------------------------------

def identity():
    """Return a 5x5 identity matrix."""
    return np.eye(5, dtype=np.float64)


def translate(dx, dy, dz, dw):
    m = identity()
    m[0, 4] = dx
    m[1, 4] = dy
    m[2, 4] = dz
    m[3, 4] = dw
    return m


def scale(sx, sy, sz, sw):
    m = identity()
    m[0, 0] = sx
    m[1, 1] = sy
    m[2, 2] = sz
    m[3, 3] = sw
    return m


# ---------------------------------------------------------------------------
# 4D Rotations — one for each of the 6 coordinate planes
# ---------------------------------------------------------------------------

def _rotation_in_plane(i, j, theta):
    """Build a 5x5 rotation matrix in the (i,j) plane by angle *theta*."""
    c, s = np.cos(theta), np.sin(theta)
    m = identity()
    m[i, i] = c;  m[i, j] = -s
    m[j, i] = s;  m[j, j] = c
    return m


def rotate_XY(theta): return _rotation_in_plane(0, 1, theta)
def rotate_XZ(theta): return _rotation_in_plane(0, 2, theta)
def rotate_YZ(theta): return _rotation_in_plane(1, 2, theta)
def rotate_XW(theta): return _rotation_in_plane(0, 3, theta)
def rotate_YW(theta): return _rotation_in_plane(1, 3, theta)
def rotate_ZW(theta): return _rotation_in_plane(2, 3, theta)

ROTATION_FUNCS = {
    'XY': rotate_XY, 'XZ': rotate_XZ, 'YZ': rotate_YZ,
    'XW': rotate_XW, 'YW': rotate_YW, 'ZW': rotate_ZW,
}


def apply_transform(vertices, matrix):
    """Apply a 5x5 matrix to an (N, 5) array of homogeneous vertices."""
    return (matrix @ vertices.T).T


# ---------------------------------------------------------------------------
# Shape Generators
# ---------------------------------------------------------------------------

def _vertex_index_map(vertices):
    """Return a dict mapping (x,y,z,w) rounded tuples -> index."""
    return {tuple(np.round(v[:4], 8)): i for i, v in enumerate(vertices)}


def generate_tesseract():
    """
    16 vertices, 32 edges, 24 square faces (= 48 triangles) of a unit tesseract
    centred at the origin with vertices at (±1, ±1, ±1, ±1).
    """
    # --- vertices ---
    verts = []
    for x in (-1, 1):
        for y in (-1, 1):
            for z in (-1, 1):
                for w in (-1, 1):
                    verts.append([x, y, z, w, 1.0])
    vertices = np.array(verts, dtype=np.float64)

    idx = _vertex_index_map(vertices)

    # --- edges (differ in exactly 1 coord) ---
    edges = []
    for i in range(16):
        for j in range(i + 1, 16):
            if np.sum(vertices[i, :4] != vertices[j, :4]) == 1:
                edges.append((i, j))

    # --- faces (triangulated squares) ---
    triangles = []
    axes = list(range(4))
    for a in range(4):
        for b in range(a + 1, 4):
            fixed = [c for c in axes if c not in (a, b)]
            for fv0 in (-1, 1):
                for fv1 in (-1, 1):
                    coords = [0.0] * 4
                    coords[fixed[0]] = fv0
                    coords[fixed[1]] = fv1
                    # four corners of the square
                    corners = {}
                    for va in (-1, 1):
                        for vb in (-1, 1):
                            c = list(coords)
                            c[a] = va; c[b] = vb
                            corners[(va, vb)] = idx[tuple(np.round(c, 8))]
                    # two triangles per quad
                    triangles.append((corners[(-1, -1)], corners[(1, -1)], corners[(1, 1)]))
                    triangles.append((corners[(-1, -1)], corners[(1, 1)], corners[(-1, 1)]))

    return vertices, edges, triangles


def generate_5cell():
    """
    5 vertices, 10 edges, 10 triangular faces of the regular 5-cell
    (4-simplex) inscribed in the unit 3-sphere.
    """
    # Coordinates of a regular 5-cell (vertices of a 4-simplex)
    a = 1.0 / np.sqrt(10.0)
    b = 1.0 / np.sqrt(6.0)
    c = 1.0 / np.sqrt(3.0)
    vertices = np.array([
        [ 1.0,  0.0, -b, -a, 1.0],
        [-1.0,  0.0, -b, -a, 1.0],
        [ 0.0,  1.0,  b, -a, 1.0],
        [ 0.0, -1.0,  b, -a, 1.0],
        [ 0.0,  0.0,  0.0,  4*a, 1.0],
    ], dtype=np.float64)

    # Every pair is an edge
    edges = [(i, j) for i in range(5) for j in range(i + 1, 5)]
    # Every triple is a face
    triangles = [(i, j, k)
                 for i in range(5) for j in range(i + 1, 5) for k in range(j + 1, 5)]

    return vertices, edges, triangles


# ---------------------------------------------------------------------------
# Cross-section & normals helpers
# ---------------------------------------------------------------------------

def compute_face_normals(vertices, triangles):
    """
    Compute a unit 3D normal for every triangle using the (x,y,z) coords.
    Returns an (N, 3) float64 array.
    """
    normals = np.empty((len(triangles), 3), dtype=np.float64)
    for ti, (a, b, c) in enumerate(triangles):
        e1 = vertices[b, :3] - vertices[a, :3]
        e2 = vertices[c, :3] - vertices[a, :3]
        n = np.cross(e1, e2)
        length = np.linalg.norm(n)
        normals[ti] = n / length if length > 1e-12 else [0, 0, 1]
    return normals


def edge_cross_section(vertices, edges, w_target):
    """
    Find 3D points where edges of the 4D object cross the w = w_target
    hyperplane.  Returns an (M, 3) float64 array of intersection points.
    """
    pts = []
    eps = 1e-10
    for i, j in edges:
        w0, w1 = vertices[i, 3], vertices[j, 3]
        if abs(w1 - w0) < eps:
            if abs(w0 - w_target) < eps:
                pts.append(vertices[i, :3].copy())
            continue
        t = (w_target - w0) / (w1 - w0)
        if -eps <= t <= 1.0 + eps:
            pt = vertices[i, :3] + t * (vertices[j, :3] - vertices[i, :3])
            pts.append(pt)
    return np.array(pts, dtype=np.float64) if pts else np.zeros((0, 3), dtype=np.float64)
