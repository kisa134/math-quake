/**
 * V4.3 «Литургия ликвидаций» — THE CONDUCTOR (docs/LITURGY_OF_LIQUIDATIONS.md).
 * The market breathes in a 75-second cycle of six epochs. Everything here is a
 * PURE FUNCTION of (t) — zero state, zero net traffic, both players watch the
 * same liturgy because fate is predetermined by hash. ~40 flops per frame.
 */

export function hash01(a: number, b: number): number {
  let h = (a * 0x9e3779b1) ^ (b * 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// НАКОПЛЕНИЕ → ПАМП → ЭЙФОРИЯ → РАСПРОДАЖА → КАПИТУЛЯЦИЯ → ТИШИНА
export const EPOCH_NAMES = ['ACCUMULATION', 'PUMP', 'EUPHORIA', 'DISTRIBUTION', 'CAPITULATION', 'SILENCE'] as const;
const DUR =    [20,   10,   13,   9,    13,   10];   // seconds, Σ = 75
const S_BIAS = [-0.1, 0.6,  1.0,  -0.5, -1.0, 0];
const SPEED =  [1.0,  1.15, 1.25, 1.1,  0.9,  0.75];
const LIGHT =  [0.85, 1.0,  1.25, 0.9,  0.7,  0.55];
const CLUSTER = [0.05, 0.14, 0.22, 0.10, 0.03, 0.02];
const HEART_HZ = [0.9, 1.3,  1.6,  2.2,  2.8,  0.6];
const BREATH = [1.0,  1.2,  1.6,  1.0,  0.8,  0.5];
// liquidation / comet probabilities per epoch (per candle per epoch)
export const P_LIQ =   [0.008, 0.004, 0.006, 0.06, 0.11, 0.004];
export const P_COMET = [0.003, 0.035, 0.006, 0.003, 0.003, 0.003];

export const CYCLE = 75;
const N = 6;
// prefix sums of duration / warped-time / heart-phase (constants, built once)
const T0: number[] = [0];
const TW0: number[] = [0];
const PH0: number[] = [0];
for (let i = 0; i < N; i++) {
  T0.push(T0[i] + DUR[i]);
  TW0.push(TW0[i] + DUR[i] * SPEED[i]);
  PH0.push(PH0[i] + DUR[i] * HEART_HZ[i]);
}
const TW_CYCLE = TW0[N];
const PH_CYCLE = PH0[N];

function epochAt(eT: number): number {
  for (let i = 0; i < N; i++) if (eT < T0[i + 1]) return i;
  return N - 1;
}

/** Blend an epoch-table value with 2s smoothstep across the boundary. */
function smoothParam(table: number[], epoch: number, eT: number): number {
  const tIn = eT - T0[epoch];
  const tLeft = T0[epoch + 1] - eT;
  const W = 2;
  let v = table[epoch];
  if (tIn < W) { // blend from previous epoch
    const k = tIn / W;
    const s = k * k * (3 - 2 * k);
    v = table[(epoch + N - 1) % N] * (1 - s) + table[epoch] * s;
  } else if (tLeft < W) {
    const k = 1 - tLeft / W;
    const s = k * k * (3 - 2 * k);
    v = table[epoch] * (1 - s) + table[(epoch + 1) % N] * s;
  }
  return v;
}

export interface ConductorState {
  epoch: number;
  epochIdx: number; // global epoch counter (cycleIdx*6 + epoch) — hashes key on it
  eT: number;
  S: number;        // sentiment −1..1
  breathAmp: number;
  clusterC: number;
  dimGain: number;
  heartPhase: number; // accumulated 2π∫hz — frequency shifts without phase pops
  speedNow: number;
  ma20R: number;      // MA-20 radius (golden/death cross animation)
}

const _state: ConductorState = {
  epoch: 0, epochIdx: 0, eT: 0, S: 0, breathAmp: 1, clusterC: 0.05,
  dimGain: 1, heartPhase: 0, speedNow: 1, ma20R: 120,
};

/** Warped orbital time — piecewise-linear pure function (NOT dt scaling). */
export function warpTime(t: number): number {
  const cycles = Math.floor(t / CYCLE);
  const eT = t - cycles * CYCLE;
  const e = epochAt(eT);
  return cycles * TW_CYCLE + TW0[e] + (eT - T0[e]) * SPEED[e];
}

/** Fill (and return) the shared zero-alloc conductor state for time t. */
export function conductorState(t: number): ConductorState {
  const cycles = Math.floor(t / CYCLE);
  const eT = t - cycles * CYCLE;
  const e = epochAt(eT);
  _state.epoch = e;
  _state.epochIdx = cycles * N + e;
  _state.eT = eT;
  // sentiment: epoch bias + a 137s irrational-beat wave (never repeats exactly)
  _state.S = 0.6 * smoothParam(S_BIAS, e, eT) + 0.4 * Math.sin((t * 2 * Math.PI) / 137);
  _state.breathAmp = smoothParam(BREATH, e, eT);
  _state.clusterC = smoothParam(CLUSTER, e, eT);
  _state.dimGain = smoothParam(LIGHT, e, eT);
  _state.speedNow = SPEED[e];
  _state.heartPhase = 2 * Math.PI * (cycles * PH_CYCLE + PH0[e] + (eT - T0[e]) * HEART_HZ[e]);
  // MA-20 golden cross: rises 120→290 through PUMP+EUPHORIA, death-crosses back in DISTRIBUTION
  const crossUp = e === 1 ? Math.min(1, (eT - T0[1]) / 4) : e === 2 ? 1 : 0;
  const crossDn = e === 3 ? Math.min(1, (eT - T0[3]) / 2.5) : (e === 4 || e === 5 || e === 0) ? 1 : 0;
  const cross = Math.max(0, crossUp - (e >= 3 || e === 0 ? crossDn : 0));
  _state.ma20R = 500 + 700 * (e === 1 || e === 2 ? cross : 0); // V6 giga radii
  return _state;
}

// ---- судьбы: детерминированное расписание сходов с орбит --------------------
export type CandleEventType = 'liq' | 'comet' | null;
export interface CandleEvent { type: CandleEventType; tStart: number; dur: number }
const _ev: CandleEvent = { type: null, tStart: 0, dur: 0 };

export const LIQ_DUR = 6;
export const COMET_DUR = 5;
export const RESURRECT_DELAY = 8;

/** The candle's fate this epoch (pure; tStart is absolute time). Cascade: in
 *  CAPITULATION an anchor + its phase-neighbours liquidate in a chain. */
export function eventFor(
  id: number, epochIdx: number, epochStartT: number, epochDur: number,
  neighborsOfAnchor: (anchor: number) => number, // returns delay slot 1..4 or 0
): CandleEvent {
  _ev.type = null;
  const epoch = epochIdx % N;
  // cascade (capitulation): anchor id from hash, fires at eT=... epoch-local 5s in
  if (epoch === 4) {
    const anchor = Math.floor(hash01(0xca5c, epochIdx) * 74); // inner belt
    if (id === anchor) {
      _ev.type = 'liq'; _ev.tStart = epochStartT + 5; _ev.dur = LIQ_DUR;
      return _ev;
    }
    const slot = neighborsOfAnchor(anchor === id ? -1 : anchor);
    if (slot > 0) {
      _ev.type = 'liq'; _ev.tStart = epochStartT + 5 + slot * 0.7; _ev.dur = LIQ_DUR;
      return _ev;
    }
  }
  const rLiq = hash01(id, epochIdx * 3 + 1);
  if (rLiq < P_LIQ[epoch]) {
    _ev.type = 'liq';
    _ev.tStart = epochStartT + hash01(id, epochIdx * 3 + 2) * Math.max(1, epochDur - LIQ_DUR - 1);
    _ev.dur = LIQ_DUR;
    return _ev;
  }
  const rCom = hash01(id, epochIdx * 5 + 3);
  if (rCom < P_COMET[epoch]) {
    _ev.type = 'comet';
    _ev.tStart = epochStartT + hash01(id, epochIdx * 5 + 4) * Math.max(1, epochDur - COMET_DUR - 1);
    _ev.dur = COMET_DUR;
    return _ev;
  }
  return _ev;
}

export function epochBounds(t: number): { startT: number; dur: number; epochIdx: number } {
  const cycles = Math.floor(t / CYCLE);
  const eT = t - cycles * CYCLE;
  const e = epochAt(eT);
  return { startT: cycles * CYCLE + T0[e], dur: DUR[e], epochIdx: cycles * N + e };
}
