#!/usr/bin/env python3
"""
main.py — Entry point for the 4-D Level-Surface Visualiser (desktop).

The flagship interactive version lives in docs/ (web, GitHub Pages);
this ModernGL build is its native desktop counterpart.

Controls
--------
Right-drag        Rotate camera
Middle-drag       Pan camera
Scroll            Zoom in / out
Shift + Scroll    Move w_target (opaque slice along 4th dimension)
Space             Toggle auto-rotation in 4-D
1                 Tesseract (8-cell)        6   120-Cell
2                 5-Cell (4-simplex)        7   Duoprism 6x6
3                 16-Cell                   8   Rectified Tesseract
4                 24-Cell                   9   Clifford Torus
5                 600-Cell                  0   Klein Bottle (4D)
E                 Toggle edge wireframe
F                 Toggle filled faces
R                 Reset view
"""

import moderngl_window
from render_engine import FourDVisualizer

if __name__ == '__main__':
    moderngl_window.run_window_config(FourDVisualizer)
