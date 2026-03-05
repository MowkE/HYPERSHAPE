#!/usr/bin/env python3
"""
main.py — Entry point for the 4-D Level-Surface Visualiser.

Controls
--------
Right-drag        Rotate camera
Middle-drag       Pan camera
Scroll            Zoom in / out
Shift + Scroll    Move w_target (opaque slice along 4th dimension)
Space             Toggle auto-rotation in 4-D
1                 Load Tesseract (4-Cube)
2                 Load 5-Cell (4-Simplex)
E                 Toggle edge wireframe
F                 Toggle filled faces
R                 Reset view
"""

import moderngl_window
from render_engine import FourDVisualizer

if __name__ == '__main__':
    moderngl_window.run_window_config(FourDVisualizer)
