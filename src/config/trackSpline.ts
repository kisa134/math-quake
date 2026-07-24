import * as THREE from 'three';

/**
 * V2 WS-B — the train track + the drift road deck (single source of truth).
 *
 * The track is a DETERMINISTIC closed CatmullRom loop threading the city
 * volume: radius ~150–300 around the origin, altitude swinging y≈60–200 so the
 * train has real climbs (slow, grinding) and dives (screaming). Both Train.tsx
 * (movement + rail tube) and any future minimap read THIS curve.
 */
const TRACK_POINTS: [number, number, number][] = [
  [920, 190, 40],     // east — cruising height
  [740, 290, 600],   // climb NE
  [240, 400, 940],    // summit north — highest point of the loop
  [-380, 330, 860],   // start of the big dive
  [-860, 210, 480],  // diving west
  [-1060, 130, -140],   // valley west — lowest + fastest
  [-720, 124, -720],  // low sweep SW
  [-160, 200, -980],  // climbing south
  [500, 310, -820],  // high bank SE
  [940, 250, -360],   // descending back to start
];

export const TRACK_CURVE = new THREE.CatmullRomCurve3(
  TRACK_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
  true,           // closed loop
  'catmullrom',
  0.6,            // a bit tighter than centripetal default → snakier corners
);

/** Total arc length (used by Train.tsx to wrap distance → curve param). */
export const TRACK_LENGTH = TRACK_CURVE.getLength();

/**
 * The drift road deck: a flat rectangular platform hanging in the volume where
 * the cars live. Cars.tsx renders + collides it; position is exported so other
 * systems (spawns, minimap) can point at it.
 */
export const ROAD_DECK = {
  x: 0,
  y: 30,
  z: 170,   // pushed out of the central arena so it reads as its own "street"
  w: 120,   // full width  (x)
  h: 2,     // full thickness (y)
  d: 80,    // full depth  (z)
} as const;

/** Convenience: y of the deck's drivable surface. */
export const ROAD_DECK_TOP = ROAD_DECK.y + ROAD_DECK.h / 2;
