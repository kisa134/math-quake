import { hash01, epochBounds, EPOCH_DUR } from './conductor';

/**
 * V7 W1 — THE $SOUL INDEX (docs/WOLF_ARC.md §7.1). One tradable instrument.
 * The chart IS the sky: log-price drifts with the same liturgy epochs the
 * player already reads overhead, so "feel the world turn red → press Q" is
 * the whole skill. Pure f(t) on the liturgy clock — PnL computes locally,
 * zero net traffic. Amplitude per epoch is the casino: hash² keeps most
 * epochs modest and occasionally spawns a MONSTER.
 */

const N = 6;
// log-price drift per second, by epoch (Σ over a cycle ≈ 0, light bear edge)
const RATE = [+0.001, +0.013, +0.006, -0.010, -0.016, +0.005];

/** Epoch amplitude 0.5..2.5 — squared hash: usually calm, rarely a monster. */
export const epochAmp = (epochIdx: number): number =>
  0.5 + 2.0 * hash01(0xf00d, epochIdx) ** 2;

// V8.6: the integral is anchored to the CURRENT TRADING DAY's start
// (48 epochs = 8 cycles = 600s exactly). Naive integration from epoch 0
// underflows exp() to a permanent $0 at wall-clock worldT (~5e7s → lp≈−15556)
// and burns ~4M loop iterations on the first call. Day-anchored, lp stays
// O(0.2), the loop is ≤48 iterations, and the market reliably opens near
// $1000 every day — exactly what «▸ РЫНОК ОТКРЫТ» promises.
let cachedDay = -1;
let sumUpto = 0;
let sumVal = 0;
function logPBase(epochIdx: number): number {
  const dayStart = Math.floor(epochIdx / 48) * 48;
  if (dayStart !== cachedDay || epochIdx < sumUpto) {
    cachedDay = dayStart;
    sumUpto = dayStart;
    sumVal = 0;
  }
  while (sumUpto < epochIdx) {
    const e = sumUpto % N;
    sumVal += RATE[e] * EPOCH_DUR[e] * epochAmp(sumUpto);
    sumUpto++;
  }
  return sumVal;
}

export function soulPrice(t: number): number {
  const { startT, epochIdx } = epochBounds(t);
  const e = epochIdx % N;
  const lp = logPBase(epochIdx)
    + RATE[e] * (t - startT) * epochAmp(epochIdx)
    // live ticks: two incommensurate wobbles so the strip breathes every frame
    + 0.006 * Math.sin((t * 2 * Math.PI) / 7.3 + epochIdx)
    + 0.003 * Math.sin((t * 2 * Math.PI) / 2.11);
  return 1000 * Math.exp(lp);
}

// ---- live snapshot (Player ticks it each frame; DOM HUD reads it) ----------
export const marketNow = { t: 0, price: 1000, epoch: 0 };
export function tickMarket(t: number): void {
  marketNow.t = t;
  marketNow.price = soulPrice(t);
  marketNow.epoch = epochBounds(t).epochIdx % N;
}

// ---- positions -------------------------------------------------------------
export interface Position {
  side: 1 | -1;      // LONG = +1, SHORT = -1
  lev: number;
  stake: number;
  entry: number;
  openedAt: number;
}

// ×100 stays locked until the chrome augment (W3)
export const LEVERAGES = [10, 25, 50];
export const LOCKED_LEV = 100;

export const posPnl = (p: Position, price: number): number =>
  p.stake * p.lev * p.side * (price / p.entry - 1);

/** Liquidation: 10% margin stays with the house. At ×50, −1.8% against you. */
export const isLiquidated = (p: Position, price: number): boolean =>
  p.side * (price / p.entry - 1) <= -0.9 / p.lev;

/** Margin health 1→0 (0 = margin call). HUD bar + heartbeat pulse feed. */
export const marginHealth = (p: Position, price: number): number => {
  const d = p.side * (price / p.entry - 1);
  return Math.min(1, Math.max(0, 1 + (d * p.lev) / 0.9));
};
