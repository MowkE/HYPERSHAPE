/**
 * palettes.js — color maps for the w axis.
 *
 * Each palette is a function t∈[0,1] → [r,g,b] in [0,1]. t=0 is the most
 * negative w ("behind" us in the 4th dimension), t=1 the most positive
 * ("ahead"). The palettes are sampled once into a texture (one row per
 * palette) so the fragment shader does a single texture fetch, and the same
 * samples paint the on-screen legend.
 */

function lerpStops(stops) {
  // stops: [[t, r, g, b], ...] sorted by t
  return (t) => {
    if (t <= stops[0][0]) return stops[0].slice(1);
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, ...a] = stops[i - 1];
        const [t1, ...b] = stops[i];
        const f = (t - t0) / (t1 - t0 || 1);
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    return stops[stops.length - 1].slice(1);
  };
}

/** Google's Turbo colormap, 5th-degree polynomial fit. */
function turbo(t) {
  t = Math.min(Math.max(t, 0), 1);
  const r = 0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b = 0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return [Math.min(Math.max(r, 0), 1), Math.min(Math.max(g, 0), 1), Math.min(Math.max(b, 0), 1)];
}

export const PALETTES = [
  {
    id: 'thermal',
    name: 'Thermal',
    fn: lerpStops([
      [0.0, 0.15, 0.25, 0.95],   // deep blue  = far negative w
      [0.5, 0.60, 0.60, 0.66],   // neutral    = w ≈ 0
      [1.0, 0.98, 0.26, 0.16],   // hot red    = far positive w
    ]),
  },
  { id: 'turbo', name: 'Turbo', fn: turbo },
  {
    id: 'viridis',
    name: 'Viridis',
    fn: lerpStops([
      [0.00, 0.267, 0.005, 0.329],
      [0.20, 0.254, 0.265, 0.530],
      [0.40, 0.164, 0.471, 0.558],
      [0.60, 0.135, 0.659, 0.518],
      [0.80, 0.478, 0.821, 0.318],
      [1.00, 0.993, 0.906, 0.144],
    ]),
  },
  {
    id: 'neon',
    name: 'Neon',
    fn: lerpStops([
      [0.0, 0.05, 0.95, 1.00],
      [0.5, 0.55, 0.40, 1.00],
      [1.0, 1.00, 0.20, 0.75],
    ]),
  },
  {
    id: 'ice',
    name: 'Ice',
    fn: lerpStops([
      [0.0, 0.06, 0.12, 0.55],
      [0.5, 0.30, 0.60, 1.00],
      [1.0, 0.90, 0.98, 1.00],
    ]),
  },
];

export const PALETTE_SIZE = 256;

/** Sample every palette into one RGBA byte array (rows = palettes). */
export function buildPaletteImage() {
  const data = new Uint8Array(PALETTES.length * PALETTE_SIZE * 4);
  PALETTES.forEach((p, row) => {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const [r, g, b] = p.fn(i / (PALETTE_SIZE - 1));
      const o = (row * PALETTE_SIZE + i) * 4;
      data[o] = r * 255; data[o + 1] = g * 255; data[o + 2] = b * 255; data[o + 3] = 255;
    }
  });
  return data;
}

/** Sample a single palette color (used for the legend + slice highlight). */
export function sample(paletteIndex, t) {
  return PALETTES[paletteIndex].fn(Math.min(Math.max(t, 0), 1));
}
