import { currentMap, type MapId } from '../config/maps';

/**
 * КВЕЙК-АРЕНЫ — pure authored data for the five classic-style maps.
 * Canon references: Q3DM17 The Longest Yard (q1), Q3DM6 Campgrounds (q2),
 * Blood Run (q3), Aerowalk (q4), Quake DM4 The Bad Place (q5) — rebuilt in
 * our matte-black + accent language at честный quake scale (коридоры 8-12u,
 * залы 40-90u, вертикаль до ~40u). Void floor at -50 stays the kill plane.
 * Пады используют СУЩЕСТВУЮЩУЮ физику isJumpPad+jumpForce (игрок И боты).
 */

export interface QPiece {
  p: [number, number, number]; // center
  s: [number, number, number]; // size
  wall?: boolean;              // isWall (else isFloor)
  metal?: boolean;             // magnetic boots surface
  glow?: boolean;              // accent-emissive trim piece
}
export interface QPad { p: [number, number, number]; force: number }
export interface QOrb { p: [number, number, number]; kind: 'buff' | 'cash' }
export interface QMapData {
  pieces: QPiece[];
  pads: QPad[];
  spawns: [number, number, number][];      // bot anchors
  playerSpawn: [number, number, number];
  orbs: QOrb[];
}

const G = 30;
/** Jump-pad force to clear height h (same formula as cityscape pads). */
const lift = (h: number) => Math.round(Math.sqrt(2 * G * (h + 8)) + 4);

// tiny builders (p = box center)
const slab = (x: number, yTop: number, z: number, w: number, d: number, th = 1, extra: Partial<QPiece> = {}): QPiece =>
  ({ p: [x, yTop - th / 2, z], s: [w, th, d], ...extra });
const wall = (x: number, yBase: number, z: number, w: number, h: number, d: number, extra: Partial<QPiece> = {}): QPiece =>
  ({ p: [x, yBase + h / 2, z], s: [w, h, d], wall: true, ...extra });
const stairs = (x: number, yBase: number, z: number, dirX: number, dirZ: number, steps: number, stepW = 8): QPiece[] => {
  const out: QPiece[] = [];
  for (let i = 0; i < steps; i++) {
    const sx = x + dirX * i * 3, sz = z + dirZ * i * 3;
    out.push(slab(sx, yBase + (i + 1) * 2, sz, dirX ? 3 : stepW, dirZ ? 3 : stepW, (i + 1) * 2));
  }
  return out;
};

// ── q1 «ДЛИННЕЙШИЙ ЛОНГ» (Q3DM17) — floating platforms over the void ────────
function buildQ1(): QMapData {
  const pieces: QPiece[] = [
    slab(0, 0, 0, 70, 34, 2),                       // main deck
    slab(-55, 10, 0, 24, 24, 2), slab(55, 10, 0, 24, 24, 2), // side decks
    slab(0, 24, -70, 22, 22, 2),                    // far tower deck
    slab(0, 18, 60, 12, 90, 2),                     // rail spine (long strip)
    slab(-28, 5, -34, 8, 8, 1), slab(28, 5, -34, 8, 8, 1),   // hop islands
    slab(0, 12, -40, 10, 10, 1),                    // mid island to tower
    // glow edges (visual)
    slab(0, 0.35, 16.5, 70, 1, 0.35, { glow: true }),
    slab(0, 0.35, -16.5, 70, 1, 0.35, { glow: true }),
    slab(0, 24.35, -80.5, 22, 1, 0.35, { glow: true }),
  ];
  const pads: QPad[] = [
    { p: [-30, 1, 0], force: lift(12) }, { p: [30, 1, 0], force: lift(12) },   // main → sides
    { p: [0, 1, -14], force: lift(26) },                                        // main → tower
    { p: [-55, 11, 8], force: lift(12) }, { p: [55, 11, 8], force: lift(12) },  // sides → spine-height hops
    { p: [0, 19, 20], force: lift(10) },                                        // spine hop
  ];
  return {
    pieces, pads,
    spawns: [[0, 3, 0], [-55, 13, 0], [55, 13, 0], [0, 27, -70], [0, 21, 55]],
    playerSpawn: [0, 4, 8],
    orbs: [
      { p: [0, 26, -70], kind: 'cash' },
      { p: [0, 20, 60], kind: 'buff' },
      { p: [-55, 12, 0], kind: 'buff' },
    ],
  };
}

// ── q2 «КЕМПИНГ МАРЖИ» (Q3DM6 Campgrounds) — atrium + balconies + mega ──────
function buildQ2(): QMapData {
  const pieces: QPiece[] = [slab(0, 0, 0, 90, 90, 2)]; // atrium floor
  // perimeter walls with doorway gaps (each side = 2 segments, gap 14)
  for (const s of [-1, 1]) {
    pieces.push(wall(s * 45, 0, -26, 2, 24, 38), wall(s * 45, 0, 26, 2, 24, 38)); // x-walls
    pieces.push(wall(-26, 0, s * 45, 38, 24, 2), wall(26, 0, s * 45, 38, 24, 2)); // z-walls
  }
  // balcony ring y=10 (inner strips along walls)
  pieces.push(
    slab(0, 10, -40, 76, 10, 1), slab(0, 10, 40, 76, 10, 1),
    slab(-40, 10, 0, 10, 68, 1), slab(40, 10, 0, 10, 68, 1),
  );
  // central pillar + MH ledge (mega spot)
  pieces.push(wall(0, 0, 0, 10, 16, 10, { metal: true }), slab(0, 17, 0, 16, 16, 1, { glow: true }));
  // outer corridor loop (floors + low outer walls), reachable through gaps
  pieces.push(
    slab(0, 0, -53, 104, 14, 2), slab(0, 0, 53, 104, 14, 2),
    slab(-53, 0, 0, 14, 76, 2), slab(53, 0, 0, 14, 76, 2),
    wall(0, 0, -61, 106, 10, 2), wall(0, 0, 61, 106, 10, 2),
    wall(-61, 0, 0, 2, 10, 106), wall(61, 0, 0, 2, 10, 106),
  );
  // stairs to balcony in two corners
  pieces.push(...stairs(-40, 0, -30, 0, 1, 5, 10), ...stairs(40, 0, 30, 0, -1, 5, 10));
  const pads: QPad[] = [
    { p: [-38, 1, 38], force: lift(12) }, { p: [38, 1, -38], force: lift(12) }, // corners → balcony
    { p: [10, 1, 0], force: lift(19) },                                          // → MH ledge
  ];
  return {
    pieces, pads,
    spawns: [[0, 3, -53], [0, 3, 53], [-53, 3, 0], [53, 3, 0], [0, 13, -40], [0, 13, 40]],
    playerSpawn: [-30, 3, -30],
    orbs: [
      { p: [0, 19, 0], kind: 'cash' },   // the mega
      { p: [-53, 2, -53 + 53], kind: 'buff' },
      { p: [53, 2, 0], kind: 'buff' },
    ],
  };
}

// ── q3 «КРОВАВЫЙ ПРОГОН» (Blood Run) — tight two-floor duel ─────────────────
function buildQ3(): QMapData {
  const pieces: QPiece[] = [
    slab(0, 0, 0, 56, 26, 2),                              // lower hall
    wall(0, 0, -13, 56, 18, 2), wall(0, 0, 13, 56, 18, 2), // long walls
    wall(-28, 0, 0, 2, 18, 26), wall(28, 0, 0, 2, 18, 26), // end walls
    slab(0, 10, -9, 56, 7, 1), slab(0, 10, 9, 56, 7, 1),   // upper side balconies
    slab(0, 10, 0, 8, 10, 1, { glow: true }),              // bridge
    // RA annex (комната ярости) off the +z wall, door gap cut by two segments
    slab(0, 0, 24, 18, 20, 2),
    wall(-9, 0, 24, 2, 12, 20), wall(9, 0, 24, 2, 12, 20), wall(0, 0, 34, 18, 12, 2),
  ];
  pieces.push(...stairs(-24, 0, 0, 1, 0, 5, 8)); // stairs up at west end
  const pads: QPad[] = [{ p: [24, 1, 0], force: lift(12) }]; // pad-lift east end
  return {
    pieces, pads,
    spawns: [[-20, 3, 0], [20, 3, 0], [0, 13, -9], [0, 13, 9], [0, 3, 26]],
    playerSpawn: [-20, 3, 5],
    orbs: [
      { p: [0, 2, 28], kind: 'buff' },   // «красная броня» → RAGE
      { p: [0, 12, 0], kind: 'cash' },   // bridge control
    ],
  };
}

// ── q4 «АЭРОХОД» (Aerowalk) — vertical duel tower ───────────────────────────
function buildQ4(): QMapData {
  const pieces: QPiece[] = [
    slab(0, 0, 0, 34, 34, 2),                 // tier 0
    slab(14, 12, 0, 22, 22, 1),               // tier 1 (offset +x)
    slab(-14, 24, 0, 22, 22, 1),              // tier 2 (offset -x)
    slab(0, 36, 0, 16, 16, 1, { glow: true }),// top — контроль карты
    wall(0, 0, -18, 36, 40, 2, { metal: true }), // magnetic wall (boots!)
    wall(-18, 0, 0, 2, 40, 36, { metal: true }),
    slab(14, 12.35, 11.5, 22, 1, 0.35, { glow: true }),
  ];
  const pads: QPad[] = [
    { p: [10, 1, 10], force: lift(14) },   // t0 → t1
    { p: [-8, 13, 6], force: lift(14) },   // t1 → t2 (jump across)
    { p: [-10, 25, -6], force: lift(14) }, // t2 → top
    { p: [-14, 1, 14], force: lift(38) },  // corner MEGA pad: t0 → top
  ];
  return {
    pieces, pads,
    spawns: [[0, 3, 0], [14, 15, 0], [-14, 27, 0], [0, 39, 0]],
    playerSpawn: [8, 3, -8],
    orbs: [
      { p: [0, 38, 0], kind: 'buff' },   // верх = сила
      { p: [14, 14, 0], kind: 'cash' },
    ],
  };
}

// ── q5 «ПЛОХОЕ МЕСТО» (Quake DM4) — low ceilings + the pit ──────────────────
function buildQ5(): QMapData {
  const pieces: QPiece[] = [];
  // floor as 4 slabs around a 14×14 central pit
  pieces.push(
    slab(0, 0, -15, 46, 16, 2), slab(0, 0, 15, 46, 16, 2),
    slab(-15, 0, 0, 16, 14, 2), slab(15, 0, 0, 16, 14, 2),
  );
  // pit: bottom + walls (fall in, pad out)
  pieces.push(
    slab(0, -10, 0, 14, 14, 2),
    wall(-7, -10, 0, 1, 10, 14), wall(7, -10, 0, 1, 10, 14),
    wall(0, -10, -7, 14, 10, 1), wall(0, -10, 7, 14, 10, 1),
  );
  // room walls h14 + LOW CEILINGS over the perimeter ring (коридорное давление)
  pieces.push(
    wall(0, 0, -23, 46, 14, 2), wall(0, 0, 23, 46, 14, 2),
    wall(-23, 0, 0, 2, 14, 46), wall(23, 0, 0, 2, 14, 46),
    slab(0, 8, -19, 46, 8, 1), slab(0, 8, 19, 46, 8, 1),
    slab(-19, 8, 0, 8, 30, 1), slab(19, 8, 0, 8, 30, 1),
  );
  // злые углы: 4 corner pillars
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    pieces.push(wall(sx * 12, 0, sz * 12, 5, 8, 5));
  const pads: QPad[] = [{ p: [0, -9, 0], force: lift(20) }]; // out of the pit
  return {
    pieces, pads,
    spawns: [[-18, 3, -18], [18, 3, 18], [-18, 3, 18], [18, 3, -18], [0, 3, -19]],
    playerSpawn: [0, 3, 19],
    orbs: [
      { p: [0, -8, 0], kind: 'cash' },   // приманка в яме
      { p: [12, 2, 0], kind: 'buff' },
    ],
  };
}

export const QUAKE_MAPS: Record<Exclude<MapId, 'donut'>, QMapData> = {
  q1: buildQ1(), q2: buildQ2(), q3: buildQ3(), q4: buildQ4(), q5: buildQ5(),
};

// ── shared lookups (BotHorde / Player read these) ───────────────────────────
const DONUT_ANCHORS: [number, number, number][] = [
  [0, 86, 0], [0, 86, 0], [0, 86, 0],
  [100, 86, 100], [-100, 86, 100], [100, 86, -100], [-100, 86, -100],
];

export function getSpawnAnchors(): [number, number, number][] {
  const m = currentMap();
  return m === 'donut' ? DONUT_ANCHORS : QUAKE_MAPS[m].spawns;
}

export function getPlayerSpawn(): [number, number, number] {
  const m = currentMap();
  if (m === 'donut') return [12 + (Math.random() - 0.5) * 12, 84, 12 + (Math.random() - 0.5) * 12];
  const s = QUAKE_MAPS[m].playerSpawn;
  return [s[0] + (Math.random() - 0.5) * 3, s[1], s[2] + (Math.random() - 0.5) * 3];
}
