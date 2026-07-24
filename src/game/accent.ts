import * as THREE from 'three';
import { audioReactive } from './audioReactive';

/**
 * V5 «Монохром живого рынка» — THE ONE ACCENT COLOR, conducted by the market.
 * The whole world (city light strips, MA-20, HUD, crosshair) reads this single
 * mutable color; the conductor's epoch drives it. Кровь всегда кримзон — она
 * вне моды. Smoothly lerped so epoch turns feel like weather, not a light
 * switch. Zero React state — consumers copy in useFrame / rAF.
 */
export const EPOCH_ACCENTS = [
  '#c8b273', // НАКОПЛЕНИЕ — приглушённое золото
  '#2fbf71', // ПАМП — изумруд
  '#ffe8b0', // ЭЙФОРИЯ — белое золото
  '#ff7b00', // РАСПРОДАЖА — оранж
  '#ff2d55', // КАПИТУЛЯЦИЯ — кримзон: мир краснеет
  '#8fa3ad', // ТИШИНА — пепельно-голубой
];

export const accent = new THREE.Color(EPOCH_ACCENTS[0]);
export const accentHex = { v: EPOCH_ACCENTS[0] };

const _target = new THREE.Color(EPOCH_ACCENTS[0]);
let _lastCssPush = 0;

/** Call once per frame (AccentDriver): lerp toward the epoch color + push CSS var (~5Hz). */
export function updateAccent(epoch: number, dt: number, nowMs: number) {
  _target.set(EPOCH_ACCENTS[epoch] ?? EPOCH_ACCENTS[0]);
  // V7.6: the whole world breathes with the track — subtle brightness swell on
  // the beat («вкусно, не диско»: max ~+13%). Applied to the LERP TARGET so it
  // self-corrects (never accumulates), then accent eases toward it.
  const beat = 1 + audioReactive.level * 0.13;
  _target.multiplyScalar(beat);
  accent.lerp(_target, Math.min(1, dt * 1.6));
  if (nowMs - _lastCssPush > 200) {
    _lastCssPush = nowMs;
    accentHex.v = `#${accent.getHexString()}`;
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--accent', accentHex.v);
    }
  }
}
