"""
render_engine.py — Interactive 4D visualizer using ModernGL + pyglet.

Renders 4D objects as translucent, colour-gradated 3D surfaces.
The w-coordinate controls colour (red ↔ blue) and transparency
(exponential decay from a user-selected w_target).
"""

import moderngl
import moderngl_window as mglw
import numpy as np
from pyrr import Matrix44, Vector3
import math

from math_4d import (
    identity, apply_transform, ROTATION_FUNCS,
    generate_tesseract, generate_5cell,
    compute_face_normals,
)

# ──────────────────────────────────────────────────────────────────────────────
# GLSL Shaders
# ──────────────────────────────────────────────────────────────────────────────

SURFACE_VS = """
#version 330
uniform mat4 m_proj;
uniform mat4 m_view;

in vec3 in_position;
in float in_w;
in vec3 in_normal;

out float v_w;
out vec3 v_normal;
out vec3 v_view_pos;

void main() {
    vec4 vp = m_view * vec4(in_position, 1.0);
    gl_Position = m_proj * vp;
    v_w        = in_w;
    v_normal   = mat3(m_view) * in_normal;
    v_view_pos = vp.xyz;
}
"""

SURFACE_FS = """
#version 330
uniform float w_target;
uniform float alpha_decay;

in float v_w;
in vec3 v_normal;
in vec3 v_view_pos;

out vec4 f_color;

void main() {
    // ── colour: gray at w=0, red at +w, blue at −w ──
    vec3 col = vec3(0.50, 0.50, 0.50);
    if (v_w > 0.0) {
        float t = clamp(v_w / 1.5, 0.0, 1.0);
        col = mix(col, vec3(0.95, 0.22, 0.18), t);
    } else {
        float t = clamp(-v_w / 1.5, 0.0, 1.0);
        col = mix(col, vec3(0.18, 0.35, 0.95), t);
    }

    // ── alpha: exponential decay from w_target ──
    float alpha = exp(-alpha_decay * abs(v_w - w_target));
    alpha = clamp(alpha, 0.03, 1.0);

    // ── lighting (two-sided Lambert + ambient) ──
    vec3 N = normalize(v_normal);
    vec3 L = normalize(vec3(0.35, 1.0, 0.55));
    float diff = abs(dot(N, L));
    float lit  = 0.30 + 0.70 * diff;

    // ── depth dimming ──
    float depth_dim = clamp(1.0 - (-v_view_pos.z) / 25.0, 0.30, 1.0);

    f_color = vec4(col * lit * depth_dim, alpha);
}
"""

EDGE_VS = """
#version 330
uniform mat4 m_proj;
uniform mat4 m_view;

in vec3 in_position;
in float in_w;

out float v_w;
out float v_depth;

void main() {
    vec4 vp = m_view * vec4(in_position, 1.0);
    gl_Position = m_proj * vp;
    v_w     = in_w;
    v_depth = -vp.z;
}
"""

EDGE_FS = """
#version 330
uniform float w_target;
uniform float alpha_decay;

in float v_w;
in float v_depth;

out vec4 f_color;

void main() {
    vec3 col = vec3(0.75);
    if (v_w > 0.0) {
        float t = clamp(v_w / 1.5, 0.0, 1.0);
        col = mix(col, vec3(1.0, 0.45, 0.35), t);
    } else {
        float t = clamp(-v_w / 1.5, 0.0, 1.0);
        col = mix(col, vec3(0.35, 0.55, 1.0), t);
    }
    float alpha = exp(-alpha_decay * abs(v_w - w_target));
    alpha = clamp(alpha, 0.06, 1.0);
    float dim = clamp(1.0 - v_depth / 25.0, 0.30, 1.0);
    f_color = vec4(col * dim, alpha);
}
"""

# ──────────────────────────────────────────────────────────────────────────────
# Visualiser Window
# ──────────────────────────────────────────────────────────────────────────────

class FourDVisualizer(mglw.WindowConfig):
    gl_version = (3, 3)
    title = "4-D Level-Surface Visualiser"
    window_size = (1280, 720)
    resizable = True

    # ── lifecycle ─────────────────────────────────────────────────────────
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        # state
        self.w_target = 0.0
        self.alpha_decay = 2.5
        self.auto_rotate = True
        self.show_edges = True
        self.show_faces = True
        self.rot_angles = {k: 0.0 for k in ROTATION_FUNCS}

        # camera (orbit)
        self.cam_yaw = 0.45
        self.cam_pitch = 0.35
        self.cam_dist = 6.0
        self.cam_target = np.array([0.0, 0.0, 0.0], dtype=np.float64)

        # mouse tracking
        self._buttons = set()
        self._shift = False

        # shaders
        self.surface_prog = self.ctx.program(vertex_shader=SURFACE_VS,
                                              fragment_shader=SURFACE_FS)
        self.edge_prog = self.ctx.program(vertex_shader=EDGE_VS,
                                           fragment_shader=EDGE_FS)

        # allocate streaming buffers (large enough for tesseract)
        self._max_tri = 60          # triangles
        self._max_edge = 40         # edges
        surf_bytes = self._max_tri * 3 * 7 * 4   # 3 verts × 7 floats × 4B
        edge_bytes = self._max_edge * 2 * 4 * 4  # 2 verts × 4 floats × 4B
        self.surface_vbo = self.ctx.buffer(reserve=surf_bytes)
        self.edge_vbo = self.ctx.buffer(reserve=edge_bytes)
        self.surface_vao = self.ctx.vertex_array(
            self.surface_prog,
            [(self.surface_vbo, '3f 1f 3f', 'in_position', 'in_w', 'in_normal')],
        )
        self.edge_vao = self.ctx.vertex_array(
            self.edge_prog,
            [(self.edge_vbo, '3f 1f', 'in_position', 'in_w')],
        )

        # load default object
        self._load_object('tesseract')

    # ── object management ────────────────────────────────────────────────
    def _load_object(self, name):
        if name == 'tesseract':
            self.base_verts, self.edges, self.tris = generate_tesseract()
        elif name == '5cell':
            self.base_verts, self.edges, self.tris = generate_5cell()
        self.current_object = name
        self._dirty = True

    # ── camera helpers ───────────────────────────────────────────────────
    def _eye(self):
        cp, cy = math.cos(self.cam_pitch), math.cos(self.cam_yaw)
        sp, sy = math.sin(self.cam_pitch), math.sin(self.cam_yaw)
        return self.cam_target + self.cam_dist * np.array(
            [cp * sy, sp, cp * cy], dtype=np.float64)

    def _view_matrix(self):
        eye = self._eye()
        return Matrix44.look_at(
            Vector3(eye, dtype='f4'),
            Vector3(self.cam_target, dtype='f4'),
            Vector3([0, 1, 0], dtype='f4'),
            dtype='f4',
        )

    def _proj_matrix(self):
        w, h = self.window_size
        return Matrix44.perspective_projection(
            55.0, w / max(h, 1), 0.1, 100.0, dtype='f4')

    # ── geometry rebuild ─────────────────────────────────────────────────
    def _rebuild(self):
        # apply 4-D rotation
        m = identity()
        for plane, angle in self.rot_angles.items():
            if abs(angle) > 1e-9:
                m = ROTATION_FUNCS[plane](angle) @ m
        tv = apply_transform(self.base_verts, m)
        self._tv = tv  # keep for sorting

        # surface data  (N_tri × 3verts × 7 floats)
        normals = compute_face_normals(tv, self.tris)
        buf = np.empty((len(self.tris), 3, 7), dtype=np.float32)
        for ti, (a, b, c) in enumerate(self.tris):
            n = normals[ti]
            for vi, idx in enumerate((a, b, c)):
                buf[ti, vi, :3] = tv[idx, :3]
                buf[ti, vi, 3]  = tv[idx, 3]
                buf[ti, vi, 4:] = n
        self._surf_buf = buf   # shape (N, 3, 7)

        # edge data  (N_edge × 2verts × 4 floats)
        ebuf = np.empty((len(self.edges), 2, 4), dtype=np.float32)
        for ei, (a, b) in enumerate(self.edges):
            ebuf[ei, 0, :3] = tv[a, :3]; ebuf[ei, 0, 3] = tv[a, 3]
            ebuf[ei, 1, :3] = tv[b, :3]; ebuf[ei, 1, 3] = tv[b, 3]
        self._edge_bytes = ebuf.tobytes()
        self._n_edge_verts = len(self.edges) * 2
        self._dirty = False

    # ── depth-sort triangles back-to-front ───────────────────────────────
    def _sorted_surface_bytes(self):
        eye = self._eye()
        centroids = self._surf_buf[:, :, :3].mean(axis=1)   # (N, 3)
        dists = np.linalg.norm(centroids - eye.astype(np.float32), axis=1)
        order = np.argsort(-dists)  # back-to-front
        return self._surf_buf[order].tobytes(), len(order) * 3

    # ── render ───────────────────────────────────────────────────────────
    def on_render(self, time, frame_time):
        self.ctx.clear(0.07, 0.07, 0.11, 1.0)

        # auto-rotate in 4-D
        if self.auto_rotate:
            self.rot_angles['XW'] += 0.30 * frame_time
            self.rot_angles['YW'] += 0.20 * frame_time
            self._dirty = True

        if self._dirty:
            self._rebuild()

        proj = self._proj_matrix()
        view = self._view_matrix()

        # transparency setup
        self.ctx.enable(moderngl.BLEND)
        self.ctx.blend_func = moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA
        self.ctx.enable(moderngl.DEPTH_TEST)
        self.ctx.depth_func = '<='

        # faces (depth-sorted, no depth-write for translucency)
        if self.show_faces:
            s_bytes, n_verts = self._sorted_surface_bytes()
            self.surface_vbo.orphan(len(s_bytes))
            self.surface_vbo.write(s_bytes)
            self.surface_prog['m_proj'].write(proj)
            self.surface_prog['m_view'].write(view)
            self.surface_prog['w_target'].value = self.w_target
            self.surface_prog['alpha_decay'].value = self.alpha_decay
            self.ctx.depth_mask = False
            self.surface_vao.render(moderngl.TRIANGLES, vertices=n_verts)

        # edges
        if self.show_edges:
            self.edge_vbo.orphan(len(self._edge_bytes))
            self.edge_vbo.write(self._edge_bytes)
            self.edge_prog['m_proj'].write(proj)
            self.edge_prog['m_view'].write(view)
            self.edge_prog['w_target'].value = self.w_target
            self.edge_prog['alpha_decay'].value = self.alpha_decay
            self.ctx.depth_mask = False
            self.edge_vao.render(moderngl.LINES, vertices=self._n_edge_verts)

        self.ctx.depth_mask = True   # restore

    # ── input handling ───────────────────────────────────────────────────
    def on_mouse_press_event(self, x, y, button):
        self._buttons.add(button)

    def on_mouse_release_event(self, x, y, button):
        self._buttons.discard(button)

    def on_mouse_drag_event(self, x, y, dx, dy):
        sens = 0.005
        if 2 in self._buttons:               # right-click → rotate camera
            self.cam_yaw   -= dx * sens * 2
            self.cam_pitch += dy * sens * 2
            self.cam_pitch = max(-1.5, min(1.5, self.cam_pitch))
        elif 3 in self._buttons:              # middle-click → pan
            right = np.array([ math.cos(self.cam_yaw), 0,
                              -math.sin(self.cam_yaw)])
            up = np.array([0, 1, 0], dtype=np.float64)
            self.cam_target -= right * dx * sens * self.cam_dist * 0.15
            self.cam_target += up    * dy * sens * self.cam_dist * 0.15

    def on_mouse_scroll_event(self, x_offset, y_offset):
        if self._shift:
            self.w_target += y_offset * 0.10
            print(f"w_target = {self.w_target:+.2f}")
        else:
            self.cam_dist *= 0.92 ** y_offset
            self.cam_dist = max(1.0, min(30.0, self.cam_dist))

    def on_key_event(self, key, action, modifiers):
        keys = self.wnd.keys
        if action == keys.ACTION_PRESS:
            self._shift = bool(modifiers.shift)
            if key == keys.SPACE:
                self.auto_rotate = not self.auto_rotate
                print("Auto-rotate:", "ON" if self.auto_rotate else "OFF")
            elif key == keys.NUMBER_1:
                self._load_object('tesseract')
                print("Loaded: Tesseract")
            elif key == keys.NUMBER_2:
                self._load_object('5cell')
                print("Loaded: 5-Cell")
            elif key == keys.E:
                self.show_edges = not self.show_edges
            elif key == keys.F:
                self.show_faces = not self.show_faces
            elif key == keys.R:
                self.rot_angles = {k: 0.0 for k in ROTATION_FUNCS}
                self.cam_yaw, self.cam_pitch, self.cam_dist = 0.45, 0.35, 6.0
                self.cam_target[:] = 0
                self.w_target = 0.0
                self._dirty = True
                print("Reset")
        elif action == keys.ACTION_RELEASE:
            self._shift = bool(modifiers.shift)
