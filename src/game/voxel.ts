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
