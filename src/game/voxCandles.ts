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
  pos: [number, number, number]; // seed position (used as fallback)
  bull: boolean;
  phase: number;  // orbit phase
  amp: number;    // legacy bob amplitude (unused in orbit mode)
  speed: number;  // legacy bob speed (unused in orbit mode)
  voxStart: number; // index of first voxel in the global arrays
  voxCount: number;
  // V3.1 «вселенная»: every candle ORBITS the central black hole like a star.
  orbitR: number;   // orbit radius from the black-hole axis
  angSpeed: number; // rad/s (flat rotation curve: slower far out)
  incSin: number;   // orbit-plane inclination (precomputed sin/cos)
  incCos: number;
}

/** The all-consuming donut sits here; orbits center on it. */
export const BLACK_HOLE = { x: 0, y: 300, z: 0, ringR: 110, tubeR: 34 };

/** Analytic orbital base position of a candle at time t (zero-alloc via out). */
export function candleBasePos(c: VoxCandle, t: number, out: { x: number; y: number; z: number }) {
  const th = c.phase + t * c.angSpeed;
  const x = Math.cos(th) * c.orbitR;
  const z0 = Math.sin(th) * c.orbitR;
  out.x = BLACK_HOLE.x + x;
  out.y = BLACK_HOLE.y + z0 * c.incSin;
  out.z = BLACK_HOLE.z + z0 * c.incCos;
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

  const addCandle = (x: number, y: number, z: number, orbitR = 0) => {
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
    const R = orbitR || 70 + rnd() * 450;
    candles.push({
      id: candles.length,
      pos: [x, y, z],
      bull,
      phase: rnd() * Math.PI * 2,
      amp: 1 + rnd() * 2,
      speed: 0.2 + rnd() * 0.5,
      voxStart: start,
      voxCount: vox - start,
      // flat rotation curve: tangential speed ~2.2–5.2 u/s everywhere → calm
      // starfield drift, ride-able with the grapple
      orbitR: R,
      angSpeed: (2.2 + rnd() * 3) / R,
      incSin: Math.sin((rnd() - 0.5) * 1.2),
      incCos: Math.cos((rnd() - 0.5) * 1.2),
    });
  };

  // «вселенная»: 90 star-candles orbiting the central black hole. Dense inner
  // belt (reachable from the arena/towers), sparser far shells.
  for (let i = 0; i < 46; i++) addCandle(0, 0, 0, 70 + rnd() * 160);   // inner belt
  for (let i = 0; i < 30; i++) addCandle(0, 0, 0, 230 + rnd() * 170);  // mid shell
  for (let i = 0; i < 14; i++) addCandle(0, 0, 0, 400 + rnd() * 140);  // outer halo

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
