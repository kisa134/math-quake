import type { DebrisChunk } from './voxel';
import {
  hash01, warpTime, conductorState, eventFor, epochBounds,
  LIQ_DUR, COMET_DUR, RESURRECT_DELAY, type ConductorState, type CandleEvent,
} from './conductor';
import { formationTargetFor, type FormationState } from './formations';

/**
 * V4.3 «Литургия ликвидаций» — the candle universe core (spec:
 * docs/LITURGY_OF_LIQUIDATIONS.md). 180 voxel chart-candles in three belts
 * orbit the black-hole donut; four analytic breathing layers make the space
 * feel alive WITHOUT any N² physics; a deterministic hash-schedule sends souls
 * off their orbits — liquidation spirals INTO the donut, pump comets OUT.
 * Everything is a pure function of (t); both clients watch the same liturgy.
 */
export interface VoxCandle {
  id: number;
  pos: [number, number, number];
  bull: boolean;
  phase: number;
  voxStart: number;
  voxCount: number;
  orbitR: number;
  angSpeed: number;
  incSin: number;
  incCos: number;
  // V4.3 population
  belt: 0 | 1 | 2;      // inner ритейл / mid смарт-мани / halo холдеры
  voxScale: number;     // 1 retail · 1.15 fund · 1.5 WHALE
  phiR: number;         // epicycle phase (precomputed hash)
  patronIdx: number;    // whale index in `candles` this soul follows (-1 = none)
}

export interface VoxData {
  candles: VoxCandle[];
  local: Float32Array;
  shade: Float32Array;
  total: number;
  /** cascade helper: anchor innerId → [4 phase-neighbour candle ids] */
  neighborsOf: Map<number, number[]>;
}

export const VOX_SIZE = 2.2; // V6: свечи-гиганты
export const COLLAPSE_AT = 0.25;

/** The all-consuming donut; the universe wheels around it, looming over spawn. */
export const BLACK_HOLE = { x: 0, y: 900, z: 0, ringR: 700, tubeR: 220 };

export const voxInbox: { id: number; x: number; y: number; z: number; r: number }[] = [];

// belt tables (spec §1/§2)
const BELT_WAVE_AMP = [6, 9, 14];
const BELT_MA_R = [500, 1075, 2000]; // MA-20 radius is animated by the conductor

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** 180 souls: 74 inner (retail pit) / 68 mid (smart money) / 38 halo (eternity). */
export function generateVoxCandles(seed = 0xcafe): VoxData {
  const rnd = mulberry32(seed);
  const candles: VoxCandle[] = [];
  const localArr: number[] = [];
  const shadeArr: number[] = [];
  let vox = 0;

  const addCandle = (belt: 0 | 1 | 2, rMin: number, rMax: number) => {
    const bull = rnd() > 0.45;
    // Pareto wealth: 78% retail / 14% funds / 8% WHALES
    const wealth = rnd();
    const sizeClass = wealth < 0.78 ? 0 : wealth < 0.92 ? 1 : 2;
    const bodyH = sizeClass === 0 ? 4 + Math.floor(rnd() * 3)
      : sizeClass === 1 ? 7 + Math.floor(rnd() * 3)
      : 10 + Math.floor(rnd() * 5);
    const voxScale = sizeClass === 0 ? 1 : sizeClass === 1 ? 1.15 : 1.5;
    const wickUp = 2 + Math.floor(rnd() * 3);
    const wickDn = 1 + Math.floor(rnd() * 2);
    const start = vox;
    const s = VOX_SIZE;
    for (let by = 0; by < bodyH; by++)
      for (let bx = -1; bx <= 1; bx++)
        for (let bz = -1; bz <= 1; bz++) {
          localArr.push(bx * s, (by + 0.5) * s, bz * s);
          shadeArr.push(0.75 + rnd() * 0.4);
          vox++;
        }
    for (let wy = 0; wy < wickUp; wy++) { localArr.push(0, (bodyH + wy + 0.5) * s, 0); shadeArr.push(0.9 + rnd() * 0.25); vox++; }
    for (let wy = 0; wy < wickDn; wy++) { localArr.push(0, -(wy + 0.5) * s, 0); shadeArr.push(0.9 + rnd() * 0.25); vox++; }
    const R = rMin + rnd() * (rMax - rMin);
    candles.push({
      id: candles.length,
      pos: [0, 0, 0],
      bull,
      phase: rnd() * Math.PI * 2,
      voxStart: start,
      voxCount: vox - start,
      orbitR: R,
      angSpeed: (8 + rnd() * 10) / R, // V6 flat curve: 8–18 u/s — движение видно на гига-масштабе
      incSin: Math.sin((rnd() - 0.5) * 1.2),
      incCos: Math.cos((rnd() - 0.5) * 1.2),
      belt,
      voxScale,
      phiR: rnd() * Math.PI * 2,
      patronIdx: -1,
    });
  };

  for (let i = 0; i < 74; i++) addCandle(0, 300, 700);
  for (let i = 0; i < 68; i++) addCandle(1, 850, 1300);
  for (let i = 0; i < 38; i++) addCandle(2, 1600, 2400);

  // V8.5 П4 — THE TITANS: 12 giant souls (ids 180-191, APPEND ONLY — the
  // capitulation cascade anchor is hardcoded to the first 74 inner ids).
  // Belt 1 radii, voxScale 5-7 — читаются с другого края карты. Гигантизм.
  for (let i = 0; i < 12; i++) {
    const bull = rnd() > 0.45;
    const bodyH = 12 + Math.floor(rnd() * 5);
    const wickUp = 4 + Math.floor(rnd() * 3);
    const wickDn = 2 + Math.floor(rnd() * 2);
    const start = vox;
    const s = VOX_SIZE;
    for (let by = 0; by < bodyH; by++)
      for (let bx = -1; bx <= 1; bx++)
        for (let bz = -1; bz <= 1; bz++) {
          localArr.push(bx * s, (by + 0.5) * s, bz * s);
          shadeArr.push(0.75 + rnd() * 0.4);
          vox++;
        }
    for (let wy = 0; wy < wickUp; wy++) { localArr.push(0, (bodyH + wy + 0.5) * s, 0); shadeArr.push(0.9 + rnd() * 0.25); vox++; }
    for (let wy = 0; wy < wickDn; wy++) { localArr.push(0, -(wy + 0.5) * s, 0); shadeArr.push(0.9 + rnd() * 0.25); vox++; }
    const R = 900 + rnd() * 500;
    candles.push({
      id: candles.length,
      pos: [0, 0, 0],
      bull,
      phase: rnd() * Math.PI * 2,
      voxStart: start,
      voxCount: vox - start,
      orbitR: R,
      angSpeed: (6 + rnd() * 6) / R, // тяжёлые — медленнее
      incSin: Math.sin((rnd() - 0.5) * 1.0),
      incCos: Math.cos((rnd() - 0.5) * 1.0),
      belt: 1,
      voxScale: 5 + rnd() * 2,
      phiR: rnd() * Math.PI * 2,
      patronIdx: -1, // титан не следует ни за кем
    });
  }

  // patrons: every non-whale follows a whale of its own belt (кит ведёт шлейф)
  for (let belt = 0; belt < 3; belt++) {
    const whales = candles.filter((c) => c.belt === belt && c.voxScale === 1.5);
    if (!whales.length) continue;
    for (const c of candles) {
      if (c.belt !== belt || c.voxScale === 1.5) continue;
      c.patronIdx = whales[Math.floor(hash01(c.id, 777) * whales.length)].id;
    }
  }

  // cascade neighbours: 4 nearest by phase within the inner belt (built on seed)
  const inner = candles.filter((c) => c.belt === 0).sort((a, b) => a.phase - b.phase);
  const neighborsOf = new Map<number, number[]>();
  for (let i = 0; i < inner.length; i++) {
    const n: number[] = [];
    for (let k = 1; k <= 2; k++) {
      n.push(inner[(i + k) % inner.length].id);
      n.push(inner[(i - k + inner.length) % inner.length].id);
    }
    neighborsOf.set(inner[i].id, n);
  }

  return { candles, local: new Float32Array(localArr), shade: new Float32Array(shadeArr), total: vox, neighborsOf };
}

// ---------------------------------------------------------------- position ---
export type CandleStatus = 0 | 1 | 2 | 3; // orbit | event-active | swallowed | resurrected

const _bounds = { startT: 0, dur: 0, epochIdx: 0 };

/** Base orbital angle at warped time (pure). */
function orbitTheta(c: VoxCandle, tW: number): number {
  return c.phase + tW * c.angSpeed;
}

/** Full living position: orbit + 4 breathing layers + MA bounce + fate
 *  overrides (liquidation spiral / pump comet / resurrection). Zero-alloc. */
const _ft = { x: 0, y: 0, z: 0 };

export function candleLivePos(
  c: VoxCandle,
  t: number,
  tW: number,
  cs: ConductorState,
  ev: CandleEvent,
  data: VoxData,
  out: { x: number; y: number; z: number },
  form?: FormationState,
): CandleStatus {
  let status: CandleStatus = 0;
  let theta = orbitTheta(c, tW);
  // стаи (псевдо-Курамото): толпы сжимаются в эйфорию
  theta += cs.clusterC * Math.sin(5 * (theta - 0.1 * t));
  // кильватер кита
  if (c.patronIdx >= 0) {
    const w = data.candles[c.patronIdx];
    theta += 0.06 * Math.sin(orbitTheta(w, tW) - theta);
  }
  // радиальный эпицикл — сердцебиение позиции
  let r = c.orbitR * (1 + 0.045 * cs.breathAmp * Math.sin(t * c.angSpeed * 2.37 + c.phiR));
  // отскок от скользящей средней (поддержка держит… кроме капитуляции)
  if (cs.epoch !== 4) {
    const Rma = c.belt === 0 ? cs.ma20R : BELT_MA_R[c.belt];
    const dd = (r - Rma) / 5;
    r += 6 * Math.exp(-dd * dd);
  }
  let yWave = BELT_WAVE_AMP[c.belt] * Math.sin(3 * theta - 0.35 * t + c.belt * 2.1);

  // --- fate overrides ---
  if (ev.type === 'liq') {
    const tau = t - ev.tStart;
    if (tau >= 0 && tau < ev.dur) {
      status = 1;
      const k = 1 - tau / ev.dur;
      r = BLACK_HOLE.ringR + (r - BLACK_HOLE.ringR) * Math.pow(Math.max(0.001, k), 1.7);
      theta += c.angSpeed * (ev.dur / 0.7) * (Math.pow(Math.max(0.05, k), -0.7) - 1);
      const s = Math.min(1, tau / ev.dur);
      yWave *= 1 - s * s * (3 - 2 * s); // smoothstep down to the donut plane
    } else if (tau >= ev.dur && tau < ev.dur + RESURRECT_DELAY) {
      return 2; // swallowed — the donut is digesting
    } else if (tau >= ev.dur + RESURRECT_DELAY) {
      // resurrection in the halo: liquidity is immortal, only traders die
      status = 3;
      const newR = 1600 + hash01(c.id, 13) * 600;
      theta = hash01(c.id, 17) * Math.PI * 2 + tW * (3 / newR);
      r = newR;
      yWave = BELT_WAVE_AMP[2] * Math.sin(3 * theta - 0.35 * t);
    }
  } else if (ev.type === 'comet') {
    const tau = t - ev.tStart;
    if (tau >= 0) {
      status = tau < ev.dur ? 1 : 0;
      const k = Math.min(1, tau / ev.dur);
      r += 90 * k * k; // срыв НАРУЖУ — новая орбита выше
      if (tau < ev.dur) yWave += 14 * Math.sin(Math.PI * (tau / ev.dur));
    }
  }

  const x = Math.cos(theta) * r;
  const z0 = Math.sin(theta) * r;
  out.x = BLACK_HOLE.x + x;
  out.y = BLACK_HOLE.y + z0 * c.incSin + yWave;
  out.z = BLACK_HOLE.z + z0 * c.incCos;

  // V7.5 Ц3: formation override — free souls converge into the euphoria figure;
  // souls with a fate (liq/comet) are the soloists, untouched.
  if (form && form.active > 0 && ev.type === null) {
    formationTargetFor(form.fig, c.id, _ft);
    out.x += (_ft.x - out.x) * form.active;
    out.y += (_ft.y - out.y) * form.active;
    out.z += (_ft.z - out.z) * form.active;
  }
  return status;
}

/** Mood gain: bulls BURN in euphoria, crimson floods the cosmos in capitulation. */
export function moodGain(bull: boolean, S: number): number {
  return 1 + 0.3 * S * (bull ? 1 : -1);
}

/** Per-candle fate for the CURRENT epoch (cached by the renderer per epoch). */
export function fateOf(c: VoxCandle, t: number, data: VoxData, out: CandleEvent): void {
  epochBoundsInto(t);
  const ev = eventFor(
    c.id, _bounds.epochIdx, _bounds.startT, _bounds.dur,
    (anchor: number) => {
      if (anchor < 0) return 0;
      const n = data.neighborsOf.get(anchor);
      if (!n) return 0;
      const idx = n.indexOf(c.id);
      return idx >= 0 ? idx + 1 : 0;
    },
  );
  out.type = ev.type;
  out.tStart = ev.tStart;
  out.dur = ev.dur;
}

function epochBoundsInto(t: number) {
  const b = epochBounds(t);
  _bounds.startT = b.startT;
  _bounds.dur = b.dur;
  _bounds.epochIdx = b.epochIdx;
}

export { warpTime, conductorState };

// legacy shim (Dragons/others import BLACK_HOLE; old callers of candleBasePos)
export function candleBasePos(c: VoxCandle, t: number, out: { x: number; y: number; z: number }) {
  const th = c.phase + t * c.angSpeed;
  const x = Math.cos(th) * c.orbitR;
  const z0 = Math.sin(th) * c.orbitR;
  out.x = BLACK_HOLE.x + x;
  out.y = BLACK_HOLE.y + z0 * c.incSin;
  out.z = BLACK_HOLE.z + z0 * c.incCos;
}

/** Debris chunks for a carved voxel (called by the renderer). */
export function voxDebris(
  x: number, y: number, z: number,
  hitX: number, hitY: number, hitZ: number,
  color: string,
): Omit<DebrisChunk, 'id' | 'createdAt'> {
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
