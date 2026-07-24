import type { DebrisChunk } from './voxel';

/**
 * Teardown-style VOXEL trading candles (V2.1). Pure data + carve logic — the
 * renderer is components/VoxelCandles.tsx. Each candle is a small voxel grid
 * (body + up/down wicks, like a real chart candle) frozen mid-explosion at
 * reachable heights; shooting carves voxels out in a radius, carved voxels fly
 * off through the existing Debris pool. Deterministic (seeded) so both players
 * see the same candles; carves replicate via the 'vox' broadcast into voxInbox.
 */
export interface VoxCandle {
  id: number;
  pos: [number, number, number]; // base (bottom-center of body)
  bull: boolean;
  phase: number;  // drift phase
  amp: number;    // bob amplitude
  speed: number;  // bob speed
  voxStart: number; // index of first voxel in the global arrays
  voxCount: number;
}

export interface VoxData {
  candles: VoxCandle[];
  // per-voxel, global across all candles:
  local: Float32Array;   // xyz local offset from candle base (stride 3)
  shade: Float32Array;   // per-voxel brightness variance 0.75..1.15
  total: number;
}

export const VOX_SIZE = 0.8;       // world size of one voxel cube
export const COLLAPSE_AT = 0.25;   // alive fraction below which the candle bursts

// Cross-module inbox: socket.ts pushes remote carves here; VoxelCandles drains
// it in useFrame (mirrors creatureHitInbox — avoids an import cycle).
export const voxInbox: { id: number; x: number; y: number; z: number; r: number }[] = [];

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Build the seeded candle field: ~44 candles ringing the arena at grapple-able
 *  heights, denser low, a few sentinels high on the climb route. */
export function generateVoxCandles(seed = 0xcafe): VoxData {
  const rnd = mulberry32(seed);
  const candles: VoxCandle[] = [];
  const localArr: number[] = [];
  const shadeArr: number[] = [];
  let vox = 0;

  const addCandle = (x: number, y: number, z: number) => {
    const bull = rnd() > 0.45;
    // chart-candle voxel layout: body 3×H×3 + top wick + bottom wick (1×n×1)
    const bodyH = 5 + Math.floor(rnd() * 4);      // 5..8
    const wickUp = 2 + Math.floor(rnd() * 3);     // 2..4
    const wickDn = 1 + Math.floor(rnd() * 2);     // 1..2
    const start = vox;
    const s = VOX_SIZE;
    for (let by = 0; by < bodyH; by++) {
      for (let bx = -1; bx <= 1; bx++) {
        for (let bz = -1; bz <= 1; bz++) {
          localArr.push(bx * s, (by + 0.5) * s, bz * s);
          shadeArr.push(0.75 + rnd() * 0.4);
          vox++;
        }
      }
    }
    for (let wy = 0; wy < wickUp; wy++) {
      localArr.push(0, (bodyH + wy + 0.5) * s, 0);
      shadeArr.push(0.9 + rnd() * 0.25);
      vox++;
    }
    for (let wy = 0; wy < wickDn; wy++) {
      localArr.push(0, -(wy + 0.5) * s, 0);
      shadeArr.push(0.9 + rnd() * 0.25);
      vox++;
    }
    candles.push({
      id: candles.length,
      pos: [x, y, z],
      bull,
      phase: rnd() * Math.PI * 2,
      amp: 1 + rnd() * 2,
      speed: 0.2 + rnd() * 0.5,
      voxStart: start,
      voxCount: vox - start,
    });
  };

  // ring field around the arena — reachable by jumps/grapple
  for (let i = 0; i < 34; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 60 + rnd() * 170;
    addCandle(Math.cos(a) * r, 26 + rnd() * 100, Math.sin(a) * r);
  }
  // sentinels along the climb (higher, sparser)
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 90 + rnd() * 140;
    addCandle(Math.cos(a) * r, 140 + rnd() * 220, Math.sin(a) * r);
  }

  return {
    candles,
    local: new Float32Array(localArr),
    shade: new Float32Array(shadeArr),
    total: vox,
  };
}

/** Debris chunks for a carved voxel (called by the renderer). */
export function voxDebris(
  x: number, y: number, z: number,
  hitX: number, hitY: number, hitZ: number,
  color: string,
): Omit<DebrisChunk, 'id' | 'createdAt'> {
  // fly away from the hit point + up, with spin
  let dx = x - hitX, dy = y - hitY, dz = z - hitZ;
  const len = Math.hypot(dx, dy, dz) || 1;
  const kick = 6 + Math.random() * 8;
  dx = (dx / len) * kick;
  dy = (dy / len) * kick + 4 + Math.random() * 4;
  dz = (dz / len) * kick;
  return {
    x, y, z,
    vx: dx, vy: dy, vz: dz,
    color,
    size: VOX_SIZE * (0.7 + Math.random() * 0.35),
    rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
    life: 1100 + Math.random() * 600,
  };
}
