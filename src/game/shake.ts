/**
 * Camera-trauma screen shake (Vlambeer "Art of Screenshake" model).
 *
 * A single additive `trauma` value in [0,1] that decays over time; the actual
 * shake is `trauma²` (quadratic reads better than linear). Kept as a tiny
 * module singleton — anything can `addTrauma()` (kills, taking damage, big
 * weapons) and the camera owner samples an offset each frame.
 *
 * IMPORTANT: this only produces a POSITIONAL offset. Yaw/pitch belong to
 * PointerLockControls; we never touch camera rotation, so shake can never
 * desync aim in this online game. No time-distortion involved.
 */
let trauma = 0;

const DECAY = 1.5;       // trauma units shed per second
const MAX_OFFSET = 0.45; // peak positional shake in world units at trauma=1

export function addTrauma(amount: number) {
  trauma = Math.min(1, trauma + amount);
}

// smooth pseudo-noise (summed sines) — NOT Math.random(), which looks like static
function noise(seed: number, t: number): number {
  return Math.sin(t * (11 + seed) + seed * 7.13) * 0.6
       + Math.sin(t * (23 + seed) + seed * 3.7) * 0.4;
}

/** Write the current shake offset into `out` and advance/decay by `dt`. */
export function sampleShake(dt: number, out: { x: number; y: number; z: number }) {
  const shake = trauma * trauma;
  if (shake <= 0.0001) {
    out.x = 0; out.y = 0; out.z = 0;
    trauma = 0;
    return;
  }
  const t = performance.now() * 0.001;
  const amp = MAX_OFFSET * shake;
  out.x = noise(1, t) * amp;
  out.y = noise(5, t) * amp;
  out.z = noise(9, t) * amp;
  trauma = Math.max(0, trauma - DECAY * dt);
}
