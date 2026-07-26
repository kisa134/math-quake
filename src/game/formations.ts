import { hash01, epochBounds, type ConductorState } from './conductor';

/**
 * V7.5 Ц3 — SOUL FORMATIONS (Cirque du Soleil pass). Every EUPHORIA epoch the
 * 180 souls converge into ONE giant figure over the Trading Floor for ~11s,
 * then dissolve back into their orbits. Pure f(t) keyed on hash01(cycleIdx) —
 * both clients watch the identical show, zero net, zero uniforms. Souls with
 * a scheduled fate (liq/comet) are the SOLOISTS — the formation never touches
 * them. Гигантизм: фигуры по 500-900 юнитов.
 */

export interface FormationState { active: number; fig: number }
const _fs: FormationState = { active: 0, fig: 0 };

// V8.5 админ-режиссура: форс-формация в любую эпоху (Hub кнопки 0/1/2)
export const formationOverride = { until: 0, fig: 0 };

/** 0..1 eased window inside EUPHORIA (epoch 2), fig hashed per cycle. */
export function formationState(t: number, cs: ConductorState): FormationState {
  const nowMs = Date.now();
  if (nowMs < formationOverride.until) {
    const left = (formationOverride.until - nowMs) / 1000;
    const w = Math.max(0, Math.min(1, Math.min(left, 2) / 2)); // ease-out tail
    _fs.active = w * w * (3 - 2 * w);
    _fs.fig = formationOverride.fig % 3;
    return _fs;
  }
  if (cs.epoch !== 2) { _fs.active = 0; return _fs; }
  const b = epochBounds(t);
  const eIn = t - b.startT;
  const w = Math.max(0, Math.min(1, Math.min(eIn - 0.5, b.dur - 0.5 - eIn) / 2));
  _fs.active = w * w * (3 - 2 * w);
  _fs.fig = Math.floor(hash01(0x50f1, Math.floor(b.epochIdx / 6)) * 3) % 3;
  return _fs;
}

// skull pixel-art (8×8, viewed from spawn), cells precomputed once
const SKULL_ROWS = [
  '..####..',
  '.######.',
  '########',
  '##.##.##',
  '########',
  '.#.##.#.',
  '.######.',
  '..#..#..',
];
const SKULL_CELLS: [number, number][] = [];
for (let row = 0; row < SKULL_ROWS.length; row++)
  for (let col = 0; col < SKULL_ROWS[row].length; col++)
    if (SKULL_ROWS[row][col] === '#') SKULL_CELLS.push([col, row]);

/** Target slot for soul `id` in figure `fig`. Zero-alloc via `out`. */
export function formationTargetFor(fig: number, id: number, out: { x: number; y: number; z: number }): void {
  if (fig === 0) {
    // THE GIGA-CANDLE: a 600u body cylinder over the plate + two wicks
    if (id < 120) {
      const layer = Math.floor(id / 6);
      const k = id % 6;
      const theta = (k / 6) * Math.PI * 2 + layer * 0.35;
      out.x = Math.cos(theta) * 55;
      out.y = 350 + layer * 30;
      out.z = Math.sin(theta) * 55;
    } else if (id < 150) {
      const j = id - 120;
      out.x = Math.cos(id * 2.4) * 8;
      out.y = 950 + (j % 15) * 13;
      out.z = Math.sin(id * 2.4) * 8;
    } else {
      const j = id - 150;
      out.x = Math.cos(id * 2.4) * 8;
      out.y = 250 + (j % 15) * 6.5;
      out.z = Math.sin(id * 2.4) * 8;
    }
    return;
  }
  if (fig === 1) {
    // THE SKULL: 360u pixel-art plane facing spawn
    const [col, row] = SKULL_CELLS[id % SKULL_CELLS.length];
    out.x = (col - 3.5) * 48 + (hash01(id, 7) - 0.5) * 16;
    out.y = 830 - row * 48;
    out.z = -420 + (hash01(id, 9) - 0.5) * 24;
    return;
  }
  // THE $ SIGN: an S-curve + vertical bar, ~560u tall, facing spawn
  if (id < 150) {
    const u = id / 150;
    out.x = 70 * Math.sin(u * Math.PI * 2 + Math.PI);
    out.y = 360 + u * 500;
    out.z = -380 + (hash01(id, 11) - 0.5) * 20;
  } else {
    // clamp: ids past 180 (the titans, V8.5) stay inside the bar
    const u = Math.min(1, (id - 150) / 30);
    out.x = 0;
    out.y = 330 + u * 560;
    out.z = -380 + (hash01(id, 11) - 0.5) * 20;
  }
}
