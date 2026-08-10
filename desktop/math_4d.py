"""
math_4d.py — Mathematical foundations for 4D visualization.

Provides 5x5 homogeneous transformation matrices, 4D rotation functions
for all 6 planes, and a library of shape generators: all six regular
4-polytopes, duoprisms, rectifications, and curved manifolds.

Every generator returns (vertices, edges, triangles):
    vertices  (N, 5) float64 — homogeneous 4D points (x, y, z, w, 1)
    edges     (E, 2) int     — index pairs, rendered as lines
    triangles (T, 3) int     — triangulated faces (may be empty)
"""

import itertools
import numpy as np

PHI = (1 + np.sqrt(5)) / 2


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
# Construction helpers
# ---------------------------------------------------------------------------

def _package(verts4, edges, tris, target_radius=2.0):
    """Scale to a common radius and convert to the (N,5) homogeneous form."""
    verts4 = np.asarray(verts4, dtype=np.float64)
    r = np.linalg.norm(verts4, axis=1).max()
    if r > 1e-9:
        verts4 = verts4 * (target_radius / r)
    vertices = np.hstack([verts4, np.ones((len(verts4), 1))])
    edges = np.asarray(edges, dtype=np.int64).reshape(-1, 2)
    tris = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
    return vertices, edges, tris


def _dedup(verts):
    seen, out = set(), []
    for v in verts:
        k = tuple(np.round(v, 6))
        if k not in seen:
            seen.add(k)
            out.append(list(v))
    return out


def _min_dist_edges(verts4):
    """Connect every closest pair — in a uniform polytope these are the edges."""
    v = np.asarray(verts4, dtype=np.float64)
    d2 = np.sum((v[:, None, :] - v[None, :, :]) ** 2, axis=-1)
    iu = np.triu_indices(len(v), k=1)
    dmin = d2[iu].min()
    mask = d2[iu] <= dmin * 1.02
    return list(zip(iu[0][mask], iu[1][mask]))


def _tri_cliques(n, edges):
    """3-cliques of the edge graph = faces of simplex-faced polytopes."""
    adj = [set() for _ in range(n)]
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    tris = []
    for a, b in edges:
        for c in adj[a] & adj[b]:
            if c > b:
                tris.append((a, b, c))
    return tris


def _signed_perms(template, even_only=False):
    """Expand a coordinate template over (even) permutations and all signs."""
    out = []
    for perm in itertools.permutations(range(4)):
        if even_only:
            inv = sum(1 for i in range(4) for j in range(i + 1, 4)
                      if perm[i] > perm[j])
            if inv % 2:
                continue
        base = [template[p] for p in perm]
        for signs in itertools.product((1, -1), repeat=4):
            out.append([b * s for b, s in zip(base, signs)])
    return _dedup(out)


def _grid_surface(f, nu, nv, u0, u1, v0, v1, wrap_u=False, wrap_v=False):
    """Parametric surface -> wireframe grid + quad triangulation."""
    cols = nu if wrap_u else nu + 1
    rows = nv if wrap_v else nv + 1
    verts = []
    for iu in range(cols):
        u = u0 + (u1 - u0) * iu / nu
        for iv in range(rows):
            v = v0 + (v1 - v0) * iv / nv
            verts.append(f(u, v))
    idx = lambda iu, iv: (iu % cols) * rows + (iv % rows)
    edges, tris = [], []
    for iu in range(cols):
        for iv in range(rows):
            has_u = wrap_u or iu < cols - 1
            has_v = wrap_v or iv < rows - 1
            if has_u:
                edges.append((idx(iu, iv), idx(iu + 1, iv)))
            if has_v:
                edges.append((idx(iu, iv), idx(iu, iv + 1)))
            if has_u and has_v:
                a, b = idx(iu, iv), idx(iu + 1, iv)
                c, d = idx(iu + 1, iv + 1), idx(iu, iv + 1)
                tris += [(a, b, c), (a, c, d)]
    return verts, edges, tris


# ---------------------------------------------------------------------------
# Shape Generators — the six regular 4-polytopes
# ---------------------------------------------------------------------------

def generate_5cell():
    """5 vertices, 10 edges, 10 faces, 5 tetrahedral cells (regular 4-simplex)."""
    s5 = np.sqrt(5.0)
    verts = [
        [1, 1, 1, -1 / s5],
        [1, -1, -1, -1 / s5],
        [-1, 1, -1, -1 / s5],
        [-1, -1, 1, -1 / s5],
        [0, 0, 0, 4 / s5],
    ]
    edges = _min_dist_edges(verts)
    return _package(verts, edges, _tri_cliques(5, edges))


def generate_tesseract():
    """16 vertices, 32 edges, 24 square faces, 8 cubic cells."""
    verts = [[x, y, z, w]
             for x in (-1, 1) for y in (-1, 1)
             for z in (-1, 1) for w in (-1, 1)]
    edges = _min_dist_edges(verts)          # Hamming-distance-1 pairs
    lookup = {tuple(v): i for i, v in enumerate(verts)}
    tris = []
    for a in range(4):
        for b in range(a + 1, 4):
            rest = [c for c in range(4) if c not in (a, b)]
            for s0 in (-1, 1):
                for s1 in (-1, 1):
                    def corner(va, vb):
                        v = [0, 0, 0, 0]
                        v[rest[0]], v[rest[1]] = s0, s1
                        v[a], v[b] = va, vb
                        return lookup[tuple(v)]
                    p, q = corner(-1, -1), corner(1, -1)
                    r, t = corner(1, 1), corner(-1, 1)
                    tris += [(p, q, r), (p, r, t)]
    return _package(verts, edges, tris)


def generate_16cell():
    """8 vertices, 24 edges, 32 faces, 16 tetrahedral cells (4D octahedron)."""
    verts = []
    for axis in range(4):
        for s in (1, -1):
            v = [0, 0, 0, 0]
            v[axis] = s
            verts.append(v)
    edges = _min_dist_edges(verts)
    return _package(verts, edges, _tri_cliques(8, edges))


def generate_24cell():
    """24 vertices, 96 edges, 96 faces, 24 octahedral cells — unique to 4D."""
    verts = _signed_perms([1, 1, 0, 0])
    edges = _min_dist_edges(verts)
    return _package(verts, edges, _tri_cliques(len(verts), edges))


def generate_600cell():
    """120 vertices, 720 edges, 1200 faces, 600 tetrahedral cells."""
    verts = _dedup(
        _signed_perms([0.5, 0.5, 0.5, 0.5])
        + _signed_perms([1, 0, 0, 0])
        + _signed_perms([PHI / 2, 0.5, 1 / (2 * PHI), 0], even_only=True)
    )
    edges = _min_dist_edges(verts)
    return _package(verts, edges, _tri_cliques(len(verts), edges))


def generate_120cell():
    """600 vertices, 1200 edges, 120 dodecahedral cells (faces left empty)."""
    s5 = np.sqrt(5.0)
    verts = _dedup(
        _signed_perms([0, 0, 2, 2])
        + _signed_perms([1, 1, 1, s5])
        + _signed_perms([PHI ** -2, PHI, PHI, PHI])
        + _signed_perms([PHI ** -1, PHI ** -1, PHI ** -1, PHI ** 2])
        + _signed_perms([0, PHI ** -2, 1, PHI ** 2], even_only=True)
        + _signed_perms([0, PHI ** -1, PHI, s5], even_only=True)
        + _signed_perms([PHI ** -1, 1, PHI, 2], even_only=True)
    )
    edges = _min_dist_edges(verts)
    return _package(verts, edges, [])


# ---------------------------------------------------------------------------
# Derived and curved shapes
# ---------------------------------------------------------------------------

def generate_rectified_tesseract():
    """Vertices at the tesseract's edge midpoints: 32 vertices, 96 edges."""
    v, e, _ = generate_tesseract()
    mids = _dedup([(v[a, :4] + v[b, :4]) / 2 for a, b in e])
    edges = _min_dist_edges(mids)
    return _package(mids, edges, _tri_cliques(len(mids), edges))


def generate_duoprism(p=6, q=6):
    """p-gon × q-gon duoprism: two polygons in perpendicular planes."""
    tau = 2 * np.pi
    verts = [[np.cos(tau * i / p), np.sin(tau * i / p),
              np.cos(tau * j / q), np.sin(tau * j / q)]
             for i in range(p) for j in range(q)]
    idx = lambda i, j: (i % p) * q + (j % q)
    edges, tris = [], []
    for i in range(p):
        for j in range(q):
            edges += [(idx(i, j), idx(i + 1, j)), (idx(i, j), idx(i, j + 1))]
            tris += [(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)),
                     (idx(i, j), idx(i + 1, j + 1), idx(i, j + 1))]
    return _package(verts, edges, tris)


def generate_clifford_torus(res=32):
    """Flat torus on the 3-sphere — only possible in 4D."""
    s = 1 / np.sqrt(2)
    f = lambda u, v: [s * np.cos(u), s * np.sin(u), s * np.cos(v), s * np.sin(v)]
    verts, edges, tris = _grid_surface(f, res, res, 0, 2 * np.pi, 0, 2 * np.pi,
                                       wrap_u=True, wrap_v=True)
    return _package(verts, edges, tris)


def generate_klein_bottle(res=40):
    """The Klein bottle's true (non-self-intersecting) embedding in R^4."""
    R, r = 1.0, 0.45
    def f(u, v):
        return [(R + r * np.cos(v)) * np.cos(u),
                (R + r * np.cos(v)) * np.sin(u),
                r * np.sin(v) * np.cos(u / 2),
                r * np.sin(v) * np.sin(u / 2)]
    verts, edges, tris = _grid_surface(f, res, int(res * 0.6),
                                       0, 2 * np.pi, 0, 2 * np.pi,
                                       wrap_u=False, wrap_v=True)
    return _package(verts, edges, tris)


# ---------------------------------------------------------------------------
# Cross-section & normals helpers
# ---------------------------------------------------------------------------

def compute_face_normals(vertices, triangles):
    """
    Compute a unit 3D normal for every triangle using the (x,y,z) coords.
    Returns an (N, 3) float64 array. Vectorized.
    """
    tri = np.asarray(triangles)
    if len(tri) == 0:
        return np.zeros((0, 3), dtype=np.float64)
    a = vertices[tri[:, 0], :3]
    e1 = vertices[tri[:, 1], :3] - a
    e2 = vertices[tri[:, 2], :3] - a
    n = np.cross(e1, e2)
    length = np.linalg.norm(n, axis=1, keepdims=True)
    length[length < 1e-12] = 1.0
    n /= length
    return n


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
