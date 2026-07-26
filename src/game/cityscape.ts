/**
 * WS-A — 1-km cyberpunk CITY generator for Math Quake V2.
 *
 * `generateCity()` is a PURE, DETERMINISTIC function (mulberry32-seeded PRNG,
 * zero Math.random) so every networked client builds an identical city. It
 * returns plain data; <Cityscape/> turns it into 3 InstancedMeshes (tower
 * bodies + emissive light strips + roof caps), 2 InstancedMeshes of drifting
 * candlesticks (bull green / bear red — the aftermath of an explosion inside a
 * trading terminal), a ≤100-RigidBody playable climb skeleton, and 4 giant
 * rotating GLB "planets".
 *
 * Layout:
 *  - The existing arena (temples at ±200, spawn y=84) stays clear: no building
 *    inside r<300 or within 75u of an outer temple.
 *  - 12 seeded downtown clusters + scatter fill an annulus r 300→1150.
 *    Heights 60–240 with ~16% supertall spikes 320→1000 → a jagged 1-km skyline.
 *  - The climb is a golden-angle helix of 16 stations from y≈95 to y≈950:
 *    deck (+jump pad) per station, mid steppers every other gap, ice decks
 *    (friction:1) every 4th station, metal decks every 5th, and 3 vertical
 *    metal walls for magnetic boots. Half the decks get a "support tower"
 *    spawned directly underneath so they read as real rooftops. 12 extra
 *    spur rooftops on tall buildings serve as grapple landings.
 */

// ---------------------------------------------------------------- types ----

export interface Inst {
  pos: [number, number, number];
  scale: [number, number, number];
  color: string;
}

export interface CandleInst extends Inst {
  phase: number;  // per-candle sin offset
  speed: number;  // drift speed (rad/s)
  amp: number;    // vertical drift amplitude (units)
}

export type ClimbKind = 'floor' | 'wall' | 'pad';

export interface ClimbPiece {
  pos: [number, number, number];
  size: [number, number, number];
  kind: ClimbKind;
  color: string;
  friction?: number;   // ice override (low, e.g. 1)
  isMetal?: boolean;   // magnetic-boots surface
  jumpForce?: number;  // pads only
}

export type PlanetId = 'skull' | 'bomber' | 'zombie' | 'throne';

export interface PlanetSpot {
  assetId: PlanetId;
  pos: [number, number, number];
  scale: number;
  spin: number; // rad/s around Y
}

export interface CityData {
  towers: Inst[];   // dark instanced bodies
  strips: Inst[];   // emissive vertical light strips
  roofs: Inst[];    // emissive roof caps
  bulls: CandleInst[];
  bears: CandleInst[];
  climb: ClimbPiece[]; // becomes fixed RigidBodies (≤100)
  planets: PlanetSpot[];
  topY: number;
  roofSpots: Array<[number, number, number]>; // V7.5: firework launch pads (spur roofs)
}

// ----------------------------------------------------------------- prng ----

/** Deterministic PRNG (mulberry32). Same seed → same city on every client. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------------------------------------------------- palette ----

// Mirrors src/theme.ts (kept local so cityscape stays a dependency-free pure
// module). World = cold set only.
// V3 Bosch-psychedelia: wine/gold/forest (owner reference boards)
// V5 «Монохром живого рынка»: башни = графит 2 тона; стрипы красятся ЕДИНЫМ
// живым акцентом в рантайме (game/accent.ts, дирижирует рынок) — здесь белые.
const NEON = ['#ffffff'];
const TOWER_TINTS = ['#131110', '#1b1815'];
const COLD = ['#d8d2c4', '#b9b2a2', '#8f8878', '#d8d2c4', '#b9b2a2', '#8f8878'];
const ICE_COLOR = '#e8e0d0';
const METAL_COLOR = '#9a8f7a';
const BULL = '#2fbf71';
const BEAR = '#c9184a';

const GROUND_Y = -50;      // void floor plane
const GRAVITY = 30;        // must match <Physics gravity> in Game.tsx
const TEMPLES: Array<[number, number]> = [[-200, -200], [200, -200], [-200, 200], [200, 200]];

/** Launch velocity needed to rise `h` units under GRAVITY, with headroom. */
function padForceFor(h: number): number {
  return Math.round(Math.sqrt(2 * GRAVITY * (h + 10)) + 4);
}

// ------------------------------------------------------------ generator ----

export const CITY_SEED = 0xc17ce5;

export function generateCity(seed = CITY_SEED): CityData {
  const rnd = mulberry32(seed);

  const towers: Inst[] = [];
  const strips: Inst[] = [];
  const roofs: Inst[] = [];
  const climb: ClimbPiece[] = [];

  /** Push one building (body + strips + optional roof cap). */
  const addBuilding = (x: number, z: number, w: number, h: number, d: number, cap: boolean) => {
    towers.push({
      pos: [x, GROUND_Y + h / 2, z],
      scale: [w, h, d],
      color: TOWER_TINTS[Math.floor(rnd() * TOWER_TINTS.length)],
    });
    // 1–3 vertical emissive strips on random faces.
    const nStrips = 1 + (rnd() < 0.7 ? 1 : 0) + (h > 1500 ? 1 : 0);
    for (let s = 0; s < nStrips; s++) {
      const face = Math.floor(rnd() * 4);
      const along = (rnd() - 0.5) * 0.7; // offset along the face
      const sh = h * (0.55 + rnd() * 0.35);
      const sy = GROUND_Y + sh / 2 + h * 0.08;
      let sx = x, sz = z, sw = 3.2, sd = 3.2;
      if (face === 0) { sx = x + w / 2 + 0.9; sz = z + d * along; sd = 2.8; }
      else if (face === 1) { sx = x - w / 2 - 0.9; sz = z + d * along; sd = 2.8; }
      else if (face === 2) { sz = z + d / 2 + 0.9; sx = x + w * along; sw = 2.8; }
      else { sz = z - d / 2 - 0.9; sx = x + w * along; sw = 2.8; }
      strips.push({ pos: [sx, sy, sz], scale: [sw, sh, sd], color: NEON[Math.floor(rnd() * NEON.length)] });
    }
    if (cap) {
      roofs.push({
        pos: [x, GROUND_Y + h + 0.7, z],
        scale: [w * 0.94, 1.4, d * 0.94],
        color: NEON[Math.floor(rnd() * NEON.length)],
      });
    }
  };

  // --- downtown clusters + scatter across the annulus r 300→1150 -----------
  const clusters: Array<[number, number]> = [];
  for (let c = 0; c < 12; c++) {
    const a = rnd() * Math.PI * 2;
    const r = 900 + rnd() * 1700;
    clusters.push([Math.cos(a) * r, Math.sin(a) * r]);
  }

  // V8.6 PERF: диета после включения блёсток — эти башни теперь РЕАЛЬНО
  // рендерятся (шейдер чинился), 780 гигантов убивали слабый GPU филлрейтом.
  const BUILDING_TARGET = 520;
  let placed = 0;
  let guard = 0;
  while (placed < BUILDING_TARGET && guard++ < BUILDING_TARGET * 6) {
    let x: number, z: number;
    if (rnd() < 0.6 && placed >= 130) {
      const [cx, cz] = clusters[Math.floor(rnd() * clusters.length)];
      x = cx + (rnd() - 0.5) * 450;
      z = cz + (rnd() - 0.5) * 450;
    } else {
      const a = rnd() * Math.PI * 2;
      // первые 130 размещений форсируются в пояс 350-800
      const r = placed < 130 ? 350 + rnd() * 450 : 350 + 2450 * Math.pow(rnd(), 0.8);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    const r = Math.hypot(x, z);
    if (r < 350 || r > 2800) continue;
    if (TEMPLES.some(([tx, tz]) => Math.max(Math.abs(x - tx), Math.abs(z - tz)) < 75)) continue;

    let h = 150 + rnd() * rnd() * 600;            // V6: 150–750 base skyline
    if (rnd() < 0.08) h = 1000 + rnd() * 2200;    // V8.6 perf: supertalls реже и до 3200
    if (r < 700) h = 60 + rnd() * rnd() * 240;    // внутренний пояс низкий — сайтлайны плиты живы
    const w = 30 + rnd() * 60;
    const d = 30 + rnd() * 60;
    addBuilding(x, z, w, h, d, true);
    placed++;
  }

  // --- spur rooftops: physics landings on 12 tall buildings (grapple bait) --
  const roofSpots: Array<[number, number, number]> = [];
  let spurs = 0;
  for (let i = 0; i < towers.length && spurs < 12; i += 7) {
    const t = towers[i];
    const h = t.scale[1];
    if (h < 400 || h > 2600) continue;
    const side = Math.min(t.scale[0], t.scale[2]) * 0.8;
    const s = Math.min(side, 20);
    const ice = spurs % 3 === 2;
    const metal = spurs % 4 === 1;
    climb.push({
      pos: [t.pos[0], GROUND_Y + h + 0.75, t.pos[2]],
      size: [s, 1.5, s],
      kind: 'floor',
      color: ice ? ICE_COLOR : metal ? METAL_COLOR : COLD[spurs % COLD.length],
      ...(ice ? { friction: 1 } : {}),
      ...(metal && !ice ? { isMetal: true } : {}),
    });
    roofSpots.push([t.pos[0], GROUND_Y + h + 2, t.pos[2]]);
    spurs++;
  }

  // --- climb skeleton: golden-angle helix, y≈95 → y≈950 --------------------
  const STATIONS = 16;
  const GOLDEN = 2.399963;
  const stationPos: Array<[number, number, number]> = [];
  let y = 95;
  for (let i = 0; i < STATIONS; i++) {
    const angle = 0.6 + i * GOLDEN;
    const radius = 260 + 140 * Math.sin(i * 0.9) + i * 12; // V6: ~260 → ~620
    stationPos.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
    y += 72 + rnd() * 10; // V6: последняя станция ≈ 1250
  }

  // Bridge from the central temple (spawn y=84) out to station 0.
  const dir0 = Math.atan2(stationPos[0][2], stationPos[0][0]);
  climb.push({ pos: [Math.cos(dir0) * 32, 86, Math.sin(dir0) * 32], size: [9, 1.5, 9], kind: 'floor', color: COLD[3] });
  climb.push({ pos: [Math.cos(dir0) * 64, 90, Math.sin(dir0) * 64], size: [8, 1.5, 8], kind: 'floor', color: COLD[4] });

  for (let i = 0; i < STATIONS; i++) {
    const [sx, sy, sz] = stationPos[i];
    const t = i / (STATIONS - 1);
    const deckS = (i === STATIONS - 1 ? 22 : 14 - t * 6) + (rnd() - 0.5) * 2; // shrink 14→8; big summit
    const isIce = i % 4 === 2;
    const isMetal = !isIce && i % 5 === 3;

    climb.push({
      pos: [sx, sy, sz],
      size: [deckS, 1.5, deckS],
      kind: 'floor',
      color: isIce ? ICE_COLOR : isMetal ? METAL_COLOR : COLD[i % COLD.length],
      ...(isIce ? { friction: 1 } : {}),
      ...(isMetal ? { isMetal: true } : {}),
    });

    // Support tower under every other deck → reads as a real rooftop.
    if (i % 2 === 0) {
      const bh = sy - 0.75 - GROUND_Y;
      addBuilding(sx, sz, deckS * 1.1, bh, deckS * 1.1, false); // no cap (deck IS the roof)
    }

    // Jump pad launching to the next station.
    if (i < STATIONS - 1) {
      const dy = stationPos[i + 1][1] - sy;
      climb.push({
        pos: [sx, sy + 1.5 / 2 + 0.5, sz],
        size: [4, 1, 4],
        kind: 'pad',
        color: BULL,
        jumpForce: padForceFor(dy),
      });
      // Mid stepping stone every other gap (recovery / alternate route).
      if (i % 2 === 0) {
        const [nx, ny, nz] = stationPos[i + 1];
        climb.push({
          pos: [(sx + nx) / 2 + (rnd() - 0.5) * 14, (sy + ny) / 2, (sz + nz) / 2 + (rnd() - 0.5) * 14],
          size: [6.5, 1.4, 6.5],
          kind: 'floor',
          color: COLD[(i + 2) % COLD.length],
        });
      }
    }

    // 3 vertical metal walls for magnetic boots (stations 4, 8, 12).
    if (i === 4 || i === 8 || i === 12) {
      const away = Math.atan2(sz, sx);
      climb.push({
        pos: [sx + Math.cos(away) * (deckS / 2 + 1.2), sy + 9.5, sz + Math.sin(away) * (deckS / 2 + 1.2)],
        size: [1.2, 18, 10],
        kind: 'wall',
        color: METAL_COLOR,
        isMetal: true,
      });
    }
  }

  const topY = stationPos[STATIONS - 1][1];

  // --- 4 giant planet set-pieces spread through the city volume ------------
  const planets: PlanetSpot[] = [
    { assetId: 'skull',  pos: [ 480, 380, -430], scale: 120, spin: 0.06 },
    { assetId: 'bomber', pos: [-700, 800,  530], scale: 160, spin: 0.045 },
    { assetId: 'zombie', pos: [ 650, 1400, 650], scale: 190, spin: 0.035 },
    { assetId: 'throne', pos: [  50, 2000, -760], scale: 230, spin: 0.028 },
  ];

  // --- floating candle swarms (the trading-terminal explosion) -------------
  const bulls: CandleInst[] = [];
  const bears: CandleInst[] = [];
  const swarmCenters: Array<[number, number, number]> = [
    [0, 900, 0], // core blast — на высоте пончика
    ...planets.map((p) => p.pos),
  ];
  const CANDLE_COUNT = 320;
  for (let i = 0; i < CANDLE_COUNT; i++) {
    let cx: number, cy: number, cz: number;
    if (rnd() < 0.62) {
      // shell around a swarm center — debris of the explosion
      const [wx, wy, wz] = swarmCenters[Math.floor(rnd() * swarmCenters.length)];
      const a = rnd() * Math.PI * 2;
      const b = (rnd() - 0.5) * Math.PI;
      const dist = 100 + rnd() * 420;
      cx = wx + Math.cos(a) * Math.cos(b) * dist;
      cy = Math.max(70, wy + Math.sin(b) * dist * 0.7);
      cz = wz + Math.sin(a) * Math.cos(b) * dist;
    } else {
      // loose scatter through the whole city cylinder
      const a = rnd() * Math.PI * 2;
      const r = 150 + rnd() * 1400;
      cx = Math.cos(a) * r;
      cy = 150 + rnd() * 2200;
      cz = Math.sin(a) * r;
    }
    const w = 2 + rnd() * 3;
    const h = 6 + rnd() * 14;
    const isBull = rnd() < 0.55;
    const candle: CandleInst = {
      pos: [cx, cy, cz],
      scale: [w, h, w],
      color: isBull ? BULL : BEAR,
      phase: rnd() * Math.PI * 2,
      speed: 0.15 + rnd() * 0.5,
      amp: 2 + rnd() * 6,
    };
    (isBull ? bulls : bears).push(candle);
  }

  return { towers, strips, roofs, bulls, bears, climb, planets, topY, roofSpots };
}

// V7.5 Ц3: module-cached seeded city — Euphoria/LowerSwarm read the SAME data
// the renderer uses (one seed → both clients identical).
let _city: CityData | null = null;
export const getCity = (): CityData => (_city ??= generateCity());
