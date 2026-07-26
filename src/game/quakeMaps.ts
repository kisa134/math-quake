import { currentMap, type MapId } from '../config/maps';

/**
 * КВЕЙК-АРЕНЫ v2 — «как в квейке реально»: ЗАКРЫТЫЕ карты. Масштаб ×2+
 * (коридоры 18-26u при игроке ~2u, залы 100-210u), стены 40-100u, ПОТОЛКИ
 * НАД ВСЕМ (джетпаком не перелететь — только коридоры, пады и крюк; крюк
 * цепляется и за потолок — Спайдермен в лабиринте). q1 — единственная
 * открытая (канон Q3DM17 — платформы в пустоте). q5 — настоящий ЛАБИРИНТ.
 * Void floor -50 остаётся kill-plane для q1.
 */

export interface QPiece {
  p: [number, number, number]; // center
  s: [number, number, number]; // size
  wall?: boolean;
  metal?: boolean;
  glow?: boolean;
}
export interface QPad { p: [number, number, number]; force: number }
export interface QOrb { p: [number, number, number]; kind: 'buff' | 'cash' }
export interface QMapData {
  pieces: QPiece[];
  pads: QPad[];
  spawns: [number, number, number][];
  playerSpawn: [number, number, number];
  orbs: QOrb[];
}

const G = 30;
const lift = (h: number) => Math.round(Math.sqrt(2 * G * (h + 8)) + 4);

const slab = (x: number, yTop: number, z: number, w: number, d: number, th = 2, extra: Partial<QPiece> = {}): QPiece =>
  ({ p: [x, yTop - th / 2, z], s: [w, th, d], ...extra });
const wall = (x: number, yBase: number, z: number, w: number, h: number, d: number, extra: Partial<QPiece> = {}): QPiece =>
  ({ p: [x, yBase + h / 2, z], s: [w, h, d], wall: true, ...extra });
/** Ceiling: underside at height h (walk-proof закрытая коробка). */
const ceil = (x: number, h: number, z: number, w: number, d: number): QPiece => slab(x, h + 2, z, w, d, 2);
const stairs = (x: number, yBase: number, z: number, dirX: number, dirZ: number, steps: number, stepW = 14, rise = 3, run = 5): QPiece[] => {
  const out: QPiece[] = [];
  for (let i = 0; i < steps; i++) {
    const sx = x + dirX * i * run, sz = z + dirZ * i * run;
    out.push(slab(sx, yBase + (i + 1) * rise, sz, dirX ? run : stepW, dirZ ? run : stepW, (i + 1) * rise));
  }
  return out;
};
/** Closed shell: perimeter walls (optionally with a doorway gap per side) + ceiling. */
function shell(pieces: QPiece[], x: number, z: number, w: number, d: number, h: number, gaps: { n?: boolean; s?: boolean; e?: boolean; w?: boolean } = {}, gapW = 22) {
  const seg = (len: number) => (len - gapW) / 2;
  // north (-z) / south (+z)
  for (const [sz, has] of [[-d / 2, gaps.n], [d / 2, gaps.s]] as [number, boolean | undefined][]) {
    if (has) {
      pieces.push(wall(x - (gapW / 2 + seg(w) / 2), 0, z + sz, seg(w), h, 3));
      pieces.push(wall(x + (gapW / 2 + seg(w) / 2), 0, z + sz, seg(w), h, 3));
    } else pieces.push(wall(x, 0, z + sz, w, h, 3));
  }
  // west (-x) / east (+x)
  for (const [sx, has] of [[-w / 2, gaps.w], [w / 2, gaps.e]] as [number, boolean | undefined][]) {
    if (has) {
      pieces.push(wall(x + sx, 0, z - (gapW / 2 + seg(d) / 2), 3, h, seg(d)));
      pieces.push(wall(x + sx, 0, z + (gapW / 2 + seg(d) / 2), 3, h, seg(d)));
    } else pieces.push(wall(x + sx, 0, z, 3, h, d));
  }
  pieces.push(ceil(x, h, z, w + 3, d + 3));
}

// ── q1 «ДЛИННЕЙШИЙ ЛОНГ» (Q3DM17) — единственная ОТКРЫТАЯ: космос ──────────
function buildQ1(): QMapData {
  const pieces: QPiece[] = [
    slab(0, 0, 0, 150, 72, 4),                          // main deck
    slab(-118, 22, 0, 52, 52, 3), slab(118, 22, 0, 52, 52, 3),
    slab(0, 52, -150, 47, 47, 3),                       // far tower
    slab(0, 39, 129, 26, 194, 3),                       // rail spine
    slab(-60, 11, -73, 17, 17, 2), slab(60, 11, -73, 17, 17, 2),
    slab(0, 26, -86, 21, 21, 2),
    slab(0, 0.6, 35, 150, 2, 0.6, { glow: true }),
    slab(0, 0.6, -35, 150, 2, 0.6, { glow: true }),
    slab(0, 52.6, -172, 47, 2, 0.6, { glow: true }),
  ];
  const pads: QPad[] = [
    { p: [-64, 2, 0], force: lift(26) }, { p: [64, 2, 0], force: lift(26) },
    { p: [0, 2, -30], force: lift(56) },
    { p: [-118, 24, 17], force: lift(21) }, { p: [118, 24, 17], force: lift(21) },
    { p: [0, 41, 43], force: lift(17) },
  ];
  return {
    pieces, pads,
    spawns: [[0, 4, 0], [-118, 26, 0], [118, 26, 0], [0, 56, -150], [0, 43, 118]],
    playerSpawn: [0, 5, 17],
    orbs: [
      { p: [0, 55, -150], kind: 'cash' },
      { p: [0, 42, 129], kind: 'buff' },
      { p: [-118, 25, 0], kind: 'buff' },
    ],
  };
}

// ── q2 «КЕМПИНГ МАРЖИ» (Q3DM6) — ЗАКРЫТЫЙ атриум + кольцевой коридор ────────
function buildQ2(): QMapData {
  const pieces: QPiece[] = [slab(0, 0, 0, 210, 210, 4)]; // весь пол
  // внешняя коробка (глухая) + внутреннее кольцо стен с 4 дверями
  shell(pieces, 0, 0, 210, 210, 52);                    // outer shell + ceiling 52
  const seg = (152 - 22) / 2;
  for (const s of [-1, 1]) {
    pieces.push(wall(-(11 + seg / 2), 0, s * 76, seg, 40, 3), wall(11 + seg / 2, 0, s * 76, seg, 40, 3));
    pieces.push(wall(s * 76, 0, -(11 + seg / 2), 3, 40, seg), wall(s * 76, 0, 11 + seg / 2, 3, 40, seg));
  }
  // балконы по 4 стенам атриума (y20) + лестницы + центральная колонна с МЕГОЙ
  pieces.push(
    slab(0, 20, -66, 130, 18, 2), slab(0, 20, 66, 130, 18, 2),
    slab(-66, 20, 0, 18, 110, 2), slab(66, 20, 0, 18, 110, 2),
    wall(0, 0, 0, 22, 34, 22, { metal: true }),
    slab(0, 36, 0, 34, 34, 2, { glow: true }),
  );
  pieces.push(...stairs(-64, 0, -46, 0, 1, 6, 16, 3.3, 5.5), ...stairs(64, 0, 46, 0, -1, 6, 16, 3.3, 5.5));
  const pads: QPad[] = [
    { p: [-58, 2, 58], force: lift(24) }, { p: [58, 2, -58], force: lift(24) },
    { p: [20, 2, 0], force: lift(40) },   // → МЕГА
  ];
  return {
    pieces, pads,
    spawns: [[0, 4, -92], [0, 4, 92], [-92, 4, 0], [92, 4, 0], [0, 24, -66], [0, 24, 66]],
    playerSpawn: [-92, 4, -40],
    orbs: [
      { p: [0, 39, 0], kind: 'cash' },     // МЕГА
      { p: [-92, 3, 92], kind: 'buff' },
      { p: [92, 3, -92], kind: 'buff' },
    ],
  };
}

// ── q3 «КРОВАВЫЙ ПРОГОН» (Blood Run) — ЗАКРЫТАЯ двухэтажная дуэль ───────────
function buildQ3(): QMapData {
  const pieces: QPiece[] = [slab(0, 0, 0, 130, 64, 4)];
  shell(pieces, 0, 0, 130, 64, 42, { s: true });        // коробка 42 + дверь на юг (в RA)
  pieces.push(
    slab(0, 22, -22, 130, 17, 2), slab(0, 22, 22, 130, 17, 2), // балконы
    slab(0, 22, 0, 20, 26, 2, { glow: true }),                  // мост
  );
  pieces.push(...stairs(-56, 0, 0, 1, 0, 7, 14, 3.2, 5));
  // коридор-перешеек из зала (южная дверь) в комнату ЯРОСТИ
  pieces.push(
    slab(0, 0, 43, 26, 26, 4),
    wall(-13, 0, 43, 3, 28, 26), wall(13, 0, 43, 3, 28, 26),
    ceil(0, 28, 43, 29, 26),
  );
  // RA-аннекс (комната ЯРОСТИ): своя закрытая коробка, север открыт в коридор
  pieces.push(
    slab(0, 0, 76, 52, 44, 4),
    wall(-26, 0, 76, 3, 28, 44), wall(26, 0, 76, 3, 28, 44),
    wall(0, 0, 98, 52, 28, 3),
    ceil(0, 28, 76, 55, 47),
  );
  const pads: QPad[] = [{ p: [56, 2, 12], force: lift(26) }]; // пад-лифт к балкону
  return {
    pieces, pads,
    spawns: [[-48, 4, 0], [48, 4, 0], [0, 26, -22], [0, 26, 22], [0, 4, 76]],
    playerSpawn: [-48, 4, 12],
    orbs: [
      { p: [0, 3, 84], kind: 'buff' },    // ЯРОСТЬ
      { p: [0, 25, 0], kind: 'cash' },    // мост
    ],
  };
}

// ── q4 «АЭРОХОД» (Aerowalk) — ЗАКРЫТАЯ вертикальная шахта ───────────────────
function buildQ4(): QMapData {
  const pieces: QPiece[] = [slab(0, 0, 0, 80, 80, 4)];
  shell(pieces, 0, 0, 80, 80, 100);                     // шахта: стены 100 + потолок
  pieces.push(
    slab(14, 26, 0, 52, 52, 3),                          // ярус 1 (+x)
    slab(-14, 52, 0, 52, 52, 3),                         // ярус 2 (−x)
    slab(0, 78, 0, 36, 36, 3, { glow: true }),           // ВЕРХ
  );
  // магнитные стены для ботинок (две грани шахты)
  pieces.push(wall(0, 0, -38.4, 78, 98, 1, { metal: true }), wall(-38.4, 0, 0, 1, 98, 78, { metal: true }));
  // пады в СВОБОДНЫХ углах шахты (над ними нет ярусов — не бьёшься в дно),
  // с апекса довороты страйфом на кромку — чистый Aerowalk
  const pads: QPad[] = [
    { p: [34, 2, 34], force: lift(32) },    // низ → ярус 1
    { p: [38, 28, -22], force: lift(30) },  // ярус 1 → ярус 2
    { p: [-38, 54, 22], force: lift(30) },  // ярус 2 → верх
    { p: [-34, 2, 34], force: lift(84) },   // угловой МЕГА-батут: низ → верх
  ];
  return {
    pieces, pads,
    spawns: [[0, 4, 0], [14, 30, 0], [-14, 56, 0], [0, 82, 0]],
    playerSpawn: [20, 4, -20],
    orbs: [
      { p: [0, 81, 0], kind: 'buff' },
      { p: [14, 29, 0], kind: 'cash' },
    ],
  };
}

// ── q5 «ПЛОХОЕ МЕСТО» — НАСТОЯЩИЙ ЛАБИРИНТ (по мотивам DM4) ─────────────────
function buildQ5(): QMapData {
  const H = 26; // высота коридоров — прыжком не перелезть, потолок над всем
  const pieces: QPiece[] = [slab(0, 0, 0, 220, 220, 4)];
  shell(pieces, 0, 0, 220, 220, H);                     // глухая коробка + потолок
  const W = (x: number, z: number, w: number, d: number) => pieces.push(wall(x, 0, z, w, H, d));
  // центральный зал 70×70 (стены с 4 проходами) + ЯМА в центре
  const s70 = (70 - 20) / 2;
  for (const s of [-1, 1]) {
    W(-(10 + s70 / 2), s * 35, s70, 3); W(10 + s70 / 2, s * 35, s70, 3);
    W(s * 35, -(10 + s70 / 2), 3, s70); W(s * 35, 10 + s70 / 2, 3, s70);
  }
  pieces.push( // яма: пролом в полу зала
    slab(0, -14, 0, 24, 24, 2),
    wall(-12, -14, 0, 2, 14, 24), wall(12, -14, 0, 2, 14, 24),
    wall(0, -14, -12, 24, 14, 2), wall(0, -14, 12, 24, 14, 2),
  );
  // ЛАБИРИНТ: кольца стен с разрывами + шипы-тупики (рисунок руками)
  // кольцо r≈72
  W(-45, -72, 60, 3); W(48, -72, 50, 3);       // север: два куска, проход у x≈-8
  W(45, 72, 60, 3); W(-48, 72, 50, 3);         // юг зеркально
  W(-72, -20, 3, 76); W(-72, 62, 3, 40);       // запад: проходы у z≈24
  W(72, 20, 3, 76); W(72, -62, 3, 40);         // восток зеркально
  // внутренние шипы между кольцом и залом
  W(-20, -54, 60, 3); W(20, 54, 60, 3);
  W(-54, 18, 3, 44); W(54, -18, 3, 44);
  // внешние отсеки-тупики (карманы с лутом)
  W(-96, -40, 40, 3); W(96, 40, 40, 3);
  W(-40, 96, 3, 40); W(40, -96, 3, 40);
  const pads: QPad[] = [{ p: [0, -13, 0], force: lift(24) }]; // из ямы
  return {
    pieces, pads,
    spawns: [[-95, 4, -95], [95, 4, 95], [-95, 4, 95], [95, 4, -95], [0, 4, -55]],
    playerSpawn: [-95, 4, 60],
    orbs: [
      { p: [0, -12, 0], kind: 'cash' },     // приманка в яме
      { p: [-100, 3, -55], kind: 'buff' },  // тупик-карман
      { p: [100, 3, 55], kind: 'buff' },
    ],
  };
}

export const QUAKE_MAPS: Record<Exclude<MapId, 'donut' | 'tower'>, QMapData> = {
  q1: buildQ1(), q2: buildQ2(), q3: buildQ3(), q4: buildQ4(), q5: buildQ5(),
};

// ── shared lookups ──────────────────────────────────────────────────────────
const DONUT_ANCHORS: [number, number, number][] = [
  [0, 86, 0], [0, 86, 0], [0, 86, 0],
  [100, 86, 100], [-100, 86, 100], [100, 86, -100], [-100, 86, -100],
];

const TOWER_ANCHORS: [number, number, number][] = [
  [40, 4, 40], [-40, 4, 40], [40, 4, -40], [-40, 4, -40], [0, 4, 60],
];

export function getSpawnAnchors(): [number, number, number][] {
  const m = currentMap();
  if (m === 'donut') return DONUT_ANCHORS;
  if (m === 'tower') return TOWER_ANCHORS;
  return QUAKE_MAPS[m].spawns;
}

export function getPlayerSpawn(): [number, number, number] {
  const m = currentMap();
  if (m === 'donut') return [12 + (Math.random() - 0.5) * 12, 84, 12 + (Math.random() - 0.5) * 12];
  if (m === 'tower') return [(Math.random() - 0.5) * 20, 5, 25 + (Math.random() - 0.5) * 10];
  const s = QUAKE_MAPS[m].playerSpawn;
  return [s[0] + (Math.random() - 0.5) * 3, s[1], s[2] + (Math.random() - 0.5) * 3];
}
