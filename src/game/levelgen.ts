/**
 * WS-4 — Data-driven vertical climb for Math Quake.
 *
 * `generateLevels()` is a PURE, DETERMINISTIC function (seeded PRNG, no
 * Math.random at call time) so every networked client builds an identical
 * tower. It returns plain descriptors; <Levels/> turns them into physics
 * primitives. Keeping geometry as data (not JSX) means the layout can be
 * tuned, serialised, or hot-swapped without touching the renderer.
 *
 * Layout: 30 floors stacked on Y, climbing UP around the existing central
 * spire (x=0,z=0, temple top ≈ y=81, player spawn y=84). Floor 0 sits just
 * above the spire and each floor is ~12u higher, so the top floor lands near
 * y≈444. Difficulty grows with height: platforms get smaller and the ring
 * radius grows (bigger gaps), fewer islands, and the jump-pads that carry you
 * to the next floor get a touch stronger to cover the widening climb.
 *
 * Surface features live here too:
 *  - ICE  platforms carry `friction: 1` (vs MOVE.friction 8) → slippery.
 *  - METAL platforms/walls carry `isMetal: true` → magnetic boots can stick.
 *  - ANCHOR slots are named empty coordinates where giant set-pieces
 *    (skull / throne / oracle-eye / crown) can be dropped in later.
 */

export type Kind = 'floor' | 'wall' | 'pad';

export interface PlatformDesc {
  /** world position of the mesh centre */
  pos: [number, number, number];
  /** box size (x,y,z). For pads, x=z=radius*2 conceptually; renderer uses a cylinder. */
  size: [number, number, number];
  kind: Kind;
  /** pads only: upward launch velocity written to newY */
  jumpForce?: number;
  /** per-surface ground friction override (ice = low, e.g. 1) */
  friction?: number;
  /** magnetic-boots stick surface */
  isMetal?: boolean;
  /** hex color for the emissive matrix material */
  color: string;
}

export interface FloorDesc {
  index: number;
  y: number;
  /** 0 (bottom, easy) → 1 (top, hard) */
  difficulty: number;
  platforms: PlatformDesc[];
}

export interface AnchorDesc {
  id: string;
  pos: [number, number, number];
  /** human note describing the giant set-piece intended for this slot */
  note: string;
}

export interface LevelData {
  floors: FloorDesc[];
  anchors: AnchorDesc[];
  /** highest occupied Y — handy for camera / skybox / kill-plane logic later */
  topY: number;
}

/** Deterministic PRNG (mulberry32). Same seed → same tower on every client. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cold world palette (mirrors src/theme.ts; kept local so levelgen stays a
// dependency-free pure module). Warm colors are reserved for actors.
const COLD = ['#3a0ca3', '#4361ee', '#7209b7', '#4cc9f0', '#00f5d4', '#f72585'];
const ICE_COLOR = '#9be7ff';   // pale frozen cyan — reads as slippery
const METAL_COLOR = '#8a94b8'; // steely blue-grey — reads as magnetic plating

const FLOOR_COUNT = 30;
const BASE_Y = 96;       // first floor sits just above the central temple top (~81)
const SPACING = 12;      // vertical gap between floors
const GRAVITY = 30;      // must match <Physics gravity> in Game.tsx

/** Launch velocity needed to rise `h` units under GRAVITY, with headroom. */
function padForceFor(h: number): number {
  return Math.round(Math.sqrt(2 * GRAVITY * (h + 6)) + 3);
}

export function generateLevels(seed = 0x1337): LevelData {
  const rnd = mulberry32(seed);
  const floors: FloorDesc[] = [];
  const anchors: AnchorDesc[] = [];

  for (let i = 0; i < FLOOR_COUNT; i++) {
    const difficulty = i / (FLOOR_COUNT - 1); // 0..1
    const y = BASE_Y + i * SPACING;

    // Difficulty curve: fewer, smaller, farther-out platforms as we climb.
    const ringCount = Math.round(8 - difficulty * 4);        // 8 → 4
    const radius = 42 + difficulty * 34 + Math.sin(i * 1.7) * 4; // 42 → ~76, wobbled
    const platSize = 13 - difficulty * 7;                    // 13 → 6
    const platThick = 1.4;

    // Which special surface (if any) this whole floor themes toward.
    const isIceFloor = i % 5 === 2;   // floors 2,7,12,17,22,27
    const isMetalFloor = i % 7 === 3; // floors 3,10,17,24  (17 is both → metal wins on walls)

    const platforms: PlatformDesc[] = [];

    // --- ring of platforms around the spire, jittered by the seed ---
    const startAngle = rnd() * Math.PI * 2;
    let padIndex = Math.floor(rnd() * ringCount); // one ring platform hosts the launch pad
    for (let r = 0; r < ringCount; r++) {
      const a = startAngle + (r / ringCount) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      const rad = radius + (rnd() - 0.5) * 10;
      const px = Math.cos(a) * rad;
      const pz = Math.sin(a) * rad;
      const s = platSize + (rnd() - 0.5) * 3;

      const ice = isIceFloor && rnd() > 0.35;   // most of an ice floor is slick
      const metal = !ice && isMetalFloor && rnd() > 0.4;

      platforms.push({
        pos: [px, y, pz],
        size: [s, platThick, s],
        kind: 'floor',
        color: ice ? ICE_COLOR : metal ? METAL_COLOR : COLD[(i + r) % COLD.length],
        ...(ice ? { friction: 1 } : {}),
        ...(metal ? { isMetal: true } : {}),
      });

      // Launch pad on the chosen ring platform → carries you to the next floor.
      if (r === padIndex && i < FLOOR_COUNT - 1) {
        platforms.push({
          pos: [px, y + platThick / 2 + 0.5, pz],
          size: [4, 1, 4], // renderer draws a cylinder r≈4
          kind: 'pad',
          jumpForce: padForceFor(SPACING) + Math.round(difficulty * 6),
          color: '#00f5d4',
        });
      }
    }

    // --- a couple of scattered "island" stepping stones (thin out with height) ---
    const islands = Math.max(0, 3 - Math.round(difficulty * 3)); // 3 → 0
    for (let k = 0; k < islands; k++) {
      const a = rnd() * Math.PI * 2;
      const rad = 12 + rnd() * (radius * 0.5);
      const s = (platSize * 0.7) + (rnd() - 0.5) * 2;
      platforms.push({
        pos: [Math.cos(a) * rad, y + (rnd() - 0.5) * 3, Math.sin(a) * rad],
        size: [s, platThick, s],
        kind: 'floor',
        color: COLD[(i + k + 3) % COLD.length],
      });
    }

    // --- metal climbing walls on metal-themed floors: vertical plates the
    // magnetic boots can cling to (walk up / hang under). Two facing plates. ---
    if (isMetalFloor) {
      const wr = radius * 0.62;
      const wallH = 16;
      platforms.push({
        pos: [wr, y + wallH / 2, 0],
        size: [1.2, wallH, platSize * 1.6],
        kind: 'wall',
        color: METAL_COLOR,
        isMetal: true,
      });
      platforms.push({
        pos: [-wr, y + wallH / 2, 0],
        size: [1.2, wallH, platSize * 1.6],
        kind: 'wall',
        color: METAL_COLOR,
        isMetal: true,
      });
    }

    floors.push({ index: i, y, difficulty, platforms });
  }

  // --- Named anchor slots for giant set-pieces (positioned at floor centres,
  // hovering a little above the deck so a model has room to sit). ---
  const anchorAt = (i: number, id: string, note: string, dy = 8) =>
    anchors.push({ id, pos: [0, BASE_Y + i * SPACING + dy, 0], note });
  anchorAt(0, 'GATEKEEPER_SKULL', 'Giant chrome skull guarding the base of the climb');
  anchorAt(7, 'BULL_COLOSSUS', 'Colossal green bull statue mid-tower', 10);
  anchorAt(14, 'IRON_THRONE', 'Metal throne set-piece (pairs with the metal walls)', 6);
  anchorAt(21, 'ORACLE_EYE', 'Floating oracle eye / data-orb over the ice tier', 12);
  anchorAt(29, 'APEX_CROWN', 'The summit crown / final boss arena', 14);

  const topY = BASE_Y + (FLOOR_COUNT - 1) * SPACING;
  return { floors, anchors, topY };
}
