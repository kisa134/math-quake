// Pure voxel-destruction domain (R1: extracted from store.ts). No React, no
// store, no framework — a cold-path factory that produces valid-at-creation
// debris chunks. The store is a transport for state, not a voxel engine.
// See docs/increments/02-voxel-destruction.md.

export interface DebrisChunk {
  id: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  color: string;
  size: number;
  createdAt: number;
  rx?: number; ry?: number; rz?: number;   // current rotation (rad)
  sx?: number; sy?: number; sz?: number;   // spin velocity (rad/s)
  life?: number;                           // seconds to live
}

/** Minimal shape a killed thing needs to shatter (store's Enemy satisfies it). */
export interface Shatterable {
  type: string;
  position: [number, number, number];
}

export const DEBRIS_CAP = 256;
const SMALL_COUNT = 10, CANDLE_COUNT = 18;
const RADIAL = 12, SCATTER = 8, POP_UP = 6, SPIN = 8;
const NEON = ['#f72585', '#00f5d4', '#4361ee', '#7209b7', '#4cc9f0', '#b5179e'];

/**
 * Pixel-fire burst: small bright chunks that lick UPWARD from a point, colors
 * ramping from the weapon/spell base color toward yellow-white (hottest chunks
 * whitest — classic pixel-art fire). Rides the existing Debris pool: callers do
 * `addDebris(makeFlames(...))` — no new render system, capped by DEBRIS_CAP.
 */
export function makeFlames(
  pos: [number, number, number],
  baseColor: string,
  count = 6,
): Omit<DebrisChunk, 'id' | 'createdAt'>[] {
  const [x, y, z] = pos;
  const n = parseInt(baseColor.replace('#', ''), 16);
  const br = Number.isNaN(n) ? 255 : (n >> 16) & 255;
  const bg = Number.isNaN(n) ? 136 : (n >> 8) & 255;
  const bb = Number.isNaN(n) ? 0 : n & 255;
  const out: Omit<DebrisChunk, 'id' | 'createdAt'>[] = [];
  for (let i = 0; i < count; i++) {
    // f=0 → pure base color, f=1 → hot yellow-white tip.
    const f = count > 1 ? i / (count - 1) : 1;
    const r = Math.round(br + (255 - br) * f);
    const g = Math.round(bg + (240 - bg) * f);
    const b = Math.round(bb + (170 - bb) * f * 0.9);
    const color = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    out.push({
      x: x + (Math.random() - 0.5) * 0.3,
      y: y + Math.random() * 0.15,
      z: z + (Math.random() - 0.5) * 0.3,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 2 + Math.random() * 4, // flames rise
      vz: (Math.random() - 0.5) * 1.6,
      color,
      size: 0.12 + Math.random() * 0.13,
      rx: 0, ry: 0, rz: 0,
      sx: (Math.random() - 0.5) * 6,
      sy: (Math.random() - 0.5) * 6,
      sz: (Math.random() - 0.5) * 6,
      life: 0.5 + Math.random() * 0.4, // 500–900ms flicker
    });
  }
  return out;
}

export const colorForEnemy = (e: Shatterable): string =>
  e.type === 'candle'
    ? (Math.random() > 0.5 ? '#00f5d4' : '#f72585')
    : NEON[Math.floor(Math.random() * NEON.length)];

/** Pre-fractured voxel chunks launched radially away from the impact point. */
export function makeChunks(enemy: Shatterable, impact: [number, number, number]): DebrisChunk[] {
  const isCandle = enemy.type === 'candle';
  const count = isCandle ? CANDLE_COUNT : SMALL_COUNT;
  const [cx, cy, cz] = enemy.position;
  const baseHalf = isCandle ? 1.5 : 1;
  const color = colorForEnemy(enemy);
  const now = Date.now();
  const out: DebrisChunk[] = [];
  for (let i = 0; i < count; i++) {
    const px = cx + (Math.random() - 0.5) * baseHalf * 2;
    const py = cy + (isCandle ? Math.random() * 5 : (Math.random() - 0.5) * baseHalf * 2);
    const pz = cz + (Math.random() - 0.5) * baseHalf * 2;
    let dx = px - impact[0], dy = py - impact[1], dz = pz - impact[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    out.push({
      id: Math.random().toString(36).substring(2, 9),
      x: px, y: py, z: pz,
      vx: dx * RADIAL + (Math.random() - 0.5) * SCATTER,
      vy: dy * RADIAL + (Math.random() - 0.5) * SCATTER + POP_UP,
      vz: dz * RADIAL + (Math.random() - 0.5) * SCATTER,
      color,
      size: baseHalf * (0.25 + Math.random() * 0.35),
      createdAt: now,
      rx: 0, ry: 0, rz: 0,
      sx: (Math.random() - 0.5) * 2 * SPIN,
      sy: (Math.random() - 0.5) * 2 * SPIN,
      sz: (Math.random() - 0.5) * 2 * SPIN,
      life: isCandle ? 2.8 : 2.5,
    });
  }
  return out;
}
